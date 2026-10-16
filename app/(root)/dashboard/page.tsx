import { Suspense } from "react";
import { cookies } from "next/headers";
import TradingViewWidget from "@/components/TradingViewWidget";
import Panel from "@/components/Panel";
import IndexPulse, { PulseSkeleton } from "@/components/IndexPulse";
import DataFreshness from "@/components/DataFreshness";
import MarketSwitcher from "@/components/MarketSwitcher";
import {
    CRYPTO_HEATMAP_CONFIG,
    STOCK_HEATMAP_CONFIG,
    marketOverviewConfig,
    marketQuotesConfig,
    timelineConfig,
    POPULAR_STOCKS,
} from "@/lib/constants";
import { MARKETS, MARKET_COOKIE, LEGACY_MARKET_COOKIE, getMarket, isMarketOpen, marketForCountry } from "@/lib/markets";
import { getSession } from "@/lib/better-auth/auth";
import { getEarningsCalendar, getMacroSnapshot, getMarketBrief } from "@/lib/market-intel";
import MarketBrief from "@/components/market/MarketBrief";
import FearGreedCard from "@/components/market/FearGreedCard";
import YieldCurveChart from "@/components/market/YieldCurveChart";
import EconomicCalendar from "@/components/market/EconomicCalendar";
import EarningsList from "@/components/market/EarningsList";

const scriptUrl = `https://s3.tradingview.com/external-embedding/embed-widget-`;

async function Brief() {
    const brief = await getMarketBrief();
    if (!brief) return null;
    return (
        <Panel title="Market brief" sub="What moved and why, refreshed before the open, at midday and after the close">
            <MarketBrief brief={brief} />
        </Panel>
    );
}

// US macro: fear & greed, the Treasury curve and the release calendar (precomputed hourly)
async function Macro() {
    const macro = await getMacroSnapshot();
    if (!macro) return null;
    const { fearGreed, yieldCurve, calendar } = macro;
    return (
        <div className={`grid gap-3 ${calendar ? 'xl:grid-cols-3' : 'xl:grid-cols-2'}`}>
            {fearGreed && <Panel title="Fear & greed" sub="Volatility, credit, momentum and strength in one score"><FearGreedCard data={fearGreed} /></Panel>}
            {yieldCurve && <Panel title="Yield curve" sub="US Treasury yields by maturity"><YieldCurveChart curve={yieldCurve} /></Panel>}
            {calendar && <Panel title="Economic calendar" sub="US releases in the next five weeks"><EconomicCalendar events={calendar} /></Panel>}
        </div>
    );
}

const POPULAR_SYMBOLS = new Set(POPULAR_STOCKS.map((s) => s.symbol));

// The week's biggest reports, ranked by expected revenue
async function EarningsWeek() {
    const cal = await getEarningsCalendar();
    if (!cal) return null;
    const today = new Date().toISOString().slice(0, 10);
    const weekOut = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const upcoming = cal.events.filter((e) => e.date >= today && e.date <= weekOut);
    const withRevenue = upcoming.filter((e) => e.revenueEstimate);
    // Rank by expected revenue; if Finnhub sent no estimates, fall back to well-known names
    const ranked = withRevenue.length >= 3
        ? withRevenue.sort((a, b) => (b.revenueEstimate ?? 0) - (a.revenueEstimate ?? 0))
        : upcoming.filter((e) => POPULAR_SYMBOLS.has(e.symbol));
    const events = ranked.slice(0, 10).sort((a, b) => a.date.localeCompare(b.date));
    return (
        <Panel title="Earnings this week" sub="Largest companies reporting in the next 7 days">
            <EarningsList events={events} empty="No large companies report in the next 7 days." />
        </Panel>
    );
}

// Widgets come from TradingView (live, no Finnhub quota) and render immediately; the tiles stream in.
export default async function Dashboard({ searchParams }: { searchParams: Promise<{ market?: string }> }) {
    const { market: requested } = await searchParams;
    // Explicit choice, then the remembered one, then the market of the user's country
    const jar = await cookies();
    const saved = (jar.get(MARKET_COOKIE) ?? jar.get(LEGACY_MARKET_COOKIE))?.value;
    const market = getMarket(requested ?? saved ?? marketForCountry((await getSession())?.user.country));
    const open = isMarketOpen(market);
    const native = market.pulse.some((p) => p.finnhub);
    const heatmap = market.heatmap === 'stocks'
        ? { script: 'stock-heatmap.js', config: STOCK_HEATMAP_CONFIG, title: 'S&P 500 heatmap' }
        : market.heatmap === 'crypto'
            ? { script: 'crypto-coins-heatmap.js', config: CRYPTO_HEATMAP_CONFIG, title: 'Crypto heatmap' }
            : null;

    return (
        <>
            <header className="page-head">
                <div>
                    <h1 className="page-title">Markets</h1>
                    <p className="page-sub">{market.name} · {open ? 'open now' : 'closed now'} · {market.feed.toLowerCase()} data</p>
                </div>
            </header>

            <MarketSwitcher active={market.id} openIds={MARKETS.filter((m) => isMarketOpen(m)).map((m) => m.id)} />

            <section className="hatch">
                <div className="section-head">
                    <div>
                        <h2 className="section-title">Pulse</h2>
                        <p className="section-sub">{native ? 'Our shared quotes via Finnhub' : `${market.feed} quotes via TradingView`}</p>
                    </div>
                    {native && <DataFreshness />}
                </div>
                {/* Keyed so switching markets swaps the tiles instead of reusing old widgets */}
                <Suspense key={market.id} fallback={<PulseSkeleton />}>
                    <IndexPulse market={market} />
                </Suspense>
            </section>

            {market.id === 'us' && (
                <div className="flex flex-col gap-3">
                    <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                        <Suspense fallback={null}><Brief /></Suspense>
                        <Suspense fallback={null}><EarningsWeek /></Suspense>
                    </div>
                    <Suspense fallback={null}><Macro /></Suspense>
                </div>
            )}

            <div key={market.id} className="flex flex-col gap-3">
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                    <Panel title="Leaders" sub="12-month trend by group">
                        <TradingViewWidget scriptUrl={`${scriptUrl}market-overview.js`} config={marketOverviewConfig(market.groups)} height={560} />
                    </Panel>
                    {heatmap ? (
                        <Panel title={heatmap.title} sub="Sized by market cap, coloured by today’s move">
                            <TradingViewWidget scriptUrl={`${scriptUrl}${heatmap.script}`} config={heatmap.config} height={560} allowExpand />
                        </Panel>
                    ) : (
                        <Panel title="Quotes" sub={`${market.name} leaders by group`}>
                            <TradingViewWidget scriptUrl={`${scriptUrl}market-quotes.js`} config={marketQuotesConfig(market.groups)} height={560} />
                        </Panel>
                    )}
                </div>

                <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                    {heatmap && (
                        <Panel title="Quotes" sub={`${market.name} leaders by group`}>
                            <TradingViewWidget scriptUrl={`${scriptUrl}market-quotes.js`} config={marketQuotesConfig(market.groups)} height={560} />
                        </Panel>
                    )}
                    <Panel title="Top stories" sub="Newest first" className={heatmap ? '' : 'xl:col-span-2'}>
                        <TradingViewWidget scriptUrl={`${scriptUrl}timeline.js`} config={timelineConfig(market.news)} height={560} />
                    </Panel>
                </div>
            </div>
        </>
    );
}
