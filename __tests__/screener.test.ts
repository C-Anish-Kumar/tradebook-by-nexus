import { describe, expect, it } from 'vitest';
import { ACCOUNT, DEFAULT_RISK, UNIVERSES, riskFor, universeById } from '@/config/universes';
import {
    earningsBadge, filterRows, pairKey, positionFor, signalFor, sortRows, toRows, trackList,
    type AnalystScreenResult, type AnalystScreenRow, type Signal,
} from '@/lib/screener';

const quant = (score: number, validated = false) => ({ score, label: 'Fair' as const, capped: !validated && score === 69, validated, components: [] });

const row = (over: Partial<AnalystScreenRow> = {}): AnalystScreenRow => ({
    ticker: 'AAA', name: 'Aaa Inc', exchange: 'NYSE', sector: 'Technology', market_cap: 1e10,
    universe: 'large_cap', tags: [], strategy: 'breakout', date: '2026-10-19', close: 50,
    status: 'entry', trigger: 49, plan: { entry: 50, stop: 47.5, risk_per_share: 2.5, risk_pct_of_price: 5, target_2r: 55, target_3r: 57.5 },
    regime: { trend: 'up', vol: 'low', adx: 28 }, quant: quant(60), validated: false,
    rel_volume: 1.6, atr_pct: 2.1, avg_dollar_volume: 5e7, spread_pct: 0.1, badges: [],
    ...over,
});

const result = (rows: AnalystScreenRow[]): AnalystScreenResult => ({ date: '2026-10-19', universes: {}, strategies: ['breakout'], rows, problems: [], seconds: 1 });

describe('universe config', () => {
    it('has the three starting universes, in priority order, with unique ids', () => {
        expect(UNIVERSES.map((u) => u.id)).toEqual(['large_cap', 'unusual_volume', 'under_5']);
        expect(new Set(UNIVERSES.map((u) => u.id)).size).toBe(UNIVERSES.length);
    });

    it('keeps risk per trade within the agreed bands', () => {
        expect(riskFor(universeById('large_cap')!).riskPctPerTrade).toBeGreaterThanOrEqual(0.5);
        expect(riskFor(universeById('large_cap')!).riskPctPerTrade).toBeLessThanOrEqual(1);
        const small = riskFor(universeById('under_5')!);
        expect(small.riskPctPerTrade).toBeGreaterThanOrEqual(0.25);
        expect(small.riskPctPerTrade).toBeLessThanOrEqual(0.5);
        expect(small.maxTotalExposurePct).toBeLessThan(100);
        expect(riskFor(universeById('large_cap')!).maxOpenPositions).toBe(DEFAULT_RISK.maxOpenPositions);
    });

    it('scans only listed exchanges and keeps small caps quiet on Telegram with higher slippage', () => {
        const u5 = universeById('under_5')!;
        expect(u5.filters.exchanges).toEqual(['NYSE', 'NASDAQ', 'AMEX']);
        expect(u5.filters.price).toEqual({ min: 1, max: 5 });
        expect(u5.telegram.enabled).toBe(false);
        expect(u5.badges).toBe(true);
        expect(u5.slippageBps).toBeGreaterThan(universeById('large_cap')!.slippageBps);
        const uv = universeById('unusual_volume')!.filters.relVolume!.min!;
        expect(uv).toBeGreaterThanOrEqual(2);
        expect(uv).toBeLessThanOrEqual(3);
    });
});

