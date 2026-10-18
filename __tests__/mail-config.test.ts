import { describe, expect, it } from 'vitest';
import { hasRealEmail, telegramEmail } from '@/lib/mail-config';

describe('hasRealEmail', () => {
    it('treats Telegram placeholders as not deliverable', () => {
        expect(hasRealEmail(telegramEmail('123'))).toBe(false);
        expect(hasRealEmail(undefined)).toBe(false);
        expect(hasRealEmail('a@b.com')).toBe(true);
    });
});
