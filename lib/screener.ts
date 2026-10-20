// The ranked market screener: types and pure helpers shared by the nightly Inngest scan, the page and the tests.
// The analyst service builds the universes and reads every strategy on every member (analyst-service/
// openstock_analyst/screener.py); this side turns its rows into signals, ranks them and sizes positions.
import { ACCOUNT, riskFor, universeById } from '@/config/universes';
import { sizeShares, type QuantScore, type SetupStatus } from '@/lib/setups';
import type { StrategyId } from '@/lib/strategies';

export type Signal = 'entry' | 'watch' | 'holding' | 'exit' | 'none';
export type Badge = { code: string; label: string };

export type PooledEvidence = {
    validated: boolean;
    params: Record<string, number> | null;
    oos_sharpe: number | null;
    baselines_sharpe: Record<string, number | null>;
    deflated_sharpe: number | null;
    trials: number | null;
    trades: number | null;
    gates: Record<string, boolean>;
    sample: number;
};

/** One row from the analyst service's /screen result. */
export type AnalystScreenRow = {
    ticker: string;
    name: string | null;
    exchange: string | null;
    sector: string | null;
    market_cap: number | null;
    universe: string;
    tags: string[];
    strategy: StrategyId;
    date: string;
    close: number;
    status: SetupStatus;
    trigger: number | null;
    plan?: { entry: number; stop: number; risk_per_share: number; risk_pct_of_price: number; target_2r: number; target_3r: number };
    regime: { trend: 'up' | 'down' | 'range' | null; vol: 'high' | 'low' | null; adx: number | null };
    quant: QuantScore;
    validated: boolean;
    rel_volume: number | null;
    atr_pct: number | null;
    avg_dollar_volume: number | null;
    spread_pct: number | null;
    badges: Badge[];
};

export type AnalystScreenResult = {
    date: string | null;
    universes: Record<string, { name: string; candidates: number; members: string[]; all_members: number; validation: Record<string, PooledEvidence> }>;
    strategies: StrategyId[];
    rows: AnalystScreenRow[];
    problems: string[];
    seconds: number;
};

/** A (ticker, strategy) pair the scan should report on even when it shows nothing today, so exits are seen. */
export type Tracked = { ticker: string; strategy: StrategyId; universe: string };

/** What the screener stores and shows: one stock under one strategy on one scan. */
export type ScreenerRowData = {
    scanDate: string;
    universe: string;
    ticker: string;
    name: string | null;
    sector: string | null;
    exchange: string | null;
    marketCap: number | null;
    tags: string[];
    strategy: StrategyId;
    signal: Signal;
    close: number;
    trigger: number | null;
    entry: number | null;
    stop: number | null;
    target2r: number | null;
    target3r: number | null;
    riskPerShare: number | null;
    score: number;
    scoreLabel: string;
    capped: boolean;
    validated: boolean;
    regime: AnalystScreenRow['regime'];
    relVolume: number | null;
    atrPct: number | null;
    avgDollarVolume: number | null;
    spreadPct: number | null;
    badges: Badge[];
};

export const SIGNAL_LABEL: Record<Signal, string> = {
    entry: 'Entry',
    watch: 'Watch',
    holding: 'Holding',
    exit: 'Exit',
    none: 'None',
};

export const SIGNALS: Signal[] = ['entry', 'watch', 'holding', 'exit', 'none'];

const IN_PLAY = new Set<SetupStatus>(['entry', 'holding']);

export const pairKey = (ticker: string, strategy: string) => `${ticker}|${strategy}`;

/** A trade that was on yesterday and is off today (nothing, or back to watching a level) has exited. */
export function signalFor(prev: Signal | undefined, now: SetupStatus): Signal {
    if ((now === 'none' || now === 'watch') && (prev === 'entry' || prev === 'holding')) return 'exit';
    return now;
}

/** Earnings within `days` calendar days (today counts), as a warning badge. */
export function earningsBadge(date: string | undefined, today: string, days = 5): Badge | null {
    if (!date || date < today) return null;
    const n = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    if (n > days) return null;
    return { code: 'earnings', label: n === 0 ? 'Earnings today' : `Earnings in ${n} day${n === 1 ? '' : 's'} (${date})` };
}

