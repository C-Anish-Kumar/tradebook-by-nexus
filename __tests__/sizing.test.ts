import { describe, expect, it } from 'vitest';
import { daysUntil, sizeShares } from '@/lib/setups';
import { isScannable } from '@/lib/symbols';

describe('sizeShares', () => {
    it('sizes by risk when cash allows', () => {
        expect(sizeShares(10_000, 1, 100, 95)).toMatchObject({ shares: 20, cost: 2000, risk: 100, capped: false });
    });
    it('never spends more than the account when the stop is very tight', () => {
        const s = sizeShares(1000, 1, 100, 99.78)!;
        expect(s.shares).toBe(10);
        expect(s.cost).toBeLessThanOrEqual(1000);
        expect(s.capped).toBe(true);
    });
    it('flags a share that costs more than the account', () => {
        expect(sizeShares(500, 1, 700, 650)).toMatchObject({ shares: 0, affordable: false });
    });
    it('rejects bad input', () => expect(sizeShares(0, 1, 10, 9)).toBeNull());
});

describe('daysUntil', () => {
    it('counts calendar days', () => expect(daysUntil('2026-10-20', new Date('2026-10-18T22:00:00Z'))).toBe(2));
    it('is null for junk', () => expect(daysUntil('soon')).toBeNull());
});

describe('isScannable', () => {
    it.each([['AAPL', true], ['SHOP.TO', true], ['NASDAQ:AAPL', false], ['7203.T', false], ['BRK.B', false]])('%s', (s, ok) => expect(isScannable(s)).toBe(ok));
});
