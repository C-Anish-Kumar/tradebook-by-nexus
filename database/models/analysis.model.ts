import { Schema, model, models, type Document, type Model } from 'mongoose';

export type AnalysisStatus = 'queued' | 'running' | 'done' | 'error';

export interface IAnalysis extends Document {
    userId: string;
    symbol: string;
    tradeDate: string;
    status: AnalysisStatus;
    jobId?: string;
    rating?: string;
    reportHtml?: string;
    error?: string;
    createdAt: Date;
    updatedAt: Date;
}

// One TradingAgents run, requested by a user from a stock page
const AnalysisSchema = new Schema<IAnalysis>(
    {
        userId: { type: String, required: true, index: true },
        symbol: { type: String, required: true, uppercase: true, trim: true },
        tradeDate: { type: String, required: true },
        status: { type: String, enum: ['queued', 'running', 'done', 'error'], default: 'queued' },
        jobId: { type: String },
        rating: { type: String },
        reportHtml: { type: String },
        error: { type: String },
    },
    { timestamps: true }
);

AnalysisSchema.index({ userId: 1, symbol: 1, createdAt: -1 });

export const Analysis: Model<IAnalysis> =
    (models?.Analysis as Model<IAnalysis>) || model<IAnalysis>('Analysis', AnalysisSchema);
