'use server';

import { requireUserId } from '@/lib/better-auth/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getCompanyNews } from '@/lib/finnhub';

const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;

// The stock page's news panel polls this. Errors come back as data: Next hides thrown messages in production
export async function refreshStockNews(rawSymbol: string): Promise<{ data: MarketNewsArticle[] } | { error: string }> {
    try {
        const userId = await requireUserId();
        const symbol = String(rawSymbol ?? '').trim().toUpperCase();
        if (!SYMBOL_PATTERN.test(symbol)) return { error: 'News is available for stock tickers only' };
        await enforceRateLimit(userId, 'news', 20);
        return { data: await getCompanyNews(symbol) };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Could not load news' };
    }
}
