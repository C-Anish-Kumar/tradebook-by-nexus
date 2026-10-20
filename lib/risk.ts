// Risk rules for the screener: your account and per-universe settings, which of tonight's entries fit your plan,
// the kill switches, and when a position you took should be closed. Pure functions (no server-only imports), shared
// by the screener page, the Positions and Performance pages, the nightly job and the tests.
import {
    ACCOUNT, DEFAULT_RISK, KILL_SWITCH, RISK_PCT_LIMITS, UNIVERSES, riskFor, universeById,
    type RiskSettings, type Universe,
} from '@/config/universes';
import { sizeShares } from '@/lib/setups';
import type { ScreenerRowData } from '@/lib/screener';

export type UniverseOverride = Partial<RiskSettings> & {
    regimeGate?: boolean;
    telegram?: { enabled?: boolean; minScore?: number };
};

/** One user's overrides of config/universes.ts, as stored in TradingSettings. */
export type TradingSettingsData = {
    accountSize: number;
    overrides: Record<string, UniverseOverride>;
    /** strategy|universe -> ISO time the kill switch was last reset (the drawdown is measured from then). */
    killResets: Record<string, string>;
    accountResetAt: string | null;
};

export const DEFAULT_SETTINGS: TradingSettingsData = { accountSize: ACCOUNT.size, overrides: {}, killResets: {}, accountResetAt: null };

export type EffectiveUniverse = { risk: RiskSettings; regimeGate: boolean; telegram: { enabled: boolean; minScore: number } };

const clamp = (n: unknown, lo: number, hi: number, fallback: number) => {
    const v = Number(n);
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
};

/** The config defaults with this user's overrides on top. */
export function effectiveUniverse(u: Universe, settings: TradingSettingsData = DEFAULT_SETTINGS): EffectiveUniverse {
    const o = settings.overrides[u.id] ?? {};
    const base = riskFor(u);
    return {
        risk: {
            riskPctPerTrade: o.riskPctPerTrade ?? base.riskPctPerTrade,
            maxOpenPositions: o.maxOpenPositions ?? base.maxOpenPositions,
            maxSectorExposurePct: o.maxSectorExposurePct ?? base.maxSectorExposurePct,
            maxTotalExposurePct: o.maxTotalExposurePct ?? base.maxTotalExposurePct,
        },
        regimeGate: o.regimeGate ?? u.regimeGate,
        telegram: { enabled: o.telegram?.enabled ?? u.telegram.enabled, minScore: o.telegram?.minScore ?? u.telegram.minScore },
    };
}

/** Cleans what the settings form sends: unknown universes dropped, numbers kept to sane ranges. */
export function sanitizeSettings(input: Partial<TradingSettingsData>, current: TradingSettingsData = DEFAULT_SETTINGS): TradingSettingsData {
    const overrides: Record<string, UniverseOverride> = {};
    for (const u of UNIVERSES) {
        const o = input.overrides?.[u.id];
        if (!o) continue;
        const base = effectiveUniverse(u);
        overrides[u.id] = {
            riskPctPerTrade: Math.round(clamp(o.riskPctPerTrade, RISK_PCT_LIMITS.min, RISK_PCT_LIMITS.max, base.risk.riskPctPerTrade) * 100) / 100,
            maxOpenPositions: Math.round(clamp(o.maxOpenPositions, 0, 20, base.risk.maxOpenPositions)),
            maxSectorExposurePct: Math.round(clamp(o.maxSectorExposurePct, 5, 100, base.risk.maxSectorExposurePct)),
            maxTotalExposurePct: Math.round(clamp(o.maxTotalExposurePct, 5, 100, base.risk.maxTotalExposurePct)),
            regimeGate: typeof o.regimeGate === 'boolean' ? o.regimeGate : base.regimeGate,
            telegram: {
                enabled: typeof o.telegram?.enabled === 'boolean' ? o.telegram.enabled : base.telegram.enabled,
                minScore: Math.round(clamp(o.telegram?.minScore, 0, 100, base.telegram.minScore)),
            },
        };
    }
    return {
        ...current,
        accountSize: Math.round(clamp(input.accountSize, 100, 100_000_000, current.accountSize) * 100) / 100,
        overrides,
    };
}

// ---------------------------------------------------------------- market regime

export type MarketRegime = { symbol: string; date: string; close: number; sma50: number; sma200: number; above_200: boolean; trend_up: boolean };

/** New entries are allowed while SPY closes above its 200-day average. With no reading the gate stays open (and says so). */
export function regimeOpen(m: MarketRegime | null | undefined): boolean {
    return !m || m.above_200;
}

