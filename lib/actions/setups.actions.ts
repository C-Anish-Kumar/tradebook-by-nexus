'use server';

import { requireUserId } from '@/lib/better-auth/auth';
import { readCache } from '@/lib/cache';
import { enforceRateLimit } from '@/lib/rate-limit';
import { inngest } from '@/lib/inngest/client';
import { getUserWatchlist } from '@/lib/actions/watchlist.actions';
import type { StoredSetup } from '@/lib/setups';

export type SetupRow = { symbol: string; stored: StoredSetup | null };

const isUsStock = (s: string) => !s.includes(':') && !s.includes('.');

/** The latest stored setup for each stock on the user's watchlist (written by the nightly scan). */
export async function getSetupBoard(): Promise<SetupRow[]> {
    await requireUserId();
    const items = await getUserWatchlist();
    const symbols = (items as { symbol: string }[]).map((i) => i.symbol.toUpperCase()).filter(isUsStock);
    return Promise.all(symbols.map(async (symbol) => ({
        symbol,
        stored: (await readCache<StoredSetup>(`setup:${symbol}`))?.value ?? null,
    })));
}

/** Asks Inngest to scan now instead of waiting for the evening run. Errors come back as data. */
export async function requestSetupScan(): Promise<{ success: true } | { error: string }> {
    try {
        const userId = await requireUserId();
        await enforceRateLimit(userId, 'setup-scan', 2);
        await inngest.send({ name: 'app/setups.scan', data: { requestedBy: userId } });
        return { success: true };
    } catch (error) {
        return { error: error instanceof Error ? error.message : 'Could not start the scan' };
    }
}
