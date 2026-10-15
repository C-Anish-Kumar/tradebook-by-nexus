import type { EconomicEvent } from "@/lib/market-intel";

const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const inDays = (d: string) => {
    const n = Math.round((new Date(`${d}T12:00:00Z`).getTime() - Date.now()) / 86_400_000);
    return n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
};

export default function EconomicCalendar({ events }: { events: EconomicEvent[] }) {
    if (events.length === 0) return <p className="p-4 text-[13px] text-faint">No major US releases in the next five weeks.</p>;
    return (
        <ul className="flex flex-col p-2">
            {events.map((e) => (
                <li key={`${e.date}-${e.name}`} className="flex items-center gap-3 rounded-[8px] px-2 py-2">
                    <span className="num w-[92px] shrink-0 text-[12.5px] text-muted-foreground">{day(e.date)}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{e.name}</span>
                    {e.high && <span className="pill is-brand">Market mover</span>}
                    <span className="hidden w-[76px] shrink-0 text-right text-[12px] text-faint sm:block">{inDays(e.date)}</span>
                </li>
            ))}
        </ul>
    );
}
