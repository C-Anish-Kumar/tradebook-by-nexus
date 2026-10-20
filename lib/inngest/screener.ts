import { inngest } from '@/lib/inngest/client';
import { connectToDatabase } from '@/database/mongoose';
import { ScreenerRow, ScreenerRun, type UniverseSummary } from '@/database/models/screener.model';
import { ForwardTrade } from '@/database/models/forward-trade.model';
import { AnalystJobMissingError, analystEnabled, getScreenJob, startScreenJob } from '@/lib/analyst';
import { readCache } from '@/lib/cache';
import { evaluateTrade } from '@/lib/forward-test';
import type { EarningsCalendar } from '@/lib/market-intel';
import { pairKey, toRows, trackList, type Signal } from '@/lib/screener';
import type { SetupStatus } from '@/lib/setups';
import { scannerStrategies, type StrategyId } from '@/lib/strategies';
import { UNIVERSES } from '@/config/universes';

const MAX_POLLS = 75;          // 2 minutes apart: the scan gets two and a half hours
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
    },
    async ({ step }) => {
        if (!analystEnabled) return { skipped: 'analyst service not configured' };
        const strategies = scannerStrategies().map((s) => s.id);
        if (!strategies.length) return { skipped: 'no scanner strategy is switched on' };

        const started = await step.run('start', async () => {
            await connectToDatabase();
            const last = await ScreenerRun.findOne({ status: 'done' }).sort({ startedAt: -1 }).lean();
            const prevRows = last ? await ScreenerRow.find({ runId: last._id }, { ticker: 1, strategy: 1, universe: 1, signal: 1 }).lean() : [];
            const open = await ForwardTrade.find({ outcome: 'open', universe: { $exists: true } }, { symbol: 1, strategy: 1, universe: 1 }).lean();
            const track = trackList(
                prevRows.map((r) => ({ ticker: r.ticker, strategy: r.strategy as StrategyId, universe: r.universe, signal: r.signal as Signal })),
                open.map((t) => ({ ticker: t.symbol, strategy: t.strategy as StrategyId, universe: t.universe! })),
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
        for (let i = 0; i < MAX_POLLS && !done; i++) {
            await step.sleep(`wait-${i}`, i === 0 ? '3m' : '2m');
            const state = await step.run(`poll-${i}`, async () => {
                try {
                    const job = await getScreenJob(started.jobId);
                    return { status: job.status, stage: job.stage ?? null, error: job.error ?? null };
                } catch (error) {
                    if (error instanceof AnalystJobMissingError) return { status: 'missing' as const, stage: null, error: 'The analyst service restarted and lost the scan' };
                    throw error;
                }
            });
            if (state.status === 'error' || state.status === 'missing') {
                await step.run('mark-failed', () => fail(started.runId, state.error ?? 'Scan failed'));
                return { runId: started.runId, failed: state.error };
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
                $set: { status: 'done', scanDate: result.date ?? undefined, finishedAt: new Date(), problems: result.problems, universes, rowCount: rows.length, seconds: result.seconds },
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

        return { runId: started.runId, tracked: started.tracked, ...saved, forward };
    },
);
