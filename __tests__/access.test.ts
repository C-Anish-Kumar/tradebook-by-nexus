import { afterEach, describe, expect, it, vi } from 'vitest';
import { allowedEmails, isAllowedEmail } from '@/lib/better-auth/access';

describe('sign-in allowlist', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('lets only the owner in by default', () => {
        vi.stubEnv('ALLOWED_EMAILS', '');
        expect(allowedEmails()).toEqual(['anish03209@gmail.com']);
        expect(isAllowedEmail('anish03209@gmail.com')).toBe(true);
        expect(isAllowedEmail(' Anish03209@Gmail.com ')).toBe(true);
        expect(isAllowedEmail('someone.else@gmail.com')).toBe(false);
    });

    it('refuses missing addresses', () => {
        expect(isAllowedEmail(undefined)).toBe(false);
        expect(isAllowedEmail(null)).toBe(false);
        expect(isAllowedEmail('')).toBe(false);
    });

    it('reads a comma-separated override', () => {
        vi.stubEnv('ALLOWED_EMAILS', 'a@example.com, B@example.com,');
        expect(allowedEmails()).toEqual(['a@example.com', 'b@example.com']);
        expect(isAllowedEmail('b@example.com')).toBe(true);
        expect(isAllowedEmail('anish03209@gmail.com')).toBe(false);
    });
});
