import { inngest } from '@/lib/inngest/client';
import { pingAnalystService } from '@/lib/analyst';
import { refreshEarningsCalendar, refreshMacroSnapshot, refreshMarketBrief } from '@/lib/market-intel';

// The free Space sleeps when idle; a ping every 15 minutes keeps first visits fast
export const keepAnalystAwake = inngest.createFunction(
    { id: 'keep-analyst-awake', concurrency: 1, triggers: [{ cron: '*/15 * * * *' }] },
    async ({ step }) => step.run('ping', () => pingAnalystService()),
);

// Precompute market-wide panels so pages only ever read MongoDB
export const refreshMarketData = inngest.createFunction(
    { id: 'refresh-market-data', concurrency: 1, triggers: [{ event: 'app/market.refresh' }, { cron: '7 * * * *' }] }, // hourly
    async ({ step }) => {
        const macro = await step.run('macro-snapshot', () => refreshMacroSnapshot());
        // Earnings dates move slowly; every 6 hours is plenty
        const hour = new Date().getUTCHours();
        const earnings = hour % 6 === 0 ? await step.run('earnings-calendar', () => refreshEarningsCalendar()) : 'skipped';
        return { macro, earnings };
    },
);

// AI brief before the open, at midday and after the close (New York time, weekdays)
export const writeMarketBrief = inngest.createFunction(
    { id: 'write-market-brief', concurrency: 1, retries: 1, triggers: [{ event: 'app/market.brief' }, { cron: 'TZ=America/New_York 50 8,12,16 * * 1-5' }] },
    async ({ step }) => step.run('generate', () => refreshMarketBrief()),
);
