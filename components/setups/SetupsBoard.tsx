'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { Check, Loader2, Radar, X } from 'lucide-react';
import { toast } from 'sonner';
import Panel from '@/components/Panel';
import { requestSetupScan, type SetupRow } from '@/lib/actions/setups.actions';
import { QuantBadge, QuantBreakdown } from '@/components/setups/QuantBadge';
import { daysUntil, MAX_POSITIONS, STATUS_LABEL, sizeShares, sortSetups } from '@/lib/setups';
import { currencyOf, isCanadian } from '@/lib/symbols';
import { cn } from '@/lib/utils';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STORAGE_KEY = 'tradebook-setup-account';
const GATE_LABEL: Record<string, string> = {
    lookahead: 'No lookahead',
    oos_profitable: 'Profitable out-of-sample',
    cost_stress_2x: 'Survives 2x costs',
    beats_baselines: 'Beats buy-and-hold and MA cross',
    deflated_sharpe: 'Deflated Sharpe ≥ 0.95',
    min_trades: 'Enough trades',
};

export default function SetupsBoard({ rows }: { rows: SetupRow[] }) {
    const [account, setAccount] = useState('');
    const [riskPct, setRiskPct] = useState('1');
    const [pending, start] = useTransition();

    // Account size stays in this browser only; it never goes to the server
    useEffect(() => {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
            if (saved) { setAccount(saved.account ?? ''); setRiskPct(saved.riskPct ?? '1'); }
        } catch { /* storage unavailable */ }
    }, []);
    useEffect(() => {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ account, riskPct })); } catch { /* ignore */ }
    }, [account, riskPct]);

    const scan = () => start(async () => {
        const res = await requestSetupScan();
        if ('error' in res) toast.error(res.error);
        else toast.success('Scan started. Results appear here in a few minutes.');
    });

    const acct = Number(account);
    const risk = Number(riskPct);
    const sorted = sortSetups(rows.map((r) => ({ ...r, setup: r.stored?.setup ?? null })));
    // Swing limit: at most MAX_POSITIONS open at once, so only the top-ranked fresh entries are actionable
    const entries = sorted.filter((r) => r.setup?.status === 'entry').map((r) => r.symbol);

    return (
        <div className="flex flex-col gap-3">
            <Panel>
                <div className="flex flex-wrap items-end gap-3 p-4">
                    <label className="flex flex-col gap-1 text-[12px] text-faint">
                        Account size
                        <input inputMode="decimal" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="1000"
                               className="h-9 w-32 rounded-[10px] bg-page px-3 text-[13px] text-foreground shadow-[inset_0_0_0_1px_var(--line)] outline-none focus:shadow-[inset_0_0_0_1px_var(--brand)]" />
                    </label>
                    <label className="flex flex-col gap-1 text-[12px] text-faint">
                        Risk per trade %
                        <input inputMode="decimal" value={riskPct} onChange={(e) => setRiskPct(e.target.value)}
                               className="h-9 w-24 rounded-[10px] bg-page px-3 text-[13px] text-foreground shadow-[inset_0_0_0_1px_var(--line)] outline-none focus:shadow-[inset_0_0_0_1px_var(--brand)]" />
                    </label>
                    <button type="button" onClick={scan} disabled={pending} className="btn btn-primary ml-auto">
                        {pending ? <Loader2 className="animate-spin" /> : <Radar />} Scan now
                    </button>
                </div>
                <p className="px-4 pb-4 text-[12px] text-faint">
                    Scans run automatically after the US close. The quant score rates each setup out of 100 and is capped at 69 until every validation gate passes; an unvalidated setup is a hypothesis to paper-trade, not an edge.
                </p>
            </Panel>

            {sorted.length === 0 && (
                <Panel><div className="empty-state py-12"><h3>No US stocks on your watchlist</h3><p className="text-[13px]">Star a few stocks, then scan.</p></div></Panel>
            )}

            {sorted.map(({ symbol, stored, setup, earningsDate }) => (
                <Panel key={symbol}>
                    <div className="flex flex-col gap-3 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                            {setup?.quant && <QuantBadge quant={setup.quant} className="mr-1" />}
                            <Link href={`/stocks/${encodeURIComponent(symbol)}`} className="num text-[15px] font-semibold hover:underline">{symbol}</Link>
                            {setup ? (
                                <>
                                    <span className={cn('pill', setup.status === 'entry' && 'is-up', setup.status === 'watch' && 'is-brand')}>{STATUS_LABEL[setup.status]}</span>
                                    <span className={cn('pill', setup.evidence.validated ? 'is-up' : 'text-warn')}>{setup.evidence.validated ? 'Validated' : 'Unvalidated'}</span>
                                    <span className="pill">{setup.regime.trend ?? '—'} trend · {setup.regime.vol ?? '—'} vol</span>
                                    <span className="num ml-auto text-[12px] text-faint">Daily close {setup.date} · {fmt(setup.close)}</span>
                                </>
                            ) : (
                                <span className="text-[13px] text-faint">Not scanned yet</span>
                            )}
                        </div>

                        {setup?.plan && (() => {
                            const p = setup.plan;
                            const size = acct > 0 ? sizeShares(acct, risk, p.entry, p.stop) : null;
                            const stats: [string, string][] = [
                                ['Entry', fmt(p.entry)], ['Stop', fmt(p.stop)], ['Risk / share', `${fmt(p.risk_per_share)} (${p.risk_pct_of_price}%)`],
                                ['2R / 3R', `${fmt(p.target_2r)} / ${fmt(p.target_3r)}`],
                            ];
                            return (
                                <>
                                    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                        {stats.map(([k, v]) => (
                                            <div key={k} className="rounded-[10px] bg-page px-3 py-2 shadow-[inset_0_0_0_1px_var(--line)]">
                                                <dt className="kicker">{k}</dt><dd className="num text-[14px] font-semibold">{v}</dd>
                                            </div>
                                        ))}
                                    </dl>
                                    <p className="text-[13px] text-muted-foreground">
                                        {size ? <>At {risk}% risk on {fmt(acct)}: <b className="num text-foreground">{size.affordable ? size.shares : 0} shares</b> (cost {fmt(size.cost)}, risk {fmt(size.risk)}){size.capped && <span className="text-warn"> · limited by your cash, so risk is lower than {risk}%</span>}{!size.affordable && <span className="text-warn"> · one share costs more than your account</span>}. </>
                                              : <>Enter an account size to see share count. </>}
                                        Exit: {p.exit_rule}.
                                    </p>
                                </>
                            );
                        })()}

                        {setup?.status === 'entry' && entries.indexOf(symbol) >= MAX_POSITIONS && (
                            <p className="text-[12px] text-warn">Skip for now: {entries.length} fresh entries, and the limit is {MAX_POSITIONS} open positions at once. Take the top {MAX_POSITIONS} by score.</p>
                        )}
                        {setup && earningsDate && (() => {
                            const d = daysUntil(earningsDate);
                            return d !== null && d <= 10 && (
                                <p className="text-[12px] text-warn">Earnings {d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`} ({earningsDate}). A report can gap price through the stop; many traders skip entries before it.</p>
                            );
                        })()}
                        {isCanadian(symbol) && <p className="text-[12px] text-faint">Toronto listing: prices and share counts are in {currencyOf(symbol)}.</p>}

                        {setup && setup.warnings.length > 0 && (
                            <ul className="flex list-disc flex-col gap-0.5 pl-5 text-[12px] text-faint">
                                {setup.warnings.map((w) => <li key={w}>{w}</li>)}
                            </ul>
                        )}

                        {setup && (
                            <details className="text-[13px] text-muted-foreground">
                                <summary className="cursor-pointer font-semibold text-foreground">{setup.quant ? 'Score and evidence' : 'Evidence'}</summary>
                                {setup.quant && <QuantBreakdown quant={setup.quant} />}
                                <p className="kicker mt-3">Validation gates</p>
                                <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                                    {Object.entries(setup.evidence.gates).map(([g, ok]) => (
                                        <li key={g} className="flex items-center gap-2">
                                            {ok ? <Check className="size-4 text-up" aria-label="Passed" /> : <X className="size-4 text-faint" aria-label="Failed" />}
                                            {GATE_LABEL[g] ?? g}
                                        </li>
                                    ))}
                                </ul>
                                <p className="mt-2 text-[12px] text-faint">
                                    Out-of-sample Sharpe {setup.evidence.oos_sharpe ?? 'n/a'} vs buy-and-hold {setup.evidence.baselines_sharpe.buy_hold ?? 'n/a'} and MA cross {setup.evidence.baselines_sharpe.ma_cross ?? 'n/a'};
                                    deflated Sharpe {setup.evidence.deflated_sharpe ?? 'n/a'} after {setup.evidence.trials ?? '?'} trials; {setup.evidence.trades ?? '?'} trades.
                                    {stored && <> Scanned {new Date(stored.scannedAt).toLocaleString()}.</>} Educational only, not financial advice.
                                </p>
                            </details>
                        )}
                    </div>
                </Panel>
            ))}
        </div>
    );
}