/**
 * Analyst rows -> stored rows. `prev` is yesterday's signal per ticker|strategy (from the last scan), so a trade
 * that disappears becomes an Exit. Rows with nothing in play and no exit are dropped.
 */
export function toRows(result: AnalystScreenResult, prev: Map<string, Signal>, earnings: Map<string, string>, today: string): ScreenerRowData[] {
    const rows: ScreenerRowData[] = [];
    for (const r of result.rows) {
        const signal = signalFor(prev.get(pairKey(r.ticker, r.strategy)), r.status);
        if (signal === 'none') continue;
        const badge = earningsBadge(earnings.get(r.ticker), today);
        rows.push({
            scanDate: r.date,
            universe: r.universe,
            ticker: r.ticker,
            name: r.name,
            sector: r.sector,
            exchange: r.exchange,
            marketCap: r.market_cap,
            tags: r.tags,
            strategy: r.strategy,
            signal,
            close: r.close,
            trigger: r.trigger,
            entry: r.plan?.entry ?? null,
            stop: r.plan?.stop ?? null,
            target2r: r.plan?.target_2r ?? null,
            target3r: r.plan?.target_3r ?? null,
            riskPerShare: r.plan?.risk_per_share ?? null,
            score: r.quant.score,
            scoreLabel: r.quant.label,
            capped: r.quant.capped,
            validated: r.validated,
            regime: r.regime,
            relVolume: r.rel_volume,
            atrPct: r.atr_pct,
            avgDollarVolume: r.avg_dollar_volume,
            spreadPct: r.spread_pct,
            badges: badge ? [...r.badges, badge] : r.badges,
        });
    }
    return rows;
}

/** Yesterday's trades still in play, plus open forward-test trades: the scan reports on these even if they go quiet. */
export function trackList(prevRows: Pick<ScreenerRowData, 'ticker' | 'strategy' | 'universe' | 'signal'>[], openTrades: Tracked[]): Tracked[] {
    const out = new Map<string, Tracked>();
    for (const r of prevRows) if (IN_PLAY.has(r.signal as SetupStatus)) out.set(pairKey(r.ticker, r.strategy), { ticker: r.ticker, strategy: r.strategy, universe: r.universe });
    for (const t of openTrades) out.set(pairKey(t.ticker, t.strategy), t);
    return [...out.values()];
}

export type ScreenerFilter = {
    strategy?: string;
    signal?: Signal;
    sector?: string;
    validatedOnly?: boolean;
    minScore?: number;
};

export function filterRows<T extends Pick<ScreenerRowData, 'strategy' | 'signal' | 'sector' | 'validated' | 'score'>>(rows: T[], f: ScreenerFilter): T[] {
    return rows.filter((r) =>
        (!f.strategy || r.strategy === f.strategy)
        && (!f.signal || r.signal === f.signal)
        && (!f.sector || r.sector === f.sector)
        && (!f.validatedOnly || r.validated)
        && (f.minScore == null || r.score >= f.minScore));
}

const SIGNAL_RANK: Record<Signal, number> = { entry: 0, exit: 1, watch: 2, holding: 3, none: 4 };

/** Highest quant score first; ties go to the more actionable signal, then the ticker. */
export function sortRows<T extends Pick<ScreenerRowData, 'score' | 'signal' | 'ticker'>>(rows: T[]): T[] {
    return [...rows].sort((a, b) => b.score - a.score || SIGNAL_RANK[a.signal] - SIGNAL_RANK[b.signal] || a.ticker.localeCompare(b.ticker));
}

/** Shares for this row under its universe's risk-per-trade, sized from the stop. Null when there is no plan. */
export function positionFor(row: Pick<ScreenerRowData, 'universe' | 'entry' | 'stop'>, account = ACCOUNT.size) {
    const u = universeById(row.universe);
    if (!u || row.entry == null || row.stop == null) return null;
    const riskPct = riskFor(u).riskPctPerTrade;
    const size = sizeShares(account, riskPct, row.entry, row.stop);
    return size && { ...size, riskPct };
}
