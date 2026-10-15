import { Sparkles } from "lucide-react";
import type { MarketBrief as Brief } from "@/lib/market-intel";
import { cn } from "@/lib/utils";

const timeET = (iso: string) =>
    new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' });

export default function MarketBrief({ brief }: { brief: Brief }) {
    const indexes = brief.moves.slice(0, 4);
    const rest = brief.moves.slice(4).sort((a, b) => b.change - a.change);
    return (
        <div className="flex flex-col gap-4 p-4">
            <div className="flex flex-col gap-1.5">
                <p className="kicker flex items-center gap-1.5"><Sparkles className="size-3.5" /> {brief.session === 'open' ? 'Intraday' : 'Latest session'} · {timeET(brief.generatedAt)} ET</p>
                <h3 className="text-[19px] font-bold tracking-[-0.02em]">{brief.headline}</h3>
                <p className="text-[14px] text-muted-foreground">{brief.summary}</p>
            </div>

            {brief.bullets.length > 0 && (
                <ul className="grid gap-2 sm:grid-cols-2">
                    {brief.bullets.map((b) => (
                        <li key={b.title} className="rounded-[10px] px-3 py-2 shadow-[inset_0_0_0_1px_var(--line)]">
                            <p className="text-[13px] font-semibold">{b.title}</p>
                            <p className="text-[13px] text-muted-foreground">{b.detail}</p>
                        </li>
                    ))}
                </ul>
            )}

            <div className="flex flex-col gap-2">
                <p className="kicker">Moves</p>
                <ul className="flex flex-wrap gap-1.5" aria-label="Session moves by index and sector">
                    {[...indexes, ...rest].map((m) => (
                        <li key={m.symbol} className={cn('pill', m.change >= 0 ? 'is-up' : 'is-down')} title={m.symbol}>
                            {m.label} <span className="num">{m.change > 0 ? '+' : ''}{m.change.toFixed(2)}%</span>
                        </li>
                    ))}
                </ul>
            </div>

            {brief.watch && <p className="text-[13px]"><span className="font-semibold">Watch next: </span><span className="text-muted-foreground">{brief.watch}</span></p>}
            <p className="text-[12px] text-faint">
                {brief.ai === false
                    ? 'The AI summary is unavailable right now, so this shows the moves only. It refreshes before the open, at midday and after the close.'
                    : 'Written by AI from live quotes and headlines. It can get things wrong; not financial advice.'}
            </p>
        </div>
    );
}
