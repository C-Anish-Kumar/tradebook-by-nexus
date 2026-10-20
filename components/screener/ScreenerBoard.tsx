'use client';

import { Fragment, useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, ListFilter, Loader2, Plus, Radar } from 'lucide-react';
import { toast } from 'sonner';
import Panel from '@/components/Panel';
import { requestScreenerRun, type ScreenerData } from '@/lib/actions/screener.actions';
import { takePosition } from '@/lib/actions/risk.actions';
import { UNIVERSES, type Universe } from '@/config/universes';
import { filterRows, positionFor, SIGNAL_LABEL, sortRows, type ScreenerFilter, type Signal } from '@/lib/screener';
import { PLAN_LABEL, regimeLabel, regimeOpen, type PlanDecision } from '@/lib/risk';
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
    const eff = data.universes[universe.id];
    const risk = eff.risk;
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
                <span>Regime gate {eff.regimeGate ? 'on' : 'off'}</span>
                <span>Telegram {eff.telegram.enabled ? `on, score ${eff.telegram.minScore}+` : 'off'}</span>
                <Link href="/positions" className="text-brand-ink hover:underline">Change</Link>
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

const PLAN_SHORT: Record<PlanDecision['reason'], string> = {
    fits: 'Fits', held: 'Held', duplicate: 'Duplicate', account_kill: 'Account stop', kill_switch: 'Kill switch', regime: 'Risk-off',
    too_wide: 'Stop too wide', max_positions: 'Max positions', sector_cap: 'Sector cap', universe_cap: 'Universe cap', cash: 'No cash',
};

function PlanCell({ decision }: { decision: PlanDecision }) {
    const fits = decision.reason === 'fits';
    return <span className={cn('pill', fits ? 'is-up' : 'text-faint')} title={PLAN_LABEL[decision.reason]}>{fits && <Check />}{PLAN_SHORT[decision.reason]}</span>;
}

/** Records a trade you placed at your broker: your fill and share count. The stop and 2R target come from the scan. */
function TakeForm({ rowId, ticker, shares, entry, stop, onDone }: { rowId: string; ticker: string; shares: number; entry: number; stop: number; onDone: () => void }) {
    const [qty, setQty] = useState(String(shares));
    const [price, setPrice] = useState(String(entry));
    const [busy, setBusy] = useState(false);
    const field = 'h-8 w-28 rounded-[8px] bg-card px-2 text-[13px] text-foreground shadow-[inset_0_0_0_1px_var(--line)] outline-none focus:shadow-[inset_0_0_0_1px_var(--brand)]';
    const save = async () => {
        setBusy(true);
        const res = await takePosition({ rowId, shares: Number(qty), entry: Number(price) });
        setBusy(false);
        if ('error' in res) toast.error(res.error);
        else {
            toast.success(`${ticker} recorded. You'll get a Telegram message when it should be closed.`);
            onDone();
        }
    };
    return (
        <div className="flex flex-wrap items-end gap-3 py-2 text-[12px] text-faint">
            <span className="self-center text-[13px] text-foreground">Record that you bought <b>{ticker}</b>:</span>
            <label className="flex flex-col gap-1">Shares<input inputMode="numeric" className={field} value={qty} onChange={(e) => setQty(e.target.value)} /></label>
            <label className="flex flex-col gap-1">Your fill<input inputMode="decimal" className={field} value={price} onChange={(e) => setPrice(e.target.value)} /></label>
            <span className="self-center">Stop {usd(stop)}</span>
            <button type="button" className="btn btn-primary h-8" onClick={save} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Check />} Save position</button>
            <span className="self-center">Nothing is ordered: place the trade at your broker first.</span>
        </div>
    );
}

