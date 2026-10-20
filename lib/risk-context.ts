// Server-side loaders for the risk rules in lib/risk.ts: a user's settings and positions, and which kill switches
// are tripped. Shared by the server actions and the nightly job.
import { connectToDatabase } from '@/database/mongoose';
import { ForwardTrade } from '@/database/models/forward-trade.model';
import { Position, TradingSettings, type IPosition } from '@/database/models/trading.model';
import { KILL_SWITCH } from '@/config/universes';
import {
    accountDrawdownPct, DEFAULT_SETTINGS, killKey, strategyKilled,
    type MarketRegime, type PlanContext, type PositionData, type TradingSettingsData,
} from '@/lib/risk';

export async function loadSettings(userId: string): Promise<TradingSettingsData> {
    await connectToDatabase();
    const s = await TradingSettings.findOne({ userId }).lean();
    if (!s) return DEFAULT_SETTINGS;
    return { accountSize: s.accountSize, overrides: s.overrides ?? {}, killResets: s.killResets ?? {}, accountResetAt: s.accountResetAt ?? null };
}

export const toPositionData = (p: IPosition & { _id: unknown }): PositionData => ({
    id: String(p._id), ticker: p.ticker, name: p.name ?? null, strategy: p.strategy, universe: p.universe, sector: p.sector ?? null,
    shares: p.shares, entry: p.entry, stop: p.stop, target2r: p.target2r ?? null, openedOn: p.openedOn, status: p.status,
    exitPrice: p.exitPrice ?? null, closedOn: p.closedOn ?? null, lastClose: p.lastClose ?? null, alerted: p.alerted ?? [],
});

export async function loadPositions(userId: string, status?: 'open' | 'closed'): Promise<PositionData[]> {
    await connectToDatabase();
    const rows = await Position.find({ userId, ...(status && { status }) }).sort({ status: -1, openedOn: -1 }).limit(500).lean();
    return rows.map((p) => toPositionData(p as IPosition & { _id: unknown }));
}

/** Closed screener forward-test trades, grouped by strategy|universe. */
export async function forwardTradesByPair() {
    await connectToDatabase();
    const trades = await ForwardTrade.find({ universe: { $exists: true } }, { strategy: 1, universe: 1, outcome: 1, r: 1, closedOn: 1, signalDate: 1 }).lean();
    const byPair = new Map<string, typeof trades>();
    for (const t of trades) {
        const k = killKey(t.strategy, t.universe!);
        byPair.set(k, [...(byPair.get(k) ?? []), t]);
    }
    return byPair;
}

export function killedPairs(byPair: Awaited<ReturnType<typeof forwardTradesByPair>>, settings: TradingSettingsData): Set<string> {
    const killed = new Set<string>();
    for (const [k, trades] of byPair) if (strategyKilled(trades, settings.killResets[k])) killed.add(k);
    return killed;
}

export function accountKillState(closed: PositionData[], settings: TradingSettingsData) {
    const drawdownPct = accountDrawdownPct(closed, settings.accountSize, settings.accountResetAt);
    return { drawdownPct, killed: drawdownPct >= KILL_SWITCH.accountDrawdownPct };
}

/** Everything planEntries needs for one user. */
export async function loadPlanContext(userId: string, market: MarketRegime | null | undefined, byPair?: Awaited<ReturnType<typeof forwardTradesByPair>>): Promise<PlanContext & { positionsAll: PositionData[] }> {
    const [settings, positionsAll, pairs] = await Promise.all([loadSettings(userId), loadPositions(userId), byPair ?? forwardTradesByPair()]);
    const closed = positionsAll.filter((p) => p.status === 'closed');
    return {
        settings,
        positions: positionsAll.filter((p) => p.status === 'open'),
        positionsAll,
        market,
        killed: killedPairs(pairs, settings),
        accountKilled: accountKillState(closed, settings).killed,
    };
}
