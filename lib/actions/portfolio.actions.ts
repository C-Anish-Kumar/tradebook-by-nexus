'use server';

import { requireUserId } from '@/lib/better-auth/auth';
import { optimizePortfolio, type PortfolioResult } from '@/lib/analyst';

const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;
const YEARS = [3, 5, 10];

export async function runPortfolioLab(rawTickers: string[], rawYears: number): Promise<PortfolioResult> {
    await requireUserId();
    const tickers = [...new Set((Array.isArray(rawTickers) ? rawTickers : []).map((t) => String(t ?? '').trim().toUpperCase()))]
        .filter(Boolean);
    if (tickers.length < 2 || tickers.length > 12) throw new Error('Pick 2 to 12 stocks');
    const bad = tickers.filter((t) => !SYMBOL_PATTERN.test(t));
    if (bad.length) throw new Error(`Portfolio Lab supports stock tickers only (not ${bad.join(', ')})`);
    const years = YEARS.includes(Number(rawYears)) ? Number(rawYears) : 5;
    return optimizePortfolio(tickers, years);
}
