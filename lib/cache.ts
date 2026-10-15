import { after } from 'next/server';
import { connectToDatabase } from '@/database/mongoose';
import { CacheEntry } from '@/database/models/cache.model';

type Entry<T> = { value: T; updatedAt: Date };

export async function readCache<T>(key: string): Promise<Entry<T> | null> {
    try {
        await connectToDatabase();
        const doc = await CacheEntry.findOne({ key }).lean();
        return doc ? { value: doc.value as T, updatedAt: doc.updatedAt } : null;
    } catch (error) {
        console.error(`cache read failed for ${key}`, error);
        return null;
    }
}

export async function writeCache<T>(key: string, value: T): Promise<void> {
    try {
        await connectToDatabase();
        await CacheEntry.updateOne({ key }, { $set: { value, updatedAt: new Date() } }, { upsert: true });
    } catch (error) {
        console.error(`cache write failed for ${key}`, error);
    }
}

// Refreshes already running in this instance, so a burst of visitors triggers one fetch
const refreshing = new Map<string, Promise<unknown>>();

function refresh<T>(key: string, load: () => Promise<T>): Promise<T> {
    let pending = refreshing.get(key) as Promise<T> | undefined;
    if (!pending) {
        pending = load()
            .then(async (value) => {
                await writeCache(key, value);
                return value;
            })
            .finally(() => refreshing.delete(key));
        refreshing.set(key, pending);
    }
    return pending;
}

/**
 * Stale-while-revalidate backed by MongoDB, so results survive restarts and cold starts.
 * Fresh: returned as is. Stale: returned at once and refreshed after the response.
 * Missing: loaded now. A failed load returns null (or throws with `throwOnMiss`).
 */
export async function cached<T>(
    key: string,
    maxAgeMs: number,
    load: () => Promise<T>,
    { throwOnMiss = false }: { throwOnMiss?: boolean } = {},
): Promise<T | null> {
    const entry = await readCache<T>(key);
    if (entry) {
        if (Date.now() - entry.updatedAt.getTime() > maxAgeMs) {
            after(() => refresh(key, load).catch((error) => console.error(`refresh failed for ${key}`, error)));
        }
        return entry.value;
    }
    try {
        return await refresh(key, load);
    } catch (error) {
        if (throwOnMiss) throw error;
        console.error(`load failed for ${key}`, error);
        return null;
    }
}
