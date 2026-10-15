"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus, Scale, X } from "lucide-react";
import { toast } from "sonner";
import { runPortfolioLab } from "@/lib/actions/portfolio.actions";
import type { PortfolioMethod, PortfolioResult } from "@/lib/analyst";
import Panel from "@/components/Panel";
import EquityChart from "@/components/stocks/EquityChart";
import FrontierChart from "@/components/portfolio/FrontierChart";
import { cn } from "@/lib/utils";

const YEARS = [3, 5, 10];
const MAX = 12;
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;
const SHORT: Record<PortfolioMethod['key'], string> = {
    max_sharpe: 'Max Sharpe', min_variance: 'Min variance', hrp: 'HRP', risk_parity: 'Risk parity', equal: 'Equal weight',
};
const ABOUT: Record<PortfolioMethod['key'], string> = {
    max_sharpe: 'Best past return per unit of risk. Tends to concentrate in recent winners.',
    min_variance: 'Lowest past volatility, ignoring returns.',
    hrp: 'Clusters similar stocks, then splits risk between and within clusters.',
    risk_parity: 'Each stock contributes the same share of total risk.',
    equal: 'The same weight in every stock. A hard baseline to beat.',
};

const pct = (n: number | null | undefined, signed = false) =>
    n === null || n === undefined || !Number.isFinite(n) ? '—' : `${signed && n > 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
const ratio = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(2));

export default function PortfolioLab({ initial }: { initial: string[] }) {
    const [tickers, setTickers] = useState(initial.slice(0, MAX));
    const [draft, setDraft] = useState('');
    const [years, setYears] = useState(5);
    const [result, setResult] = useState<PortfolioResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [selectedKey, setSelectedKey] = useState<PortfolioMethod['key'] | null>(null);

    const add = (raw: string) => {
        const next = raw.split(/[\s,]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
        const bad = next.filter((t) => !SYMBOL_PATTERN.test(t));
        if (bad.length) toast.error(`Not a stock ticker: ${bad.join(', ')}`);
        setTickers((cur) => [...new Set([...cur, ...next.filter((t) => SYMBOL_PATTERN.test(t))])].slice(0, MAX));
        setDraft('');
    };

    const run = async () => {
        setLoading(true);
        try {
            const res = await runPortfolioLab(tickers, years);
            setResult(res);
            // Open on the method with the best out-of-sample Sharpe
            setSelectedKey([...res.methods].sort((a, b) => b.out_of_sample.sharpe - a.out_of_sample.sharpe)[0].key);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Optimisation failed');
        } finally {
            setLoading(false);
        }
    };

    const selected = result?.methods.find((m) => m.key === selectedKey) ?? result?.methods[0];
    const bestSharpe = result ? Math.max(...result.methods.map((m) => m.out_of_sample.sharpe)) : null;
    const equity = useMemo(() => (result && selected
        ? result.equity.map((p) => ({ date: p.date, strategy: Number(p[selected.key]), buy_hold: p.benchmark }))
        : []), [result, selected]);

    return (
        <div className="flex flex-col gap-3">
            <Panel title="Stocks" sub="Prefilled from your watchlist · 2 to 12 US-listed tickers">
                <div className="flex flex-col gap-3 p-4">
                    <ul className="flex flex-wrap gap-2" aria-label="Selected stocks">
                        {tickers.map((t) => (
                            <li key={t} className="pill is-brand gap-1">
                                <span className="num">{t}</span>
                                <button type="button" onClick={() => setTickers((cur) => cur.filter((c) => c !== t))} aria-label={`Remove ${t}`} className="opacity-70 hover:opacity-100">
                                    <X />
                                </button>
                            </li>
                        ))}
                        {tickers.length === 0 && <li className="text-[13px] text-faint">Add at least two tickers.</li>}
                    </ul>
                    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) add(draft); }}>
                        <label htmlFor="ticker-input" className="sr-only">Add tickers</label>
                        <input id="ticker-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add tickers, e.g. AAPL MSFT"
                               disabled={tickers.length >= MAX}
                               className="h-9 min-w-0 flex-1 rounded-[10px] bg-page px-3 text-[13px] shadow-[inset_0_0_0_1px_var(--line)] outline-none focus:shadow-[inset_0_0_0_1px_var(--brand)] sm:max-w-64" />
                        <button type="submit" className="btn btn-ghost" disabled={!draft.trim() || tickers.length >= MAX}><Plus /> Add</button>
                        <div className="flex rounded-[10px] p-0.5 shadow-[inset_0_0_0_1px_var(--line)]" role="group" aria-label="History">
                            {YEARS.map((y) => (
                                <button key={y} type="button" onClick={() => setYears(y)} disabled={loading} aria-pressed={y === years}
                                        className={cn('h-8 rounded-[8px] px-3 text-[13px] font-semibold', y === years ? 'bg-brand-soft text-brand-ink' : 'text-muted-foreground hover:text-foreground')}>
                                    {y}Y
                                </button>
                            ))}
                        </div>
                        <button type="button" onClick={run} disabled={loading || tickers.length < 2} className="btn btn-primary">
                            {loading ? <Loader2 className="animate-spin" /> : <Scale />}
                            {result ? 'Run again' : 'Optimise'}
                        </button>
                    </form>
                    {loading && <p className="text-[12px] text-faint">Fitting five allocation methods and testing each one walk-forward…</p>}
                </div>
            </Panel>

            {result && selected && (
                <>
                    <Panel title="Methods compared" sub={`Out of sample since ${result.out_of_sample_start}: each quarter is traded with weights fitted on the year before`}>
                        <div className="overflow-x-auto p-4">
                            <table className="w-full min-w-[640px] text-left text-[13px]">
                                <caption className="sr-only">Walk-forward performance by method; select a row to see its weights and curve</caption>
                                <thead className="text-[11px] uppercase tracking-wide text-faint">
                                    <tr>
                                        <th className="py-1.5 pr-3 font-semibold">Method</th>
                                        <th className="py-1.5 pl-3 text-right font-semibold">Return / yr</th>
                                        <th className="py-1.5 pl-3 text-right font-semibold">Volatility</th>
                                        <th className="py-1.5 pl-3 text-right font-semibold">Sharpe</th>
                                        <th className="py-1.5 pl-3 text-right font-semibold">Sortino</th>
                                        <th className="py-1.5 pl-3 text-right font-semibold">Max drawdown</th>
                                        <th className="py-1.5 pl-3 text-right font-semibold">Calmar</th>
                                        <th className="py-1.5 pl-3 text-right font-semibold">Alpha / beta</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {result.methods.map((m) => {
                                        const o = m.out_of_sample;
                                        const active = m.key === selected.key;
                                        return (
                                            <tr key={m.key} onClick={() => setSelectedKey(m.key)} aria-selected={active}
                                                className={cn('cursor-pointer border-t border-line hover:bg-hover', active && 'bg-brand-soft/60')}>
                                                <th scope="row" className="py-2 pr-3 font-semibold">
                                                    <button type="button" onClick={() => setSelectedKey(m.key)} className="text-left">
                                                        {m.label}
                                                        {o.sharpe === bestSharpe && <span className="pill is-up ml-2 align-middle">Best Sharpe</span>}
                                                    </button>
                                                </th>
                                                <td className={cn('num py-2 pl-3 text-right', o.annual_return >= 0 ? 'text-up' : 'text-down')}>{pct(o.annual_return, true)}</td>
                                                <td className="num py-2 pl-3 text-right">{pct(o.annual_volatility)}</td>
                                                <td className="num py-2 pl-3 text-right font-semibold">{ratio(o.sharpe)}</td>
                                                <td className="num py-2 pl-3 text-right">{ratio(o.sortino)}</td>
                                                <td className="num py-2 pl-3 text-right text-down">{pct(o.max_drawdown)}</td>
                                                <td className="num py-2 pl-3 text-right">{ratio(o.calmar)}</td>
                                                <td className="num py-2 pl-3 text-right">{pct(o.alpha, true)} / {ratio(o.beta)}</td>
                                            </tr>
                                        );
                                    })}
                                    <tr className="border-t border-line text-muted-foreground">
                                        <th scope="row" className="py-2 pr-3 font-normal">{result.benchmark_ticker} (benchmark)</th>
                                        <td className="num py-2 pl-3 text-right">{pct(result.benchmark.annual_return, true)}</td>
                                        <td className="num py-2 pl-3 text-right">{pct(result.benchmark.annual_volatility)}</td>
                                        <td className="num py-2 pl-3 text-right">{ratio(result.benchmark.sharpe)}</td>
                                        <td className="num py-2 pl-3 text-right">{ratio(result.benchmark.sortino)}</td>
                                        <td className="num py-2 pl-3 text-right">{pct(result.benchmark.max_drawdown)}</td>
                                        <td className="num py-2 pl-3 text-right">{ratio(result.benchmark.calmar)}</td>
                                        <td className="num py-2 pl-3 text-right">—</td>
                                    </tr>
                                </tbody>
                            </table>
                            <p className="mt-2 text-[12px] text-faint">Select a method to see its weights and curve. {ABOUT[selected.key]}</p>
                        </div>
                    </Panel>

                    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
                        <Panel title={`${selected.label} vs ${result.benchmark_ticker}`} sub="Growth of $10,000, out of sample only">
                            <div className="p-4"><EquityChart points={equity} labels={[SHORT[selected.key], result.benchmark_ticker]} /></div>
                        </Panel>
                        <Panel title="Weights today" sub={`${selected.label}, fitted on ${result.start} to ${result.end}`}>
                            <ul className="flex flex-col gap-2 p-4">
                                {Object.entries(selected.weights).sort((a, b) => b[1] - a[1]).map(([t, w]) => (
                                    <li key={t} className="grid grid-cols-[56px_1fr_52px] items-center gap-2 text-[13px]">
                                        <span className="num font-semibold">{t}</span>
                                        <span className="h-2 rounded-full bg-hover" aria-hidden>
                                            <span className="block h-2 rounded-full" style={{ width: `${Math.max(w * 100, w > 0 ? 1 : 0)}%`, background: '#199e70' }} />
                                        </span>
                                        <span className="num text-right">{(w * 100).toFixed(1)}%</span>
                                    </li>
                                ))}
                            </ul>
                        </Panel>
                    </div>

                    <div className="grid gap-3 xl:grid-cols-2">
                        <Panel title="Efficient frontier" sub="Best possible return for each level of risk, over the whole window">
                            <div className="p-4">
                                <FrontierChart frontier={result.frontier} assets={result.assets}
                                               selected={{ label: SHORT[selected.key], ...selected.in_sample }} />
                            </div>
                        </Panel>
                        <Panel title="Correlation" sub="Daily returns · lower means better diversification">
                            <Correlation tickers={result.correlation.tickers} matrix={result.correlation.matrix} />
                        </Panel>
                    </div>

                    <p className="text-[12px] text-faint">
                        Long only, fully invested, no trading costs, daily data from {result.start} to {result.end}. Walk-forward: fit on {result.walk_forward.train_days} trading days, hold for the next {result.walk_forward.test_days}, repeat.
                        Built with skfolio and empyrical. Past results don’t predict future returns.
                    </p>
                </>
            )}
        </div>
    );
}

// Blue for positive, orange for negative; the number is always printed so colour is never the only cue
function Correlation({ tickers, matrix }: { tickers: string[]; matrix: number[][] }) {
    return (
        <div className="overflow-x-auto p-4">
            <table className="border-separate border-spacing-0.5 text-[12px]">
                <caption className="sr-only">Correlation of daily returns between each pair of stocks</caption>
                <thead>
                    <tr>
                        <td />
                        {tickers.map((t) => <th key={t} scope="col" className="num px-1 pb-1 font-semibold text-faint">{t}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {matrix.map((row, i) => (
                        <tr key={tickers[i]}>
                            <th scope="row" className="num pr-2 text-right font-semibold text-faint">{tickers[i]}</th>
                            {row.map((v, j) => (
                                <td key={j} className="num h-9 min-w-11 rounded-[6px] text-center"
                                    style={{ background: i === j ? 'var(--hover)' : `color-mix(in oklab, ${v >= 0 ? '#3987e5' : '#e07b39'} ${Math.round(Math.abs(v) * 70)}%, transparent)` }}>
                                    {i === j ? '' : v.toFixed(2)}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
