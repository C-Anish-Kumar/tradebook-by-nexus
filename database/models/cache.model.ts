import { Schema, model, models, type Model } from 'mongoose';

export interface ICacheEntry {
    key: string;
    value: unknown;
    updatedAt: Date;
}

// Precomputed results (analyst service, market data) that pages read instead of waiting on the source
const CacheEntrySchema = new Schema<ICacheEntry>(
    {
        key: { type: String, required: true, unique: true },
        value: { type: Schema.Types.Mixed, required: true },
        updatedAt: { type: Date, required: true },
    },
    { versionKey: false, minimize: false }
);

export const CacheEntry: Model<ICacheEntry> =
    (models?.CacheEntry as Model<ICacheEntry>) || model<ICacheEntry>('CacheEntry', CacheEntrySchema);
