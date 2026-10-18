'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Loader2, Send } from 'lucide-react';
import Panel from '@/components/Panel';
import { askTradeBot } from '@/lib/actions/chat.actions';
import type { ChatMessage } from '@/lib/chat';
import { cn } from '@/lib/utils';

const SUGGESTIONS = [
    'What are the best setups on my watchlist today?',
    'Which of my stocks have an entry signal right now?',
    'Explain how the quant score is built',
    'Show me every strategy on MU',
];

export default function TradeChat() {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [pending, start] = useTransition();
    const end = useRef<HTMLDivElement>(null);

    useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, pending]);

    const send = (text: string) => {
        const question = text.trim();
        if (!question || pending) return;
        const next: ChatMessage[] = [...messages, { role: 'user', content: question }];
        setMessages(next);
        setInput('');
        start(async () => {
            const res = await askTradeBot(next);
            setMessages([...next, { role: 'assistant', content: 'error' in res ? res.error : res.reply }]);
        });
    };

    return (
        <Panel>
            <div className="flex min-h-[420px] flex-col gap-3 p-4">
                <div className="flex flex-1 flex-col gap-3" aria-live="polite">
                    {messages.length === 0 && (
                        <div className="flex flex-col gap-3 py-6">
                            <p className="text-[13px] text-muted-foreground">
                                Ask for trade signals in plain words. Answers come from the latest daily-close scan of every strategy that is switched on, with each setup&apos;s quant score and evidence.
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {SUGGESTIONS.map((s) => (
                                    <button key={s} type="button" onClick={() => send(s)} className="pill h-8 px-3 text-[13px] hover:bg-brand-soft">{s}</button>
                                ))}
                            </div>
                        </div>
                    )}
                    {messages.map((m, i) => (
                        <div key={i} className={cn('max-w-[85%] whitespace-pre-wrap rounded-[12px] px-3 py-2 text-[13px] leading-relaxed',
                            m.role === 'user' ? 'self-end bg-brand-soft text-foreground' : 'self-start bg-page shadow-[inset_0_0_0_1px_var(--line)]')}>
                            {m.content}
                        </div>
                    ))}
                    {pending && (
                        <div className="flex items-center gap-2 self-start text-[13px] text-faint"><Loader2 className="size-4 animate-spin" /> Reading the scans…</div>
                    )}
                    <div ref={end} />
                </div>

                <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex items-center gap-2">
                    <input value={input} onChange={(e) => setInput(e.target.value)} maxLength={500} placeholder="Ask about a stock or your watchlist…"
                           aria-label="Message"
                           className="h-10 min-w-0 flex-1 rounded-[10px] bg-page px-3 text-[13px] text-foreground shadow-[inset_0_0_0_1px_var(--line)] outline-none focus:shadow-[inset_0_0_0_1px_var(--brand)]" />
                    <button type="submit" disabled={pending || !input.trim()} className="btn btn-primary" aria-label="Send"><Send /></button>
                </form>
                <p className="text-[11px] text-faint">Educational only, not financial advice. The score rates setup quality, not the chance of profit. Unvalidated setups are paper-trade ideas.</p>
            </div>
        </Panel>
    );
}
