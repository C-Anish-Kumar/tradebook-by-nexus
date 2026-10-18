import { MessageSquare } from 'lucide-react';
import { analystEnabled } from '@/lib/analyst';
import TradeChat from '@/components/chat/TradeChat';
import Panel from '@/components/Panel';

export const metadata = { title: 'Ask | Apex Tradebook' };
export const maxDuration = 60; // a cold analyst service can take a while to answer the first question

export default function ChatPage() {
    return (
        <>
            <header className="page-head">
                <div>
                    <h1 className="page-title">Ask</h1>
                    <p className="page-sub">Chat with the assistant to get trade signals from your strategies, with the score and evidence behind each</p>
                </div>
            </header>
            {analystEnabled ? (
                <TradeChat />
            ) : (
                <Panel>
                    <div className="empty-state py-14">
                        <span className="empty-icon"><MessageSquare className="size-5" /></span>
                        <h3>The assistant is off</h3>
                        <p className="max-w-80 text-[13px]">Signals run on the analyst service. Set ANALYST_SERVICE_URL and ANALYST_API_KEY to turn it on.</p>
                    </div>
                </Panel>
            )}
        </>
    );
}
