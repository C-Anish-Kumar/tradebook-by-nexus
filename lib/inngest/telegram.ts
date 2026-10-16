import { inngest } from '@/lib/inngest/client';
import { APP_URL } from '@/lib/brand';
import { readCache, writeCache } from '@/lib/cache';
import { analystEnabled, fetchStrategySignals } from '@/lib/analyst';
import { refreshEarningsCalendar, type EarningsCalendar } from '@/lib/market-intel';
import { escapeHtml, getBotUsername, setTelegramCommands, setTelegramWebhook, telegramEnabled } from '@/lib/telegram';
import {
    buildWatchlistSummary, earningsDayLabel, earningsHourLabel, formatUsd, linkedUsers, notify, stockLink, watchlistsFor,
} from '@/lib/notify';

const isUsStock = (s: string) => !s.includes(':') && !s.includes('.');
const todayIso = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

// Run once after setting TELEGRAM_BOT_TOKEN: points the bot at /api/telegram and sets its command menu
export const setupTelegramBot = inngest.createFunction(
    { id: 'telegram-setup', triggers: [{ event: 'app/telegram.setup' }] },
    async ({ step }) => {
        if (!telegramEnabled) return { error: 'TELEGRAM_BOT_TOKEN is not set' };
        if (!process.env.TELEGRAM_WEBHOOK_SECRET) return { error: 'TELEGRAM_WEBHOOK_SECRET is not set' };
        await step.run('set-webhook', () => setTelegramWebhook(`${APP_URL}/api/telegram`));
        await step.run('set-commands', () => setTelegramCommands());
        const username = await step.run('bot-name', () => getBotUsername());
        return { ok: true, bot: `@${username}`, webhook: `${APP_URL}/api/telegram` };
    },
);

// After the US close: each linked user's watchlist moves, strategy verdicts and upcoming reports
export const sendDailySummaries = inngest.createFunction(
    { id: 'telegram-daily-summary', concurrency: 1, retries: 1, triggers: [{ event: 'app/telegram.daily' }, { cron: 'TZ=America/New_York 25 16 * * 1-5' }] },
    async ({ step }) => step.run('send', async () => {
        const users = await linkedUsers('daily');
        if (!users.length) return { sent: 0 };
        const lists = await watchlistsFor(users.map((u) => u.userId));
        const date = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' });
        let sent = 0;
        for (const u of users) {
            const symbols = lists.get(u.userId) ?? [];
            if (!symbols.length) continue;
            if (await notify(u, await buildWatchlistSummary(symbols, `Watchlist close · ${date}`))) sent++;
        }
        return { users: users.length, sent };
    }),
);

type SignalState = { verdict: string; tone: string };

// Daily after the close: re-check each watched stock's strategy and text watchers when the verdict changes
export const watchStrategySignals = inngest.createFunction(
    { id: 'telegram-strategy-signals', concurrency: 1, retries: 1, triggers: [{ event: 'app/telegram.signals' }, { cron: 'TZ=America/New_York 40 16 * * 1-5' }] },
    async ({ step }) => step.run('check', async () => {
        if (!analystEnabled) return { skipped: 'analyst service not configured' };
        const users = await linkedUsers('signals');
        if (!users.length) return { checked: 0 };
        const lists = await watchlistsFor(users.map((u) => u.userId));
        const symbols = [...new Set([...lists.values()].flat())].filter(isUsStock);

        const changes: { symbol: string; from: string; to: string; html: string }[] = [];
        for (const symbol of symbols) {
            try {
                // A sleeping Space gets one long wait; the rest are fast
                const s = await fetchStrategySignals(symbol, 60_000);
                await writeCache(`signals:${symbol}`, s); // the stock page reads this too
                const prev = (await readCache<SignalState>(`signal-state:${symbol}`))?.value;
                await writeCache<SignalState>(`signal-state:${symbol}`, { verdict: s.verdict, tone: s.tone });
                // First sighting just records the state; only real changes are worth a text
                if (!prev || prev.verdict === s.verdict) continue;
                const icon = s.tone === 'up' ? '🟢' : s.tone === 'down' ? '🔴' : s.tone === 'warn' ? '🟠' : '⚪️';
                changes.push({
                    symbol, from: prev.verdict, to: s.verdict,
                    html: [
                        `${icon} <b>${stockLink(symbol)}: ${escapeHtml(s.verdict)}</b>`,
                        `Was: ${escapeHtml(prev.verdict)}`,
                        `Close ${formatUsd(s.close)} · stop ${formatUsd(s.risk.stop)}${s.risk.target_4r ? ` · 4R target ${formatUsd(s.risk.target_4r)}` : ''}`,
                        `<i>10/21 EMA + Supertrend (10,3), daily candles. Not financial advice.</i>`,
                    ].join('\n'),
                });
            } catch (error) {
                console.error(`signal check failed for ${symbol}`, error);
            }
        }

        let sent = 0;
        for (const c of changes) {
            for (const u of users) {
                if ((lists.get(u.userId) ?? []).includes(c.symbol) && await notify(u, c.html)) sent++;
            }
        }
        return { checked: symbols.length, changes: changes.map((c) => `${c.symbol}: ${c.from} → ${c.to}`), sent };
    }),
);

