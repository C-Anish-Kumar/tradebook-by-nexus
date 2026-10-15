import { Check, X } from "lucide-react";
import type { StrategyCheck, StrategySignals } from "@/lib/analyst";
import { cn } from "@/lib/utils";

const TONE: Record<StrategySignals['tone'], string> = { up: 'is-up', down: 'is-down', warn: '', neutral: '' };
const TREND: Record<StrategySignals['trend'], string> = { up: 'Uptrend', down: 'Downtrend', mixed: 'Mixed' };

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Checklist({ title, checks, hint }: { title: string; checks: StrategyCheck[]; hint: string }) {
    return (
        <div className="flex flex-col gap-2">
            <div>
                <p className="kicker">{title}</p>
                <p className="text-[12px] text-faint">{hint}</p>
            </div>
            <ul className="flex flex-col gap-1.5">
                {checks.map(({ rule, passed, detail }) => (
                    <li key={rule} className="flex gap-2 text-[13px]">
                        {passed
                            ? <Check className="mt-0.5 size-4 flex-none text-up" aria-label="Met" />
                            : <X className="mt-0.5 size-4 flex-none text-faint" aria-label="Not met" />}
                        <span className="min-w-0">
                            <span className={cn('font-semibold', passed ? 'text-foreground' : 'text-muted-foreground')}>{rule}</span>
                            <span className="block text-[12px] text-faint">{detail}</span>
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default function StrategyPanel({ signals }: { signals: StrategySignals }) {
    const { indicators: ind, risk } = signals;
    const stats = [
        ['10 EMA', fmt(ind.ema10)],
        ['21 EMA', fmt(ind.ema21)],
        ['50 DEMA', fmt(ind.dema50)],
        ['Supertrend', `${fmt(ind.supertrend)} ${ind.supertrend_up ? '▲' : '▼'}`],
    ];

    return (
        <div className="flex flex-col gap-5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('pill', TONE[signals.tone], signals.tone === 'warn' && 'text-warn')}>{signals.verdict}</span>
                    <span className="pill">{TREND[signals.trend]}</span>
                    {ind.weekly_supertrend_up !== null && (
                        <span className={cn('pill', ind.weekly_supertrend_up ? 'is-up' : 'is-down')}>
                            Weekly Supertrend {ind.weekly_supertrend_up ? 'green' : 'red'}
                        </span>
                    )}
                    {ind.supertrend_flipped_today && <span className="pill is-brand">Supertrend flipped today</span>}
                </div>
                <p className="num text-[12px] text-faint">Daily close {signals.date} · {fmt(signals.close)}</p>
            </div>

            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {stats.map(([label, value]) => (
                    <div key={label} className="rounded-[10px] bg-page px-3 py-2 shadow-[inset_0_0_0_1px_var(--line)]">
                        <dt className="kicker">{label}</dt>
                        <dd className="num text-[15px] font-semibold">{value}</dd>
                    </div>
                ))}
            </dl>

            <p className="text-[13px] text-muted-foreground">
                Suggested stop below the 10-day swing low: <b className="num text-foreground">{fmt(risk.stop)}</b>
                {risk.target_4r && <> · first target at 4R: <b className="num text-foreground">{fmt(risk.target_4r)}</b></>}
                {' '}(measured from today’s close).
            </p>

            <div className="grid gap-5 md:grid-cols-3">
                <Checklist title="Entry" hint="All four for a new long" checks={signals.entry} />
                <Checklist title="Staged exits" hint="For an open position" checks={signals.exits} />
                <Checklist title="Add-backs" hint="After trimming, Supertrend green" checks={signals.add_backs} />
            </div>

            <details className="group text-[13px] text-muted-foreground">
                <summary className="cursor-pointer font-semibold text-foreground">How the strategy works</summary>
                <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
                    <li>Trade with the trend: long only while the 10 EMA is above the 21 EMA and Supertrend (10,3) is green.</li>
                    <li>Enter on a pullback to the 10 or 21 EMA, or a breakout from a tight 3–5 day range, once a bullish candle confirms. Stop below the recent swing low.</li>
                    <li>Take profits in quarters: 25% at 4R, 25% on the 2nd close below the 10 EMA, 25% on the 2nd close below the 21 EMA, the rest on a lower high after the 10 EMA crosses under the 21 EMA.</li>
                    <li>Add back in quarters while Supertrend stays green: on a close back above the 10 EMA, back above the 21 EMA, a higher low after the crossover, and a breakout above the last pivot high.</li>
                    <li>The 50 DEMA and weekly Supertrend are context: dynamic support and the higher-timeframe trend.</li>
                </ul>
                <p className="mt-2 text-[12px] text-faint">Rule checks on daily candles from Yahoo Finance, refreshed every 15 minutes. Educational only, not financial advice; backtest before trading it.</p>
            </details>
        </div>
    );
}
