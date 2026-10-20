import { Schema, model, models, type Model } from 'mongoose';

export type ForwardOutcome = 'open' | 'stopped' | 'target' | 'exited' | 'expired';

// One paper trade the scanner would have taken, recorded the day the entry appeared and judged only on later daily closes
export interface IForwardTrade {
    strategy: string;
    symbol: string;
    /** The screener universe that logged it; absent for trades from the watchlist scan. */
    universe?: string;
    signalDate: string; // the daily bar the setup was based on (YYYY-MM-DD)
    entry: number;
    stop: number;
    target2r: number;
    score: number | null;
    validated: boolean;
    outcome: ForwardOutcome;
    closedOn?: string;
    exitPrice?: number;
    r?: number; // result in R: (exit - entry) / (entry - stop)
    lastClose?: number;
}

const ForwardTradeSchema = new Schema<IForwardTrade>(
    {
        strategy: { type: String, required: true },
        symbol: { type: String, required: true },
        universe: { type: String, index: true },
        signalDate: { type: String, required: true },
        entry: { type: Number, required: true },
        stop: { type: Number, required: true },
        target2r: { type: Number, required: true },
        score: { type: Number, default: null },
        validated: { type: Boolean, default: false },
        outcome: { type: String, enum: ['open', 'stopped', 'target', 'exited', 'expired'], default: 'open', index: true },
        closedOn: String,
        exitPrice: Number,
        r: Number,
        lastClose: Number,
    },
    { timestamps: true, versionKey: false },
);
// One trade per signal per source: the watchlist scan (no universe) and each screener universe keep separate records
ForwardTradeSchema.index({ strategy: 1, symbol: 1, signalDate: 1, universe: 1 }, { unique: true });

export const ForwardTrade: Model<IForwardTrade> =
    (models?.ForwardTrade as Model<IForwardTrade>) || model<IForwardTrade>('ForwardTrade', ForwardTradeSchema);
