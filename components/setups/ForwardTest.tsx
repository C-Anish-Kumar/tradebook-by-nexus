import type { ForwardRow, ForwardTradeRow } from '@/lib/actions/setups.actions';
import Panel from '@/components/Panel';
import { cn } from '@/lib/utils';

const OUTCOME: Record<string, string> = { open: 'Open', stopped: 'Stopped', target: '2R hit', exited: 'Strategy exit', expired: 'Expired' };
const r = (n: number | null) => (n === null ? '—' : `${n > 0 ? '+' : ''}${n}R`);

/** The honest scoreboard: entries logged as they appeared, judged on later closes. Nothing here is back-filled. */
export default function ForwardTest({ rows, recent }: { rows: ForwardRow[]; recent: ForwardTradeRow[] }) {
    const total = rows.reduce((n, x) => n + x.trades, 0);
    return (
        <Panel title="Forward test" sub="Every entry the scanner shows is logged the day it appears and judged on later daily closes. This is the real record, not a backtest.">
            {total === 0 ? (
                <p className="p-4 text-[13px] text-faint">Nothing logged yet. The first entries are recorded at the next scan, and results build up over weeks.</p>
            ) : (
                <div className="flex flex-col gap-4 p-4">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-[13px]">
                            <thead><tr className="kicker"><th className="py-1 pr-3 font-normal">Strategy</th><th className="pr-3 font-normal">Logged</th><th className="pr-3 font-normal">Open</th><th className="pr-3 font-normal">Closed</th><th className="pr-3 font-normal">Win rate</th><th className="pr-3 font-normal">Avg R</th><th className="font-normal">Total R</th></tr></thead>
                            <tbody>
                                {rows.map((x) => (
                                    <tr key={x.strategy} className="border-t border-[var(--line)]">
                                        <td className="py-1.5 pr-3">{x.name}</td>
                                        <td className="num pr-3">{x.trades}</td><td className="num pr-3">{x.open}</td><td className="num pr-3">{x.closed}</td>
                                        <td className="num pr-3">{x.winRate === null ? '—' : `${x.winRate}%`}</td>
                                        <td className={cn('num pr-3', (x.avgR ?? 0) > 0 ? 'text-up' : (x.avgR ?? 0) < 0 && 'text-down')}>{r(x.avgR)}</td>
                                        <td className="num">{r(x.totalR)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <ul className="flex flex-col gap-1 text-[12.5px] text-muted-foreground">
                        {recent.map((t) => (
                            <li key={t.id} className="flex flex-wrap items-center gap-2">
                                <span className="num font-semibold text-foreground">{t.symbol}</span>
                                <span className="text-faint">{t.signalDate}</span>
                                <span>{OUTCOME[t.outcome] ?? t.outcome}</span>
                                {t.score !== null && <span className="text-faint">score {t.score}</span>}
                                <span className="num ml-auto">{t.outcome === 'open' ? '' : r(t.r)}</span>
                            </li>
                        ))}
                    </ul>
                    <p className="text-[12px] text-faint">Judged on daily closes only: a stop or target touched intraday is not seen, and fills are idealised at the planned entry. Small samples say little; wait for 30 or more closed trades before trusting any number.</p>
                </div>
            )}
        </Panel>
    );
}
