import PerformanceBoard from '@/components/risk/PerformanceBoard';
import { getPerformance } from '@/lib/actions/risk.actions';

export const metadata = { title: 'Performance | Apex Tradebook' };

export default async function PerformancePage() {
    const view = await getPerformance();
    return (
        <>
            <header className="page-head">
                <div>
                    <h1 className="page-title">Performance</h1>
                    <p className="page-sub">The forward test of every strategy in every universe, next to what its backtest expected</p>
                </div>
            </header>
            <PerformanceBoard view={view} />
        </>
    );
}
