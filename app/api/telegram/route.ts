import { connectToDatabase } from '@/database/mongoose';
import { NotificationSettings } from '@/database/models/notification.model';
import { buildWatchlistSummary, watchlistsFor } from '@/lib/notify';
import { escapeHtml, sendTelegram, WEBHOOK_SECRET } from '@/lib/telegram';
import { APP_URL, BRAND_FULL } from '@/lib/brand';

type Update = { message?: { text?: string; chat?: { id: number; first_name?: string; username?: string } } };

const HELP = `I send updates for the stocks on your ${BRAND_FULL} watchlist:
• your price alerts the moment they trigger
• a summary after each US market close
• strategy signal changes (entry, trim, exit)
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
    const chat = update?.message?.chat;
    const text = update?.message?.text?.trim() ?? '';
    if (!chat) return Response.json({ ok: true });
    const chatId = String(chat.id);
    const reply = (html: string) => sendTelegram(chatId, html).catch((e) => console.error('telegram reply failed', e));

    try {
        await connectToDatabase();
        const [command, arg] = text.split(/\s+/, 2);

        if (command === '/start') {
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
