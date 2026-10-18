import { inngest } from '@/lib/inngest/client';
import { connectToDatabase } from '@/database/mongoose';
import { Watchlist } from '@/database/models/watchlist.model';
import { readCache, writeCache } from '@/lib/cache';
import { analystEnabled, fetchSetup } from '@/lib/analyst';
import { linkedUsers, notify, stockLink, watchlistsFor } from '@/lib/notify';
import { setupMessage, transition, type SetupStatus, type StoredSetup } from '@/lib/setups';

const MAX_SYMBOLS = 60; // one free analyst Space works through them one at a time
const isUsStock = (s: string) => !s.includes(':') && !s.includes('.');

type SetupState = { status: SetupStatus };

/**
 * After the close (and after the strategy-signal job): score every watched stock's regime and breakout
 * setup, store the result for the Setups page, and message opted-in users about fresh entries and exits.
 * One Inngest step per symbol, so a slow or sleeping Space retries just that stock, not the whole scan.
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

        const symbols = await step.run('list-symbols', async () => {
            await connectToDatabase();
            const all = (await Watchlist.distinct('symbol')) as string[];
            return [...new Set(all.map((s) => s.toUpperCase()).filter(isUsStock))].sort().slice(0, MAX_SYMBOLS);
        });
        if (!symbols.length) return { scanned: 0 };

        const changes: { symbol: string; kind: 'entry' | 'exit'; stored: StoredSetup }[] = [];
        let failed = 0;

        for (const symbol of symbols) {
            const result = await step.run(`setup-${symbol}`, async () => {
                try {
                    // Universe = every stock scanned, so the Deflated Sharpe prices in the whole search
                    const setup = await fetchSetup(symbol, symbols.length);
                    const stored: StoredSetup = { setup, scannedAt: new Date().toISOString() };
                    const prev = (await readCache<SetupState>(`setup-state:${symbol}`))?.value;
                    await writeCache(`setup:${symbol}`, stored);
                    await writeCache<SetupState>(`setup-state:${symbol}`, { status: setup.status });
                    const kind = transition(prev?.status, setup.status);
                    return { ok: true as const, kind, stored };
                } catch (error) {
                    console.error(`setup scan failed for ${symbol}`, error);
                    return { ok: false as const };
                }
            });
            if (!result.ok) failed++;
            else if (result.kind) changes.push({ symbol, kind: result.kind, stored: result.stored });
        }

        const sent = await step.run('notify', async () => {
            if (!changes.length) return 0;
            const users = await linkedUsers('setups');
            if (!users.length) return 0;
            const lists = await watchlistsFor(users.map((u) => u.userId));
            let count = 0;
            for (const c of changes) {
                for (const u of users) {
                    if ((lists.get(u.userId) ?? []).includes(c.symbol)
                        && await notify(u, setupMessage(stockLink(c.symbol), c.stored.setup, c.kind))) count++;
                }
            }
            return count;
        });

        return { scanned: symbols.length, failed, changes: changes.map((c) => `${c.symbol}: ${c.kind}`), sent };
    },
);
