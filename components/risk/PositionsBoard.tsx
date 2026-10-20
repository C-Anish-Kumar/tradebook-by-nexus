import Panel from '@/components/Panel';
import AccountSettingsForm from '@/components/risk/AccountSettingsForm';
import PositionsTable from '@/components/risk/PositionsTable';
import ResetButton from '@/components/risk/ResetButton';
import type { PositionsView } from '@/lib/actions/risk.actions';
import { cn } from '@/lib/utils';

const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Account stats, the account kill switch, open and closed positions, sector exposure and the risk settings. */
export default function PositionsBoard({ view }: { view: PositionsView }) {
    const { account, settings } = view;
    const sectorCap = Math.max(...Object.values(view.universes).map((u) => u.risk.maxSectorExposurePct));
    const stats = [
        { label: 'Account', value: usd(settings.accountSize) },
        { label: 'Invested', value: `${usd(account.invested)} · ${Math.round((account.invested / settings.accountSize) * 100)}%` },
        { label: 'Open positions', value: String(view.open.length) },
        { label: 'Realised P&L', value: usd(account.realised), tone: account.realised > 0 ? 'text-up' : account.realised < 0 ? 'text-down' : '' },
    ];

    return (
        <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {stats.map((s) => (
                    <Panel key={s.label}>
                        <div className="flex flex-col gap-1 p-4">
                            <span className="kicker">{s.label}</span>
                            <span className={cn('num text-[20px] font-semibold text-foreground', s.tone)}>{s.value}</span>
                        </div>
                    </Panel>
                ))}
            </div>

            <Panel
                title="Account kill switch"
                sub={`New entries stop fitting your plan once your closed positions fall ${account.limitPct}% of the account from their best point`}
                action={account.killed ? <ResetButton label="Reset account kill switch" /> : undefined}
            >
                <div className="flex flex-wrap items-center gap-3 p-4 text-[13px]">
                    <span className={cn('pill', account.killed ? 'is-down' : 'is-up')}>{account.killed ? 'Tripped' : 'OK'}</span>
                    <span className="text-muted-foreground">Drawdown from realised P&amp;L: <b className="num text-foreground">{account.drawdownPct}%</b> of {account.limitPct}%{settings.accountResetAt ? `, counted since ${settings.accountResetAt.slice(0, 10)}` : ''}</span>
                </div>
            </Panel>

            <Panel title="Open positions" sub="Last close is from the nightly scan. You get a Telegram message when one hits its stop, its strategy exit or 2R">
                <PositionsTable open={view.open} closed={view.closed} />
            </Panel>

            {view.sectors.length > 0 && (
                <Panel title="Sector exposure" sub={`Share of the account in each sector; the largest universe cap is ${sectorCap}%`}>
                    <ul className="flex flex-col gap-2 p-4 text-[13px]">
                        {view.sectors.map((s) => (
                            <li key={s.sector} className="grid grid-cols-[10rem_1fr_6rem] items-center gap-3">
                                <span className="truncate text-muted-foreground">{s.sector}</span>
                                <span className="h-2 rounded-full bg-hover">
                                    <span className={cn('block h-2 rounded-full', s.pct > sectorCap ? 'bg-down' : 'bg-brand')} style={{ width: `${Math.min(100, s.pct)}%` }} />
                                </span>
                                <span className="num text-right">{s.pct}%</span>
                            </li>
                        ))}
                    </ul>
                </Panel>
            )}

            <Panel title="Account and risk" sub="Your account size and each universe's limits. They change position sizes and what fits your plan straight away">
                <AccountSettingsForm settings={settings} universes={view.universes} />
            </Panel>

            <p className="px-1 text-[12px] text-faint">Research tooling, not financial advice. Nothing here places orders: you trade at your broker and record it here.</p>
        </div>
    );
}
