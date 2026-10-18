// Who gets which Telegram message, and the watchlist summary text shared by the daily job and /summary
import { connectToDatabase } from '@/database/mongoose';
import { NotificationSettings, type INotificationSettings, type NotificationPrefs } from '@/database/models/notification.model';
import { Watchlist } from '@/database/models/watchlist.model';
import { readCache } from '@/lib/cache';
import { getLiveQuotes } from '@/lib/finnhub';
import { escapeHtml, sendTelegram, TelegramBlockedError, telegramEnabled } from '@/lib/telegram';
import { APP_URL } from '@/lib/brand';
import type { StrategySignals } from '@/lib/analyst';
import { STATUS_LABEL, type StoredSetup } from '@/lib/setups';
import { setupCacheKey, STRATEGY_1, STRATEGY_2 } from '@/lib/strategies';
import type { EarningsCalendar } from '@/lib/market-intel';

export type LinkedUser = Pick<INotificationSettings, 'userId' | 'telegramChatId' | 'prefs'>;

/** Users with a linked Telegram chat who want this kind of message. */
export async function linkedUsers(pref: keyof NotificationPrefs): Promise<LinkedUser[]> {
    if (!telegramEnabled) return [];
    await connectToDatabase();
    return NotificationSettings.find(
        { telegramChatId: { $exists: true, $ne: null }, [`prefs.${pref}`]: true },
        { userId: 1, telegramChatId: 1, prefs: 1 },
    ).lean();
}

/** userId -> watched symbols */
export async function watchlistsFor(userIds: string[]): Promise<Map<string, string[]>> {
    await connectToDatabase();
    const rows = await Watchlist.find({ userId: { $in: userIds } }, { userId: 1, symbol: 1 }).lean();
    const map = new Map<string, string[]>();
    for (const r of rows) map.set(r.userId, [...(map.get(r.userId) ?? []), r.symbol]);
    return map;
}

/** Sends one message; a user who blocked the bot is unlinked instead of retried forever. */
export async function notify(user: Pick<LinkedUser, 'userId' | 'telegramChatId'>, html: string): Promise<boolean> {
    if (!user.telegramChatId) return false;
    try {
        await sendTelegram(user.telegramChatId, html);
        return true;
    } catch (error) {
        if (error instanceof TelegramBlockedError) {
            await NotificationSettings.updateOne({ userId: user.userId }, { $unset: { telegramChatId: 1, telegramName: 1 } });
        } else {
            console.error(`telegram send failed for ${user.userId}`, error);
        }
        return false;
    }
}

const pct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const stockLink = (symbol: string) => `<a href="${APP_URL}/stocks/${encodeURIComponent(symbol)}">${escapeHtml(symbol)}</a>`;
const isStock = (s: string) => !s.includes(':');

const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const HOUR_LABEL: Record<string, string> = { bmo: 'before the open', amc: 'after the close', dmh: 'during the session' };

/** Watchlist snapshot: moves, trade signals (from the shared cache) and reports due soon. */
export async function buildWatchlistSummary(symbols: string[], title: string): Promise<string> {
    if (symbols.length === 0) return `<b>${escapeHtml(title)}</b>\nYour watchlist is empty. Star stocks on ${APP_URL} to get updates here.`;
    const quotes = await getLiveQuotes(symbols);
    const rows = symbols
        .map((s) => ({ s, q: quotes[s] }))
        .filter((r): r is { s: string; q: NonNullable<typeof r.q> } => Boolean(r.q?.c))
        .sort((a, b) => (b.q.dp ?? 0) - (a.q.dp ?? 0));

    const lines = [`<b>${escapeHtml(title)}</b>`];
    if (rows.length) {
        lines.push(...rows.slice(0, 25).map(({ s, q }) => `${(q.dp ?? 0) >= 0 ? '🟢' : '🔴'} ${stockLink(s)}  ${usd(q.c ?? 0)}  <b>${pct(q.dp ?? 0)}</b>`));
        if (rows.length > 2) lines.push('', `Best ${escapeHtml(rows[0].s)} ${pct(rows[0].q.dp ?? 0)} · Worst ${escapeHtml(rows.at(-1)!.s)} ${pct(rows.at(-1)!.q.dp ?? 0)}`);
    }
    const unpriced = symbols.filter((s) => !rows.some((r) => r.s === s));
    if (unpriced.length) lines.push(`<i>No live quote for ${escapeHtml(unpriced.join(', '))}</i>`);

    // Signals the scans already computed; no extra service calls here. Only strategies that are switched on.
    const stocks = symbols.filter(isStock);
    if (STRATEGY_2.enabled) {
        const setups = (await Promise.all(stocks.map(async (s) => {
            const v = (await readCache<StoredSetup>(setupCacheKey('breakout', s)))?.value?.setup;
            if (!v || (v.status !== 'entry' && v.status !== 'watch')) return null;
            return `${stockLink(s)}: ${STATUS_LABEL[v.status]}${v.quant ? ` · quant ${v.quant.score}/100` : ''} (scan of ${v.date})`;
        }))).filter(Boolean);
        if (setups.length) lines.push('', `<b>${escapeHtml(STRATEGY_2.label)}: ${escapeHtml(STRATEGY_2.name)}</b>`, ...setups as string[]);
    }
    if (STRATEGY_1.enabled) {
        const verdicts = (await Promise.all(stocks.map(async (s) => {
            const v = (await readCache<StrategySignals>(`signals:${s}`))?.value;
            return v && v.tone !== 'neutral' ? `${escapeHtml(s)}: ${escapeHtml(v.verdict)}` : null;
        }))).filter(Boolean);
        if (verdicts.length) lines.push('', `<b>${escapeHtml(STRATEGY_1.label)}: ${escapeHtml(STRATEGY_1.name)}</b>`, ...verdicts as string[]);
    }

    const cal = (await readCache<EarningsCalendar>('earnings:calendar'))?.value;
    if (cal) {
        const today = new Date().toISOString().slice(0, 10);
        const soon = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
        const due = cal.events.filter((e) => symbols.includes(e.symbol) && e.date >= today && e.date <= soon)
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((e) => `${escapeHtml(e.symbol)} ${dayLabel(e.date)}${HOUR_LABEL[e.hour] ? `, ${HOUR_LABEL[e.hour]}` : ''}`);
        if (due.length) lines.push('', '<b>Earnings this week</b>', ...due);
    }
    lines.push('', `<a href="${APP_URL}/watchlist">Open your watchlist</a>`);
    return lines.join('\n');
}

export const earningsDayLabel = dayLabel;
export const earningsHourLabel = (h: string) => HOUR_LABEL[h] ?? '';
export { pct as formatPct, usd as formatUsd };

/** Price alert for one user, if they linked Telegram and want alerts. Returns whether it was delivered. */
export async function sendAlertTelegram(userId: string, alert: { symbol: string; condition: 'ABOVE' | 'BELOW'; targetPrice: number }, price: number) {
    if (!telegramEnabled) return false;
    await connectToDatabase();
    const s = await NotificationSettings.findOne({ userId, 'prefs.alerts': true, telegramChatId: { $exists: true, $ne: null } }, { userId: 1, telegramChatId: 1 }).lean();
    if (!s) return false;
    return notify(s, [
        `🔔 <b>${stockLink(alert.symbol)} is ${alert.condition === 'ABOVE' ? 'above' : 'below'} ${usd(alert.targetPrice)}</b>`,
        `Now ${usd(price)}. This alert is now closed; set a new one on the stock page.`,
    ].join('\n'));
}
