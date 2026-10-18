import { describe, expect, it } from 'vitest';
import { STRATEGIES } from '@/lib/strategies';
import { setupMessage, sizeShares, sortSetups, transition, type QuantScore, type Setup } from '@/lib/setups';

const base = (over: Partial<Setup> = {}, validated = false): Setup => ({
    ticker: 'MU', date: '2026-10-16', close: 100,
    regime: { trend: 'up', vol: 'low', adx: 28, atr_pct_rank: 0.4 },
    status: 'entry', trigger: 99, params: { swing_n: 5, adx_min: 22, trail_atr: 3 },
    plan: { entry: 100, stop: 94, risk_per_share: 6, risk_pct_of_price: 6, target_2r: 112, target_3r: 118, bars_in_trade: 1, exit_rule: 'x' },
    evidence: { validated, oos_sharpe: 0.5, baselines_sharpe: { buy_hold: 0.4, ma_cross: 0.3 }, deflated_sharpe: 0.4, trials: 18, trades: 20, gates: {} },
    warnings: [], ...over,
});

const quant = (score: number, capped = false): QuantScore => ({
    score, capped, validated: !capped, label: score >= 65 ? 'Good' : 'Fair',
    components: [{ key: 'evidence', label: 'Evidence', points: 10, max: 40, note: 'x' }],
});

describe('sizeShares', () => {
    it('risks the chosen percent of the account, rounded down to whole shares', () => {
        expect(sizeShares(1000, 1, 50, 48)).toEqual({ shares: 5, cost: 250, risk: 10, capped: false, affordable: true });
    });
    it('caps positions at what the account can buy', () => {
        const s = sizeShares(1000, 1, 100, 99.9)!;
        expect(s).toMatchObject({ shares: 10, capped: true });
        expect(s.cost).toBeLessThanOrEqual(1000);
    });
    it('refuses nonsense inputs', () => {
        expect(sizeShares(0, 1, 50, 48)).toBeNull();
        expect(sizeShares(1000, 1, 48, 50)).toBeNull();
        expect(sizeShares(1000, 0, 50, 48)).toBeNull();
    });
});

describe('transition', () => {
    it('stays quiet on first sighting and on no change', () => {
        expect(transition(undefined, 'entry')).toBeNull();
        expect(transition('holding', 'holding')).toBeNull();
        expect(transition('none', 'watch')).toBeNull();
    });
    it('reports a fresh entry and the end of a trade', () => {
        expect(transition('none', 'entry')).toBe('entry');
        expect(transition('watch', 'entry')).toBe('entry');
        expect(transition('holding', 'none')).toBe('exit');
        expect(transition('entry', 'none')).toBe('exit');
    });
    it('does not re-announce a trade already running', () => {
        expect(transition('holding', 'entry')).toBeNull();
    });
});

describe('sortSetups', () => {
    it('puts validated setups first, then actionable ones, unscanned last', () => {
        const rows = [
            { id: 'none', setup: base({ status: 'none' }) },
            { id: 'unscanned', setup: null },
            { id: 'unvalidated-entry', setup: base() },
            { id: 'validated-watch', setup: base({ status: 'watch' }, true) },
        ];
        expect(sortSetups(rows).map((r) => r.id)).toEqual(['validated-watch', 'unvalidated-entry', 'none', 'unscanned']);
    });
});

describe('setupMessage', () => {
    it('always labels unvalidated setups and quotes the stop', () => {
        const msg = setupMessage('<a>MU</a>', base(), 'entry');
        expect(msg).toContain('Unvalidated');
        expect(msg).toContain('stop $94.00');
    });
    it('marks validated setups', () => {
        expect(setupMessage('MU', base({}, true), 'entry')).toContain('Passed every validation gate');
    });
});

describe('quant score', () => {
    it('breaks ties between equally actionable setups by score, highest first, and tolerates old results without one', () => {
        const rows = [
            { id: 'low', setup: base({ quant: quant(40, true) }) },
            { id: 'old', setup: base() },
            { id: 'high', setup: base({ quant: quant(68, true) }) },
        ];
        expect(sortSetups(rows).map((r) => r.id)).toEqual(['high', 'low', 'old']);
    });

    it('shows the score in an entry message, and says when it is capped', () => {
        const msg = setupMessage('MU', base({ quant: quant(68, true) }), 'entry');
        expect(msg).toContain('Quant score: <b>68/100</b> (Good), capped until validated');
        expect(setupMessage('MU', base(), 'entry')).not.toContain('Quant score');
    });

    it('names the strategy that fired', () => {
        const msg = setupMessage('MU', base(), 'entry', STRATEGIES.golden_cross);
        expect(msg).toContain('Golden cross pullback entry');
        expect(msg).toContain('Strategy 4');
        expect(setupMessage('MU', base(), 'exit', STRATEGIES.volume_bounce)).toContain('High-volume bounce trade ended');
    });
});
