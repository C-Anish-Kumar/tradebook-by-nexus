import { Schema, model, models, type Model, type Types } from 'mongoose';
import type { PooledEvidence, ScreenerRowData } from '@/lib/screener';

export type ScreenerRunStatus = 'running' | 'done' | 'error';

export type UniverseSummary = {
    name: string;
    candidates: number;
    /** Stocks whose first (primary) universe is this one, after every filter. */
    members: string[];
    /** Members before de-duplication across universes. */
    allMembers: number;
    validation: Record<string, PooledEvidence>;
};

// One nightly scan of every universe (the rows it found live in ScreenerRow)
export interface IScreenerRun {
    status: ScreenerRunStatus;
    jobId?: string;
    scanDate?: string;          // the daily bar the scan read (YYYY-MM-DD)
    startedAt: Date;
    finishedAt?: Date;
    error?: string;
    problems: string[];
    universes: Record<string, UniverseSummary>;
    rowCount: number;
    seconds?: number;
}

const ScreenerRunSchema = new Schema<IScreenerRun>(
    {
        status: { type: String, enum: ['running', 'done', 'error'], required: true, index: true },
        jobId: String,
        scanDate: { type: String, index: true },
        startedAt: { type: Date, required: true },
        finishedAt: Date,
        error: String,
        problems: { type: [String], default: [] },
        universes: { type: Schema.Types.Mixed, default: {} },
        rowCount: { type: Number, default: 0 },
        seconds: Number,
    },
    { versionKey: false, minimize: false },
);

export const ScreenerRun: Model<IScreenerRun> =
    (models?.ScreenerRun as Model<IScreenerRun>) || model<IScreenerRun>('ScreenerRun', ScreenerRunSchema);

export interface IScreenerRow extends ScreenerRowData {
    runId: Types.ObjectId;
}

const ScreenerRowSchema = new Schema<IScreenerRow>(
    {
        runId: { type: Schema.Types.ObjectId, ref: 'ScreenerRun', required: true },
        scanDate: { type: String, required: true },
        universe: { type: String, required: true },
        ticker: { type: String, required: true },
        name: String,
        sector: String,
        exchange: String,
        marketCap: Number,
        tags: { type: [String], default: [] },
        strategy: { type: String, required: true },
        signal: { type: String, enum: ['entry', 'watch', 'holding', 'exit', 'none'], required: true },
        close: Number,
        trigger: Number,
        entry: Number,
        stop: Number,
        target2r: Number,
        target3r: Number,
        riskPerShare: Number,
        score: { type: Number, required: true },
        scoreLabel: String,
        capped: Boolean,
        validated: Boolean,
        regime: { type: Schema.Types.Mixed, default: {} },
        relVolume: Number,
        atrPct: Number,
        avgDollarVolume: Number,
        spreadPct: Number,
        badges: { type: [{ code: String, label: String, _id: false }], default: [] },
    },
    { versionKey: false, minimize: false },
);
ScreenerRowSchema.index({ runId: 1, universe: 1, score: -1 });
ScreenerRowSchema.index({ ticker: 1, scanDate: -1 });

export const ScreenerRow: Model<IScreenerRow> =
    (models?.ScreenerRow as Model<IScreenerRow>) || model<IScreenerRow>('ScreenerRow', ScreenerRowSchema);
