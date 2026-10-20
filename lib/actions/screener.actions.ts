'use server';

import { requireUserId } from '@/lib/better-auth/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { inngest } from '@/lib/inngest/client';
import { connectToDatabase } from '@/database/mongoose';
import { ScreenerRow, ScreenerRun, type ScreenerRunStatus, type UniverseSummary } from '@/database/models/screener.model';
import type { ScreenerRowData } from '@/lib/screener';
import { effectiveUniverse, planEntries, type EffectiveUniverse, type MarketRegime, type PlanDecision, type TradingSettingsData } from '@/lib/risk';
import { loadPlanContext } from '@/lib/risk-context';
import { UNIVERSES } from '@/config/universes';

export type ScreenerRunInfo = {
    status: ScreenerRunStatus;
    scanDate: string | null;
    startedAt: string;
    finishedAt: string | null;
    error: string | null;
    problems: string[];
    universes: Record<string, Omit<UniverseSummary, 'members'> & { memberCount: number }>;
    market: MarketRegime | null;
};

export type ScreenerData = {
    /** The latest finished scan and its rows. */
    run: ScreenerRunInfo | null;
    rows: (ScreenerRowData & { id: string })[];
    /** A scan in progress or that failed after the latest finished one. */
    latest: Pick<ScreenerRunInfo, 'status' | 'startedAt' | 'error'> | null;
    /** Your account and per-universe settings, with config defaults filled in. */
    settings: TradingSettingsData;
    universes: Record<string, EffectiveUniverse>;
    /** Row id -> whether that entry fits your plan tonight (entries only). */
    plan: Record<string, PlanDecision>;
    /** Tickers you hold, and the kill switches that are tripped (strategy|universe). */
    held: string[];
    killed: string[];
    accountKilled: boolean;
};

const STALE_MS = 3 * 60 * 60_000;

type RunDoc = {
    _id: unknown; status: ScreenerRunStatus; scanDate?: string; startedAt: Date; finishedAt?: Date; error?: string; problems?: string[];
    universes?: Record<string, UniverseSummary>; market?: MarketRegime | null;
};

const info = (r: RunDoc): ScreenerRunInfo => ({
    status: r.status,
    scanDate: r.scanDate ?? null,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    error: r.error ?? null,
    problems: r.problems ?? [],
    universes: Object.fromEntries(Object.entries(r.universes ?? {}).map(([id, u]) => {
        const { members, ...rest } = u;
        return [id, { ...rest, memberCount: members?.length ?? 0 }];
    })),
    market: r.market ?? null,
});

/** The latest finished screen, every row it found, and whether a newer scan is running or failed. */
export async function getScreener(): Promise<ScreenerData> {
    const userId = await requireUserId();
    await connectToDatabase();
    const [done, newest] = await Promise.all([
        ScreenerRun.findOne({ status: 'done' }).sort({ startedAt: -1 }).lean<RunDoc>(),
        ScreenerRun.findOne({}).sort({ startedAt: -1 }).lean<RunDoc>(),
    ]);
    const rows = done ? await ScreenerRow.find({ runId: done._id }).select('-runId').sort({ score: -1 }).lean() : [];
    // A scan "running" for over 3 hours died without saying so (the job allows two and a half): show it as failed
    const stale = newest?.status === 'running' && Date.now() - newest.startedAt.getTime() > STALE_MS;
    const latest = newest && (!done || String(newest._id) !== String(done._id))
        ? { status: stale ? 'error' as const : newest.status, startedAt: newest.startedAt.toISOString(), error: stale ? 'The scan stopped without finishing' : newest.error ?? null }
        : null;
    const out = rows.map(({ _id, ...r }) => ({ ...(r as unknown as ScreenerRowData), id: String(_id) }));
    const ctx = await loadPlanContext(userId, done?.market);
    return {
        run: done ? info(done) : null,
        rows: out,
        latest,
        settings: ctx.settings,
        universes: Object.fromEntries(UNIVERSES.map((u) => [u.id, effectiveUniverse(u, ctx.settings)])),
        plan: Object.fromEntries(planEntries(out, ctx)),
        held: ctx.positions.map((p) => p.ticker),
        killed: [...ctx.killed],
        accountKilled: ctx.accountKilled,
    };
}

/** Starts a full screen now instead of waiting for the evening run. Errors come back as data. */
export async function requestScreenerRun(): Promise<{ success: true } | { error: string }> {
    try {
        const userId = await requireUserId();
        await enforceRateLimit(userId, 'screener-run', 3);
        await inngest.send({ name: 'app/screener.run', data: { requestedBy: userId } });
        return { success: true };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Could not start the scan' };
    }
}

/** This stock's row under one strategy in the latest finished screen, if it was in play. */
export async function getScreenerRow(ticker: string, strategy: string): Promise<ScreenerRowData | null> {
    await requireUserId();
    await connectToDatabase();
    const done = await ScreenerRun.findOne({ status: 'done' }).sort({ startedAt: -1 }).select('_id').lean();
    if (!done) return null;
    const row = await ScreenerRow.findOne({ runId: done._id, ticker: ticker.toUpperCase(), strategy }).select('-_id -runId').lean();
    return row as unknown as ScreenerRowData | null;
}
