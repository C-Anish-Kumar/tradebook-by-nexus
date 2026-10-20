'use server';

import { revalidatePath } from 'next/cache';
import { requireUserId } from '@/lib/better-auth/auth';
import { connectToDatabase } from '@/database/mongoose';
import { Position, TradingSettings } from '@/database/models/trading.model';
import { ScreenerRow, ScreenerRun, type UniverseSummary } from '@/database/models/screener.model';
import { KILL_SWITCH, UNIVERSES, universeById } from '@/config/universes';
import {
    effectiveUniverse, killKey, positionPnl, rStats, sanitizeSettings, sinceReset,
    type EffectiveUniverse, type MarketRegime, type PositionData, type TradingSettingsData,
} from '@/lib/risk';
import { accountKillState, forwardTradesByPair, loadPositions, loadSettings } from '@/lib/risk-context';
import { scannerStrategies, type StrategyId } from '@/lib/strategies';
import type { BacktestStats } from '@/lib/screener';

const today = () => new Date().toISOString().slice(0, 10);

const refresh = () => {
    revalidatePath('/');
    revalidatePath('/positions');
    revalidatePath('/performance');
};

export type SettingsView = { settings: TradingSettingsData; universes: Record<string, EffectiveUniverse> };

export async function getTradingSettings(): Promise<SettingsView> {
    const userId = await requireUserId();
    const settings = await loadSettings(userId);
    return { settings, universes: Object.fromEntries(UNIVERSES.map((u) => [u.id, effectiveUniverse(u, settings)])) };
}

export async function saveTradingSettings(input: Pick<TradingSettingsData, 'accountSize' | 'overrides'>): Promise<{ success: true; settings: TradingSettingsData } | { error: string }> {
    try {
        const userId = await requireUserId();
        const current = await loadSettings(userId);
        const next = sanitizeSettings(input, current);
        await TradingSettings.updateOne(
            { userId },
            { $set: { accountSize: next.accountSize, overrides: next.overrides } },
            { upsert: true },
        );
        refresh();
        return { success: true, settings: next };
    } catch (error) {
        console.error('saveTradingSettings failed', error);
        return { error: 'Could not save your settings. Try again.' };
    }
}

/** Records that you took a screener entry at your broker. The plan's stop and target come from the row. */
export async function takePosition(input: { rowId: string; shares: number; entry: number }): Promise<{ success: true } | { error: string }> {
    try {
        const userId = await requireUserId();
        const shares = Math.floor(Number(input.shares));
        const entry = Number(input.entry);
        if (!(shares >= 1)) return { error: 'Enter at least 1 share.' };
        if (!(entry > 0)) return { error: 'Enter the price you paid.' };
        await connectToDatabase();
        const row = await ScreenerRow.findById(input.rowId).lean().catch(() => null);
        if (!row || row.stop == null) return { error: 'That screener row is gone. Refresh and try again.' };
        if (entry <= row.stop) return { error: `Your price is at or below the stop (${row.stop}).` };
        if (await Position.exists({ userId, ticker: row.ticker, status: 'open' })) return { error: `You already hold ${row.ticker}.` };
        await Position.create({
            userId, ticker: row.ticker, name: row.name ?? undefined, strategy: row.strategy, universe: row.universe,
            sector: row.sector ?? undefined, shares, entry, stop: row.stop, target2r: row.target2r ?? undefined,
            openedOn: today(), status: 'open', lastClose: row.close, lastScan: row.scanDate, alerted: [],
        });
        refresh();
        return { success: true };
    } catch (error) {
        console.error('takePosition failed', error);
        return { error: 'Could not record the position. Try again.' };
    }
}

export async function closePosition(id: string, exitPrice: number): Promise<{ success: true } | { error: string }> {
    try {
        const userId = await requireUserId();
        const price = Number(exitPrice);
        if (!(price > 0)) return { error: 'Enter the price you sold at.' };
        await connectToDatabase();
        const res = await Position.updateOne({ _id: id, userId, status: 'open' }, { $set: { status: 'closed', exitPrice: price, closedOn: today() } });
        if (!res.matchedCount) return { error: 'That position is not open.' };
        refresh();
        return { success: true };
    } catch (error) {
        console.error('closePosition failed', error);
        return { error: 'Could not close the position. Try again.' };
    }
}

/** For a position recorded by mistake: removes it entirely (it never counts towards P&L or the kill switch). */
export async function deletePosition(id: string): Promise<{ success: true } | { error: string }> {
    try {
        const userId = await requireUserId();
        await connectToDatabase();
        await Position.deleteOne({ _id: id, userId });
        refresh();
        return { success: true };
    } catch (error) {
        console.error('deletePosition failed', error);
        return { error: 'Could not delete the position. Try again.' };
    }
}

export type PositionsView = {
    settings: TradingSettingsData;
    universes: Record<string, EffectiveUniverse>;
    open: PositionData[];
    closed: PositionData[];
    account: { drawdownPct: number; killed: boolean; limitPct: number; realised: number; invested: number };
    sectors: { sector: string; cost: number; pct: number }[];
};

