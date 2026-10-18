'use server';

import { randomBytes, randomInt } from 'crypto';
import { headers } from 'next/headers';
import { auth } from '@/lib/better-auth/auth';
import { connectToDatabase } from '@/database/mongoose';
import { TelegramLogin } from '@/database/models/telegram-login.model';
import { getBotUsername, telegramEnabled } from '@/lib/telegram';

const TTL_MS = 10 * 60_000;
const MAX_PER_MINUTE = 60; // across everyone: stops a script from filling the collection

export async function startTelegramLogin(): Promise<{ code: string; match: string; url: string } | { error: string }> {
    if (!telegramEnabled) return { error: 'Telegram sign-in is not set up on this server.' };
    try {
        await connectToDatabase();
        // expiresAt is 10 minutes out, so anything created in the last minute is at least 9 minutes from expiry
        const recent = await TelegramLogin.countDocuments({ expiresAt: { $gt: new Date(Date.now() + TTL_MS - 60_000) } });
        if (recent >= MAX_PER_MINUTE) return { error: 'Too many sign-ins right now. Try again in a minute.' };
        const code = randomBytes(16).toString('hex');
        const match = String(randomInt(10, 100));
        await TelegramLogin.create({ code, match, expiresAt: new Date(Date.now() + TTL_MS) });
        return { code, match, url: `https://t.me/${await getBotUsername()}?start=login_${code}` };
    } catch (error) {
        console.error('startTelegramLogin failed', error);
        return { error: 'Could not start Telegram sign-in. Try again.' };
    }
}

/** Called every few seconds by the sign-in page. Once approved in Telegram, this starts the session. */
export async function pollTelegramLogin(code: string): Promise<{ status: 'pending' | 'expired' | 'ok' }> {
    if (typeof code !== 'string' || code.length !== 32) return { status: 'expired' };
    await connectToDatabase();
    const login = await TelegramLogin.findOne({ code }, { status: 1, expiresAt: 1 }).lean();
    if (!login || login.expiresAt < new Date()) return { status: 'expired' };
    if (login.status === 'pending') return { status: 'pending' };
    try {
        // The nextCookies plugin turns this call's session cookie into a cookie on the response
        // The endpoint reads the body itself (no schema), so its generated type is empty
        await auth.api.signInTelegram({ body: { code } as never, headers: await headers() });
        return { status: 'ok' };
    } catch (error) {
        console.error('telegram sign-in failed', error);
        return { status: 'expired' };
    }
}
