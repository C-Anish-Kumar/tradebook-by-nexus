import { Crosshair } from 'lucide-react';
import { analystEnabled } from '@/lib/analyst';
import { getSetupBoard } from '@/lib/actions/setups.actions';
import SetupsBoard from '@/components/setups/SetupsBoard';
import Panel from '@/components/Panel';
import { STRATEGY_2 } from '@/lib/strategies';

export const metadata = { title: 'Setups | Tradebook by Nexus' };

export default async function SetupsPage() {
    const rows = analystEnabled ? await getSetupBoard() : [];

    return (
        <>
            <header className="page-head">
                <div>
                    <h1 className="page-title">Setups</h1>
                    <p className="page-sub">{STRATEGY_2.label}: regime-aware breakout entries on your watchlist, each shown with the evidence behind it</p>
                </div>
            </header>
            {analystEnabled ? (
                <SetupsBoard rows={rows} />
            ) : (
                <Panel>
                    <div className="empty-state py-14">
                        <span className="empty-icon"><Crosshair className="size-5" /></span>
                        <h3>Setups are off</h3>
                        <p className="max-w-80 text-[13px]">They run on the analyst service. Set ANALYST_SERVICE_URL and ANALYST_API_KEY to turn them on.</p>
                    </div>
                </Panel>
            )}
        </>
    );
}
