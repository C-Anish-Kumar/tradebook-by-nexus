import { inngest } from '@/lib/inngest/client';
import { connectToDatabase } from '@/database/mongoose';
import { ScreenerRow, ScreenerRun, type UniverseSummary } from '@/database/models/screener.model';
import { ForwardTrade } from '@/database/models/forward-trade.model';
import { NotificationSettings } from '@/database/models/notification.model';
import { Position } from '@/database/models/trading.model';
import { AnalystJobMissingError, analystEnabled, getScreenJob, startScreenJob } from '@/lib/analyst';
import { readCache } from '@/lib/cache';
import { evaluateTrade } from '@/lib/forward-test';
import type { EarningsCalendar } from '@/lib/market-intel';
import { pairKey, toRows, trackList, type Signal } from '@/lib/screener';
import type { SetupStatus } from '@/lib/setups';
import { scannerStrategies, type StrategyId } from '@/lib/strategies';
import { TELEGRAM_TOP_N, UNIVERSES } from '@/config/universes';
import { APP_URL } from '@/lib/brand';
import { notify, stockLink } from '@/lib/notify';
import { telegramEnabled } from '@/lib/telegram';
import { effectiveUniverse, planEntries, positionExit, type MarketRegime } from '@/lib/risk';
import { forwardTradesByPair, loadPlanContext } from '@/lib/risk-context';
import { dailySummaryMessage, entriesMessage, exitMessage, type AlertPick } from '@/lib/risk-alerts';

const MAX_POLLS = 75;          // 2 minutes apart: the scan gets two and a half hours
const MAX_UNREACHABLE = 5;     // consecutive failed status checks (a busy or restarting Space) before giving up
const KEEP_DAYS = 60;          // older runs and their rows are deleted

const fail = async (runId: string, error: string) => {
    await connectToDatabase();
    await ScreenerRun.updateOne({ _id: runId }, { $set: { status: 'error', error, finishedAt: new Date() } });
};

/**
 * After the US close: build every universe in config/universes.ts, run every enabled strategy on every member,
 * and store a ranked row per stock x strategy with something in play. The analyst service does the heavy work
 * as a background job; this function starts it, waits in 2-minute sleeps (which cost nothing), then saves the
 * result and updates the forward test.
 */
