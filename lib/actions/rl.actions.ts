'use server';

import { connectToDatabase } from '@/database/mongoose';
import { RlRun } from '@/database/models/rl-run.model';
import { requireUserId } from '@/lib/better-auth/auth';
import { inngest } from '@/lib/inngest/client';
import { ALGOS, TEMPLATES, nexusEnabled, type Algo, type RunResult, type SweepResult } from '@/lib/nexus';

// Yahoo tickers: AAPL, BRK-B, SHOP.TO, BTC-USD
const SYMBOL_PATTERN = /^[A-Z0-9^][A-Z0-9.=^-]{0,14}$/;
const TIMESTEPS = [20_000, 50_000, 150_000];
// Training is CPU-heavy on a free Space; a few runs a day is plenty
const DAILY_LIMIT = Number(process.env.NEXUS_DAILY_LIMIT) || 10;

export type RlRunSummary = {
    id: string;
    kind: 'run' | 'sweep';
    template: string;
    tickers: string[];
    timesteps: number;
    algos: string[];
    seeds: number;
    status: 'queued' | 'running' | 'done' | 'error';
    error?: string;
    createdAt: string;
    result?: RunResult | SweepResult;
};

type Doc = {
    _id: unknown; kind: 'run' | 'sweep'; template: string; tickers: string[]; timesteps: number; algos: string[];
    seeds: number; status: RlRunSummary['status']; error?: string; createdAt: Date; result?: unknown;
};

const toSummary = (doc: Doc, withResult = false): RlRunSummary => ({
    id: String(doc._id),
    kind: doc.kind,
    template: doc.template,
    tickers: doc.tickers,
    timesteps: doc.timesteps,
    algos: doc.algos,
    seeds: doc.seeds,
    status: doc.status,
    error: doc.error,
    createdAt: new Date(doc.createdAt).toISOString(),
    ...(withResult && doc.result ? { result: doc.result as RunResult | SweepResult } : {}),
});

export async function listRlRuns(): Promise<RlRunSummary[]> {
    const userId = await requireUserId();
    await connectToDatabase();
    const docs = await RlRun.find({ userId }).sort({ createdAt: -1 }).limit(20).select('-result').lean<Doc[]>();
    return docs.map((d) => toSummary(d));
}

export async function getRlRun(id: string): Promise<RlRunSummary | null> {
    const userId = await requireUserId();
    if (!/^[a-f0-9]{24}$/.test(String(id))) return null;
    await connectToDatabase();
    const doc = await RlRun.findOne({ _id: id, userId }).lean<Doc>();
    return doc ? toSummary(doc, true) : null;
}

export type RlRequest = {
    kind: 'run' | 'sweep';
    template: string;
    tickers?: string[];
    timesteps: number;
    algo?: Algo;
    algos?: Algo[];
    seeds?: number;
};

// Errors come back as data: Next hides thrown messages from server actions in production
export async function requestRlRun(req: RlRequest): Promise<{ data: RlRunSummary } | { error: string }> {
    try {
        const userId = await requireUserId();
        if (!nexusEnabled) return { error: 'RL Lab is not configured on this server' };
        const kind = req.kind === 'sweep' ? 'sweep' : 'run';
        if (!TEMPLATES.some((t) => t.name === req.template)) return { error: 'Pick a strategy template' };
        const timesteps = TIMESTEPS.includes(Number(req.timesteps)) ? Number(req.timesteps) : 50_000;

        const tickers = [...new Set((req.tickers ?? []).map((t) => String(t ?? '').trim().toUpperCase()).filter(Boolean))];
        if (tickers.length > 12) return { error: 'Use at most 12 tickers' };
        const bad = tickers.filter((t) => !SYMBOL_PATTERN.test(t));
        if (bad.length) return { error: `Not a valid ticker: ${bad.join(', ')}` };

        const algos = kind === 'sweep'
            ? [...new Set((req.algos ?? ['ppo', 'a2c']).filter((a): a is Algo => (ALGOS as readonly string[]).includes(a)))]
            : [(ALGOS as readonly string[]).includes(req.algo ?? '') ? req.algo! : 'ppo'];
        const seeds = kind === 'sweep' ? Math.min(Math.max(Math.round(Number(req.seeds) || 2), 1), 3) : 1;
        if (!algos.length) return { error: 'Pick at least one algorithm' };
        if (algos.length * seeds > 6) return { error: 'A sweep can train at most 6 agents' };

        await connectToDatabase();
        if (await RlRun.exists({ userId, status: { $in: ['queued', 'running'] } })) {
            return { error: 'You already have a run in progress. Try again when it finishes.' };
        }
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        if (await RlRun.countDocuments({ userId, createdAt: { $gte: since } }) >= DAILY_LIMIT) {
            return { error: `Daily limit reached (${DAILY_LIMIT} runs per 24 hours)` };
        }

        const doc = await RlRun.create({ userId, kind, template: req.template, tickers, timesteps, algos, seeds });
        await inngest.send({ name: 'app/rl.requested', data: { runId: String(doc._id) } });
        return { data: toSummary(doc.toObject() as Doc) };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Couldn’t start the run' };
    }
}
