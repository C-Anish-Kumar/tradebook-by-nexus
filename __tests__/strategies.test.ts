import { describe, expect, it } from 'vitest';
import { enabledStrategies, scannerStrategies, setupCacheKey, STRATEGIES, STRATEGY_1, STRATEGY_2 } from '@/lib/strategies';

describe('strategy registry', () => {
    it('runs Strategy 2 only for now', () => {
        expect(enabledStrategies().map((s) => s.id)).toEqual(['breakout']);
        expect(STRATEGY_1.enabled).toBe(false);
        expect(STRATEGY_2.enabled).toBe(true);
    });

    it('gives every strategy its own Telegram switch and a unique label', () => {
        const all = Object.values(STRATEGIES);
        expect(new Set(all.map((s) => s.telegramPref)).size).toBe(all.length);
        expect(new Set(all.map((s) => s.label)).size).toBe(all.length);
    });

    it('only lists enabled scanners on the Setups page', () => {
        expect(scannerStrategies().every((s) => s.enabled && s.scanner)).toBe(true);
    });

    it('keeps the original cache key for breakout so stored scans survive, and namespaces the rest', () => {
        expect(setupCacheKey('breakout', 'MU')).toBe('setup:MU');
        expect(setupCacheKey('ema_supertrend', 'MU')).toBe('setup:ema_supertrend:MU');
    });
});