export const runScreener = inngest.createFunction(
    {
        id: 'run-screener',
        concurrency: 1,
        retries: 1,
        triggers: [{ event: 'app/screener.run' }, { cron: 'TZ=America/New_York 20 17 * * 1-5' }],
        // Whatever broke, never leave a scan showing as "running" (that also locks the Run scan now button)
        onFailure: async ({ error }) => {
            await connectToDatabase();
            await ScreenerRun.updateMany({ status: 'running' }, { $set: { status: 'error', error: `Scan failed: ${error.message}`.slice(0, 500), finishedAt: new Date() } });
        },
    },
    async ({ step }) => {
        if (!analystEnabled) return { skipped: 'analyst service not configured' };
        const strategies = scannerStrategies().map((s) => s.id);
        if (!strategies.length) return { skipped: 'no scanner strategy is switched on' };

        const started = await step.run('start', async () => {
            await connectToDatabase();
            // Only one scan runs at a time, so anything still marked running is left over from a crash
            await ScreenerRun.updateMany({ status: 'running' }, { $set: { status: 'error', error: 'Interrupted', finishedAt: new Date() } });
            const last = await ScreenerRun.findOne({ status: 'done' }).sort({ startedAt: -1 }).lean();
            const prevRows = last ? await ScreenerRow.find({ runId: last._id }, { ticker: 1, strategy: 1, universe: 1, signal: 1 }).lean() : [];
            const open = await ForwardTrade.find({ outcome: 'open', universe: { $exists: true } }, { symbol: 1, strategy: 1, universe: 1 }).lean();
            // Positions you took are always reported, so their stops and exits are seen
            const held = await Position.find({ status: 'open' }, { ticker: 1, strategy: 1, universe: 1 }).lean();
            const track = trackList(
                prevRows.map((r) => ({ ticker: r.ticker, strategy: r.strategy as StrategyId, universe: r.universe, signal: r.signal as Signal })),
                [
                    ...open.map((t) => ({ ticker: t.symbol, strategy: t.strategy as StrategyId, universe: t.universe! })),
                    ...held.map((p) => ({ ticker: p.ticker, strategy: p.strategy as StrategyId, universe: p.universe })),
                ],
            );
            const job = await startScreenJob({
                universes: UNIVERSES.map((u) => ({ id: u.id, name: u.name, filters: u.filters, slippageBps: u.slippageBps, badges: u.badges })),
                strategies,
                track,
            });
            const run = await ScreenerRun.create({ status: 'running', jobId: job.id, startedAt: new Date() });
            return { runId: String(run._id), jobId: job.id, tracked: track.length };
        });

        let done = false;
        let unreachable = 0;
        for (let i = 0; i < MAX_POLLS && !done; i++) {
            await step.sleep(`wait-${i}`, i === 0 ? '3m' : '2m');
            const state = await step.run(`poll-${i}`, async () => {
                try {
                    const job = await getScreenJob(started.jobId);
                    return { status: job.status, stage: job.stage ?? null, error: job.error ?? null };
                } catch (error) {
                    if (error instanceof AnalystJobMissingError) return { status: 'missing' as const, stage: null, error: 'The analyst service restarted and lost the scan' };
                    // A busy or restarting Space answers 5xx for a while; keep the scan alive and check again
                    return { status: 'unreachable' as const, stage: null, error: error instanceof Error ? error.message : String(error) };
                }
            });
            unreachable = state.status === 'unreachable' ? unreachable + 1 : 0;
            if (state.status === 'error' || state.status === 'missing' || unreachable >= MAX_UNREACHABLE) {
                const reason = unreachable >= MAX_UNREACHABLE ? `The analyst service stopped answering (${state.error})` : state.error ?? 'Scan failed';
                await step.run('mark-failed', () => fail(started.runId, reason));
                return { runId: started.runId, failed: reason };
            }
            done = state.status === 'done';
        }
        if (!done) {
            await step.run('mark-timed-out', () => fail(started.runId, 'The scan took longer than two and a half hours'));
            return { runId: started.runId, failed: 'timed out' };
        }

        const saved = await step.run('save', async () => {
            const job = await getScreenJob(started.jobId);
            const result = job.result;
            if (!result) throw new Error('The scan finished without a result');
            await connectToDatabase();

            // Yesterday's signals, so a trade that went quiet shows as an Exit
            const last = await ScreenerRun.findOne({ status: 'done' }).sort({ startedAt: -1 }).lean();
            const prev = new Map<string, Signal>();
            if (last) {
                for (const r of await ScreenerRow.find({ runId: last._id }, { ticker: 1, strategy: 1, signal: 1 }).lean()) {
                    prev.set(pairKey(r.ticker, r.strategy), r.signal as Signal);
                }
            }
            // Next report per stock from the shared earnings calendar, for the "earnings soon" badge
            const today = new Date().toISOString().slice(0, 10);
            const earnings = new Map<string, string>();
            for (const e of (await readCache<EarningsCalendar>('earnings:calendar'))?.value?.events ?? []) {
                if (e.date >= today && (!earnings.has(e.symbol) || e.date < earnings.get(e.symbol)!)) earnings.set(e.symbol, e.date);
            }

            const rows = toRows(result, prev, earnings, today);
            if (rows.length) await ScreenerRow.insertMany(rows.map((r) => ({ ...r, runId: started.runId })), { ordered: false });
            const universes: Record<string, UniverseSummary> = {};
            for (const [id, u] of Object.entries(result.universes)) {
                universes[id] = { name: u.name, candidates: u.candidates, members: u.members, allMembers: u.all_members, validation: u.validation };
            }
            await ScreenerRun.updateOne({ _id: started.runId }, {
                $set: {
                    status: 'done', scanDate: result.date ?? undefined, finishedAt: new Date(), problems: result.problems, universes,
                    rowCount: rows.length, seconds: result.seconds, market: result.market ?? null,
                },
            });

            // Keep two months of history
            const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000);
            const old = await ScreenerRun.find({ startedAt: { $lt: cutoff } }, { _id: 1 }).lean();
            if (old.length) {
                await ScreenerRow.deleteMany({ runId: { $in: old.map((o) => o._id) } });
                await ScreenerRun.deleteMany({ _id: { $in: old.map((o) => o._id) } });
            }
            return { rows: rows.length, entries: rows.filter((r) => r.signal === 'entry').length, problems: result.problems };
        });

        // Forward test: every entry becomes a paper trade in its universe; open trades are judged on today's close
        const forward = await step.run('forward-test', async () => {
            await connectToDatabase();
            await ForwardTrade.syncIndexes(); // moves the unique index to include the universe
            const rows = await ScreenerRow.find({ runId: started.runId }).lean();
            let opened = 0, closed = 0;
            for (const r of rows) {
                if (r.signal !== 'entry' || r.entry == null || r.stop == null || r.target2r == null) continue;
                const exists = await ForwardTrade.exists({ strategy: r.strategy, symbol: r.ticker, universe: r.universe, $or: [{ outcome: 'open' }, { signalDate: r.scanDate }] });
                if (exists) continue;
                await ForwardTrade.create({
                    strategy: r.strategy, symbol: r.ticker, universe: r.universe, signalDate: r.scanDate,
                    entry: r.entry, stop: r.stop, target2r: r.target2r, score: r.score, validated: r.validated,
                });
                opened++;
            }
            const today = new Map(rows.map((r) => [pairKey(r.ticker, r.strategy), r]));
            for (const trade of await ForwardTrade.find({ outcome: 'open', universe: { $exists: true } })) {
                const row = today.get(pairKey(trade.symbol, trade.strategy));
                if (!row) continue;
                // Anything but entry/holding means the strategy is flat, so the paper trade has exited
                const status: SetupStatus = row.signal === 'entry' || row.signal === 'holding' ? row.signal : 'none';
                const update = evaluateTrade(trade, { date: row.scanDate, close: row.close, status });
                if (!update) continue;
                await ForwardTrade.updateOne({ _id: trade._id }, { $set: update });
                if (update.outcome !== 'open') closed++;
            }
            return { opened, closed };
        });

        // Positions you took: tonight's close, for the Positions page and the summary
        const positions = await step.run('positions', async () => {
            await connectToDatabase();
            const rows = await ScreenerRow.find({ runId: started.runId }, { ticker: 1, close: 1, scanDate: 1 }).lean();
            const close = new Map(rows.map((r) => [r.ticker, r]));
            let updated = 0;
            for (const p of await Position.find({ status: 'open' }, { ticker: 1 }).lean()) {
                const r = close.get(p.ticker);
                if (!r) continue;
                await Position.updateOne({ _id: p._id }, { $set: { lastClose: r.close, lastScan: r.scanDate } });
                updated++;
            }
            return { updated };
        });

        const alerts = await step.run('alerts', () => sendScreenerAlerts(started.runId));

        return { runId: started.runId, tracked: started.tracked, ...saved, forward, positions, alerts };
    },
);