export default function ScreenerBoard({ data }: { data: ScreenerData }) {
    const router = useRouter();
    const [tab, setTab] = useState<string>(UNIVERSES[0].id);
    const [filter, setFilter] = useState<ScreenerFilter>({});
    const [pending, start] = useTransition();
    const [planOnly, setPlanOnly] = useState(false);
    const [taking, setTaking] = useState<string | null>(null);
    const strategies = scannerStrategies();
    const account = data.settings.accountSize;
    const held = useMemo(() => new Set(data.held), [data.held]);

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
    const rows = useMemo(
        () => sortRows(filterRows(inTab, filter)).filter((r) => !planOnly || data.plan[r.id]?.reason === 'fits'),
        [inTab, filter, planOnly, data.plan],
    );

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
                            Runs every weekday at 5:20 PM New York time. Account {usd(account)} (<Link href="/positions" className="text-brand-ink hover:underline">change</Link>); position sizes come from each universe&apos;s risk per trade and the stop.
                        </span>
                        {data.run && (
                            <span className={regimeOpen(data.run.market) ? 'text-muted-foreground' : 'text-down'}>{regimeLabel(data.run.market)}</span>
                        )}
                        {data.accountKilled && <span className="text-down">Account kill switch is on: no entry fits your plan until you reset it on the Positions page.</span>}
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
                    const entries = data.rows.filter((r) => r.universe === u.id && r.signal === 'entry');
                    const fits = entries.filter((r) => data.plan[r.id]?.reason === 'fits').length;
                    return (
                        <button key={u.id} type="button" onClick={() => pickTab(u.id)} aria-pressed={u.id === universe.id}
                                className={cn('pill h-8 px-3 text-[13px]', u.id === universe.id && 'is-brand')}>
                            {u.name}
                            {entries.length > 0 && <span className="num opacity-80"> · {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}, {fits} fit{fits === 1 ? 's' : ''}</span>}
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
                    <label className="flex h-9 items-center gap-2 text-[13px] text-muted-foreground">
                        <input type="checkbox" checked={planOnly} onChange={(e) => setPlanOnly(e.target.checked)} />
                        Fits my plan
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
                                    <th className="is-num">Risk/sh</th><th className="is-num">Size</th><th>Plan</th><th>Regime</th><th>Sector</th>
                                    <th>Scan</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => {
                                    const decision = data.plan[r.id];
                                    const size = decision ?? positionFor(r, account, data.universes[r.universe]?.risk.riskPctPerTrade);
                                    const href = `/stocks/${encodeURIComponent(r.ticker)}?strategy=${r.strategy}`;
                                    const canTake = r.signal === 'entry' && r.stop != null && !held.has(r.ticker);
                                    return (
                                        <Fragment key={r.id}>
                                        <tr className="cursor-pointer" onClick={() => router.push(href)}>
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
                                            <td className="is-num num" title={size ? `Risking ${size.riskPct}% of ${usd(account)} = ${usd(size.risk)}` : undefined}>
                                                {size && size.shares > 0 ? <>{size.shares} sh <span className="text-faint">({compact(size.cost)})</span></> : '–'}
                                            </td>
                                            <td className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                                {decision ? <PlanCell decision={decision} /> : r.signal === 'entry' ? null : <span className="text-faint">–</span>}
                                                {canTake && (
                                                    <button type="button" className="btn btn-ghost ml-1 h-7 px-2 text-[12px]" onClick={() => setTaking(taking === r.id ? null : r.id)}>
                                                        <Plus /> Take
                                                    </button>
                                                )}
                                                {held.has(r.ticker) && r.signal !== 'entry' && <span className="pill is-brand">Holding</span>}
                                            </td>
                                            <td className="text-muted-foreground">{[r.regime.trend, r.regime.vol && `${r.regime.vol} vol`].filter(Boolean).join(', ') || '–'}</td>
                                            <td className="text-muted-foreground">{r.sector ?? '–'}</td>
                                            <td className="num text-faint">{r.scanDate}</td>
                                        </tr>
                                        {taking === r.id && (
                                            <tr>
                                                <td colSpan={14} className="bg-page">
                                                    <TakeForm rowId={r.id} ticker={r.ticker} shares={decision?.shares || size?.shares || 1} entry={r.entry ?? r.close}
                                                              stop={r.stop!} onDone={() => { setTaking(null); router.refresh(); }} />
                                                </td>
                                            </tr>
                                        )}
                                        </Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Panel>

            <p className="px-1 text-[12px] text-faint">
                &ldquo;Fits your plan&rdquo; takes tonight&apos;s entries best score first and keeps those that fit together within your caps, open positions, the market regime and the kill switches. &ldquo;Take&rdquo; only records a trade you placed yourself.
            </p>
            <p className="px-1 text-[12px] text-faint">
                Research tooling, not financial advice; nothing here trades. Scores are a checklist out of 100, capped at 69 until the strategy passes every validation gate in this universe. New strategies and universes start unvalidated: paper-trade them first.
            </p>
        </div>
    );
}