export function regimeLabel(m: MarketRegime | null | undefined): string {
    if (!m) return 'Market regime unknown (no SPY reading): the gate is open';
    const pct = ((m.close / m.sma200 - 1) * 100).toFixed(1);
    return m.above_200
        ? `Risk on: ${m.symbol} ${pct}% above its 200-day average${m.trend_up ? '' : ', but its 50-day is still below the 200-day'}`
        : `Risk off: ${m.symbol} ${pct}% below its 200-day average, so gated universes take no new entries`;
}

// ---------------------------------------------------------------- drawdown and kill switches

/** Deepest fall from a running peak (starting at 0) of the cumulative sum of `steps`. Always >= 0. */
export function maxDrawdown(steps: number[]): number {
    let cum = 0, peak = 0, worst = 0;
    for (const s of steps) {
        cum += s;
        peak = Math.max(peak, cum);
        worst = Math.max(worst, peak - cum);
    }
    return Math.round(worst * 100) / 100;
}

export const killKey = (strategy: string, universe: string) => `${strategy}|${universe}`;

export type ClosedTrade = { r?: number | null; outcome: string; closedOn?: string | null; updatedAt?: Date | string };

/** Win rate, average and total R and max drawdown in R of closed trades, in the order they closed. */
export function rStats(trades: ClosedTrade[]) {
    const closed = trades
        .filter((t) => t.outcome !== 'open' && typeof t.r === 'number')
        .sort((a, b) => (a.closedOn ?? '').localeCompare(b.closedOn ?? ''));
    const rs = closed.map((t) => t.r as number);
    const total = rs.reduce((s, r) => s + r, 0);
    return {
        closed: rs.length,
        winRate: rs.length ? Math.round((rs.filter((r) => r > 0).length / rs.length) * 1000) / 10 : null,
        avgR: rs.length ? Math.round((total / rs.length) * 100) / 100 : null,
        totalR: rs.length ? Math.round(total * 100) / 100 : null,
        maxDrawdownR: rs.length ? maxDrawdown(rs) : null,
    };
}

/** Trades counted towards a kill switch: those closed on or after its last reset. */
export const sinceReset = <T extends ClosedTrade>(trades: T[], resetAt: string | null | undefined) =>
    resetAt ? trades.filter((t) => (t.closedOn ?? '') >= resetAt.slice(0, 10)) : trades;

export function strategyKilled(trades: ClosedTrade[], resetAt?: string | null, limitR = KILL_SWITCH.strategyDrawdownR): boolean {
    const dd = rStats(sinceReset(trades, resetAt)).maxDrawdownR;
    return dd !== null && dd >= limitR;
}

export type PositionData = {
    id: string;
    ticker: string;
    name: string | null;
    strategy: string;
    universe: string;
    sector: string | null;
    shares: number;
    entry: number;
    stop: number;
    target2r: number | null;
    openedOn: string;
    status: 'open' | 'closed';
    exitPrice: number | null;
    closedOn: string | null;
    lastClose: number | null;
    alerted: string[];
};

export const positionPnl = (p: Pick<PositionData, 'shares' | 'entry'>, price: number) => Math.round((price - p.entry) * p.shares * 100) / 100;
export const positionR = (p: Pick<PositionData, 'entry' | 'stop'>, price: number) =>
    p.entry > p.stop ? Math.round(((price - p.entry) / (p.entry - p.stop)) * 100) / 100 : null;

/** Account drawdown from your closed positions' realised P&L since the last reset, in % of the account. */
export function accountDrawdownPct(closed: Pick<PositionData, 'shares' | 'entry' | 'exitPrice' | 'closedOn'>[], accountSize: number, resetAt?: string | null): number {
    const since = resetAt?.slice(0, 10) ?? '';
    const steps = closed
        .filter((p) => p.exitPrice != null && (p.closedOn ?? '') >= since)
        .sort((a, b) => (a.closedOn ?? '').localeCompare(b.closedOn ?? ''))
        .map((p) => positionPnl(p, p.exitPrice!));
    return accountSize > 0 ? Math.round((maxDrawdown(steps) / accountSize) * 10_000) / 100 : 0;
}

// ---------------------------------------------------------------- which entries fit the plan

export type PlanReason =
    | 'fits' | 'held' | 'duplicate' | 'account_kill' | 'kill_switch' | 'regime'
    | 'too_wide' | 'max_positions' | 'sector_cap' | 'universe_cap' | 'cash';

export const PLAN_LABEL: Record<PlanReason, string> = {
    fits: 'Fits your plan',
    held: 'Already holding',
    duplicate: 'Picked under another strategy',
    account_kill: 'Account kill switch',
    kill_switch: 'Strategy kill switch',
    regime: 'Market risk-off',
    too_wide: 'Stop too wide for the risk budget',
    max_positions: 'Universe at max positions',
    sector_cap: 'Sector cap reached',
    universe_cap: 'Universe exposure cap reached',
    cash: 'Not enough cash left',
};

export type PlanDecision = { reason: PlanReason; shares: number; cost: number; risk: number; riskPct: number };

