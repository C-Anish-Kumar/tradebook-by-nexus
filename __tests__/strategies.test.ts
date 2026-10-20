import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { enabledStrategies, scannerStrategies, setupCacheKey, setupStateKey, STRATEGIES, STRATEGY_1, STRATEGY_2 } from '@/lib/strategies';

describe('strategy registry', () => {
    it('runs the trend breakout and the playbook strategies, with EMA + Supertrend off', () => {
        expect(enabledStrategies().map((s) => s.id)).toEqual([
            'breakout', 'ma_pullback', 'golden_cross', 'breakout_retest', 'volume_bounce',
            'rsi_dip', 'bb_snapback', 'macd_trend', 'td_exhaustion',
        ]);
        expect(STRATEGY_1.enabled).toBe(false);
        expect(STRATEGY_2.enabled).toBe(true);
    });

    it('gives every strategy its own Telegram switch, a unique descriptive name and a plain explanation', () => {
        const all = Object.values(STRATEGIES);
        expect(new Set(all.map((s) => s.telegramPref)).size).toBe(all.length);
        expect(new Set(all.map((s) => s.name)).size).toBe(all.length);
        for (const s of all) {
            expect(s.name).not.toMatch(/^strategy\s*\d/i);
            expect(s.looksAt.length).toBeGreaterThan(1);
        }
    });

    it('has an analyst-service spec for every scanner, so the screener can run it', () => {
        const specs = readFileSync('analyst-service/openstock_analyst/setups.py', 'utf8');
        for (const s of scannerStrategies()) expect(specs).toContain(`"${s.id}": `);
    });

    it('only lists enabled scanners on the Setups page', () => {
        expect(scannerStrategies().every((s) => s.enabled && s.scanner)).toBe(true);
    });

    it('keeps the original cache key for breakout so stored scans survive, and namespaces the rest', () => {
        expect(setupCacheKey('breakout', 'MU')).toBe('setup:MU');
        expect(setupCacheKey('ema_supertrend', 'MU')).toBe('setup:ema_supertrend:MU');
        expect(setupStateKey('breakout', 'MU')).toBe('setup-state:MU');
        expect(setupStateKey('golden_cross', 'MU')).toBe('setup-state:golden_cross:MU');
    });
});
