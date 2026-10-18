import { inngest } from '@/lib/inngest/client';
import { connectToDatabase } from '@/database/mongoose';
import { Watchlist } from '@/database/models/watchlist.model';
import { readCache, writeCache } from '@/lib/cache';
import { analystEnabled, fetchSetup } from '@/lib/analyst';
import { linkedUsers, notify, stockLink, watchlistsFor } from '@/lib/notify';
import { setupMessage, transition, type SetupStatus, type StoredSetup } from '@/lib/setups';
import { ForwardTrade } from '@/database/models/forward-trade.model';
import { evaluateTrade } from '@/lib/forward-test';
import { scannerStrategies, setupCacheKey, setupStateKey, type Strategy } from '@/lib/strategies';
import { isScannable } from '@/lib/symbols';

const MAX_SYMBOLS = 60; // one free analyst Space works through them one at a time

type SetupState = { status: SetupStatus };
type Change = { symbol: string; strategy: Strategy; kind: 'entry' | 'exit'; stored: StoredSetup };

/**
 * After the close (and after the strategy-signal job): score every watched stock under every enabled strategy,
 * store the result for the Setups page, and message opted-in users about fresh entries and exits.
 * One Inngest step per stock and strategy, so a slow or sleeping Space retries just that one, not the whole scan.
 * The Deflated Sharpe is told the search covered every stock x strategy pair, so picking the best of many is priced in.
 */
export const scanSetups = inngest.createFunction(
    {
        id: 'scan-setups',
        concurrency: 1,
        retries: 1,
        triggers: [{ event: 'app/setups.scan' }, { cron: 'TZ=America/New_York 55 16 * * 1-5' }],
    },
    async ({ step }) => {
        if (!analystEnabled) return { skipped: 'analyst service not configured' };
        const strategies = scannerStrategies();
        if (!strategies.length) return { skipped: 'no scanner strategy is switched on' };

        const symbols = await step.run('list-symbols', async () => {
            await connectToDatabase();
            const all = (await Watchlist.distinct('symbol')) as string[];
            return [...new Set(all.map((s) => s.toUpperCase()).filter(isScannable))].sort().slice(0, MAX_SYMBOLS);
        });
        if (!symbols.length) return { scanned: 0 };

        const universe = symbols.length * strategies.length;
        const changes: Change[] = [];
        const fresh: { symbol: string; strategy: Strategy; stored: StoredSetup }[] = [];
        let failed = 0;

        for (const symbol of symbols) {
            for (const strategy of strategies) {
                const result = await step.run(`setup-${strategy.id}-${symbol}`, async () => {
                    try {
                        const setup = await fetchSetup(symbol, universe, 60_000, strategy.id);
                        const stored: StoredSetup = { setup, scannedAt: new Date().toISOString() };
                        const prev = (await readCache<SetupState>(setupStateKey(strategy.id, symbol)))?.value;
                        await writeCache(setupCacheKey(strategy.id, symbol), stored);
                        await writeCache<SetupState>(setupStateKey(strategy.id, symbol), { status: setup.status });
                        return { ok: true as const, kind: transition(prev?.status, setup.status), stored };
                    } catch (error) {
                        console.error(`setup scan failed for ${strategy.id} ${symbol}`, error);
                        return { ok: false as const };
                    }
                });
                if (!result.ok) failed++;
                else if (result.stored.setup.status === 'entry') fresh.push({ symbol, strategy, stored: result.stored });
                if (result.ok && result.kind) changes.push({ symbol, strategy, kind: result.kind, stored: result.stored });
            }
        }

        // Forward test: log every entry the scanner shows as a paper trade, then judge open ones on the newest closes
        const forward = await step.run('forward-test', async () => {
            try {
                await connectToDatabase();
                let opened = 0, closed = 0;
                for (const f of fresh) {
                    const plan = f.stored.setup.plan;
                    if (!plan) continue;
                    const exists = await ForwardTrade.exists({ strategy: f.strategy.id, symbol: f.symbol, $or: [{ outcome: 'open' }, { signalDate: f.stored.setup.date }] });
                    if (exists) continue;
                    await ForwardTrade.create({
                        strategy: f.strategy.id, symbol: f.symbol, signalDate: f.stored.setup.date,
                        entry: plan.entry, stop: plan.stop, target2r: plan.target_2r,
                        score: f.stored.setup.quant?.score ?? null, validated: f.stored.setup.evidence.validated,
                    });
                    opened++;
                }
                for (const trade of await ForwardTrade.find({ outcome: 'open' })) {
                    const latest = (await readCache<StoredSetup>(setupCacheKey(trade.strategy as Strategy['id'], trade.symbol)))?.value?.setup;
                    const update = latest && evaluateTrade(trade, latest);
                    if (!update) continue;
                    await ForwardTrade.updateOne({ _id: trade._id }, { $set: update });
                    if (update.outcome !== 'open') closed++;
                }
                return { opened, closed };
            } catch (error) {
                console.error('forward test update failed', error);
                return { opened: 0, closed: 0 };
            }
        });

        const sent = await step.run('notify', async () => {
            let count = 0;
            for (const strategy of strategies) {
                const mine = changes.filter((c) => c.strategy.id === strategy.id);
                if (!mine.length) continue;
                const users = await linkedUsers(strategy.telegramPref);
                if (!users.length) continue;
                const lists = await watchlistsFor(users.map((u) => u.userId));
                for (const c of mine) {
                    for (const u of users) {
                        // Exits always go out (you may hold it); fresh entries respect the user's minimum score
                        const score = c.stored.setup.quant?.score ?? 0;
                        if ((lists.get(u.userId) ?? []).includes(c.symbol)
                            && (c.kind === 'exit' || score >= (u.minScore ?? 0))
                            && await notify(u, setupMessage(stockLink(c.symbol), c.stored.setup, c.kind, strategy))) count++;
                    }
                }
            }
            return count;
        });

        return { scanned: symbols.length, forward, strategies: strategies.map((s) => s.id), failed, changes: changes.map((c) => `${c.strategy.id} ${c.symbol}: ${c.kind}`), sent };
    },
);
