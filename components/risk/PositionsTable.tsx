'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { closePosition, deletePosition } from '@/lib/actions/risk.actions';
import { universeById } from '@/config/universes';
import { STRATEGIES, type StrategyId } from '@/lib/strategies';
import { EXIT_LABEL, positionExit, positionPnl, positionR, type ExitReason, type PositionData } from '@/lib/risk';
import { cn } from '@/lib/utils';

const usd = (n: number | null | undefined) => (n == null ? '–' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const signed = (n: number) => `${n < 0 ? '−' : '+'}${usd(Math.abs(n))}`;
const rText = (r: number | null) => (r === null ? '–' : `${r > 0 ? '+' : ''}${r}R`);
const tone = (n: number) => (n > 0 ? 'text-up' : n < 0 ? 'text-down' : '');

function CloseForm({ position, onDone }: { position: PositionData; onDone: () => void }) {
    const [price, setPrice] = useState(String(position.lastClose ?? position.entry));
    const [busy, setBusy] = useState(false);
    const save = async () => {
        setBusy(true);
        const res = await closePosition(position.id, Number(price));
        setBusy(false);
        if ('error' in res) toast.error(res.error);
        else onDone();
    };
    return (
        <span className="inline-flex items-center gap-1">
            <input inputMode="decimal" aria-label="Exit price" value={price} onChange={(e) => setPrice(e.target.value)}
                   className="h-7 w-24 rounded-[8px] bg-page px-2 text-[13px] text-foreground shadow-[inset_0_0_0_1px_var(--line)] outline-none focus:shadow-[inset_0_0_0_1px_var(--brand)]" />
            <button type="button" className="btn btn-primary h-7 px-2 text-[12px]" onClick={save} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Check />} Sold</button>
        </span>
    );
}

/** Positions you took: open ones with tonight's close, P&L and any exit the scan saw; closed ones with the result. */
export default function PositionsTable({ open, closed }: { open: PositionData[]; closed: PositionData[] }) {
    const router = useRouter();
    const [closing, setClosing] = useState<string | null>(null);

    const remove = async (p: PositionData) => {
        if (!confirm(`Delete ${p.ticker}? Use this only for a position recorded by mistake: it disappears from P&L and the kill switch.`)) return;
        const res = await deletePosition(p.id);
        if ('error' in res) toast.error(res.error);
        else router.refresh();
    };

    return (
        <div className="flex flex-col gap-4 p-4">
            {open.length === 0 ? (
                <p className="text-[13px] text-faint">No open positions. Press <b>Take</b> on a screener entry after you buy it at your broker.</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="data-table text-[13px]">
                        <thead>
                            <tr>
                                <th>Ticker</th><th>Strategy</th><th>Universe</th><th className="is-num">Shares</th><th className="is-num">Entry</th>
                                <th className="is-num">Stop</th><th className="is-num">2R</th><th className="is-num">Last close</th><th className="is-num">P&amp;L</th>
                                <th>Signal</th><th>Opened</th><th />
                            </tr>
                        </thead>
                        <tbody>
                            {open.map((p) => {
                                const px = p.lastClose ?? p.entry;
                                const pnl = positionPnl(p, px);
                                // What the latest close says, from the stored close (the nightly job sends the Telegram version)
                                const now: ExitReason | null = p.lastClose == null ? null : positionExit(p, { signal: 'holding', close: p.lastClose });
                                const flags = [...new Set([...(p.alerted as ExitReason[]), ...(now ? [now] : [])])];
                                return (
                                    <tr key={p.id}>
                                        <td className="py-2"><Link href={`/stocks/${encodeURIComponent(p.ticker)}?strategy=${p.strategy}`} className="mono font-semibold text-foreground hover:text-brand-ink">{p.ticker}</Link></td>
                                        <td>{STRATEGIES[p.strategy as StrategyId]?.name ?? p.strategy}</td>
                                        <td className="text-muted-foreground">{universeById(p.universe)?.name ?? p.universe}</td>
                                        <td className="is-num num">{p.shares}</td>
                                        <td className="is-num num">{usd(p.entry)}</td>
                                        <td className="is-num num">{usd(p.stop)}</td>
                                        <td className="is-num num">{usd(p.target2r)}</td>
                                        <td className="is-num num">{usd(p.lastClose)}</td>
                                        <td className={cn('is-num num', tone(pnl))}>{signed(pnl)} <span className="text-faint">{rText(positionR(p, px))}</span></td>
                                        <td>
                                            {flags.length ? flags.map((f) => (
                                                <span key={f} className={cn('pill mr-1', f === 'target' ? 'is-up' : 'is-down')} title={EXIT_LABEL[f]}>{f === 'target' ? '2R reached' : f === 'stop' ? 'Stop hit' : 'Exit signal'}</span>
                                            )) : <span className="text-faint">In trade</span>}
                                        </td>
                                        <td className="num text-faint">{p.openedOn}</td>
                                        <td className="whitespace-nowrap">
                                            <span className="inline-flex items-center gap-1">
                                                {closing === p.id ? (
                                                    <>
                                                        <CloseForm position={p} onDone={() => { setClosing(null); router.refresh(); }} />
                                                        <button type="button" className="icon-btn ml-1" aria-label="Cancel" onClick={() => setClosing(null)}><X /></button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button type="button" className="btn btn-ghost h-7 px-2 text-[12px]" onClick={() => setClosing(p.id)}>Close</button>
                                                        <button type="button" className="icon-btn ml-1" aria-label={`Delete ${p.ticker}`} title="Recorded by mistake" onClick={() => remove(p)}><Trash2 /></button>
                                                    </>
                                                )}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {closed.length > 0 && (
                <details>
                    <summary className="cursor-pointer text-[13px] text-muted-foreground">Closed positions ({closed.length})</summary>
                    <div className="mt-2 overflow-x-auto">
                        <table className="data-table text-[13px]">
                            <thead>
                                <tr><th>Ticker</th><th>Strategy</th><th className="is-num">Shares</th><th className="is-num">Entry</th><th className="is-num">Exit</th><th className="is-num">P&amp;L</th><th>Opened</th><th>Closed</th><th /></tr>
                            </thead>
                            <tbody>
                                {closed.map((p) => {
                                    const pnl = positionPnl(p, p.exitPrice ?? p.entry);
                                    return (
                                        <tr key={p.id}>
                                            <td className="mono py-2 font-semibold text-foreground">{p.ticker}</td>
                                            <td>{STRATEGIES[p.strategy as StrategyId]?.name ?? p.strategy}</td>
                                            <td className="is-num num">{p.shares}</td>
                                            <td className="is-num num">{usd(p.entry)}</td>
                                            <td className="is-num num">{usd(p.exitPrice)}</td>
                                            <td className={cn('is-num num', tone(pnl))}>{signed(pnl)} <span className="text-faint">{rText(positionR(p, p.exitPrice ?? p.entry))}</span></td>
                                            <td className="num text-faint">{p.openedOn}</td>
                                            <td className="num text-faint">{p.closedOn}</td>
                                            <td><button type="button" className="icon-btn" aria-label={`Delete ${p.ticker}`} title="Recorded by mistake" onClick={() => remove(p)}><Trash2 /></button></td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </details>
            )}
        </div>
    );
}
