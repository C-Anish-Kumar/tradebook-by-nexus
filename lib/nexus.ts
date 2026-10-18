// Client for the Nexus RL service (github.com/C-Anish-Kumar/nexus), hosted on its own free
// Hugging Face Space because training an agent takes minutes.

const SERVICE_URL = process.env.NEXUS_SERVICE_URL?.replace(/\/+$/, '');
const API_KEY = process.env.NEXUS_API_KEY;

export const nexusEnabled = Boolean(SERVICE_URL && API_KEY);

export const ALGOS = ['ppo', 'a2c', 'sac', 'td3', 'ddpg'] as const;
export type Algo = (typeof ALGOS)[number];

// Mirrors nexus/templates/*.yaml so the page renders even while the Space sleeps
export const TEMPLATES = [
    { name: 'etf_rotation', label: 'ETF rotation', tickers: ['SPY', 'QQQ', 'IWM', 'TLT', 'GLD'], benchmark: 'SPY',
      about: 'Rotate between stocks, small caps, bonds and gold. Diversified and the calmest; a good first strategy.' },
    { name: 'megacap_tech', label: 'Mega-cap tech', tickers: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META'], benchmark: 'QQQ',
      about: 'The six largest US tech stocks. Higher return potential, bigger swings.' },
    { name: 'crypto_majors', label: 'Crypto majors', tickers: ['BTC-USD', 'ETH-USD', 'SOL-USD'], benchmark: 'BTC-USD',
      about: 'Bitcoin, Ether and Solana, traded every day. The most volatile; the drawdown stop stays on.' },
    { name: 'spy_timing', label: 'S&P 500 timing', tickers: ['SPY'], benchmark: 'SPY',
      about: 'One asset: when to hold the S&P 500 and when to sit in cash.' },
] as const;
export type TemplateName = (typeof TEMPLATES)[number]['name'];

export type Metrics = {
    total_return: number; cagr: number | null; volatility: number | null; sharpe: number | null;
    sortino: number | null; max_drawdown: number; calmar: number | null; var_95: number | null;
    cvar_95: number | null; win_rate: number | null; alpha: number | null; beta: number | null;
};

export type PeriodResult = {
    start: string;
    end: string;
    agent: Metrics;
    buy_and_hold: Metrics;
    benchmark: Metrics;
    risk_events: { day: number; event: string; equity: number }[];
    trades: number;
    costs: number;
    final_weights: Record<string, number>;
    curves: { agent: [string, number][]; buy_and_hold: [string, number][]; benchmark: [string, number][] };
};

export type Verdict = { call: 'edge' | 'defensive' | 'no_edge'; beats_buy_and_hold: boolean; text: string };

export type RunResult = {
    id: string;
    strategy: {
        name: string; tickers: string[]; benchmark: string; algo: Algo; timesteps: number;
        train_start: string; val_start: string; test_start: string; test_end: string;
    };
    validation: PeriodResult;
    test: PeriodResult;
    verdict: Verdict;
    signal: { as_of: string; raw: Record<string, number>; action: Record<string, 'buy' | 'sell' | 'hold'> };
    seconds: number;
};

export type SweepRow = {
    run_id: string; algo: Algo; seed: number; validation_sharpe: number | null; validation_return: number | null;
    test_sharpe: number | null; test_return: number | null; test_max_drawdown: number | null; call: Verdict['call'];
};

export type SweepResult = {
    id: string;
    candidates: number;
    best: RunResult;
    leaderboard: SweepRow[];
    summary: string;
    seconds: number;
};

export type NexusJob = {
    id: string;
    status: 'queued' | 'running' | 'done' | 'error';
    result?: RunResult | SweepResult;
    error?: string;
};

export class NexusJobMissingError extends Error {
    constructor() {
        super('The Nexus service no longer has this job (it probably restarted)');
    }
}

const headers = () => {
    const h: Record<string, string> = { 'Content-Type': 'application/json', 'X-Nexus-Key': API_KEY! };
    // A private Hugging Face Space also wants a token
    if (process.env.NEXUS_HF_TOKEN) h.Authorization = `Bearer ${process.env.NEXUS_HF_TOKEN}`;
    return h;
};

async function call<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
    if (!nexusEnabled) throw new Error('RL Lab is not configured');
    const res = await fetch(`${SERVICE_URL}${path}`, {
        ...init,
        headers: headers(),
        cache: 'no-store',
        signal: AbortSignal.timeout(init?.timeoutMs ?? 30_000),
    });
    if (res.status === 404 && path.startsWith('/jobs/')) throw new NexusJobMissingError();
    if (!res.ok) {
        const detail = await res.json().then((b) => b.detail).catch(() => null);
        throw new Error(typeof detail === 'string' ? detail : `Nexus service ${res.status}`);
    }
    return res.json() as Promise<T>;
}

export type JobRequest = {
    template: string;
    tickers?: string[];
    timesteps?: number;
    algo?: Algo;
    algos?: Algo[];
    seeds?: number;
};

export const startNexusJob = (kind: 'run' | 'sweep', body: JobRequest) =>
    call<{ id: string }>(kind === 'run' ? '/runs' : '/sweeps', {
        method: 'POST',
        body: JSON.stringify(body),
        // A sleeping Space takes about a minute to wake
        timeoutMs: 90_000,
    });

export const getNexusJob = (id: string) => call<NexusJob>(`/jobs/${encodeURIComponent(id)}`);

// Pinged with the analyst service so the free Space stays awake
export async function pingNexusService(): Promise<number> {
    if (!nexusEnabled) return 0;
    const res = await fetch(`${SERVICE_URL}/`, { headers: headers(), cache: 'no-store', signal: AbortSignal.timeout(60_000) });
    return res.status;
}
