'use server';

import { requireUserId } from '@/lib/better-auth/auth';
import { readCache } from '@/lib/cache';
import { enforceRateLimit } from '@/lib/rate-limit';
import { inngest } from '@/lib/inngest/client';
import { getUserWatchlist } from '@/lib/actions/watchlist.actions';
import type { StoredSetup } from '@/lib/setups';
import type { EarningsCalendar } from '@/lib/market-intel';
import { setupCacheKey, scannerStrategies, STRATEGIES, type StrategyId } from '@/lib/strategies';
import { connectToDatabase } from '@/database/mongoose';
import { ForwardTrade } from '@/database/models/forward-trade.model';
import { summarize, type Summary } from '@/lib/forward-test';
import { isScannable } from '@/lib/symbols';

export type SetupRow = { symbol: string; stored: StoredSetup | null; earningsDate?: string };


/** The latest stored setup of one strategy for each stock on the user's watchlist (written by the nightly scan). */
export async function getSetupBoard(strategy: StrategyId = 'breakout'): Promise<SetupRow[]> {
    await requireUserId();
    if (!STRATEGIES[strategy]?.scanner || !STRATEGIES[strategy].enabled) return []; // callable from the browser: only serve live scanners
    const items = await getUserWatchlist();
    const symbols = (items as { symbol: string }[]).map((i) => i.symbol.toUpperCase()).filter(isScannable);
    // Next report per stock, from the shared earnings calendar (about three weeks ahead); absent when none is due
    const today = new Date().toISOString().slice(0, 10);
    const calendar = (await readCache<EarningsCalendar>('earnings:calendar'))?.value;
    const next = new Map<string, string>();
    for (const e of calendar?.events ?? []) {
        if (e.date >= today && (!next.has(e.symbol) || e.date < next.get(e.symbol)!)) next.set(e.symbol, e.date);
    }
    return Promise.all(symbols.map(async (symbol) => ({
        symbol,
        stored: (await readCache<StoredSetup>(setupCacheKey(strategy, symbol)))?.value ?? null,
        earningsDate: next.get(symbol),
    })));
}

/** Asks Inngest to scan now instead of waiting for the evening run. Errors come back as data. */
export async function requestSetupScan(): Promise<{ success: true } | { error: string }> {
    try {
        const userId = await requireUserId();
        await enforceRateLimit(userId, 'setup-scan', 2);
        await inngest.send({ name: 'app/setups.scan', data: { requestedBy: userId } });
        return { success: true };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Could not start the scan' };
    }
}

export type ForwardRow = { strategy: StrategyId; label: string; name: string } & Summary;
export type ForwardTradeRow = { id: string; strategy: StrategyId; symbol: string; signalDate: string; outcome: string; r: number | null; score: number | null };

/** How the scanner's entries have actually done since they were logged: every user's watchlist feeds one shared record. */
export async function getForwardTest(): Promise<{ rows: ForwardRow[]; recent: ForwardTradeRow[] }> {
    await requireUserId();
    await connectToDatabase();
    const all = await ForwardTrade.find({}).sort({ signalDate: -1 }).limit(2000).lean();
    const rows = scannerStrategies().map((s) => ({ strategy: s.id, label: s.label, name: s.name, ...summarize(all.filter((t) => t.strategy === s.id)) }));
    const recent = all.slice(0, 12).map((t) => ({
        id: String(t._id), strategy: t.strategy as StrategyId, symbol: t.symbol, signalDate: t.signalDate,
        outcome: t.outcome, r: typeof t.r === 'number' ? t.r : null, score: t.score ?? null,
    }));
    return { rows, recent };
}
