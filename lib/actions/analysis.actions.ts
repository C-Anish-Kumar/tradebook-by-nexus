'use server';

import { connectToDatabase } from '@/database/mongoose';
import { Analysis } from '@/database/models/analysis.model';
import { requireUserId } from '@/lib/better-auth/auth';
import { inngest } from '@/lib/inngest/client';
import { analystEnabled } from '@/lib/analyst';

// Same shape the alert actions accept; TradingAgents reads Yahoo tickers (AAPL, BRK-B, SHOP.TO)
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;
// Each run makes dozens of LLM calls, so cap them per user to protect the Gemini quota
const DAILY_LIMIT = Number(process.env.ANALYST_DAILY_LIMIT) || 5;

export type AnalysisSummary = {
    id: string;
    symbol: string;
    tradeDate: string;
    status: 'queued' | 'running' | 'done' | 'error';
    rating?: string;
    error?: string;
    createdAt: string;
};

const toSummary = (doc: {
    _id: unknown; symbol: string; tradeDate: string; status: AnalysisSummary['status'];
    rating?: string; error?: string; createdAt: Date;
}): AnalysisSummary => ({
    id: String(doc._id),
    symbol: doc.symbol,
    tradeDate: doc.tradeDate,
    status: doc.status,
    rating: doc.rating,
    error: doc.error,
    createdAt: new Date(doc.createdAt).toISOString(),
});

export async function getLatestAnalysis(rawSymbol: string): Promise<AnalysisSummary | null> {
    const userId = await requireUserId();
    const symbol = String(rawSymbol ?? '').trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(symbol)) return null;

    await connectToDatabase();
    const doc = await Analysis.findOne({ userId, symbol })
        .sort({ createdAt: -1 })
        .select('-reportHtml')
        .lean();
    return doc ? toSummary(doc) : null;
}

export async function requestAnalysis(rawSymbol: string): Promise<AnalysisSummary> {
    const userId = await requireUserId();
    if (!analystEnabled) throw new Error('AI Analyst is not configured on this server');
    const symbol = String(rawSymbol ?? '').trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(symbol)) throw new Error('AI Analyst supports stock tickers only');

    await connectToDatabase();
    const pending = await Analysis.exists({ userId, status: { $in: ['queued', 'running'] } });
    if (pending) throw new Error('You already have an analysis running. Try again when it finishes.');

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const today = await Analysis.countDocuments({ userId, createdAt: { $gte: since } });
    if (today >= DAILY_LIMIT) throw new Error(`Daily limit reached (${DAILY_LIMIT} analyses per 24 hours)`);

    const tradeDate = new Date().toISOString().slice(0, 10);
    const doc = await Analysis.create({ userId, symbol, tradeDate, status: 'queued' });
    await inngest.send({ name: 'app/analysis.requested', data: { analysisId: String(doc._id) } });
    return toSummary(doc);
}
