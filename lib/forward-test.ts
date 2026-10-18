import type { ForwardOutcome, IForwardTrade } from '@/database/models/forward-trade.model';
import type { Setup } from '@/lib/setups';

export const EXPIRE_DAYS = 30;

export type TradeState = Pick<IForwardTrade, 'entry' | 'stop' | 'target2r' | 'signalDate' | 'outcome'>;
export type Update = { outcome: ForwardOutcome; lastClose: number; closedOn?: string; exitPrice?: number; r?: number };

const rOf = (t: TradeState, price: number) => Math.round(((price - t.entry) / (t.entry - t.stop)) * 100) / 100;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/**
 * Judges an open paper trade on the newest daily close only: stop hit, 2R target hit, the strategy's own exit,
 * or too old. Using closes means an intraday wick through the stop is not seen, and a gap fills at the close, not the stop.
 */
export function evaluateTrade(t: TradeState, latest: Pick<Setup, 'date' | 'close' | 'status'>): Update | null {
    if (t.outcome !== 'open' || latest.date <= t.signalDate) return null;
    const done = (outcome: ForwardOutcome): Update => ({ outcome, lastClose: latest.close, closedOn: latest.date, exitPrice: latest.close, r: rOf(t, latest.close) });
    if (latest.close <= t.stop) return done('stopped');
    if (latest.close >= t.target2r) return done('target');
    if (latest.status === 'none') return done('exited');
    if (days(t.signalDate, latest.date) > EXPIRE_DAYS) return done('expired');
    return { outcome: 'open', lastClose: latest.close };
}

export type Summary = { trades: number; open: number; closed: number; winRate: number | null; avgR: number | null; totalR: number | null };

export function summarize(rows: Pick<IForwardTrade, 'outcome' | 'r'>[]): Summary {
    const closed = rows.filter((r) => r.outcome !== 'open' && typeof r.r === 'number');
    const totalR = closed.reduce((s, r) => s + r.r!, 0);
    return {
        trades: rows.length,
        open: rows.length - closed.length,
        closed: closed.length,
        winRate: closed.length ? Math.round((closed.filter((r) => r.r! > 0).length / closed.length) * 100) : null,
        avgR: closed.length ? Math.round((totalR / closed.length) * 100) / 100 : null,
        totalR: closed.length ? Math.round(totalR * 100) / 100 : null,
    };
}
