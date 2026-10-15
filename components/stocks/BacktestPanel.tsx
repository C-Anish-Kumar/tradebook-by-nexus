"use client";

import { useState } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { runBacktest } from "@/lib/actions/strategy.actions";
import type { BacktestResult } from "@/lib/analyst";
import EquityChart from "@/components/stocks/EquityChart";
import { cn } from "@/lib/utils";

const YEARS = [1, 3, 5, 10];
// Trade steps are in quarters of the original position
const quarters = (shares: number, full: number) => {
    const q = Math.round((4 * shares) / full);
    return q >= 4 ? 'all' : q === 2 ? '½' : q === 3 ? '¾' : '¼';
};
const pct = (n: number | null, signed = true) => n === null ? '—' : `${signed && n > 0 ? '+' : ''}${n.toFixed(1)}%`;

export default function BacktestPanel({ symbol }: { symbol: string }) {
    const [years, setYears] = useState(5);
    const [result, setResult] = useState<BacktestResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [showAll, setShowAll] = useState(false);

    const run = async (y = years) => {
        setYears(y);
        setLoading(true);
        try {
            setResult(await runBacktest(symbol, y));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Backtest failed');
        } finally {
            setLoading(false);
        }
    };

    const s = result?.stats;
    const tiles = s ? [
        ['Strategy return', pct(s.total_return_pct), s.total_return_pct >= 0],
        ['Buy & hold', pct(s.buy_hold_return_pct), s.buy_hold_return_pct >= 0],
        ['Yearly (CAGR)', pct(s.cagr_pct), s.cagr_pct >= 0],
        ['Max drawdown', `${pct(s.max_drawdown_pct, false)} vs ${pct(s.buy_hold_max_drawdown_pct, false)}`, null],
        ['Trades', String(s.trades), null],
        ['Win rate', s.win_rate_pct === null ? '—' : `${s.win_rate_pct}%`, null],
        ['Avg win / loss', `${pct(s.avg_win_pct)} / ${pct(s.avg_loss_pct)}`, null],
        ['Profit factor', s.profit_factor === null ? '—' : s.profit_factor.toFixed(2), s.profit_factor === null ? null : s.profit_factor >= 1],
    ] as const : [];
    const trades = result ? [...result.trades].reverse() : [];

    return (
        <div className="flex flex-col gap-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-[10px] p-0.5 shadow-[inset_0_0_0_1px_var(--line)]" role="group" aria-label="Backtest period">
                    {YEARS.map((y) => (
                        <button key={y} type="button" onClick={() => (result ? run(y) : setYears(y))} disabled={loading}
                                className={cn('h-8 rounded-[8px] px-3 text-[13px] font-semibold', y === years ? 'bg-brand-soft text-brand-ink' : 'text-muted-foreground hover:text-foreground')}
                                aria-pressed={y === years}>
                            {y}Y
                        </button>
                    ))}
                </div>
                <button type="button" onClick={() => run()} disabled={loading} className="btn btn-primary">
                    {loading ? <Loader2 className="animate-spin" /> : <FlaskConical />}
                    {result ? 'Run again' : `Backtest ${symbol}`}
                </button>
                {loading && <span className="text-[12px] text-faint">Replaying {years} years of daily candles…</span>}
            </div>

            {result && s && (
                <>
                    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {tiles.map(([label, value, good]) => (
                            <div key={label} className="rounded-[10px] bg-page px-3 py-2 shadow-[inset_0_0_0_1px_var(--line)]">
                                <dt className="kicker">{label}</dt>
                                <dd className={cn('num text-[15px] font-semibold', good === true && 'text-up', good === false && 'text-down')}>{value}</dd>
                            </div>
                        ))}
                    </dl>

                    <EquityChart points={result.equity} />

                    {result.open_trade && (
                        <p className="text-[13px] text-muted-foreground">
                            Open position since {result.open_trade.entry_date} at {result.open_trade.entry_price.toFixed(2)},
                            {' '}{result.open_trade.quarters_held}/4 held, stop {result.open_trade.stop.toFixed(2)}.
                        </p>
                    )}

                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[520px] text-left text-[13px]">
                            <caption className="sr-only">Backtest trades, newest first</caption>
                            <thead className="text-[11px] uppercase tracking-wide text-faint">
                                <tr>
                                    <th className="py-1.5 pr-3 font-semibold">Entry</th>
                                    <th className="py-1.5 pr-3 font-semibold">Exit</th>
                                    <th className="py-1.5 pr-3 text-right font-semibold">Return</th>
                                    <th className="py-1.5 pr-3 text-right font-semibold">R</th>
                                    <th className="py-1.5 font-semibold">Steps</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(showAll ? trades : trades.slice(0, 8)).map((t) => (
                                    <tr key={t.entry_date} className="border-t border-line align-top">
                                        <td className="num whitespace-nowrap py-1.5 pr-3">{t.entry_date}<span className="block text-faint">{t.entry_price.toFixed(2)}</span></td>
                                        <td className="num whitespace-nowrap py-1.5 pr-3">{t.exit_date}<span className="block text-faint">{t.bars} days</span></td>
                                        <td className={cn('num py-1.5 pr-3 text-right font-semibold', t.return_pct >= 0 ? 'text-up' : 'text-down')}>{pct(t.return_pct)}</td>
                                        <td className="num py-1.5 pr-3 text-right">{t.r_multiple.toFixed(2)}</td>
                                        <td className="py-1.5 text-[12px] text-faint">
                                            {t.log.slice(1).map((l) => `${l.side === 'buy' ? '+' : '−'}${quarters(l.shares, t.log[0].shares)} ${l.reason}`).join(' · ') || '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {trades.length > 8 && (
                            <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-[12px] font-semibold text-brand-ink hover:underline">
                                {showAll ? 'Show fewer' : `Show all ${trades.length} trades`}
                            </button>
                        )}
                    </div>

                    <p className="text-[12px] text-faint">
                        {result.start} to {result.end} · ${result.assumptions.start_equity.toLocaleString('en-US')} start, all-in per trade, {result.assumptions.cost_per_side_pct}% cost per side.
                        Signals on the daily close, filled at the next open; stops and the 4R target fill intraday. Past results don’t predict future returns.
                    </p>
                </>
            )}
        </div>
    );
}
