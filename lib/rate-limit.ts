import { connectToDatabase } from '@/database/mongoose';
import { RateLimit } from '@/database/models/rate-limit.model';

/** Fixed one-minute window per user and action. Throws a readable error past the limit. */
export async function enforceRateLimit(userId: string, action: string, perMinute: number) {
    const minute = Math.floor(Date.now() / 60_000);
    try {
        await connectToDatabase();
        const doc = await RateLimit.findOneAndUpdate(
            { key: `${action}:${userId}:${minute}` },
            { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((minute + 2) * 60_000) } },
            { upsert: true, new: true },
        ).lean();
        if (doc && doc.count > perMinute) throw new RateLimitError();
    } catch (error) {
        if (error instanceof RateLimitError) throw error;
        console.error('rate limit check failed', error); // never block users because the counter is down
    }
}

class RateLimitError extends Error {
    constructor() {
        super('Too many runs in a minute. Wait a moment and try again.');
    }
}
