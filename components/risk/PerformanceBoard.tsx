import Panel from '@/components/Panel';
import ResetButton from '@/components/risk/ResetButton';
import type { PerformanceRow, PerformanceView } from '@/lib/actions/risk.actions';
import { UNIVERSES } from '@/config/universes';
import { STRATEGIES } from '@/lib/strategies';
import { regimeLabel, regimeOpen } from '@/lib/risk';
import { cn } from '@/lib/utils';

const r = (n: number | null | undefined) => (n == null ? '–' : `${n > 0 ? '+' : ''}${n}R`);
const pct = (n: number | null | undefined) => (n == null ? '–' : `${n}%`);
const dd = (n: number | null | undefined) => (n == null ? '–' : `${n}R`);
const tone = (n: number | null | undefined) => (n == null ? '' : n > 0 ? 'text-up' : n < 0 ? 'text-down' : '');

/** Live minus backtest average R, once there is enough live data to say anything. */
function Drift({ row }: { row: PerformanceRow }) {
    if (row.live.avgR == null || row.backtest?.avg_r == null) return <span className="text-faint">–</span>;
    const d = Math.round((row.live.avgR - row.backtest.avg_r) * 100) / 100;
    return <span className={cn('num', row.live.closed < 30 ? 'text-faint' : tone(d))} title={row.live.closed < 30 ? 'Fewer than 30 closed trades: too few to judge' : undefined}>{r(d)}</span>;
}

/** The forward test per strategy x universe beside its backtest, the market regime and the kill switches. */
export default function PerformanceBoard({ view }: { view: PerformanceView }) {
    const marketOpen = regimeOpen(view.market);

    return (
        <div className="flex flex-col gap-3">
            <Panel title="Market regime" sub={view.scanDate ? `From the scan of ${view.scanDate}` : 'No scan has finished yet'}>
                <div className="flex flex-wrap items-center gap-3 p-4 text-[13px]">
                    <span className={cn('pill', marketOpen ? 'is-up' : 'is-down')}>{marketOpen ? 'Risk on' : 'Risk off'}</span>
                    <span className="text-muted-foreground">{regimeLabel(view.market)}</span>
                    {view.market && (
                        <span className="num text-faint">SPY {view.market.close} · 50-day {view.market.sma50} · 200-day {view.market.sma200}</span>
                    )}
                </div>
            </Panel>

            {view.account.killed && (
                <Panel>
                    <div className="flex flex-wrap items-center gap-3 p-4 text-[13px]">
                        <span className="pill is-down">Account kill switch tripped</span>
                        <span className="text-muted-foreground">Your closed positions are down {view.account.drawdownPct}% from their best (limit {view.account.limitPct}%). Reset it on the Positions page.</span>
                    </div>
                </Panel>
            )}

            {UNIVERSES.map((u) => {
                const rows = view.rows.filter((x) => x.universe === u.id);
                return (
                    <Panel key={u.id} title={u.name} sub={`Kill switch at ${view.killLimitR}R of forward-test drawdown`}>
                        <div className="overflow-x-auto">
                            <table className="data-table text-[13px]">
                                <thead>
                                    <tr>
                                        <th>Strategy</th><th>Validated</th>
                                        <th className="is-num">Logged</th><th className="is-num">Open</th><th className="is-num">Closed</th>
                                        <th className="is-num">Win rate</th><th className="is-num">Avg R</th><th className="is-num">Total R</th><th className="is-num">Max DD</th>
                                        <th className="is-num">BT trades</th><th className="is-num">BT win</th><th className="is-num">BT avg R</th><th className="is-num">BT max DD</th>
                                        <th className="is-num">Live − BT</th><th>Kill switch</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((x) => (
                                        <tr key={x.strategy}>
                                            <td className="py-2 whitespace-nowrap text-foreground">{STRATEGIES[x.strategy]?.name ?? x.strategy}</td>
                                            <td>{x.validated == null ? <span className="text-faint">–</span> : x.validated ? <span className="text-up">Yes</span> : <span className="text-faint">No</span>}</td>
                                            <td className="is-num num">{x.logged}</td>
                                            <td className="is-num num">{x.open}</td>
                                            <td className="is-num num">{x.live.closed}</td>
                                            <td className="is-num num">{pct(x.live.winRate)}</td>
                                            <td className={cn('is-num num', tone(x.live.avgR))}>{r(x.live.avgR)}</td>
                                            <td className={cn('is-num num', tone(x.live.totalR))}>{r(x.live.totalR)}</td>
                                            <td className="is-num num">{dd(x.live.maxDrawdownR)}</td>
                                            <td className="is-num num text-muted-foreground">{x.backtest?.trades ?? '–'}</td>
                                            <td className="is-num num text-muted-foreground">{pct(x.backtest?.win_rate)}</td>
                                            <td className="is-num num text-muted-foreground">{r(x.backtest?.avg_r)}</td>
                                            <td className="is-num num text-muted-foreground">{dd(x.backtest?.max_dd_r)}</td>
                                            <td className="is-num"><Drift row={x} /></td>
                                            <td className="whitespace-nowrap">
                                                {x.killed ? (
                                                    <>
                                                        <span className="pill is-down" title={`${x.killDrawdownR}R down since ${x.resetAt?.slice(0, 10) ?? 'the start'}`}>Off · {dd(x.killDrawdownR)}</span>
                                                        <ResetButton strategy={x.strategy} universe={x.universe} />
                                                    </>
                                                ) : (
                                                    <span className="text-faint" title={x.resetAt ? `Counted since ${x.resetAt.slice(0, 10)}` : undefined}>OK · {dd(x.killDrawdownR ?? 0)}</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Panel>
                );
            })}

            <p className="px-1 text-[12px] text-faint">
                Live = the forward test: every screener entry is logged the night it appears and judged on later daily closes (stop, 2R target, the strategy&apos;s exit, or 30 days), in R.
                Backtest = the chosen settings&apos; trades over each validation stock&apos;s out-of-sample window, in R; it refreshes weekly (the first figures arrive with the next scan).
                Fewer than 30 closed live trades say very little: the Live − BT column stays grey until then. Research tooling, not financial advice.
            </p>
        </div>
    );
}
