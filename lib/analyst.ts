// Client for the TradingAgents service in analyst-service/ (hosted outside Vercel: a run takes minutes)

const SERVICE_URL = process.env.ANALYST_SERVICE_URL?.replace(/\/+$/, '');
const API_KEY = process.env.ANALYST_API_KEY;

export const analystEnabled = Boolean(SERVICE_URL && API_KEY);

export type AnalystJob = {
    id: string;
    status: 'queued' | 'running' | 'done' | 'error';
    rating?: string;
    report_html?: string;
    error?: string;
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
    if (!analystEnabled) throw new Error('AI Analyst is not configured');
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Analyst-Key': API_KEY! };
    // A private Hugging Face Space also wants a token
    if (process.env.ANALYST_HF_TOKEN) headers.Authorization = `Bearer ${process.env.ANALYST_HF_TOKEN}`;

    const res = await fetch(`${SERVICE_URL}${path}`, { ...init, headers, cache: 'no-store' });
    if (res.status === 404) throw new AnalystJobMissingError();
    if (!res.ok) throw new Error(`Analyst service ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json() as Promise<T>;
}

export class AnalystJobMissingError extends Error {
    constructor() {
        super('The analyst service no longer has this job (it probably restarted)');
    }
}

export const startAnalystJob = (ticker: string, date: string) =>
    call<{ id: string }>('/analyses', { method: 'POST', body: JSON.stringify({ ticker, date }) });

export const getAnalystJob = (id: string) => call<AnalystJob>(`/analyses/${encodeURIComponent(id)}`);
