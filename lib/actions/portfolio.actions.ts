'use server';

import { requireUserId } from '@/lib/better-auth/auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { optimizePortfolio, type PortfolioResult } from '@/lib/analyst';

const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;
const YEARS = [3, 5, 10];

// Errors come back as data: Next hides thrown messages from server actions in production
export async function runPortfolioLab(rawTickers: string[], rawYears: number): Promise<{ data: PortfolioResult } | { error: string }> {
    try {
        const userId = await requireUserId();
        const tickers = [...new Set((Array.isArray(rawTickers) ? rawTickers : []).map((t) => String(t ?? '').trim().toUpperCase()))]
            .filter(Boolean);
        if (tickers.length < 2 || tickers.length > 12) return { error: 'Pick 2 to 12 stocks' };
        const bad = tickers.filter((t) => !SYMBOL_PATTERN.test(t));
        if (bad.length) return { error: `Portfolio Lab supports stock tickers only (not ${bad.join(', ')})` };
        const years = YEARS.includes(Number(rawYears)) ? Number(rawYears) : 5;
        await enforceRateLimit(userId, 'portfolio', 5);
        return { data: await optimizePortfolio(tickers, years) };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Optimisation failed' };
    }
}
