'use server';

import { randomBytes } from 'crypto';
import { revalidatePath } from 'next/cache';
import { requireUserId } from '@/lib/better-auth/auth';
import { connectToDatabase } from '@/database/mongoose';
import { NotificationSettings, type NotificationPrefs } from '@/database/models/notification.model';
import { getBotUsername, sendTelegram, telegramEnabled } from '@/lib/telegram';
import { buildWatchlistSummary, watchlistsFor } from '@/lib/notify';

export type TelegramStatus = { enabled: boolean; connected: boolean; name?: string; prefs: NotificationPrefs; minScore: number };
const DEFAULT_PREFS: NotificationPrefs = {
    alerts: true, daily: true, signals: true, earnings: true,
    setups: false, maPullback: false, goldenCross: false, breakoutRetest: false, volumeBounce: false,
};
const PREF_KEYS = Object.keys(DEFAULT_PREFS) as (keyof NotificationPrefs)[];

// Every action works on the signed-in user's own settings; nothing takes a user id from the client
export async function getTelegramStatus(): Promise<TelegramStatus> {
    const userId = await requireUserId();
    if (!telegramEnabled) return { enabled: false, connected: false, prefs: DEFAULT_PREFS, minScore: 0 };
    await connectToDatabase();
    const s = await NotificationSettings.findOne({ userId }).lean();
    return { enabled: true, connected: Boolean(s?.telegramChatId), name: s?.telegramName, prefs: { ...DEFAULT_PREFS, ...s?.prefs }, minScore: s?.minScore ?? 0 };
}

/** A one-time t.me link that ties the user's Telegram chat to this account when they press Start. */
export async function createTelegramLink(): Promise<{ url: string } | { error: string }> {
    const userId = await requireUserId();
    if (!telegramEnabled) return { error: 'Telegram is not set up on this server.' };
    try {
        await connectToDatabase();
        const code = randomBytes(16).toString('hex');
        await NotificationSettings.updateOne(
            { userId },
            { $set: { linkCode: code, linkCodeExpires: new Date(Date.now() + 15 * 60_000) }, $setOnInsert: { prefs: DEFAULT_PREFS } },
            { upsert: true },
        );
        return { url: `https://t.me/${await getBotUsername()}?start=${code}` };
    } catch (error) {
        console.error('createTelegramLink failed', error);
        return { error: 'Could not create a link. Try again.' };
    }
}

export async function updateTelegramPrefs(input: Partial<NotificationPrefs>) {
    const userId = await requireUserId();
    const $set = Object.fromEntries(PREF_KEYS.filter((k) => typeof input[k] === 'boolean').map((k) => [`prefs.${k}`, input[k]]));
    await connectToDatabase();
    await NotificationSettings.updateOne({ userId }, { $set }, { upsert: true });
    return { success: true };
}

/** Only message me about fresh entries scoring at least this (0-100). */
export async function updateMinScore(value: number) {
    const userId = await requireUserId();
    const minScore = Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
    await connectToDatabase();
    await NotificationSettings.updateOne({ userId }, { $set: { minScore } }, { upsert: true });
    return { success: true, minScore };
}

export async function disconnectTelegram() {
    const userId = await requireUserId();
    await connectToDatabase();
    await NotificationSettings.updateOne({ userId }, { $unset: { telegramChatId: 1, telegramName: 1 } });
    revalidatePath('/profile');
    return { success: true };
}

/** Sends the user's watchlist summary now, as a test. */
export async function sendTelegramTest(): Promise<{ success: true } | { error: string }> {
    const userId = await requireUserId();
    await connectToDatabase();
    const s = await NotificationSettings.findOne({ userId }).lean();
    if (!s?.telegramChatId) return { error: 'Connect Telegram first.' };
    try {
        const symbols = (await watchlistsFor([userId])).get(userId) ?? [];
        await sendTelegram(s.telegramChatId, await buildWatchlistSummary(symbols, 'Test: your watchlist now'));
        return { success: true };
    } catch (error) {
        console.error('telegram test failed', error);
        return { error: 'Telegram did not accept the message. Try reconnecting.' };
    }
}
