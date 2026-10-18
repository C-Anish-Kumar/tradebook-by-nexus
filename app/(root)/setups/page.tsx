import Link from 'next/link';
import { Crosshair } from 'lucide-react';
import { analystEnabled } from '@/lib/analyst';
import { getForwardTest, getSetupBoard } from '@/lib/actions/setups.actions';
import ForwardTest from '@/components/setups/ForwardTest';
import SetupsBoard from '@/components/setups/SetupsBoard';
import Panel from '@/components/Panel';
import { scannerStrategies } from '@/lib/strategies';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Setups | Apex Tradebook' };

export default async function SetupsPage({ searchParams }: { searchParams: Promise<{ strategy?: string }> }) {
    const { strategy: wanted } = await searchParams;
    const strategies = scannerStrategies();
    const active = strategies.find((s) => s.id === wanted) ?? strategies[0];
    const rows = analystEnabled && active ? await getSetupBoard(active.id) : [];
    const forward = analystEnabled && active ? await getForwardTest().catch(() => null) : null;

    return (
        <>
            <header className="page-head">
                <div>
                    <h1 className="page-title">Setups</h1>
                    <p className="page-sub">
                        {active ? `${active.label}: ${active.name} entries on your watchlist, each with a 0-100 quant score and the evidence behind it` : 'No strategy is switched on'}
                    </p>
                </div>
            </header>
            {strategies.length > 1 && (
                <nav aria-label="Strategy" className="mb-3 flex flex-wrap gap-2">
                    {strategies.map((s) => (
                        <Link key={s.id} href={`/setups?strategy=${s.id}`} aria-current={s.id === active?.id ? 'page' : undefined}
                              className={cn('pill h-8 px-3 text-[13px]', s.id === active?.id && 'is-brand')}>
                            {s.label} · {s.name}
                        </Link>
                    ))}
                </nav>
            )}
            {analystEnabled && active ? (
                <div className="flex flex-col gap-3">
                    <SetupsBoard rows={rows} />
                    {forward && <ForwardTest {...forward} />}
                </div>
            ) : (
                <Panel>
                    <div className="empty-state py-14">
                        <span className="empty-icon"><Crosshair className="size-5" /></span>
                        <h3>{active ? 'Setups are off' : 'No strategy is switched on'}</h3>
                        <p className="max-w-80 text-[13px]">
                            {active ? 'They run on the analyst service. Set ANALYST_SERVICE_URL and ANALYST_API_KEY to turn them on.' : 'Enable one in lib/strategies.ts.'}
                        </p>
                    </div>
                </Panel>
            )}
        </>
    );
}
