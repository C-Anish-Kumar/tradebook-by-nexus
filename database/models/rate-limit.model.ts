import { Schema, model, models, type Model } from 'mongoose';

export interface IRateLimit {
    key: string;
    count: number;
    expiresAt: Date;
}

// One counter per user, action and minute; Mongo's TTL monitor deletes old windows
const RateLimitSchema = new Schema<IRateLimit>(
    {
        key: { type: String, required: true, unique: true },
        count: { type: Number, default: 0 },
        expiresAt: { type: Date, required: true, expires: 0 },
    },
    { versionKey: false }
);

export const RateLimit: Model<IRateLimit> =
    (models?.RateLimit as Model<IRateLimit>) || model<IRateLimit>('RateLimit', RateLimitSchema);
