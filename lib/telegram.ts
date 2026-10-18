// Telegram Bot API client: free, instant messages to users who link their chat on the Profile page
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
export const telegramEnabled = Boolean(TOKEN);
// Telegram echoes this on every webhook call so we know the request is really from Telegram
export const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';

export class TelegramBlockedError extends Error {}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not set');
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({})) as { ok?: boolean; result?: T; description?: string };
    // 403: the user blocked the bot or deleted the chat
    if (res.status === 403) throw new TelegramBlockedError(data.description || 'Blocked by user');
    if (!res.ok || !data.ok) throw new Error(`Telegram ${method} failed: ${data.description || res.status}`);
    return data.result as T;
}

/** Sends an HTML-formatted message (escape user data with escapeHtml). */
export const sendTelegram = (chatId: string, html: string) =>
    call('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });

/** A message with inline buttons; each button is { text, callback_data }. */
export const sendTelegramButtons = (chatId: string, html: string, buttons: { text: string; callback_data: string }[]) =>
    call('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', reply_markup: { inline_keyboard: [buttons] } });

export const answerCallback = (id: string, text?: string) => call('answerCallbackQuery', { callback_query_id: id, text });

export const editTelegram = (chatId: string, messageId: number, html: string) =>
    call('editMessageText', { chat_id: chatId, message_id: messageId, text: html, parse_mode: 'HTML' });

let username: string | null = null;
export async function getBotUsername(): Promise<string> {
    if (username) return username;
    if (process.env.TELEGRAM_BOT_USERNAME) return (username = process.env.TELEGRAM_BOT_USERNAME.replace(/^@/, ''));
    const me = await call<{ username: string }>('getMe', {});
    return (username = me.username);
}

export const setTelegramWebhook = (url: string) =>
    call('setWebhook', { url, secret_token: WEBHOOK_SECRET || undefined, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });

export const setTelegramCommands = () =>
    call('setMyCommands', {
        commands: [
            { command: 'summary', description: 'Your watchlist right now' },
            { command: 'stop', description: 'Stop all messages and unlink' },
            { command: 'help', description: 'What this bot sends' },
        ],
    });
