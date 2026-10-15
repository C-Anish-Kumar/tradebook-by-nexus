"use client";

import { useEffect, useState } from "react";
import { Bot, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getLatestAnalysis, requestAnalysis, type AnalysisSummary } from "@/lib/actions/analysis.actions";
import { cn } from "@/lib/utils";

const RATING_CLASS: Record<string, string> = {
    Buy: 'is-up',
    Overweight: 'is-up',
    Underweight: 'is-down',
    Sell: 'is-down',
};

const POLL_MS = 15_000;

// The service reports raw exceptions; turn the usual ones into something actionable
function friendlyError(error?: string) {
    const raw = error ?? '';
    if (/api key/i.test(raw)) return 'The AI service has no Gemini key. Add GOOGLE_API_KEY to the Space secrets.';
    if (/429|RESOURCE_EXHAUSTED|quota|rate limit/i.test(raw)) return 'Gemini’s rate limit was hit. Try again in a few minutes.';
    if (/no longer has this job|restarted/i.test(raw)) return 'The AI service restarted during the run. Please run it again.';
    if (/took too long/i.test(raw)) return 'The analysis took too long and was stopped. Please try again.';
    if (/Analyst service 401/.test(raw)) return 'OpenStock and the AI service have different ANALYST_API_KEY values.';
    return 'Something went wrong while analysing. Please try again.';
}

const minutesSince = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));

export default function AIAnalystPanel({ symbol, initial }: { symbol: string; initial: AnalysisSummary | null }) {
    const [analysis, setAnalysis] = useState(initial);
    const [starting, setStarting] = useState(false);
    const [, setTick] = useState(0);
    const pending = analysis?.status === 'queued' || analysis?.status === 'running';

    // While a run is in flight, check back until it lands
    useEffect(() => {
        if (!pending) return;
        const timer = setInterval(async () => {
            try {
                const latest = await getLatestAnalysis(symbol);
                setAnalysis(latest);
                setTick((t) => t + 1); // refreshes the elapsed time
                if (latest?.status === 'done') toast.success(`AI analysis for ${symbol} is ready`);
            } catch (error) {
                console.error('Failed to refresh analysis:', error);
            }
        }, POLL_MS);
        return () => clearInterval(timer);
    }, [pending, symbol]);

    const start = async () => {
        setStarting(true);
        try {
            setAnalysis(await requestAnalysis(symbol));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Couldn’t start the analysis');
        } finally {
            setStarting(false);
        }
    };

    return (
        <div className="flex flex-col gap-3">
            {analysis?.status === 'done' && (
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-[13px] text-muted-foreground">Rating for {analysis.tradeDate}</p>
                        <span className={cn('pill mt-1', RATING_CLASS[analysis.rating ?? ''])}>{analysis.rating ?? 'Review'}</span>
                    </div>
                    <a href={`/analysis/${analysis.id}/report`} target="_blank" rel="noopener" className="btn btn-ghost">
                        <ExternalLink /> Full report
                    </a>
                </div>
            )}

            {pending && (
                <p className="flex items-center gap-2 text-[13px]">
                    <Loader2 className="size-4 animate-spin" />
                    <span>
                        Analysts, researchers and the risk team are debating {symbol}
                        {analysis && minutesSince(analysis.createdAt) > 0 && ` (${minutesSince(analysis.createdAt)} min so far)`}.
                        {' '}This takes 5–15 minutes; you can leave this page.
                    </span>
                </p>
            )}

            {analysis?.status === 'error' && (
                <p className="text-[13px] text-down" title={analysis.error}>{friendlyError(analysis.error)}</p>
            )}

            {!pending && (
                <button type="button" onClick={start} disabled={starting} className="btn btn-primary self-start">
                    {starting ? <Loader2 className="animate-spin" /> : <Bot />}
                    {analysis ? 'Run a new analysis' : `Analyze ${symbol} with AI`}
                </button>
            )}

            <p className="text-[12px] text-muted-foreground">
                Multi-agent research by TradingAgents. Not financial advice.
            </p>
        </div>
    );
}
