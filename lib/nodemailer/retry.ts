// Gmail sometimes drops a connection before TLS finishes (ECONNRESET / ESOCKET), and Vercel can cut a socket
// that sat idle while the function was frozen. Both are worth a quick retry; a bad password or address is not.
const TRANSIENT = new Set(['ESOCKET', 'ECONNECTION', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND']);

export const isTransientMailError = (error: unknown) => {
    const e = error as { code?: string; originalCode?: string; responseCode?: number } | null;
    if (!e) return false;
    if (TRANSIENT.has(e.code ?? '') || TRANSIENT.has(e.originalCode ?? '')) return true;
    return typeof e.responseCode === 'number' && e.responseCode >= 400 && e.responseCode < 500; // SMTP 4xx: try again later
};

/** Runs `send`, retrying transient failures after each delay in `delaysMs` (3 tries by default). */
export async function withMailRetry<T>(send: () => Promise<T>, delaysMs: number[] = [1000, 3000]): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await send();
        } catch (error) {
            if (attempt >= delaysMs.length || !isTransientMailError(error)) throw error;
            console.warn(`Email send failed (${(error as { code?: string }).code}), retrying in ${delaysMs[attempt]}ms`);
            await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
        }
    }
}