export async function getPositionsView(): Promise<PositionsView> {
    const userId = await requireUserId();
    const [settings, all] = await Promise.all([loadSettings(userId), loadPositions(userId)]);
    const open = all.filter((p) => p.status === 'open');
    const closed = all.filter((p) => p.status === 'closed');
    const invested = open.reduce((s, p) => s + p.shares * p.entry, 0);
    const bySector = new Map<string, number>();
    for (const p of open) bySector.set(p.sector || 'Unknown', (bySector.get(p.sector || 'Unknown') ?? 0) + p.shares * p.entry);
    const kill = accountKillState(closed, settings);
    return {
        settings,
        universes: Object.fromEntries(UNIVERSES.map((u) => [u.id, effectiveUniverse(u, settings)])),
        open,
        closed,
        account: {
            ...kill,
            limitPct: KILL_SWITCH.accountDrawdownPct,
            realised: Math.round(closed.reduce((s, p) => s + positionPnl(p, p.exitPrice ?? p.entry), 0) * 100) / 100,
            invested: Math.round(invested * 100) / 100,
        },
        sectors: [...bySector].map(([sector, cost]) => ({ sector, cost: Math.round(cost * 100) / 100, pct: Math.round((cost / settings.accountSize) * 1000) / 10 }))
            .sort((a, b) => b.cost - a.cost),
    };
}

export type PerformanceRow = {
    strategy: StrategyId;
    universe: string;
    logged: number;
    open: number;
    live: ReturnType<typeof rStats>;
    /** Drawdown counted by the kill switch (since its last reset). */
    killDrawdownR: number | null;
    killed: boolean;
    resetAt: string | null;
    validated: boolean | null;
    backtest: BacktestStats | null;
};

export type PerformanceView = {
    rows: PerformanceRow[];
    market: MarketRegime | null;
    scanDate: string | null;
    killLimitR: number;
    account: { drawdownPct: number; killed: boolean; limitPct: number };
};

/** The forward test per strategy x universe, next to what the walk-forward backtest expected. */
export async function getPerformance(): Promise<PerformanceView> {
    const userId = await requireUserId();
    await connectToDatabase();
    const [settings, byPair, run, closed] = await Promise.all([
        loadSettings(userId),
        forwardTradesByPair(),
        ScreenerRun.findOne({ status: 'done' }).sort({ startedAt: -1 }).lean<{ scanDate?: string; market?: MarketRegime | null; universes?: Record<string, UniverseSummary> }>(),
        loadPositions(userId, 'closed'),
    ]);
    const rows: PerformanceRow[] = [];
    for (const u of UNIVERSES) {
        for (const s of scannerStrategies()) {
            const k = killKey(s.id, u.id);
            const trades = byPair.get(k) ?? [];
            const resetAt = settings.killResets[k] ?? null;
            const killDrawdownR = rStats(sinceReset(trades, resetAt)).maxDrawdownR;
            const ev = run?.universes?.[u.id]?.validation?.[s.id];
            rows.push({
                strategy: s.id, universe: u.id,
                logged: trades.length,
                open: trades.filter((t) => t.outcome === 'open').length,
                live: rStats(trades),
                killDrawdownR,
                killed: killDrawdownR !== null && killDrawdownR >= KILL_SWITCH.strategyDrawdownR,
                resetAt,
                validated: ev ? ev.validated : null,
                backtest: ev?.backtest ?? null,
            });
        }
    }
    const kill = accountKillState(closed, settings);
    return {
        rows,
        market: run?.market ?? null,
        scanDate: run?.scanDate ?? null,
        killLimitR: KILL_SWITCH.strategyDrawdownR,
        account: { ...kill, limitPct: KILL_SWITCH.accountDrawdownPct },
    };
}

/** Starts a strategy's kill-switch drawdown afresh from today. Its history is kept. */
export async function resetKillSwitch(strategy: string, universe: string): Promise<{ success: true } | { error: string }> {
    const userId = await requireUserId();
    if (!universeById(universe) || !scannerStrategies().some((s) => s.id === strategy)) return { error: 'Unknown strategy or universe.' };
    await connectToDatabase();
    const current = await loadSettings(userId);
    await TradingSettings.updateOne(
        { userId },
        { $set: { [`killResets.${killKey(strategy, universe)}`]: new Date().toISOString() }, $setOnInsert: { accountSize: current.accountSize } },
        { upsert: true },
    );
    refresh();
    return { success: true };
}

export async function resetAccountKillSwitch(): Promise<{ success: true }> {
    const userId = await requireUserId();
    await connectToDatabase();
    const current = await loadSettings(userId);
    await TradingSettings.updateOne(
        { userId },
        { $set: { accountResetAt: new Date().toISOString() }, $setOnInsert: { accountSize: current.accountSize } },
        { upsert: true },
    );
    refresh();
    return { success: true };
}
