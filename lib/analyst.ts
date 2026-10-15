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

async function call<T>(path: string, init?: RequestInit): Promise<T> {
    if (!analystEnabled) throw new Error('AI Analyst is not configured');
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Analyst-Key': API_KEY! };
    // A private Hugging Face Space also wants a token
    if (process.env.ANALYST_HF_TOKEN) headers.Authorization = `Bearer ${process.env.ANALYST_HF_TOKEN}`;

    const res = await fetch(`${SERVICE_URL}${path}`, { ...init, headers, cache: 'no-store' });
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

// Daily-candle strategy checklist. Not user-specific, so the Next data cache shares it for 15 minutes.
export async function getStrategySignals(ticker: string): Promise<StrategySignals | null> {
    if (!analystEnabled) return null;
    const headers: Record<string, string> = { 'X-Analyst-Key': API_KEY! };
    if (process.env.ANALYST_HF_TOKEN) headers.Authorization = `Bearer ${process.env.ANALYST_HF_TOKEN}`;
    try {
        const res = await fetch(`${SERVICE_URL}/signals/${encodeURIComponent(ticker)}`, {
            headers,
            next: { revalidate: 900 },
            // A sleeping Space can take a minute to wake; don't hold the page that long
            signal: AbortSignal.timeout(20_000),
        });
        return res.ok ? (await res.json() as StrategySignals) : null;
    } catch {
        return null;
    }
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
};

// Replays the strategy on the analyst service; results are cached there and here for 6 hours
export async function getBacktest(ticker: string, years: number): Promise<BacktestResult> {
    if (!analystEnabled) throw new Error('The analyst service is not configured');
    const headers: Record<string, string> = { 'X-Analyst-Key': API_KEY! };
    if (process.env.ANALYST_HF_TOKEN) headers.Authorization = `Bearer ${process.env.ANALYST_HF_TOKEN}`;
    const res = await fetch(`${SERVICE_URL}/backtest/${encodeURIComponent(ticker)}?years=${years}`, {
        headers,
        next: { revalidate: 6 * 60 * 60 },
        signal: AbortSignal.timeout(90_000),
    });
    if (res.status === 404) throw new Error('Not enough price history to backtest this stock');
    if (!res.ok) throw new Error(`Backtest failed (${res.status})`);
    return res.json() as Promise<BacktestResult>;
}
