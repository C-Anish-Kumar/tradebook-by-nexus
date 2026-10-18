import { connectToDatabase } from '@/database/mongoose';
import { NotificationSettings } from '@/database/models/notification.model';
import { buildWatchlistSummary, watchlistsFor } from '@/lib/notify';
import { TelegramLogin } from '@/database/models/telegram-login.model';
import { answerCallback, editTelegram, escapeHtml, sendTelegram, sendTelegramButtons, WEBHOOK_SECRET } from '@/lib/telegram';
import { APP_URL, BRAND_FULL } from '@/lib/brand';
import { enabledStrategies } from '@/lib/strategies';

type Update = {
    message?: { text?: string; chat?: { id: number; first_name?: string; username?: string } };
    callback_query?: { id: string; data?: string; from: { id: number; first_name?: string; username?: string }; message?: { message_id: number; chat: { id: number } } };
};

const HELP = `I send updates for the stocks on your ${BRAND_FULL} watchlist:
• your price alerts the moment they trigger
• a summary after each US market close
• trade signals with a 0-100 quant score (${enabledStrategies().map((s) => s.name).join(', ')}), if you switch them on
• earnings reminders and beat/miss results

/summary — your watchlist right now
/stop — stop all messages and unlink
Choose which messages you get on your Profile page: ${APP_URL}/profile`;

// Telegram calls this for every message sent to the bot
export async function POST(req: Request) {
    if (!WEBHOOK_SECRET || req.headers.get('x-telegram-bot-api-secret-token') !== WEBHOOK_SECRET) {
        return new Response('forbidden', { status: 403 });
    }
    const update = await req.json().catch(() => null) as Update | null;
    if (update?.callback_query) return handleLoginButton(update.callback_query);
    const chat = update?.message?.chat;
    const text = update?.message?.text?.trim() ?? '';
    if (!chat) return Response.json({ ok: true });
    const chatId = String(chat.id);
    const reply = (html: string) => sendTelegram(chatId, html).catch((e) => console.error('telegram reply failed', e));

    try {
        await connectToDatabase();
        const [command, arg] = text.split(/\s+/, 2);

        if (command === '/start' && arg?.startsWith('login_')) {
            // Sign-in from the website: ask for approval, showing the number the page displays
            const login = await TelegramLogin.findOne({ code: arg.slice(6), status: 'pending', expiresAt: { $gt: new Date() } }, { code: 1, match: 1 }).lean();
            if (!login) {
                await reply('That sign-in link has expired. Go back to the sign-in page and start again.');
            } else {
                await sendTelegramButtons(chatId,
                    `Someone is signing in to ${escapeHtml(BRAND_FULL)}.\n\nThe page shows the number <b>${login.match}</b>. Approve only if it matches. If you didn't start this, tap Cancel.`,
                    [{ text: 'Approve', callback_data: `ok:${login.code}` }, { text: 'Cancel', callback_data: `no:${login.code}` }],
                ).catch((e) => console.error('telegram login prompt failed', e));
            }
        } else if (command === '/start') {
            const linked = arg && await NotificationSettings.findOneAndUpdate(
                { linkCode: arg, linkCodeExpires: { $gt: new Date() } },
                { $set: { telegramChatId: chatId, telegramName: chat.username ? `@${chat.username}` : chat.first_name ?? '' }, $unset: { linkCode: 1, linkCodeExpires: 1 } },
                { new: true },
            );
            if (linked) {
                // One account per chat: unlink any other account that pointed here
                await NotificationSettings.updateMany({ telegramChatId: chatId, userId: { $ne: linked.userId } }, { $unset: { telegramChatId: 1, telegramName: 1 } });
                await reply(`✅ Connected to ${escapeHtml(BRAND_FULL)}.\n\n${escapeHtml(HELP)}`);
            } else {
                await reply(`To connect, open ${APP_URL}/profile and tap <b>Connect Telegram</b>. Links expire after 15 minutes.`);
            }
        } else if (command === '/stop') {
            const res = await NotificationSettings.updateMany({ telegramChatId: chatId }, { $unset: { telegramChatId: 1, telegramName: 1 } });
            await reply(res.modifiedCount ? 'Unlinked. You will get no more messages. Reconnect any time from your Profile page.' : 'This chat is not linked to an account.');
        } else if (command === '/summary') {
            const settings = await NotificationSettings.findOne({ telegramChatId: chatId }).lean();
            if (!settings) {
                await reply(`This chat is not linked yet. Open ${APP_URL}/profile and tap <b>Connect Telegram</b>.`);
            } else {
                const symbols = (await watchlistsFor([settings.userId])).get(settings.userId) ?? [];
                await reply(await buildWatchlistSummary(symbols, 'Your watchlist now'));
            }
        } else {
            await reply(escapeHtml(HELP));
        }
    } catch (error) {
        console.error('telegram webhook error', error);
    }
    // Always 200, or Telegram keeps redelivering the same update
    return Response.json({ ok: true });
}

// Approve / Cancel buttons on a website sign-in request
async function handleLoginButton(cb: NonNullable<Update['callback_query']>) {
    try {
        await connectToDatabase();
        const [action, code] = (cb.data ?? '').split(':');
        const chatId = String(cb.from.id);
        const messageId = cb.message?.message_id;
        const done = (html: string, toast: string) => Promise.all([
            answerCallback(cb.id, toast),
            messageId ? editTelegram(String(cb.message!.chat.id), messageId, html) : null,
        ]).catch((e) => console.error('telegram callback reply failed', e));
        if (!code || code.length !== 32 || (action !== 'ok' && action !== 'no')) return Response.json({ ok: true });

        if (action === 'no') {
            await TelegramLogin.deleteOne({ code, status: 'pending' });
            await done('Cancelled. Nobody was signed in.', 'Cancelled');
        } else {
            const tgName = cb.from.username ? `@${cb.from.username}` : cb.from.first_name ?? '';
            const approved = await TelegramLogin.findOneAndUpdate(
                { code, status: 'pending', expiresAt: { $gt: new Date() } },
                { $set: { status: 'approved', chatId, tgName } },
            );
            await (approved
                ? done('✅ Approved. You can go back to the website.', 'Approved')
                : done('That sign-in request has expired.', 'Expired'));
        }
    } catch (error) {
        console.error('telegram login button error', error);
    }
    return Response.json({ ok: true });
}
