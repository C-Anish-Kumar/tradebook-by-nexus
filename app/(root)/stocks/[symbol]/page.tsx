import { Suspense } from "react";
import { CandlestickChart } from "lucide-react";
import TradingViewWidget from "@/components/TradingViewWidget";
import StockHeader, { StockHeaderSkeleton } from "@/components/stocks/StockHeader";
import StockSentimentCard from "@/components/stocks/StockSentimentCard";
import AIAnalystPanel from "@/components/stocks/AIAnalystPanel";
import StrategyPanel from "@/components/stocks/StrategyPanel";
import Panel from "@/components/Panel";
import {
    CANDLE_CHART_WIDGET_CONFIG,
    TECHNICAL_ANALYSIS_WIDGET_CONFIG,
    COMPANY_PROFILE_WIDGET_CONFIG,
    COMPANY_FINANCIALS_WIDGET_CONFIG,
} from "@/lib/constants";
import { getStockSentimentInsights } from '@/lib/actions/adanos.actions';
import { getLatestAnalysis } from '@/lib/actions/analysis.actions';
import { analystEnabled, getStrategySignals } from '@/lib/analyst';
import { formatSymbolForTradingView, isChartEmbeddable, tradingViewSymbolUrl } from '@/lib/utils';

const scriptUrl = `https://s3.tradingview.com/external-embedding/embed-widget-`;

async function Sentiment({ symbol }: { symbol: string }) {
    const insight = await getStockSentimentInsights(symbol);
    if (!insight) return null;
    return (
        <Panel title="Sentiment" sub="Reddit, X.com, news and Polymarket">
            <StockSentimentCard insight={insight} />
        </Panel>
    );
}

async function AIAnalyst({ symbol }: { symbol: string }) {
    if (!analystEnabled || symbol.includes(':')) return null; // stocks only; crypto pairs carry an exchange prefix
    const latest = await getLatestAnalysis(symbol);
    return (
        <Panel title="AI Analyst" sub="Agents debate the stock and settle on a rating">
            <AIAnalystPanel symbol={symbol} initial={latest} />
        </Panel>
    );
}

async function Strategy({ symbol }: { symbol: string }) {
    if (!analystEnabled || symbol.includes(':')) return null;
    const signals = await getStrategySignals(symbol);
    if (!signals) return null;
    return (
        <Panel title="Strategy" sub="10/21 EMA + Supertrend (10,3) rules on the daily chart">
            <StrategyPanel signals={signals} />
        </Panel>
    );
}

// Charts come straight from TradingView (live, no quota); only the header waits on Finnhub, and it streams.
export default async function StockDetails({ params }: StockDetailsPageProps) {
    const { symbol: rawSymbol } = await params;
    const symbol = decodeURIComponent(rawSymbol).toUpperCase();
    const tvSymbol = formatSymbolForTradingView(symbol);

    return (
        <>
            <Suspense fallback={<StockHeaderSkeleton />}>
                <StockHeader symbol={symbol} />
            </Suspense>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
                <div className="flex min-w-0 flex-col gap-3">
                    {isChartEmbeddable(tvSymbol) ? (
                        <Panel title="Chart" sub="Live from TradingView · switch interval and style in the chart">
                            <TradingViewWidget
                                scriptUrl={`${scriptUrl}advanced-chart.js`}
                                config={CANDLE_CHART_WIDGET_CONFIG(tvSymbol)}
                                height={560}
                                allowExpand
                            />
                        </Panel>
                    ) : (
                        // TradingView refuses this exchange's chart in embeds; say so instead of showing its error
                        <Panel title="Chart" sub="Only on TradingView for this exchange">
                            <div className="empty-state py-14">
                                <span className="empty-icon"><CandlestickChart className="size-5" /></span>
                                <h3>Chart not available here</h3>
                                <p className="max-w-80 text-[13px]">
                                    TradingView doesn’t license {tvSymbol.split(':')[0]} charts for other sites. Financials, technicals and the profile below still work.
                                </p>
                                <a href={tradingViewSymbolUrl(tvSymbol)} target="_blank" rel="noopener noreferrer" className="btn btn-ghost mt-2">
                                    Open chart on TradingView
                                </a>
                            </div>
                        </Panel>
                    )}
                    <Suspense fallback={null}>
                        <Strategy symbol={symbol} />
                    </Suspense>
                    <Panel title="Financials" sub="Income statement, balance sheet and ratios">
                        <TradingViewWidget
                            scriptUrl={`${scriptUrl}financials.js`}
                            config={COMPANY_FINANCIALS_WIDGET_CONFIG(tvSymbol)}
                            height={500}
                        />
                    </Panel>
                </div>

                <div className="flex min-w-0 flex-col gap-3">
                    <Panel title="Technicals" sub="Oscillators and moving averages, 1h">
                        <TradingViewWidget
                            scriptUrl={`${scriptUrl}technical-analysis.js`}
                            config={TECHNICAL_ANALYSIS_WIDGET_CONFIG(tvSymbol)}
                            height={400}
                        />
                    </Panel>
                    <Suspense fallback={null}>
                        <AIAnalyst symbol={symbol} />
                    </Suspense>
                    <Suspense fallback={null}>
                        <Sentiment symbol={symbol} />
                    </Suspense>
                    <Panel title="Profile" sub="What the company does">
                        <TradingViewWidget
                            scriptUrl={`${scriptUrl}symbol-profile.js`}
                            config={COMPANY_PROFILE_WIDGET_CONFIG(tvSymbol)}
                            height={440}
                        />
                    </Panel>
                </div>
            </div>
        </>
    );
}
