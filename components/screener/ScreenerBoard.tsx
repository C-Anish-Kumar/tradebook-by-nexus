'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, ListFilter, Loader2, Radar } from 'lucide-react';
import { toast } from 'sonner';
import Panel from '@/components/Panel';
import { requestScreenerRun, type ScreenerData } from '@/lib/actions/screener.actions';
import { ACCOUNT, UNIVERSES, riskFor, type Universe } from '@/config/universes';
import { filterRows, positionFor, SIGNAL_LABEL, sortRows, type ScreenerFilter, type Signal } from '@/lib/screener';
import { STRATEGIES, scannerStrategies, type StrategyId } from '@/lib/strategies';
import { cn } from '@/lib/utils';

const TAB_KEY = 'tradebook-screener-tab';
const usd = (n: number | null | undefined) => (n == null ? '–' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const compact = (n: number | null | undefined) => (n == null ? '–' : n < 1000 ? `$${Math.round(n)}` : `$${Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)}`);
const SIGNAL_TONE: Record<Signal, string> = { entry: 'is-up', exit: 'is-down', watch: 'is-brand', holding: '', none: '' };
const GATE_LABEL: Record<string, string> = {
    lookahead: 'No lookahead',
    oos_profitable: 'Profitable out of sample',
    cost_stress_2x: 'Survives 2x costs',
    beats_baselines: 'Beats buy-and-hold and MA cross',
    deflated_sharpe: 'Deflated Sharpe ≥ 0.95',
    min_trades: 'Enough trades',
};

const scoreTone = (s: number) => (s >= 65 ? 'text-up' : s >= 50 ? 'text-brand-ink' : s >= 35 ? 'text-warn' : 'text-down');

function UniverseHeader({ universe, data }: { universe: Universe; data: ScreenerData }) {
    const risk = riskFor(universe);
    const summary = data.run?.universes[universe.id];
    return (
        <div className="flex flex-col gap-3 p-4 text-[12.5px]">
            <p className="text-muted-foreground">{universe.description}.</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-faint">
                <span>{summary ? `${summary.memberCount} stocks (${summary.allMembers} before de-duplication)` : 'Not scanned yet'}</span>
                <span>Risk {risk.riskPctPerTrade}% a trade</span>
                <span>Up to {risk.maxOpenPositions} positions</span>
                <span>Sector cap {risk.maxSectorExposurePct}%</span>
                {risk.maxTotalExposurePct < 100 && <span>Universe cap {risk.maxTotalExposurePct}% of the account</span>}
                <span>Slippage {universe.slippageBps} bps a side</span>
                <span>Telegram {universe.telegram.enabled ? `on, score ${universe.telegram.minScore}+` : 'off'}</span>
            </div>
            {summary && (
                <div className="flex flex-wrap gap-2">
                    {Object.entries(summary.validation).map(([sid, ev]) => {
                        const failed = Object.entries(ev.gates).filter(([, ok]) => !ok).map(([g]) => GATE_LABEL[g] ?? g);
                        return (
                            <span key={sid} className={cn('pill', ev.validated && 'is-up')}
                                  title={ev.validated
                                      ? `Passed every gate on ${ev.sample} sampled stocks: out-of-sample Sharpe ${ev.oos_sharpe}, ${ev.trades} trades`
                                      : `Failed: ${failed.join(', ') || 'no usable history'}. Sharpe ${ev.oos_sharpe ?? 'n/a'} over ${ev.sample} sampled stocks, ${ev.trades ?? 0} trades`}>
                                {ev.validated ? <Check /> : <AlertTriangle />}
                                {STRATEGIES[sid as StrategyId]?.name ?? sid}: {ev.validated ? 'validated' : 'unvalidated'}
                            </span>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default function ScreenerBoard({ data }: { data: ScreenerData }) {
    const router = useRouter();
    const [tab, setTab] = useState<string>(UNIVERSES[0].id);
    const [filter, setFilter] = useState<ScreenerFilter>({});
    const [pending, start] = useTransition();
    const strategies = scannerStrategies();

    useEffect(() => {
        try {
            const saved = localStorage.getItem(TAB_KEY);
            if (saved && UNIVERSES.some((u) => u.id === saved)) setTab(saved);
        } catch { /* storage unavailable */ }
    }, []);
    const pickTab = (id: string) => {
        setTab(id);
        setFilter((f) => ({ ...f, sector: undefined }));
        try { localStorage.setItem(TAB_KEY, id); } catch { /* ignore */ }
    };

    const universe = UNIVERSES.find((u) => u.id === tab) ?? UNIVERSES[0];
    const inTab = useMemo(() => data.rows.filter((r) => r.universe === universe.id), [data.rows, universe.id]);
    const sectors = useMemo(() => [...new Set(inTab.map((r) => r.sector).filter((s): s is string => !!s))].sort(), [inTab]);
    const rows = useMemo(() => sortRows(filterRows(inTab, filter)), [inTab, filter]);

    const run = () => start(async () => {
        const res = await requestScreenerRun();
        if ('error' in res) toast.error(res.error);
        else toast.success('Scan started. A full scan takes 20-60 minutes; this page shows the result when it is done.');
    });

    const set = (patch: Partial<ScreenerFilter>) => setFilter((f) => ({ ...f, ...patch }));
    const field = 'h-9 rounded-[10px] bg-page px-3 text-[13px] text-foreground shadow-[inset_0_0_0_1px_var(--line)] outline-none focus:shadow-[inset_0_0_0_1px_var(--brand)]';

    return (
        <div className="flex flex-col gap-3">
            <Panel>
                <div className="flex flex-wrap items-center gap-3 p-4 text-[12.5px]">
                    <div className="flex flex-col gap-0.5">
                        <span className="text-foreground">
                            {data.run ? <>Last scan: daily bar of <b>{data.run.scanDate ?? '–'}</b></> : 'No scan has finished yet'}
                        </span>
                        <span className="text-faint">
                            Runs every weekday at 5:20 PM New York time. Account {usd(ACCOUNT.size)}; position sizes come from each universe&apos;s risk per trade and the stop.
                        </span>
                        {data.latest?.status === 'running' && <span className="text-brand-ink">A scan started {new Date(data.latest.startedAt).toLocaleString()} is still running.</span>}
                        {data.latest?.status === 'error' && <span className="text-down">The last scan failed: {data.latest.error}</span>}
                        {data.run?.problems.map((p) => <span key={p} className="text-warn">{p}</span>)}
                    </div>
                    <button type="button" onClick={run} disabled={pending} className="btn btn-primary ml-auto">
                        {pending ? <Loader2 className="animate-spin" /> : <Radar />} Run scan now
                    </button>
                </div>
            </Panel>

            <nav aria-label="Universe" className="flex flex-wrap gap-2">
                {UNIVERSES.map((u) => {
                    const count = data.rows.filter((r) => r.universe === u.id && r.signal === 'entry').length;
                    return (
                        <button key={u.id} type="button" onClick={() => pickTab(u.id)} aria-pressed={u.id === universe.id}
                                className={cn('pill h-8 px-3 text-[13px]', u.id === universe.id && 'is-brand')}>
                            {u.name}{count > 0 && <span className="num opacity-80"> · {count} entr{count === 1 ? 'y' : 'ies'}</span>}
                        </button>
                    );
                })}
            </nav>

            <Panel title={universe.name}>
                <UniverseHeader universe={universe} data={data} />
            </Panel>

            <Panel>
                <div className="flex flex-wrap items-end gap-3 p-4 text-[12px] text-faint">
                    <label className="flex flex-col gap-1">
                        Strategy
                        <select className={field} value={filter.strategy ?? ''} onChange={(e) => set({ strategy: e.target.value || undefined })}>
                            <option value="">All strategies</option>
                            {strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    </label>
                    <label className="flex flex-col gap-1">
                        Signal
                        <select className={field} value={filter.signal ?? ''} onChange={(e) => set({ signal: (e.target.value || undefined) as Signal | undefined })}>
                            <option value="">All signals</option>
                            {(['entry', 'watch', 'holding', 'exit'] as Signal[]).map((s) => <option key={s} value={s}>{SIGNAL_LABEL[s]}</option>)}
                        </select>
                    </label>
                    <label className="flex flex-col gap-1">
                        Sector
                        <select className={field} value={filter.sector ?? ''} onChange={(e) => set({ sector: e.target.value || undefined })}>
                            <option value="">All sectors</option>
                            {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </label>
                    <label className="flex flex-col gap-1">
                        Min score
                        <input inputMode="numeric" className={cn(field, 'w-24')} value={filter.minScore ?? ''} placeholder="0"
                               onChange={(e) => set({ minScore: e.target.value === '' ? undefined : Number(e.target.value) || 0 })} />
                    </label>
                    <label className="flex h-9 items-center gap-2 text-[13px] text-muted-foreground">
                        <input type="checkbox" checked={!!filter.validatedOnly} onChange={(e) => set({ validatedOnly: e.target.checked || undefined })} />
                        Validated only
                    </label>
                    <span className="ml-auto self-center">{rows.length} of {inTab.length} rows</span>
                </div>

                {rows.length === 0 ? (
                    <div className="empty-state py-12">
                        <span className="empty-icon"><ListFilter className="size-5" /></span>
                        <h3>{inTab.length ? 'Nothing matches these filters' : data.run ? 'Nothing in play in this universe' : 'Waiting for the first scan'}</h3>
                        <p className="max-w-96 text-[13px]">
                            {data.run ? 'Only stocks with an entry, watch, holding or exit signal are listed.' : 'Run a scan now, or wait for this evening.'}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="data-table text-[13px]">
                            <thead>
                                <tr>
                                    <th>Ticker</th><th>Strategy</th><th>Signal</th><th className="is-num">Score</th><th>Validated</th>
                                    <th className="is-num">Entry</th><th className="is-num">Stop</th><th className="is-num">2R / 3R</th>
                                    <th className="is-num">Risk/sh</th><th className="is-num">Size</th><th>Regime</th><th>Sector</th>
                                    <th>Scan</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => {
                                    const size = positionFor(r);
                                    const href = `/stocks/${encodeURIComponent(r.ticker)}?strategy=${r.strategy}`;
                                    return (
                                        <tr key={r.id} className="cursor-pointer" onClick={() => router.push(href)}>
                                            <td className="py-2">
                                                <Link href={href} onClick={(e) => e.stopPropagation()} className="mono font-semibold text-foreground hover:text-brand-ink">{r.ticker}</Link>
                                                {r.name && <span className="ml-2 inline-block max-w-40 truncate align-bottom text-[12px] text-faint">{r.name}</span>}
                                                {(r.tags.length > 0 || r.badges.length > 0) && (
                                                    <div className="mt-1 mr-2 flex w-72 flex-wrap gap-1 whitespace-normal">
                                                        {r.tags.map((t) => <span key={t} className="pill" title="Also in this universe">{t}</span>)}
                                                        {r.badges.map((b) => <span key={b.code} className="pill h-auto py-0.5 text-left whitespace-normal text-warn" title={b.label}><AlertTriangle />{b.label}</span>)}
                                                    </div>
                                                )}
                                            </td>
                                            <td>{STRATEGIES[r.strategy]?.name ?? r.strategy}</td>
                                            <td><span className={cn('pill', SIGNAL_TONE[r.signal])}>{SIGNAL_LABEL[r.signal]}</span></td>
                                            <td className="is-num">
                                                <span className={cn('num font-semibold', scoreTone(r.score))}>{r.score}</span>
                                                <span className="text-faint">{r.capped ? ' · capped' : ''}</span>
                                            </td>
                                            <td>{r.validated ? <span className="text-up">Yes</span> : <span className="text-faint">No</span>}</td>
                                            <td className="is-num num">{usd(r.entry)}</td>
                                            <td className="is-num num">{usd(r.stop)}</td>
                                            <td className="is-num num">{r.target2r == null ? '–' : `${usd(r.target2r)} / ${usd(r.target3r)}`}</td>
                                            <td className="is-num num">{usd(r.riskPerShare)}</td>
                                            <td className="is-num num" title={size ? `Risking ${size.riskPct}% of ${usd(ACCOUNT.size)} = ${usd(size.risk)}` : undefined}>
                                                {size ? <>{size.shares} sh <span className="text-faint">({compact(size.cost)}{size.capped ? ', cash-capped' : ''})</span></> : '–'}
                                            </td>
                                            <td className="text-muted-foreground">{[r.regime.trend, r.regime.vol && `${r.regime.vol} vol`].filter(Boolean).join(', ') || '–'}</td>
                                            <td className="text-muted-foreground">{r.sector ?? '–'}</td>
                                            <td className="num text-faint">{r.scanDate}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Panel>

            <p className="px-1 text-[12px] text-faint">
                Research tooling, not financial advice; nothing here trades. Scores are a checklist out of 100, capped at 69 until the strategy passes every validation gate in this universe. New strategies and universes start unvalidated: paper-trade them first.
            </p>
        </div>
    );
}
