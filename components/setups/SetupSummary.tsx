import Link from 'next/link';
import { QuantBadge, QuantBreakdown } from '@/components/setups/QuantBadge';
import { STATUS_LABEL, type Setup } from '@/lib/setups';
import { cn } from '@/lib/utils';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Read-only view of one stock's setup, for the stock page (the Setups page adds position sizing on top). */
export default function SetupSummary({ setup }: { setup: Setup }) {
    const p = setup.plan;
    return (
        <div className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
                {setup.quant && <QuantBadge quant={setup.quant} className="mr-1" />}
                <span className={cn('pill', setup.status === 'entry' && 'is-up', setup.status === 'watch' && 'is-brand')}>{STATUS_LABEL[setup.status]}</span>
                <span className={cn('pill', setup.evidence.validated ? 'is-up' : 'text-warn')}>{setup.evidence.validated ? 'Validated' : 'Unvalidated'}</span>
                <span className="pill">{setup.regime.trend ?? '—'} trend · {setup.regime.vol ?? '—'} vol</span>
                <span className="num ml-auto text-[12px] text-faint">Daily close {setup.date} · {fmt(setup.close)}</span>
            </div>

            {p && (
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {([['Entry', fmt(p.entry)], ['Stop', fmt(p.stop)], ['Risk / share', `${fmt(p.risk_per_share)} (${p.risk_pct_of_price}%)`], ['2R / 3R', `${fmt(p.target_2r)} / ${fmt(p.target_3r)}`]] as const).map(([k, v]) => (
                        <div key={k} className="rounded-[10px] bg-page px-3 py-2 shadow-[inset_0_0_0_1px_var(--line)]">
                            <dt className="kicker">{k}</dt><dd className="num text-[14px] font-semibold">{v}</dd>
                        </div>
                    ))}
                </dl>
            )}

            {setup.warnings.length > 0 && (
                <ul className="flex list-disc flex-col gap-0.5 pl-5 text-[12px] text-faint">
                    {setup.warnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
            )}

            {setup.quant && (
                <details className="text-[13px] text-muted-foreground">
                    <summary className="cursor-pointer font-semibold text-foreground">How the score is built</summary>
                    <QuantBreakdown quant={setup.quant} />
                </details>
            )}

            <p className="text-[12px] text-faint">
                Watchlisted stocks are re-scanned after every US close, with position sizing on <Link href="/setups" className="underline">Setups</Link>. Educational only, not financial advice.
            </p>
        </div>
    );
}