export type PlanRow = Pick<ScreenerRowData, 'ticker' | 'strategy' | 'universe' | 'sector' | 'signal' | 'entry' | 'stop' | 'score'> & { id: string };

export type PlanContext = {
    settings: TradingSettingsData;
    /** Your open positions. */
    positions: Pick<PositionData, 'ticker' | 'universe' | 'sector' | 'shares' | 'entry'>[];
    market: MarketRegime | null | undefined;
    /** killKey(strategy, universe) of every tripped strategy kill switch. */
    killed: Set<string>;
    accountKilled: boolean;
};

const sectorOf = (s: string | null | undefined) => s || 'Unknown';

/**
 * Tonight's entries, best score first, each either taken into a simulated book or turned away with the first rule
 * it breaks: already held, kill switches, the market regime, a stop too wide to size, then the universe's position,
 * sector and exposure caps and the cash left. Taking one uses up room, so lower-ranked entries see what is left;
 * the result is the set of trades that fit together, not each one alone.
 */
export function planEntries(rows: PlanRow[], ctx: PlanContext): Map<string, PlanDecision> {
    const account = ctx.settings.accountSize;
    const count = new Map<string, number>();       // universe -> positions
    const uniCost = new Map<string, number>();     // universe -> $ invested
    const secCost = new Map<string, number>();     // sector -> $ invested (whole account)
    const held = new Set<string>();
    let invested = 0;
    const add = (universe: string, sector: string | null, cost: number) => {
        count.set(universe, (count.get(universe) ?? 0) + 1);
        uniCost.set(universe, (uniCost.get(universe) ?? 0) + cost);
        secCost.set(sectorOf(sector), (secCost.get(sectorOf(sector)) ?? 0) + cost);
        invested += cost;
    };
    for (const p of ctx.positions) {
        held.add(p.ticker);
        add(p.universe, p.sector, p.shares * p.entry);
    }

    const out = new Map<string, PlanDecision>();
    const entries = rows.filter((r) => r.signal === 'entry').sort((a, b) => b.score - a.score || a.ticker.localeCompare(b.ticker));
    const picked = new Set<string>();
    const gateOpen = regimeOpen(ctx.market);
    for (const r of entries) {
        const u = universeById(r.universe);
        const eff = u ? effectiveUniverse(u, ctx.settings) : { risk: DEFAULT_RISK, regimeGate: true };
        const riskPct = eff.risk.riskPctPerTrade;
        const size = r.entry != null && r.stop != null ? sizeShares(account, riskPct, r.entry, r.stop) : null;
        const d = (reason: PlanReason): PlanDecision => ({ reason, shares: size?.shares ?? 0, cost: size?.cost ?? 0, risk: size?.risk ?? 0, riskPct });
        let reason: PlanReason = 'fits';
        if (held.has(r.ticker)) reason = 'held';
        else if (picked.has(r.ticker)) reason = 'duplicate';
        else if (ctx.accountKilled) reason = 'account_kill';
        else if (ctx.killed.has(killKey(r.strategy, r.universe))) reason = 'kill_switch';
        else if (eff.regimeGate && !gateOpen) reason = 'regime';
        else if (!size || size.shares < 1) reason = 'too_wide';
        else if ((count.get(r.universe) ?? 0) >= eff.risk.maxOpenPositions) reason = 'max_positions';
        else if ((secCost.get(sectorOf(r.sector)) ?? 0) + size.cost > (account * eff.risk.maxSectorExposurePct) / 100 + 1e-6) reason = 'sector_cap';
        else if ((uniCost.get(r.universe) ?? 0) + size.cost > (account * eff.risk.maxTotalExposurePct) / 100 + 1e-6) reason = 'universe_cap';
        else if (invested + size.cost > account + 1e-6) reason = 'cash';
        if (reason === 'fits') {
            picked.add(r.ticker);
            add(r.universe, r.sector, size!.cost);
        }
        out.set(r.id, d(reason));
    }
    return out;
}

// ---------------------------------------------------------------- positions you took

export type ExitReason = 'stop' | 'strategy_exit' | 'target';

export const EXIT_LABEL: Record<ExitReason, string> = {
    stop: 'Closed at or below your stop',
    strategy_exit: "The strategy's exit rule fired",
    target: 'Reached the 2R target',
};

/** Whether tonight's close says a position you hold should be closed (or, at 2R, at least looked at). */
export function positionExit(
    p: Pick<PositionData, 'stop' | 'target2r'>,
    row: Pick<ScreenerRowData, 'signal' | 'close'> | undefined,
): ExitReason | null {
    if (!row) return null;
    if (row.close <= p.stop) return 'stop';
    if (row.signal === 'exit' || row.signal === 'none' || row.signal === 'watch') return 'strategy_exit';
    if (p.target2r != null && row.close >= p.target2r) return 'target';
    return null;
}
