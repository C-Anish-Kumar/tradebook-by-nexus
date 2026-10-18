// Trade setups from the analyst service's /setups endpoint: types and the pure helpers around them
// (no server-only imports, so the page, the Inngest job and the tests can all share them).
import { STRATEGY_2, type Strategy, type StrategyId } from '@/lib/strategies';

export type SetupStatus = 'entry' | 'holding' | 'watch' | 'none';

export type SetupGates = Record<string, boolean>;

export type QuantPart = { key: string; label: string; points: number; max: number; note: string };
export type QuantLabel = 'Strong' | 'Good' | 'Fair' | 'Weak' | 'Poor';

/** 0-100 setup-quality rating: an auditable checklist, capped at 69 until every validation gate passes. */
export type QuantScore = { score: number; label: QuantLabel; capped: boolean; validated: boolean; components: QuantPart[] };

export type Setup = {
    ticker: string;
    /** Absent on results stored before there was more than one strategy (those are the breakout). */
    strategy?: StrategyId;
    date: string;
    close: number;
    regime: { trend: 'up' | 'down' | 'range' | null; vol: 'high' | 'low' | null; adx: number | null; atr_pct_rank: number | null };
    status: SetupStatus;
    trigger: number | null;
    params: Record<string, number>;
    plan?: {
        entry: number; stop: number; risk_per_share: number; risk_pct_of_price: number;
        target_2r: number; target_3r: number; bars_in_trade: number; exit_rule: string;
    };
    volume?: { relative: number | null };
    /** Absent on results stored before the quant score existed. */
    quant?: QuantScore;
    evidence: {
        validated: boolean;
        oos_sharpe: number | null;
        baselines_sharpe: Record<string, number | null>;
        deflated_sharpe: number | null;
        trials: number | null;
        trades: number | null;
        gates: SetupGates;
    };
    warnings: string[];
};

export type StoredSetup = { setup: Setup; scannedAt: string };

export const STATUS_LABEL: Record<SetupStatus, string> = {
    entry: 'Entry signal',
    holding: 'In trend',
    watch: 'Watching breakout',
    none: 'No setup',
};

const STATUS_RANK: Record<SetupStatus, number> = { entry: 0, watch: 1, holding: 2, none: 3 };

/** Validated first, then by how actionable the status is, then by quant score (highest first). */
export function sortSetups<T extends { setup: Setup | null }>(rows: T[]): T[] {
    const rank = (r: T) => (r.setup ? (r.setup.evidence.validated ? 0 : 10) + STATUS_RANK[r.setup.status] : 99);
    const score = (r: T) => r.setup?.quant?.score ?? -1;
    return [...rows].sort((a, b) => rank(a) - rank(b) || score(b) - score(a));
}

/** Swing limit: open at most this many positions at once. */
export const MAX_POSITIONS = 2;

/** Whole shares to buy so a stop-out loses `riskPct` of the account, never spending more than the account itself; null if the inputs can't size a trade. */
export function sizeShares(account: number, riskPct: number, entry: number, stop: number) {
    if (!(account > 0) || !(riskPct > 0) || !(entry > stop) || stop <= 0) return null;
    const byRisk = Math.floor((account * riskPct / 100) / (entry - stop));
    const byCash = Math.floor(account / entry);
    const shares = Math.max(0, Math.min(byRisk, byCash));
    return { shares, cost: shares * entry, risk: shares * (entry - stop), capped: byRisk > byCash, affordable: byCash >= 1 };
}

/** Whole days from today (UTC date) to an ISO date; null when it is not a date. */
export function daysUntil(date: string, now = new Date()): number | null {
    const t = Date.parse(`${date}T00:00:00Z`);
    if (Number.isNaN(t)) return null;
    return Math.round((t - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000);
}

export type Transition = 'entry' | 'exit' | null;

/** What changed since the last scan worth a message: a fresh entry, or a trade that has ended. */
export function transition(prev: SetupStatus | undefined, next: SetupStatus): Transition {
    if (!prev) return null; // first sighting only records the state
    if (next === 'entry' && prev !== 'entry' && prev !== 'holding') return 'entry';
    if (next === 'none' && (prev === 'entry' || prev === 'holding')) return 'exit';
    return null;
}

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Telegram HTML for one change. `link` is the already-escaped stock link. */
export function setupMessage(link: string, setup: Setup, kind: Exclude<Transition, null>, strategy: Strategy = STRATEGY_2): string {
    const ev = setup.evidence;
    const tag = ev.validated
        ? '✅ Passed every validation gate'
        : '⚠️ Unvalidated: paper-trade it, do not size it like an edge';
    if (kind === 'exit') {
        return [
            `🔴 <b>${link}: ${esc(strategy.name)} trade ended</b>`,
            `The exit rule was hit (close ${usd(setup.close)}).`,
            `<i>${esc(tag)}</i>`,
        ].join('\n');
    }
    const p = setup.plan!;
    const regime = [setup.regime.trend, setup.regime.vol && `${setup.regime.vol} vol`].filter(Boolean).join(', ');
    return [
        `🟢 <b>${link}: ${esc(strategy.name)} entry</b> (${esc(regime)} regime)`,
        `Entry about ${usd(p.entry)} · stop ${usd(p.stop)} (risk ${usd(p.risk_per_share)}/share, ${p.risk_pct_of_price}%)`,
        `Reference targets: 2R ${usd(p.target_2r)} · 3R ${usd(p.target_3r)}`,
        ...(setup.quant ? [`Quant score: <b>${setup.quant.score}/100</b> (${esc(setup.quant.label)})${setup.quant.capped ? ', capped until validated' : ''}`] : []),
        `Size: account × your risk % ÷ ${usd(p.risk_per_share)}`,
        `Evidence: walk-forward Sharpe ${ev.oos_sharpe ?? 'n/a'}, deflated Sharpe ${ev.deflated_sharpe ?? 'n/a'} over ${ev.trials ?? '?'} trials`,
        `<i>${esc(tag)}</i>`,
        `<i>${strategy.label} (${esc(strategy.name)}), daily candles. Not financial advice.</i>`,
    ].join('\n');
}
