import { describe, expect, it, vi } from 'vitest';
import { isTransientMailError, withMailRetry } from '@/lib/nodemailer/retry';

// The error Gmail produced in production when the connection dropped before TLS finished
const dropped = Object.assign(new Error('Client network socket disconnected before secure TLS connection was established'), { code: 'ESOCKET', originalCode: 'ECONNRESET' });
const badLogin = Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535 });

describe('withMailRetry', () => {
    it('retries a dropped connection and succeeds', async () => {
        const send = vi.fn().mockRejectedValueOnce(dropped).mockRejectedValueOnce(dropped).mockResolvedValue({ messageId: 'ok' });
        await expect(withMailRetry(send, [0, 0])).resolves.toEqual({ messageId: 'ok' });
        expect(send).toHaveBeenCalledTimes(3);
    });

    it('gives up after the last retry', async () => {
        const send = vi.fn().mockRejectedValue(dropped);
        await expect(withMailRetry(send, [0, 0])).rejects.toBe(dropped);
        expect(send).toHaveBeenCalledTimes(3);
    });

    it('does not retry a wrong password', async () => {
        const send = vi.fn().mockRejectedValue(badLogin);
        await expect(withMailRetry(send, [0, 0])).rejects.toBe(badLogin);
        expect(send).toHaveBeenCalledTimes(1);
    });
});

describe('isTransientMailError', () => {
    it('treats network drops and SMTP 4xx as transient', () => {
        expect(isTransientMailError(dropped)).toBe(true);
        expect(isTransientMailError({ code: 'EENVELOPE', responseCode: 421 })).toBe(true);
        expect(isTransientMailError(badLogin)).toBe(false);
        expect(isTransientMailError(null)).toBe(false);
    });
});
