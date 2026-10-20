import { describe, expect, it } from 'vitest';
import { KILL_SWITCH, RISK_PCT_LIMITS, universeById } from '@/config/universes';
import {
    accountDrawdownPct, DEFAULT_SETTINGS, effectiveUniverse, killKey, maxDrawdown, planEntries, positionExit, positionR,
    regimeOpen, rStats, sanitizeSettings, sinceReset, strategyKilled,
    type MarketRegime, type PlanContext, type PlanRow, type TradingSettingsData,
} from '@/lib/risk';

const riskOn: MarketRegime = { symbol: 'SPY', date: '2026-10-20', close: 600, sma50: 590, sma200: 560, above_200: true, trend_up: true };
const riskOff: MarketRegime = { ...riskOn, close: 540, above_200: false };

let n = 0;
const entry = (over: Partial<PlanRow> = {}): PlanRow => ({
    id: `r${n++}`, ticker: `T${n}`, strategy: 'breakout', universe: 'large_cap', sector: 'Technology',
    signal: 'entry', entry: 100, stop: 95, score: 60, ...over,
});

const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
    settings: DEFAULT_SETTINGS, positions: [], market: riskOn, killed: new Set(), accountKilled: false, ...over,
});

describe('settings', () => {
    it('falls back to config/universes.ts and applies per-universe overrides', () => {
        const u = universeById('large_cap')!;
        expect(effectiveUniverse(u).risk.riskPctPerTrade).toBe(0.75);
        const s: TradingSettingsData = { ...DEFAULT_SETTINGS, overrides: { large_cap: { riskPctPerTrade: 1, regimeGate: false, telegram: { minScore: 50 } } } };
        const e = effectiveUniverse(u, s);
        expect(e.risk.riskPctPerTrade).toBe(1);
        expect(e.risk.maxOpenPositions).toBe(4);
        expect(e.regimeGate).toBe(false);
        expect(e.telegram).toEqual({ enabled: true, minScore: 50 });
    });

    it('clamps what the form sends and drops unknown universes', () => {
        const s = sanitizeSettings({
            accountSize: 25_000.555,
            overrides: { large_cap: { riskPctPerTrade: 5, maxOpenPositions: -2, maxSectorExposurePct: 400 }, nope: { riskPctPerTrade: 1 } },
        });
        expect(s.accountSize).toBe(25_000.56);
        expect(s.overrides.large_cap.riskPctPerTrade).toBe(RISK_PCT_LIMITS.max);
        expect(s.overrides.large_cap.maxOpenPositions).toBe(0);
        expect(s.overrides.large_cap.maxSectorExposurePct).toBe(100);
        expect(s.overrides.large_cap.maxTotalExposurePct).toBe(100);   // missing -> the default
        expect(s.overrides.nope).toBeUndefined();
        expect(sanitizeSettings({ accountSize: Number.NaN }).accountSize).toBe(DEFAULT_SETTINGS.accountSize);
    });
});

describe('drawdown and kill switches', () => {
    it('measures the deepest fall from a running peak that starts at zero', () => {
        expect(maxDrawdown([])).toBe(0);
        expect(maxDrawdown([2, -1, -1, -1, 3])).toBe(3);
        expect(maxDrawdown([-1, -1])).toBe(2);
        expect(maxDrawdown([1, 1, 1])).toBe(0);
    });

    const closed = (r: number, closedOn: string) => ({ outcome: r > 0 ? 'target' : 'stopped', r, closedOn });

    it('summarises closed trades in the order they closed', () => {
        const s = rStats([closed(2, '2026-01-05'), closed(-1, '2026-01-02'), { outcome: 'open', r: null }, closed(-1, '2026-01-03')]);
        expect(s).toEqual({ closed: 3, winRate: 33.3, avgR: 0, totalR: 0, maxDrawdownR: 2 });
        expect(rStats([]).avgR).toBeNull();
    });

    it(`trips a strategy at ${KILL_SWITCH.strategyDrawdownR}R of drawdown and counts only trades after a reset`, () => {
        const losing = Array.from({ length: 6 }, (_, i) => closed(-1, `2026-02-0${i + 1}`));
        expect(strategyKilled(losing)).toBe(true);
        expect(strategyKilled(losing.slice(0, 5))).toBe(false);
        expect(strategyKilled(losing, '2026-02-03T12:00:00Z')).toBe(false);
        expect(sinceReset(losing, '2026-02-03T12:00:00Z')).toHaveLength(4);
    });

    it('tracks account drawdown from realised P&L in % of the account', () => {
        const p = (exitPrice: number, closedOn: string) => ({ shares: 100, entry: 50, exitPrice, closedOn });
        expect(accountDrawdownPct([p(45, '2026-03-01'), p(46, '2026-03-02')], 10_000)).toBe(9);
        expect(accountDrawdownPct([p(55, '2026-03-01'), p(45, '2026-03-02')], 10_000)).toBe(5);
        expect(accountDrawdownPct([p(45, '2026-03-01'), p(46, '2026-03-02')], 10_000, '2026-03-02T00:00:00Z')).toBe(4);
    });
});

