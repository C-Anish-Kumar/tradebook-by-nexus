'use server';

import { requireUserId } from '@/lib/better-auth/auth';
import { getBacktest, type BacktestResult } from '@/lib/analyst';

const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;
const YEARS = [1, 3, 5, 10];

export async function runBacktest(rawSymbol: string, rawYears: number): Promise<BacktestResult> {
    await requireUserId();
    const symbol = String(rawSymbol ?? '').trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(symbol)) throw new Error('Backtests support stock tickers only');
    const years = YEARS.includes(Number(rawYears)) ? Number(rawYears) : 5;
    return getBacktest(symbol, years);
}
