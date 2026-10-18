"use client";

import { useEffect, useMemo, useState } from "react";
import { BrainCircuit, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getRlRun, listRlRuns, requestRlRun, type RlRunSummary } from "@/lib/actions/rl.actions";
import { TEMPLATES, type Algo, type Metrics, type PeriodResult, type RunResult, type SweepResult, type TemplateName } from "@/lib/nexus";
import Panel from "@/components/Panel";
import EquityChart from "@/components/stocks/EquityChart";
import { cn } from "@/lib/utils";

const POLL_MS = 15_000;
const LENGTHS = [
    { steps: 20_000, label: 'Quick', note: '~2 min' },
    { steps: 50_000, label: 'Standard', note: '~5 min' },
    { steps: 150_000, label: 'Long', note: '~15 min' },
];
const SWEEP_ALGOS: Algo[] = ['ppo', 'a2c', 'sac'];
const CALL: Record<RunResult['verdict']['call'], { label: string; cls: string }> = {
    edge: { label: 'Edge', cls: 'is-up' },
    defensive: { label: 'Defensive', cls: 'is-brand' },
    no_edge: { label: 'No edge', cls: 'is-down' },
};

const pct = (n: number | null | undefined, signed = false) =>
    n === null || n === undefined || !Number.isFinite(n) ? '—' : `${signed && n > 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
const ratio = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(2));
const templateLabel = (name: string) => TEMPLATES.find((t) => t.name === name)?.label ?? name;
const minutesSince = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
const isSweep = (r: RunResult | SweepResult): r is SweepResult => 'leaderboard' in r;

function friendlyError(error?: string) {
    const raw = error ?? '';
    if (/no longer has this job|restarted/i.test(raw)) return 'The Nexus service restarted during training. Please run it again.';
    if (/took too long/i.test(raw)) return 'Training took too long and was stopped. Try a shorter length.';
    if (/401|Nexus key/i.test(raw)) return 'Tradebook and the Nexus service have different NEXUS_API_KEY values.';
    if (/no data|returned no data/i.test(raw)) return `No price history: ${raw.replace(/^\w+Error: /, '')}`;
    return raw ? `Training failed: ${raw.replace(/^\w+Error: /, '')}` : 'Training failed. Please try again.';
}

export default function RlLab({ initialRuns, initialSelected }: { initialRuns: RlRunSummary[]; initialSelected: RlRunSummary | null }) {
    const [runs, setRuns] = useState(initialRuns);
    const [selected, setSelected] = useState(initialSelected);
    const [template, setTemplate] = useState<TemplateName>('etf_rotation');
    const [tickers, setTickers] = useState('');
    const [mode, setMode] = useState<'run' | 'sweep'>('run');
    const [steps, setSteps] = useState(50_000);
    const [algos, setAlgos] = useState<Algo[]>(['ppo', 'a2c']);
    const [seeds, setSeeds] = useState(2);
    const [starting, setStarting] = useState(false);
    const [, setTick] = useState(0);

    const pending = runs.find((r) => r.status === 'queued' || r.status === 'running');

    // While training, check back until it lands, then open the result
    useEffect(() => {
        if (!pending) return;
        const timer = setInterval(async () => {
            try {
                const latest = await getRlRun(pending.id);
                setTick((t) => t + 1);
                if (!latest || latest.status === 'queued' || latest.status === 'running') return;
                setRuns(await listRlRuns());
                if (latest.status === 'done') {
                    setSelected(latest);
                    toast.success(`${templateLabel(latest.template)} finished training`);
                }
            } catch (error) {
                console.error('Failed to refresh RL run:', error);
            }
        }, POLL_MS);
        return () => clearInterval(timer);
    }, [pending]);

    const start = async () => {
        setStarting(true);
        try {
            const res = await requestRlRun({
                kind: mode,
                template,
                tickers: tickers.split(/[\s,]+/).filter(Boolean),
                timesteps: steps,
                algo: 'ppo',
                algos,
                seeds,
            });
            if ('error' in res) {
                toast.error(res.error);
                return;
            }
            setRuns((cur) => [res.data, ...cur]);
        } catch {
            toast.error('Couldn’t start training. Check your connection and try again.');
        } finally {
            setStarting(false);
        }
    };

    const open = async (id: string) => {
        const run = await getRlRun(id);
        if (run) setSelected(run);
    };

    const chosen = TEMPLATES.find((t) => t.name === template)!;
    const agents = mode === 'sweep' ? algos.length * seeds : 1;

    return (
        <div className="flex flex-col gap-3">
            <Panel title="Strategy" sub="Pick what to trade; the agent learns from history up to 2024 and is judged on 2025 onward">
                <div className="flex flex-col gap-4 p-4">
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" role="radiogroup" aria-label="Strategy template">
                        {TEMPLATES.map((t) => (
                            <button key={t.name} type="button" role="radio" aria-checked={t.name === template} onClick={() => setTemplate(t.name)}
                                    className={cn('flex flex-col gap-1 rounded-[12px] p-3 text-left shadow-[inset_0_0_0_1px_var(--line)] hover:bg-hover',
                                        t.name === template && 'bg-brand-soft/60 shadow-[inset_0_0_0_1px_var(--brand)]')}>
                                <span className="text-[13px] font-semibold">{t.label}</span>
                                <span className="num text-[12px] text-muted-foreground">{t.tickers.join(' · ')}</span>
                                <span className="text-[12px] text-faint">{t.about}</span>
                            </button>
                        ))}
                    </div>

                    <div className="flex flex-wrap items-end gap-3">
                        <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12px] text-muted-foreground sm:max-w-80">
                            Your own tickers (optional)
                            <input value={tickers} onChange={(e) => setTickers(e.target.value.toUpperCase())}
                                   placeholder={chosen.tickers.join(', ')}
                                   className="h-9 rounded-[10px] bg-page px-3 text-[13px] text-foreground shadow-[inset_0_0_0_1px_var(--line)] outline-none focus:shadow-[inset_0_0_0_1px_var(--brand)]" />
                        </label>
                        <Segmented label="Mode" value={mode} onChange={setMode}
                                   options={[{ value: 'run', label: 'One agent' }, { value: 'sweep', label: 'Sweep' }]} />
                        <Segmented label="Training" value={steps} onChange={setSteps}
                                   options={LENGTHS.map((l) => ({ value: l.steps, label: l.label, title: l.note }))} />
                    </div>

                    {mode === 'sweep' && (
                        <div className="flex flex-wrap items-end gap-3">
                            <fieldset className="flex flex-col gap-1">
                                <legend className="mb-1 text-[12px] text-muted-foreground">Algorithms</legend>
                                <div className="flex gap-1.5">
                                    {SWEEP_ALGOS.map((a) => (
                                        <button key={a} type="button" aria-pressed={algos.includes(a)}
                                                onClick={() => setAlgos((cur) => cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a])}
                                                className={cn('pill uppercase', algos.includes(a) && 'is-brand')}>{a}</button>
                                    ))}
                                </div>
                            </fieldset>
                            <Segmented label="Seeds each" value={seeds} onChange={setSeeds}
                                       options={[1, 2, 3].map((n) => ({ value: n, label: String(n) }))} />
                            <p className={cn('text-[12px]', agents > 6 ? 'text-down' : 'text-faint')}>
                                {agents} agent{agents === 1 ? '' : 's'} (max 6). The best is chosen on 2024 only, so its 2025+ result stays honest.
                            </p>
                        </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3">
                        <button type="button" onClick={start} className="btn btn-primary"
                                disabled={starting || Boolean(pending) || agents === 0 || agents > 6}>
                            {starting ? <Loader2 className="animate-spin" /> : <BrainCircuit />}
                            {mode === 'sweep' ? 'Run sweep' : 'Train agent'}
                        </button>
                        {pending && (
                            <p className="flex items-center gap-2 text-[13px]">
                                <Loader2 className="size-4 animate-spin" />
                                Training {templateLabel(pending.template)}
                                {minutesSince(pending.createdAt) > 0 && ` (${minutesSince(pending.createdAt)} min so far)`}. You can leave this page.
                            </p>
                        )}
                    </div>
                </div>
            </Panel>

            {selected?.result && (isSweep(selected.result)
                ? <SweepView sweep={selected.result} />
                : <RunView run={selected.result} />)}

            {runs.length > 0 && (
                <Panel title="Your runs" sub="The last 20">
                    <ul className="flex flex-col p-2">
                        {runs.map((r) => (
                            <li key={r.id}>
                                <button type="button" onClick={() => open(r.id)} disabled={r.status !== 'done'}
                                        className={cn('flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] px-2 py-2 text-left text-[13px] enabled:hover:bg-hover',
                                            selected?.id === r.id && 'bg-brand-soft/60')}>
                                    <span className="font-semibold">{templateLabel(r.template)}</span>
                                    <span className="text-muted-foreground">
                                        {r.kind === 'sweep' ? `sweep · ${r.algos.join('/').toUpperCase()} × ${r.seeds}` : (r.algos[0] ?? 'ppo').toUpperCase()}
                                        {' · '}{(r.timesteps / 1000).toFixed(0)}k steps
                                        {r.tickers.length > 0 && ` · ${r.tickers.join(', ')}`}
                                    </span>
                                    <span className="flex-1" />
                                    {r.status === 'error' && <span className="text-down" title={r.error}>{friendlyError(r.error)}</span>}
                                    {(r.status === 'queued' || r.status === 'running') && <Loader2 className="size-4 animate-spin" />}
                                    <span className="text-[12px] text-faint">{new Date(r.createdAt).toLocaleString()}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </Panel>
            )}

            <p className="text-[12px] text-faint">
                Daily data from Yahoo Finance, 0.1% cost per trade (0.2% for crypto), risk limits on. Agents built with Nexus on FinRL and Stable-Baselines3.
                A good backtest is not a promise: most agents that beat the market on paper don’t live. Not financial advice.
            </p>
        </div>
    );
}

function Segmented<T extends string | number>({ label, value, onChange, options }: {
    label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string; title?: string }[];
}) {
    return (
        <div className="flex flex-col gap-1">
            <span className="text-[12px] text-muted-foreground">{label}</span>
            <div className="flex rounded-[10px] p-0.5 shadow-[inset_0_0_0_1px_var(--line)]" role="group" aria-label={label}>
                {options.map((o) => (
                    <button key={String(o.value)} type="button" onClick={() => onChange(o.value)} aria-pressed={o.value === value} title={o.title}
                            className={cn('h-8 rounded-[8px] px-3 text-[13px] font-semibold',
                                o.value === value ? 'bg-brand-soft text-brand-ink' : 'text-muted-foreground hover:text-foreground')}>
                        {o.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

function RunView({ run }: { run: RunResult }) {
    const s = run.strategy;
    const call = CALL[run.verdict.call];
    // EquityChart shows growth of $10,000; Nexus simulates $100,000
    const points = useMemo(() => {
        const hold = new Map(run.test.curves.buy_and_hold);
        return run.test.curves.agent.map(([date, v]) => ({ date, strategy: v / 10, buy_hold: (hold.get(date) ?? v) / 10 }));
    }, [run]);

    return (
        <>
            <Panel title={`${templateLabel(s.name)} · ${s.algo.toUpperCase()}`}
                   sub={`${s.tickers.join(', ')} · trained ${s.train_start} to ${s.val_start}, tested ${run.test.start} to ${run.test.end}`}>
                <div className="flex flex-col gap-3 p-4">
                    <p className="flex flex-wrap items-center gap-2 text-[13px]">
                        <span className={cn('pill', call.cls)}>{call.label}</span>
                        <span>{run.verdict.text}</span>
                    </p>
                    <MetricsTable period={run.test} benchmark={s.benchmark} caption="Test period: data the agent never saw" />
                </div>
            </Panel>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
                <Panel title="Agent vs buy and hold" sub={`Same tickers, test period ${run.test.start} to ${run.test.end}`}>
                    <div className="p-4"><EquityChart points={points} labels={['Agent', 'Buy & hold']} /></div>
                </Panel>
                <Panel title="Today’s signal" sub={`What the agent would do on ${run.signal.as_of}`}>
                    <ul className="flex flex-col gap-2 p-4">
                        {Object.entries(run.signal.action).map(([t, a]) => (
                            <li key={t} className="grid grid-cols-[80px_56px_1fr_52px] items-center gap-2 text-[13px]">
                                <span className="num font-semibold">{t}</span>
                                <span className={cn('pill justify-center uppercase', a === 'buy' ? 'is-up' : a === 'sell' ? 'is-down' : '')}>{a}</span>
                                <span className="h-2 rounded-full bg-hover" aria-hidden>
                                    <span className="block h-2 rounded-full" style={{ width: `${(run.test.final_weights[t] ?? 0) * 100}%`, background: '#199e70' }} />
                                </span>
                                <span className="num text-right">{pct(run.test.final_weights[t])}</span>
                            </li>
                        ))}
                        <li className="grid grid-cols-[80px_56px_1fr_52px] items-center gap-2 text-[13px] text-muted-foreground">
                            <span>Cash</span><span /><span />
                            <span className="num text-right">{pct(run.test.final_weights.CASH)}</span>
                        </li>
                        <li className="pt-1 text-[12px] text-faint">
                            Bars show the agent’s holdings at the end of the test. {run.verdict.call !== 'edge' && 'It showed no edge, so don’t act on this signal.'}
                        </li>
                    </ul>
                </Panel>
            </div>

            <Panel title="Validation period" sub={`${run.validation.start} to ${run.validation.end}: used to pick agents in a sweep`}>
                <div className="p-4"><MetricsTable period={run.validation} benchmark={s.benchmark} caption="Validation period results" /></div>
            </Panel>
        </>
    );
}

function MetricsTable({ period, benchmark, caption }: { period: PeriodResult; benchmark: string; caption: string }) {
    const rows: [string, Metrics, boolean][] = [
        ['Agent', period.agent, true],
        ['Buy & hold (same tickers)', period.buy_and_hold, false],
        [`${benchmark} (benchmark)`, period.benchmark, false],
    ];
    return (
        <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px]">
                <caption className="sr-only">{caption}</caption>
                <thead className="text-[11px] uppercase tracking-wide text-faint">
                    <tr>
                        <th className="py-1.5 pr-3 font-semibold" />
                        <th className="py-1.5 pl-3 text-right font-semibold">Return</th>
                        <th className="py-1.5 pl-3 text-right font-semibold">Return / yr</th>
                        <th className="py-1.5 pl-3 text-right font-semibold">Sharpe</th>
                        <th className="py-1.5 pl-3 text-right font-semibold">Sortino</th>
                        <th className="py-1.5 pl-3 text-right font-semibold">Max drawdown</th>
                        <th className="py-1.5 pl-3 text-right font-semibold">Worst 5% day</th>
                        <th className="py-1.5 pl-3 text-right font-semibold">Alpha / beta</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(([label, m, isAgent]) => (
                        <tr key={label} className={cn('border-t border-line', !isAgent && 'text-muted-foreground')}>
                            <th scope="row" className={cn('py-2 pr-3', isAgent ? 'font-semibold' : 'font-normal')}>{label}</th>
                            <td className={cn('num py-2 pl-3 text-right', isAgent && (m.total_return >= 0 ? 'text-up' : 'text-down'))}>{pct(m.total_return, true)}</td>
                            <td className="num py-2 pl-3 text-right">{pct(m.cagr, true)}</td>
                            <td className={cn('num py-2 pl-3 text-right', isAgent && 'font-semibold')}>{ratio(m.sharpe)}</td>
                            <td className="num py-2 pl-3 text-right">{ratio(m.sortino)}</td>
                            <td className="num py-2 pl-3 text-right">{pct(m.max_drawdown)}</td>
                            <td className="num py-2 pl-3 text-right">{pct(m.cvar_95)}</td>
                            <td className="num py-2 pl-3 text-right">{m.beta === null ? '—' : `${pct(m.alpha, true)} / ${ratio(m.beta)}`}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="mt-2 text-[12px] text-faint">
                {period.trades} trades, {period.costs.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} in costs
                {period.risk_events.length > 0 && `, drawdown stop hit ${period.risk_events.length}×`}. Worst 5% day is the average loss on the worst 5% of days.
            </p>
        </div>
    );
}

function SweepView({ sweep }: { sweep: SweepResult }) {
    return (
        <>
            <Panel title={`Sweep: ${sweep.candidates} agents`} sub="Ranked by validation Sharpe; the top row is the agent you would have picked">
                <div className="flex flex-col gap-3 overflow-x-auto p-4">
                    <p className="text-[13px]">{sweep.summary}</p>
                    <table className="w-full min-w-[560px] text-left text-[13px]">
                        <caption className="sr-only">Every agent in the sweep</caption>
                        <thead className="text-[11px] uppercase tracking-wide text-faint">
                            <tr>
                                <th className="py-1.5 pr-3 font-semibold">Agent</th>
                                <th className="py-1.5 pl-3 text-right font-semibold">Validation Sharpe</th>
                                <th className="py-1.5 pl-3 text-right font-semibold">Test return</th>
                                <th className="py-1.5 pl-3 text-right font-semibold">Test Sharpe</th>
                                <th className="py-1.5 pl-3 text-right font-semibold">Test max drawdown</th>
                                <th className="py-1.5 pl-3 font-semibold">Verdict</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sweep.leaderboard.map((r, i) => (
                                <tr key={r.run_id} className={cn('border-t border-line', i === 0 && 'bg-brand-soft/40')}>
                                    <th scope="row" className="num py-2 pr-3 font-semibold uppercase">{r.algo} · seed {r.seed}</th>
                                    <td className="num py-2 pl-3 text-right">{ratio(r.validation_sharpe)}</td>
                                    <td className={cn('num py-2 pl-3 text-right', (r.test_return ?? 0) >= 0 ? 'text-up' : 'text-down')}>{pct(r.test_return, true)}</td>
                                    <td className="num py-2 pl-3 text-right">{ratio(r.test_sharpe)}</td>
                                    <td className="num py-2 pl-3 text-right">{pct(r.test_max_drawdown)}</td>
                                    <td className="py-2 pl-3"><span className={cn('pill', CALL[r.call].cls)}>{CALL[r.call].label}</span></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Panel>
            <RunView run={sweep.best} />
        </>
    );
}