/**
 * Telegram after a scan, per linked user and each switchable on the Profile page: the entries that fit their plan in
 * every universe with alerts on (above its minimum score), exits on positions they took (each reason once), and a
 * summary. "Fits the plan" is worked out for that user: their account, caps, positions and kill switches.
 */
export async function sendScreenerAlerts(runId: string) {
    if (!telegramEnabled) return { skipped: 'Telegram is not set up' };
    await connectToDatabase();
    const users = await NotificationSettings.find({ telegramChatId: { $exists: true, $ne: null } }, { userId: 1, telegramChatId: 1, prefs: 1 }).lean();
    if (!users.length) return { users: 0 };
    const run = await ScreenerRun.findById(runId).lean<{ scanDate?: string; market?: MarketRegime | null; universes?: Record<string, UniverseSummary> }>();
    const rows = (await ScreenerRow.find({ runId }).lean()).map(({ _id, ...r }) => ({ ...r, id: String(_id) }));
    const byPair = await forwardTradesByPair();
    const sent = { entries: 0, exits: 0, summaries: 0 };

    for (const user of users) {
        const on = (key: 'screenerEntries' | 'positionExits' | 'screenerDaily') => user.prefs?.[key] !== false;
        const ctx = await loadPlanContext(user.userId, run?.market, byPair);
        const open = ctx.positionsAll.filter((p) => p.status === 'open');
        const plan = planEntries(rows, ctx);
        const picksIn = (universe: string, minScore = 0): AlertPick[] => rows
            .filter((r) => r.universe === universe && r.signal === 'entry' && plan.get(r.id)?.reason === 'fits' && r.score >= minScore)
            .sort((a, b) => b.score - a.score)
            .map((r) => ({ row: r, plan: plan.get(r.id)! }));

        if (on('screenerEntries')) {
            for (const u of UNIVERSES) {
                const eff = effectiveUniverse(u, ctx.settings);
                if (!eff.telegram.enabled) continue;
                const picks = picksIn(u.id, eff.telegram.minScore).slice(0, TELEGRAM_TOP_N);
                if (picks.length && await notify(user, entriesMessage(u.name, picks, stockLink))) sent.entries++;
            }
        }

        if (on('positionExits')) {
            for (const p of open) {
                const row = rows.find((r) => r.ticker === p.ticker && r.strategy === p.strategy);
                const reason = positionExit(p, row);
                if (!row || !reason || p.alerted.includes(reason)) continue;
                if (await notify(user, exitMessage(p, reason, row.close, stockLink))) {
                    await Position.updateOne({ _id: p.id }, { $addToSet: { alerted: reason } });
                    sent.exits++;
                }
            }
        }

        if (on('screenerDaily') && run) {
            const universes = UNIVERSES.map((u) => {
                const inU = rows.filter((r) => r.universe === u.id && r.signal === 'entry');
                const fits = picksIn(u.id);
                return { name: u.name, members: run.universes?.[u.id]?.members?.length ?? 0, entries: inU.length, fits: fits.length, top: fits.slice(0, 3) };
            });
            const html = dailySummaryMessage({
                date: run.scanDate ?? null, market: run.market, universes, positions: open,
                killed: [...ctx.killed], accountKilled: ctx.accountKilled, link: stockLink, appUrl: APP_URL,
            });
            if (await notify(user, html)) sent.summaries++;
        }
    }
    return { users: users.length, ...sent };
}