describe('planEntries', () => {
    it('takes the best entries until the universe is full', () => {
        const sectors = ['Technology', 'Energy', 'Finance', 'Health Care', 'Utilities'];
        const rows = [60, 69, 50, 65, 55].map((score, i) => entry({ score, sector: sectors[i] }));
        const plan = planEntries(rows, ctx());
        const fits = rows.filter((r) => plan.get(r.id)!.reason === 'fits').map((r) => r.score);
        expect(fits.sort()).toEqual([55, 60, 65, 69]);
        expect(plan.get(rows[2].id)!.reason).toBe('max_positions');
    });

    it('sizes from the stop at the universe risk and your account size', () => {
        const r = entry({ entry: 50, stop: 47.5 });
        expect(planEntries([r], ctx()).get(r.id)).toMatchObject({ reason: 'fits', shares: 30, cost: 1500, risk: 75, riskPct: 0.75 });
        const big = { ...DEFAULT_SETTINGS, accountSize: 20_000 };
        expect(planEntries([r], ctx({ settings: big })).get(r.id)!.shares).toBe(60);
    });

    it('turns away a stop too wide to buy one share within the risk budget', () => {
        const r = entry({ entry: 539.72, stop: 459.03 });   // $80.69 a share against a $75 budget
        expect(planEntries([r], ctx()).get(r.id)!.reason).toBe('too_wide');
    });

    it('applies the sector cap across the whole account', () => {
        // $2,000 each at 5% stops; the 40% cap is $4,000 of technology
        const rows = [69, 68, 67].map((score) => entry({ score, entry: 100, stop: 96.25 }));
        const plan = planEntries(rows, ctx());
        expect(rows.map((r) => plan.get(r.id)!.reason)).toEqual(['fits', 'fits', 'sector_cap']);
        const other = entry({ score: 66, entry: 100, stop: 96.25, sector: 'Energy' });
        expect(planEntries([...rows, other], ctx()).get(other.id)!.reason).toBe('fits');
    });

    it("respects the universe's exposure cap and open positions", () => {
        const small = [69, 68].map((score) => entry({ score, universe: 'under_5', entry: 3, stop: 2.8 }));
        // 0.35% of $10k = $35 risk -> 175 shares = $525 each; the 25% cap is $2,500 ($1,600 already in), then 2 positions
        const plan = planEntries(small, ctx({ positions: [{ ticker: 'OLD', universe: 'under_5', sector: 'Energy', shares: 400, entry: 4 }] }));
        expect(small.map((r) => plan.get(r.id)!.reason)).toEqual(['fits', 'max_positions']);
        const capped = planEntries(small, ctx({ positions: [{ ticker: 'OLD', universe: 'under_5', sector: 'Energy', shares: 500, entry: 4.5 }] }));
        expect(capped.get(small[0].id)!.reason).toBe('universe_cap');
    });

    it('never doubles up on a ticker', () => {
        const a = entry({ ticker: 'AAA', score: 69 });
        const b = entry({ ticker: 'AAA', strategy: 'ma_pullback', score: 60 });
        const plan = planEntries([a, b], ctx());
        expect(plan.get(b.id)!.reason).toBe('duplicate');
        const held = planEntries([a], ctx({ positions: [{ ticker: 'AAA', universe: 'large_cap', sector: 'Technology', shares: 1, entry: 100 }] }));
        expect(held.get(a.id)!.reason).toBe('held');
    });

    it('gates on the market regime per universe and on the kill switches', () => {
        const r = entry();
        expect(planEntries([r], ctx({ market: riskOff })).get(r.id)!.reason).toBe('regime');
        const ungated = { ...DEFAULT_SETTINGS, overrides: { large_cap: { regimeGate: false } } };
        expect(planEntries([r], ctx({ market: riskOff, settings: ungated })).get(r.id)!.reason).toBe('fits');
        expect(regimeOpen(null)).toBe(true);
        expect(planEntries([r], ctx({ killed: new Set([killKey('breakout', 'large_cap')]) })).get(r.id)!.reason).toBe('kill_switch');
        expect(planEntries([r], ctx({ accountKilled: true })).get(r.id)!.reason).toBe('account_kill');
    });

    it('stops at the cash in the account', () => {
        const loose = { maxSectorExposurePct: 100, maxOpenPositions: 10 };
        const tight = { ...DEFAULT_SETTINGS, overrides: { large_cap: loose, unusual_volume: loose } };
        // 1% stops: $7,500 of large caps, then $5,000 of unusual volume (0.5% risk) no longer fits in $10,000
        const rows = [entry({ score: 69, entry: 100, stop: 99, sector: 'Energy' }),
            entry({ score: 68, entry: 100, stop: 99, sector: 'Finance', universe: 'unusual_volume' })];
        const plan = planEntries(rows, ctx({ settings: tight }));
        expect(rows.map((r) => plan.get(r.id)!.reason)).toEqual(['fits', 'cash']);
    });

    it('only decides entries', () => {
        expect(planEntries([entry({ signal: 'watch' }), entry({ signal: 'holding' })], ctx()).size).toBe(0);
    });
});

describe('positions', () => {
    const p = { stop: 95, target2r: 110 };
    it('says when to get out', () => {
        expect(positionExit(p, { signal: 'holding', close: 94 })).toBe('stop');
        expect(positionExit(p, { signal: 'exit', close: 100 })).toBe('strategy_exit');
        expect(positionExit(p, { signal: 'holding', close: 111 })).toBe('target');
        expect(positionExit(p, { signal: 'holding', close: 101 })).toBeNull();
        expect(positionExit(p, undefined)).toBeNull();
    });

    it('expresses a price in R', () => {
        expect(positionR({ entry: 100, stop: 95 }, 110)).toBe(2);
        expect(positionR({ entry: 100, stop: 100 }, 110)).toBeNull();
    });
});
