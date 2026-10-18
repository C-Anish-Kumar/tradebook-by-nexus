import { Schema, model, models, type Document, type Model } from 'mongoose';

export type RlRunStatus = 'queued' | 'running' | 'done' | 'error';

export interface IRlRun extends Document {
    userId: string;
    kind: 'run' | 'sweep';
    template: string;
    tickers: string[];
    timesteps: number;
    algos: string[];
    seeds: number;
    status: RlRunStatus;
    jobId?: string;
    result?: unknown;
    error?: string;
    createdAt: Date;
    updatedAt: Date;
}

// One Nexus training run or sweep, requested from the RL Lab page
const RlRunSchema = new Schema<IRlRun>(
    {
        userId: { type: String, required: true, index: true },
        kind: { type: String, enum: ['run', 'sweep'], required: true },
        template: { type: String, required: true },
        tickers: { type: [String], default: [] },
        timesteps: { type: Number, required: true },
        algos: { type: [String], default: [] },
        seeds: { type: Number, default: 1 },
        status: { type: String, enum: ['queued', 'running', 'done', 'error'], default: 'queued' },
        jobId: { type: String },
        result: { type: Schema.Types.Mixed },
        error: { type: String },
    },
    { timestamps: true }
);

RlRunSchema.index({ userId: 1, createdAt: -1 });

export const RlRun: Model<IRlRun> =
    (models?.RlRun as Model<IRlRun>) || model<IRlRun>('RlRun', RlRunSchema);
