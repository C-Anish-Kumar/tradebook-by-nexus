import { ListFilter } from 'lucide-react';
import Panel from '@/components/Panel';
import ScreenerBoard from '@/components/screener/ScreenerBoard';
import { analystEnabled } from '@/lib/analyst';
import { getScreener } from '@/lib/actions/screener.actions';

export const metadata = { title: 'Screener | Apex Tradebook' };

export default async function ScreenerPage() {
    const data = analystEnabled ? await getScreener() : null;
    return (
        <>
            <header className="page-head">
                <div>
                    <h1 className="page-title">Screener</h1>
                    <p className="page-sub">Every universe scanned after the close: each stock under every strategy, ranked by quant score</p>
                </div>
            </header>
            {data ? <ScreenerBoard data={data} /> : (
                <Panel>
                    <div className="empty-state py-14">
                        <span className="empty-icon"><ListFilter className="size-5" /></span>
                        <h3>The screener is off</h3>
                        <p className="max-w-80 text-[13px]">It runs on the analyst service. Set ANALYST_SERVICE_URL and ANALYST_API_KEY to turn it on.</p>
                    </div>
                </Panel>
            )}
        </>
    );
}
