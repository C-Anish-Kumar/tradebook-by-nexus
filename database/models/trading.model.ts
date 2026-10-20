import { Schema, model, models, type Model } from 'mongoose';
import type { UniverseOverride } from '@/lib/risk';

// Your own account size and per-universe overrides of config/universes.ts, plus kill-switch resets
export interface ITradingSettings {
    userId: string;
    accountSize: number;
    overrides: Record<string, UniverseOverride>;
    /** strategy|universe -> when its kill switch was last reset */
    killResets: Record<string, string>;
    accountResetAt?: string;
}

const TradingSettingsSchema = new Schema<ITradingSettings>(
    {
        userId: { type: String, required: true, unique: true },
        accountSize: { type: Number, required: true },
        overrides: { type: Schema.Types.Mixed, default: {} },
        killResets: { type: Schema.Types.Mixed, default: {} },
        accountResetAt: String,
    },
    { timestamps: true, versionKey: false, minimize: false },
);

export const TradingSettings: Model<ITradingSettings> =
    (models?.TradingSettings as Model<ITradingSettings>) || model<ITradingSettings>('TradingSettings', TradingSettingsSchema);

export type PositionStatus = 'open' | 'closed';

// A trade you marked as taken from the screener. Nothing here places orders: you trade at your broker and record it.
export interface IPosition {
    userId: string;
    ticker: string;
    name?: string;
    strategy: string;
    universe: string;
    sector?: string;
    shares: number;
    entry: number;              // your fill
    stop: number;
    target2r?: number;
    openedOn: string;           // YYYY-MM-DD
    status: PositionStatus;
    exitPrice?: number;
    closedOn?: string;
    lastClose?: number;         // from the latest nightly scan
    lastScan?: string;
    /** Exit reasons already sent to Telegram, so each one is sent once. */
    alerted: string[];
}

const PositionSchema = new Schema<IPosition>(
    {
        userId: { type: String, required: true, index: true },
        ticker: { type: String, required: true },
        name: String,
        strategy: { type: String, required: true },
        universe: { type: String, required: true },
        sector: String,
        shares: { type: Number, required: true, min: 1 },
        entry: { type: Number, required: true },
        stop: { type: Number, required: true },
        target2r: Number,
        openedOn: { type: String, required: true },
        status: { type: String, enum: ['open', 'closed'], default: 'open', index: true },
        exitPrice: Number,
        closedOn: String,
        lastClose: Number,
        lastScan: String,
        alerted: { type: [String], default: [] },
    },
    { timestamps: true, versionKey: false },
);
PositionSchema.index({ userId: 1, status: 1, openedOn: -1 });

export const Position: Model<IPosition> =
    (models?.Position as Model<IPosition>) || model<IPosition>('Position', PositionSchema);