// Morning and evening: reminders for reports due tomorrow, and beat/miss once results are in
export const watchEarnings = inngest.createFunction(
    { id: 'telegram-earnings', concurrency: 1, retries: 1, triggers: [{ event: 'app/telegram.earnings' }, { cron: 'TZ=America/New_York 45 8,17 * * 1-5' }] },
    async ({ step }) => {
        await step.run('refresh-calendar', () => refreshEarningsCalendar());
        return step.run('notify', async () => {
            const users = await linkedUsers('earnings');
            if (!users.length) return { sent: 0 };
            const cal = (await readCache<EarningsCalendar>('earnings:calendar'))?.value;
            if (!cal) return { error: 'no earnings calendar' };
            const lists = await watchlistsFor(users.map((u) => u.userId));
            const watched = new Set([...lists.values()].flat());
            const tomorrow = plusDays(1), recent = plusDays(-3), today = todayIso();

            const messages: { symbol: string; html: string }[] = [];
            for (const e of cal.events.filter((ev) => watched.has(ev.symbol))) {
                const kind = e.epsActual !== null && e.date >= recent && e.date <= today ? 'result' : e.date === tomorrow ? 'reminder' : null;
                if (!kind) continue;
                const key = `earnings-sent:${e.symbol}:${e.date}:${kind}`;
                if (await readCache(key)) continue; // already told everyone
                await writeCache(key, true);
                if (kind === 'reminder') {
                    const hour = earningsHourLabel(e.hour);
                    messages.push({ symbol: e.symbol, html: [
                        `📅 <b>${stockLink(e.symbol)} reports tomorrow</b>${hour ? `, ${hour}` : ''}`,
                        `Q${e.quarter} ${e.year} · EPS estimate ${e.epsEstimate ?? '—'}${e.revenueEstimate ? ` · revenue est. $${(e.revenueEstimate / 1e9).toFixed(1)}B` : ''}`,
                    ].join('\n') });
                } else {
                    const beat = e.epsEstimate !== null ? e.epsActual! >= e.epsEstimate : null;
                    messages.push({ symbol: e.symbol, html: [
                        `${beat === null ? '📊' : beat ? '✅' : '❌'} <b>${stockLink(e.symbol)} ${beat === null ? 'reported' : beat ? 'beat' : 'missed'}</b> (${earningsDayLabel(e.date)})`,
                        `EPS ${e.epsActual} vs ${e.epsEstimate ?? '—'} expected${e.revenueActual && e.revenueEstimate ? ` · revenue $${(e.revenueActual / 1e9).toFixed(2)}B vs $${(e.revenueEstimate / 1e9).toFixed(2)}B` : ''}`,
                    ].join('\n') });
                }
            }

            let sent = 0;
            for (const m of messages) {
                for (const u of users) {
                    if ((lists.get(u.userId) ?? []).includes(m.symbol) && await notify(u, m.html)) sent++;
                }
            }
            return { messages: messages.length, sent };
        });
    },
);
