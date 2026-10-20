import PositionsBoard from '@/components/risk/PositionsBoard';
import { getPositionsView } from '@/lib/actions/risk.actions';

export const metadata = { title: 'Positions | Apex Tradebook' };

export default async function PositionsPage() {
    const view = await getPositionsView();
    return (
        <>
            <header className="page-head">
                <div>
                    <h1 className="page-title">Positions</h1>
                    <p className="page-sub">Trades you took from the screener, your account and the risk rules that decide what fits</p>
                </div>
            </header>
            <PositionsBoard view={view} />
        </>
    );
}
