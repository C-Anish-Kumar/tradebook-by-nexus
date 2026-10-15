'use server';

import { requireUserId } from '@/lib/better-auth/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getBacktest, type BacktestResult } from '@/lib/analyst';

const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;
const YEARS = [1, 3, 5, 10];

// Errors come back as data: Next hides thrown messages from server actions in production
export async function runBacktest(rawSymbol: string, rawYears: number): Promise<{ data: BacktestResult } | { error: string }> {
    try {
        const userId = await requireUserId();
        const symbol = String(rawSymbol ?? '').trim().toUpperCase();
        if (!SYMBOL_PATTERN.test(symbol)) return { error: 'Backtests support stock tickers only' };
        const years = YEARS.includes(Number(rawYears)) ? Number(rawYears) : 5;
        await enforceRateLimit(userId, 'backtest', 10);
        return { data: await getBacktest(symbol, years) };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Backtest failed' };
    }
}
