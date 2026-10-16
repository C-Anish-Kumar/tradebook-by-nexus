import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { alertsEnabled } from "@/lib/market-data";
import { sendWeeklyNewsSummary, sendSignUpEmail, checkStockAlerts, checkInactiveUsers } from "@/lib/inngest/functions";
import { runAnalysis } from "@/lib/inngest/analysis";
import { runRlJob } from "@/lib/inngest/rl";
import { keepAnalystAwake, refreshMarketData, writeMarketBrief } from "@/lib/inngest/market";

export const { GET, POST, PUT } = serve({
    client: inngest,
    // The alert checker only runs where price alerts are turned on (realtime mode)
    functions: [sendSignUpEmail, sendWeeklyNewsSummary, checkInactiveUsers, runAnalysis, runRlJob, keepAnalystAwake, refreshMarketData, writeMarketBrief, ...(alertsEnabled ? [checkStockAlerts] : [])],
})