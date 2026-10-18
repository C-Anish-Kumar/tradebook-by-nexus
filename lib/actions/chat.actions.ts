'use server';

import { requireUserId } from '@/lib/better-auth/auth';
import { callAIProviderWithFallback } from '@/lib/ai-provider';
import { readCache } from '@/lib/cache';
import { enforceRateLimit } from '@/lib/rate-limit';
import { analystEnabled, getSetup } from '@/lib/analyst';
import { getUserWatchlist } from '@/lib/actions/watchlist.actions';
import { buildPrompt, cleanHistory, extractTickers, formatSetup, isBroadAsk } from '@/lib/chat';
import { sortSetups, type Setup, type StoredSetup } from '@/lib/setups';
import { scannerStrategies, setupCacheKey } from '@/lib/strategies';
import { isScannable } from '@/lib/symbols';

const LIVE_READ_MS = 25_000;   // a cold analyst Space can be slow; answer with what is ready instead of hanging
const BOARD_ROWS = 12;

const within = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
    Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

/** The signal facts the model may quote: the stocks named in the question, plus the best of the watchlist when it is a broad ask. */
async function gatherData(question: string, watchlist: string[]): Promise<string> {
    const strategies = scannerStrategies();
    const tickers = extractTickers(question, watchlist).filter(isScannable);
    const lines: string[] = [];

    for (const symbol of tickers) {
        const rows = await Promise.all(strategies.map(async (strategy) => ({
            strategy, setup: await within(getSetup(symbol, strategy.id).catch(() => null), LIVE_READ_MS),
        })));
        const ready = rows.filter((r): r is { strategy: typeof r.strategy; setup: Setup } => Boolean(r.setup));
        lines.push(...ready.map((r) => formatSetup(symbol, r.strategy, r.setup)));
        if (ready.length < rows.length) lines.push(`${symbol}: ${rows.length - ready.length} strategy read(s) not available yet (the analyst service may be waking up).`);
    }

    if (!tickers.length || isBroadAsk(question)) {
        const board = (await Promise.all(watchlist.filter(isScannable).flatMap((symbol) => strategies.map(async (strategy) => {
            const setup = (await readCache<StoredSetup>(setupCacheKey(strategy.id, symbol)))?.value?.setup ?? null;
            return { symbol, strategy, setup };
        })))).filter((r) => r.setup && (r.setup.status === 'entry' || r.setup.status === 'watch'));
        const top = sortSetups(board).slice(0, BOARD_ROWS);
        lines.push(top.length
            ? `Watchlist signals now (entries and watched breakouts, best first):\n${top.map((r) => formatSetup(r.symbol, r.strategy, r.setup!)).join('\n')}`
            : 'Watchlist: no strategy has an entry or a watched level right now (or the nightly scan has not run yet).');
    }
    return lines.join('\n');
}

/** One chat turn. Takes the recent conversation (the last message is the user's question) and returns the reply. */
export async function askTradeBot(messages: unknown): Promise<{ reply: string } | { error: string }> {
    try {
        const userId = await requireUserId();
        await enforceRateLimit(userId, 'trade-chat', 8);
        if (!analystEnabled) return { error: 'Signals run on the analyst service, which is not configured on this server.' };
        const history = cleanHistory(messages);
        if (!history.length) return { error: 'Ask a question first.' };

        const watchlist = ((await getUserWatchlist()) as { symbol: string }[]).map((i) => i.symbol.toUpperCase());
        const data = await gatherData(history[history.length - 1].content, watchlist);
        const reply = (await callAIProviderWithFallback(buildPrompt(history, data))).trim();
        return { reply: reply || 'I could not put an answer together. Try rephrasing.' };
    } catch (error) {
        console.error('trade chat failed', error);
        return { error: error instanceof Error && /Too many/.test(error.message) ? error.message : 'The assistant could not answer just now. Try again in a moment.' };
    }
}