describe('signals', () => {
    it('turns a trade that goes quiet into an exit', () => {
        expect(signalFor('holding', 'none')).toBe('exit');
        expect(signalFor('entry', 'watch')).toBe('exit');
        expect(signalFor('entry', 'holding')).toBe('holding');
        expect(signalFor('watch', 'none')).toBe('none');
        expect(signalFor(undefined, 'entry')).toBe('entry');
    });

    it('converts analyst rows, keeping exits and dropping quiet stocks', () => {
        const prev = new Map<string, Signal>([[pairKey('BBB', 'breakout'), 'holding']]);
        const rows = toRows(result([
            row(),
            row({ ticker: 'BBB', status: 'none', plan: undefined }),
            row({ ticker: 'CCC', status: 'none', plan: undefined }),
        ]), prev, new Map([['AAA', '2026-10-21']]), '2026-10-19');
        expect(rows.map((r) => [r.ticker, r.signal])).toEqual([['AAA', 'entry'], ['BBB', 'exit']]);
        expect(rows[0]).toMatchObject({ entry: 50, stop: 47.5, target2r: 55, target3r: 57.5, riskPerShare: 2.5, score: 60 });
        expect(rows[0].badges).toEqual([{ code: 'earnings', label: 'Earnings in 2 days (2026-10-21)' }]);
        expect(rows[1].entry).toBeNull();
    });

    it('flags earnings only when they are close', () => {
        expect(earningsBadge('2026-10-19', '2026-10-19')?.label).toBe('Earnings today');
        expect(earningsBadge('2026-10-30', '2026-10-19')).toBeNull();
        expect(earningsBadge('2026-10-10', '2026-10-19')).toBeNull();
        expect(earningsBadge(undefined, '2026-10-19')).toBeNull();
    });

    it('tracks trades in play and open paper trades, once each', () => {
        const tracked = trackList(
            [
                { ticker: 'AAA', strategy: 'breakout', universe: 'large_cap', signal: 'holding' },
                { ticker: 'BBB', strategy: 'breakout', universe: 'large_cap', signal: 'watch' },
            ],
            [{ ticker: 'AAA', strategy: 'breakout', universe: 'large_cap' }, { ticker: 'CCC', strategy: 'ma_pullback', universe: 'under_5' }],
        );
        expect(tracked.map((t) => pairKey(t.ticker, t.strategy)).sort()).toEqual(['AAA|breakout', 'CCC|ma_pullback']);
    });
});

describe('ranking and filters', () => {
    const rows = toRows(result([
        row({ ticker: 'LOW', quant: quant(40) }),
        row({ ticker: 'HIGH', quant: quant(80, true), validated: true, sector: 'Energy' }),
        row({ ticker: 'MID', quant: quant(60), status: 'watch', strategy: 'ma_pullback' }),
        row({ ticker: 'TIE', quant: quant(60) }),
    ]), new Map(), new Map(), '2026-10-19');

    it('sorts by score, then the more actionable signal', () => {
        expect(sortRows(rows).map((r) => r.ticker)).toEqual(['HIGH', 'TIE', 'MID', 'LOW']);
    });

    it('filters by strategy, signal, sector, validation and minimum score', () => {
        expect(filterRows(rows, { strategy: 'ma_pullback' }).map((r) => r.ticker)).toEqual(['MID']);
        expect(filterRows(rows, { signal: 'entry' })).toHaveLength(3);
        expect(filterRows(rows, { sector: 'Energy' }).map((r) => r.ticker)).toEqual(['HIGH']);
        expect(filterRows(rows, { validatedOnly: true }).map((r) => r.ticker)).toEqual(['HIGH']);
        expect(filterRows(rows, { minScore: 60 })).toHaveLength(3);
    });
});

describe('position size', () => {
    it("sizes from the stop with the universe's risk per trade", () => {
        const p = positionFor({ universe: 'large_cap', entry: 50, stop: 47.5 })!;
        // $10,000 x 0.75% = $75 risk / $2.50 a share = 30 shares
        expect(ACCOUNT.size).toBe(10_000);
        expect(p.shares).toBe(30);
        expect(p.riskPct).toBe(0.75);
        const small = positionFor({ universe: 'under_5', entry: 3, stop: 2.8 })!;
        expect(small.shares).toBe(175); // $35 / $0.20
    });

    it('returns nothing without a plan or a known universe', () => {
        expect(positionFor({ universe: 'large_cap', entry: null, stop: null })).toBeNull();
        expect(positionFor({ universe: 'nope', entry: 10, stop: 9 })).toBeNull();
    });
});
