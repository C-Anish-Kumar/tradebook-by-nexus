import { Scale } from 'lucide-react';
import { getUserWatchlist } from '@/lib/actions/watchlist.actions';
import { analystEnabled } from '@/lib/analyst';
import PortfolioLab from '@/components/portfolio/PortfolioLab';
import Panel from '@/components/Panel';

export const metadata = { title: 'Portfolio Lab | Tradebook by Nexus' };

export default async function PortfolioPage() {
    const items = await getUserWatchlist();
    // Crypto and foreign pairs carry an exchange prefix; the optimiser works on stock tickers
    const symbols = items.map((item: { symbol: string }) => item.symbol).filter((s: string) => !s.includes(':'));

    return (
        <>
            <header className="page-head">
                <div>
                    <h1 className="page-title">Portfolio Lab</h1>
                    <p className="page-sub">Five ways to split money across your stocks, each tested on data it never saw</p>
                </div>
            </header>
            {analystEnabled ? (
                <PortfolioLab initial={symbols} />
            ) : (
                <Panel>
                    <div className="empty-state py-14">
                        <span className="empty-icon"><Scale className="size-5" /></span>
                        <h3>Portfolio Lab is off</h3>
                        <p className="max-w-80 text-[13px]">It runs on the analyst service. Set ANALYST_SERVICE_URL and ANALYST_API_KEY to turn it on.</p>
                    </div>
                </Panel>
            )}
        </>
    );
}
