import { Suspense } from "react";
import { CandlestickChart } from "lucide-react";
import TradingViewWidget from "@/components/TradingViewWidget";
import StockHeader, { StockHeaderSkeleton } from "@/components/stocks/StockHeader";
import StockSentimentCard from "@/components/stocks/StockSentimentCard";
import AIAnalystPanel from "@/components/stocks/AIAnalystPanel";
import StrategyPanel from "@/components/stocks/StrategyPanel";
import { scannerStrategies, STRATEGY_1 } from "@/lib/strategies";
import { STATUS_LABEL } from "@/lib/setups";
import SetupSummary from "@/components/setups/SetupSummary";
import BacktestPanel from "@/components/stocks/BacktestPanel";
import FundamentalsPanel from "@/components/stocks/FundamentalsPanel";
import Panel from "@/components/Panel";
import {
    CANDLE_CHART_WIDGET_CONFIG,
    TECHNICAL_ANALYSIS_WIDGET_CONFIG,
    COMPANY_PROFILE_WIDGET_CONFIG,
    COMPANY_FINANCIALS_WIDGET_CONFIG,
} from "@/lib/constants";
import { getStockSentimentInsights } from '@/lib/actions/adanos.actions';
import { getLatestAnalysis } from '@/lib/actions/analysis.actions';
import { analystEnabled, getFundamentals, getSetup, getStrategySignals } from '@/lib/analyst';
import { cn, formatSymbolForTradingView, isChartEmbeddable, tradingViewSymbolUrl } from '@/lib/utils';

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

async function Setups({ symbol }: { symbol: string }) {
    const strategies = scannerStrategies();
    if (!analystEnabled || !strategies.length || symbol.includes(':')) return null;
    // Last night's scan where there is one; otherwise a live read, shared for 30 minutes
    const rows = await Promise.all(strategies.map(async (strategy) => ({ strategy, setup: await getSetup(symbol, strategy.id) })));
    return (
        <Panel title="Trade setups" sub="Every strategy that is switched on, each with a 0-100 quant score">
            {rows.every((r) => !r.setup) ? (
                <div className="empty-state py-10">
                    <h3>Waking up the analyst service</h3>
                    <p className="max-w-80 text-[13px]">The scores for {symbol} will be ready in about a minute. Refresh then.</p>
                </div>
            ) : (
                <div className="flex flex-col divide-y divide-line">
                    {rows.map(({ strategy, setup }, i) => (
                        <details key={strategy.id} open={i === 0} className="group">
                            <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-[13px]">
                                <span className="font-semibold text-foreground">{strategy.label}: {strategy.name}</span>
                                {setup ? (
                                    <>
                                        <span className={cn('pill', setup.status === 'entry' && 'is-up', setup.status === 'watch' && 'is-brand')}>{STATUS_LABEL[setup.status]}</span>
                                        {setup.quant && <span className="pill num">{setup.quant.score}/100 · {setup.quant.label}</span>}
                                    </>
                                ) : <span className="text-faint">Not available yet</span>}
                            </summary>
                            {setup && (
                                <>
                                    <p className="px-4 text-[12px] text-faint">{strategy.rules}</p>
                                    <SetupSummary setup={setup} />
                                </>
                            )}
                        </details>
                    ))}
                </div>
            )}
        </Panel>
    );
}

async function Strategy({ symbol }: { symbol: string }) {
    if (!analystEnabled || !STRATEGY_1.enabled || symbol.includes(':')) return null;
    const signals = await getStrategySignals(symbol);
    if (!signals) {
        // First visit while the Space sleeps: say so instead of silently dropping the panels
        return (
            <Panel title={STRATEGY_1.label} sub={`${STRATEGY_1.name}: ${STRATEGY_1.rules}`}>
                <div className="empty-state py-10">
                    <h3>Waking up the analyst service</h3>
                    <p className="max-w-80 text-[13px]">The strategy checklist, backtest and fundamentals for {symbol} will be ready in about a minute. Refresh then.</p>
                </div>
            </Panel>
        );
    }
    return (
        <>
            <Panel title={STRATEGY_1.label} sub={`${STRATEGY_1.name}: ${STRATEGY_1.rules}`}>
                <StrategyPanel signals={signals} />
            </Panel>
            <Panel title="Backtest" sub="How these rules would have traded this stock">
                <BacktestPanel symbol={symbol} />
            </Panel>
        </>
    );
}

async function SecFundamentals({ symbol }: { symbol: string }) {
    if (symbol.includes(':')) return null;
    const data = await getFundamentals(symbol);
    if (!data) return null; // not an SEC filer, or the service is asleep
    return (
        <Panel title="Fundamentals" sub="From SEC filings: annual results, insider trades and the latest reports">
            <FundamentalsPanel data={data} />
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
                        <Setups symbol={symbol} />
                    </Suspense>
                    <Suspense fallback={null}>
                        <Strategy symbol={symbol} />
                    </Suspense>
                    <Suspense fallback={null}>
                        <SecFundamentals symbol={symbol} />
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
