import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { alertsEnabled } from "@/lib/market-data";
import { sendWeeklyNewsSummary, sendSignUpEmail, checkStockAlerts, checkInactiveUsers } from "@/lib/inngest/functions";
import { runAnalysis } from "@/lib/inngest/analysis";
import { keepAnalystAwake, refreshMarketData, writeMarketBrief } from "@/lib/inngest/market";
import { scanSetups } from "@/lib/inngest/setups";
import { runScreener } from "@/lib/inngest/screener";
import { sendDailySummaries, setupTelegramBot, watchEarnings, watchStrategySignals } from "@/lib/inngest/telegram";

export const { GET, POST, PUT } = serve({
    client: inngest,
    // The alert checker only runs where price alerts are turned on (realtime mode)
    functions: [sendSignUpEmail, sendWeeklyNewsSummary, checkInactiveUsers, runAnalysis, keepAnalystAwake, refreshMarketData, writeMarketBrief, setupTelegramBot, sendDailySummaries, watchStrategySignals, watchEarnings, scanSetups, runScreener, ...(alertsEnabled ? [checkStockAlerts] : [])],
})