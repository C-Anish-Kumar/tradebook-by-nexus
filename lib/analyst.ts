import { cached, readCache } from '@/lib/cache';
import type { Setup, StoredSetup } from '@/lib/setups';
import { setupCacheKey } from '@/lib/strategies';

// Client for the TradingAgents service in analyst-service/ (hosted outside Vercel: a run takes minutes)

const SERVICE_URL = process.env.ANALYST_SERVICE_URL?.replace(/\/+$/, '');
const API_KEY = process.env.ANALYST_API_KEY;

export const analystEnabled = Boolean(SERVICE_URL && API_KEY);

export type AnalystJob = {
    id: string;
    status: 'queued' | 'running' | 'done' | 'error';
    rating?: string;
    report_html?: string;
    error?: string;
};

// One place builds the auth headers for every call to the service
const serviceHeaders = () => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Analyst-Key': API_KEY! };
    // A private Hugging Face Space also wants a token
    if (process.env.ANALYST_HF_TOKEN) headers.Authorization = `Bearer ${process.env.ANALYST_HF_TOKEN}`;
    return headers;
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
    if (!analystEnabled) throw new Error('AI Analyst is not configured');
    const res = await fetch(`${SERVICE_URL}${path}`, { ...init, headers: serviceHeaders(), cache: 'no-store' });
    if (res.status === 404) throw new AnalystJobMissingError();
    if (!res.ok) throw new Error(`Analyst service ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json() as Promise<T>;
}

export class AnalystJobMissingError extends Error {
    constructor() {
        super('The analyst service no longer has this job (it probably restarted)');
    }
}

export const startAnalystJob = (ticker: string, date: string) =>
    call<{ id: string }>('/analyses', { method: 'POST', body: JSON.stringify({ ticker, date }) });

export const getAnalystJob = (id: string) => call<AnalystJob>(`/analyses/${encodeURIComponent(id)}`);

export type StrategyCheck = { rule: string; passed: boolean; detail: string };
export type StrategySignals = {
    ticker: string;
    date: string;
    close: number;
    verdict: string;
    tone: 'up' | 'down' | 'warn' | 'neutral';
    trend: 'up' | 'down' | 'mixed';
    indicators: {
        ema10: number; ema21: number; dema50: number; supertrend: number;
        supertrend_up: boolean; supertrend_flipped_today: boolean; weekly_supertrend_up: boolean | null;
    };
    risk: { stop: number; target_4r: number | null };
    entry: StrategyCheck[];
    exits: StrategyCheck[];
    add_backs: StrategyCheck[];
};

// Fresh read from the service (no cache); background jobs use this directly
export async function fetchStrategySignals(ticker: string, timeoutMs = 20_000): Promise<StrategySignals> {
    const res = await fetch(`${SERVICE_URL}/signals/${encodeURIComponent(ticker)}`, {
        headers: serviceHeaders(),
        cache: 'no-store',
        // A sleeping Space can take a minute to wake; don't hold the page that long
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`signals ${res.status}`);
    return res.json() as Promise<StrategySignals>;
}

// Daily-candle strategy checklist, shared by everyone. Stored in MongoDB so a sleeping Space never blanks the panel.
export async function getStrategySignals(ticker: string): Promise<StrategySignals | null> {
    if (!analystEnabled) return null;
    return cached(`signals:${ticker}`, 15 * 60_000, () => fetchStrategySignals(ticker));
}

// Regime + breakout setup with its walk-forward evidence. `universe` = how many tickers this scan covers,
// so the service's Deflated Sharpe prices in the search. Validation is slow on a cold Space: allow a minute.
export async function fetchSetup(ticker: string, universe = 1, timeoutMs = 60_000): Promise<Setup> {
    const res = await fetch(`${SERVICE_URL}/setups/${encodeURIComponent(ticker)}?universe=${universe}`, {
        headers: serviceHeaders(),
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`setups ${res.status}`);
    return res.json() as Promise<Setup>;
}

const SCAN_FRESH_MS = 36 * 3_600_000;

// Setup for the stock page: last night's scan if it is recent (it priced in the whole watchlist's search),
// otherwise a live single-stock read, shared for 30 minutes. Null while the Space sleeps.
export async function getSetup(ticker: string): Promise<Setup | null> {
    if (!analystEnabled) return null;
    const stored = (await readCache<StoredSetup>(setupCacheKey('breakout', ticker)))?.value;
    if (stored?.setup.quant && Date.now() - Date.parse(stored.scannedAt) < SCAN_FRESH_MS) return stored.setup;
    return cached<Setup>(`setup-live:${ticker}`, 30 * 60_000, () => fetchSetup(ticker));
}

export type BacktestTrade = {
    entry_date: string; entry_price: number; exit_date: string; return_pct: number; pnl: number;
    r_multiple: number; bars: number;
    log: { date: string; side: 'buy' | 'sell'; shares: number; price: number; reason: string }[];
};
export type BacktestResult = {
    ticker: string; years: number; start: string; end: string;
    stats: {
        total_return_pct: number; cagr_pct: number; max_drawdown_pct: number;
        buy_hold_return_pct: number; buy_hold_max_drawdown_pct: number;
        trades: number; win_rate_pct: number | null; avg_win_pct: number | null; avg_loss_pct: number | null;
        profit_factor: number | null; avg_r: number | null; exposure_pct: number;
    };
    equity: { date: string; strategy: number; buy_hold: number }[];
    trades: BacktestTrade[];
    open_trade: { entry_date: string; entry_price: number; quarters_held: number; stop: number } | null;
    assumptions: { start_equity: number; cost_per_side_pct: number; fills: string };
    // empyrical metrics on the weekly curve vs SPY; null when the benchmark couldn't load
    risk?: RiskMetrics | null;
};

export type RiskMetrics = {
    annual_return: number; annual_volatility: number; sharpe: number; sortino: number;
    max_drawdown: number; calmar: number; alpha?: number | null; beta?: number | null;
};

const WAKING = 'The analyst service is waking up. Try again in a minute.';

// Replays the strategy on the analyst service; results are kept for 6 hours
export async function getBacktest(ticker: string, years: number): Promise<BacktestResult> {
    if (!analystEnabled) throw new Error('The analyst service is not configured');
    const result = await cached(`backtest:${ticker}:${years}`, 6 * 60 * 60_000, async () => {
        const res = await fetch(`${SERVICE_URL}/backtest/${encodeURIComponent(ticker)}?years=${years}`, {
            headers: serviceHeaders(),
            cache: 'no-store',
            signal: AbortSignal.timeout(90_000),
        });
        if (res.status === 404) throw new Error('Not enough price history to backtest this stock');
        if (!res.ok) throw new Error(res.status >= 502 ? WAKING : `Backtest failed (${res.status})`);
        return res.json() as Promise<BacktestResult>;
    }, { throwOnMiss: true });
    return result!;
}

export type FundamentalsLine = { key: string; label: string; values: (number | null)[] };
export type InsiderTrade = {
    date: string; name: string; position: string | null; side: 'buy' | 'sell';
    shares: number; value: number; planned: boolean; url: string;
};
export type Fundamentals = {
    ticker: string; name: string; cik: number; industry: string | null;
    periods: string[];
    lines: FundamentalsLine[];
    derived: {
        operating_margin_pct: (number | null)[] | null; net_margin_pct: (number | null)[] | null;
        fcf_margin_pct: (number | null)[] | null; revenue_growth_pct: (number | null)[] | null;
    };
    filings: { form: string; date: string; url: string }[];
    insiders: { days: number; filings_scanned: number; bought_value: number; sold_value: number; trades: InsiderTrade[] };
};

// SEC EDGAR statements and Form 4s for US filers. Filings change slowly, so keep for 12 hours.
export async function getFundamentals(ticker: string): Promise<Fundamentals | null> {
    if (!analystEnabled || ticker.includes('.')) return null; // foreign listings aren't SEC filers
    return cached(`fundamentals:${ticker}`, 12 * 60 * 60_000, async () => {
        const res = await fetch(`${SERVICE_URL}/fundamentals/${encodeURIComponent(ticker)}`, {
            headers: serviceHeaders(),
            cache: 'no-store',
            // A cold lookup reads several filings from the SEC (~8 s)
            signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) throw new Error(`fundamentals ${res.status}`);
        return res.json() as Promise<Fundamentals>;
    });
}

export type PortfolioMethod = {
    key: 'max_sharpe' | 'min_variance' | 'hrp' | 'risk_parity' | 'equal';
    label: string;
    weights: Record<string, number>;
    in_sample: { annual_return: number; annual_volatility: number };
    out_of_sample: RiskMetrics;
};
export type PortfolioResult = {
    benchmark_ticker: string; years: number;
    tickers: string[]; start: string; end: string; out_of_sample_start: string;
    walk_forward: { train_days: number; test_days: number };
    methods: PortfolioMethod[];
    benchmark: RiskMetrics;
    equity: ({ date: string; benchmark: number } & Record<string, number | string>)[];
    frontier: { annual_return: number; annual_volatility: number }[];
    assets: { ticker: string; annual_return: number; annual_volatility: number }[];
    correlation: { tickers: string[]; matrix: number[][] };
};

// skfolio walk-forward comparison on the analyst service, kept for 6 hours per ticker set
export async function optimizePortfolio(tickers: string[], years: number): Promise<PortfolioResult> {
    if (!analystEnabled) throw new Error('The analyst service is not configured');
    const key = `portfolio:${[...tickers].sort().join(',')}:${years}`;
    const result = await cached(key, 6 * 60 * 60_000, async () => {
        const res = await fetch(`${SERVICE_URL}/portfolio/optimize`, {
            method: 'POST',
            headers: serviceHeaders(),
            body: JSON.stringify({ tickers, years, benchmark: 'SPY' }),
            cache: 'no-store',
            signal: AbortSignal.timeout(90_000),
        });
        if (res.status === 404 || res.status === 422) {
            const detail = await res.json().then((b) => b.detail).catch(() => null);
            throw new Error(typeof detail === 'string' ? detail : 'Not enough price history for these tickers');
        }
        if (!res.ok) throw new Error(res.status >= 502 ? WAKING : `Optimisation failed (${res.status})`);
        return res.json() as Promise<PortfolioResult>;
    }, { throwOnMiss: true });
    return result!;
}

// Pinged on a schedule so the free Space never falls asleep between visitors
export async function pingAnalystService(): Promise<number> {
    if (!analystEnabled) return 0;
    const res = await fetch(`${SERVICE_URL}/`, { headers: serviceHeaders(), cache: 'no-store', signal: AbortSignal.timeout(60_000) });
    return res.status;
}
