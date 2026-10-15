import Link from "next/link";
import type { EarningsEvent } from "@/lib/market-intel";
import { cn } from "@/lib/utils";

const HOUR = { bmo: 'Before open', amc: 'After close', dmh: 'During hours', '': '' } as const;
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const money = (n: number | null) => n === null ? '—' : `$${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)}`;

// Upcoming reports show the estimate; reported ones show actual vs estimate with beat / miss
export default function EarningsList({ events, empty }: { events: EarningsEvent[]; empty: string }) {
    if (events.length === 0) return <p className="p-4 text-[13px] text-faint">{empty}</p>;
    return (
        <ul className="flex flex-col p-2">
            {events.map((e) => {
                const reported = e.epsActual !== null;
                const beat = reported && e.epsEstimate !== null ? e.epsActual! >= e.epsEstimate : null;
                return (
                    <li key={`${e.symbol}-${e.date}`}>
                        <Link href={`/stocks/${e.symbol}`} className="flex items-center gap-3 rounded-[8px] px-2 py-2 hover:bg-hover">
                            <span className="num w-14 shrink-0 text-[13px] font-semibold">{e.symbol}</span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-[12.5px]">{day(e.date)}{HOUR[e.hour] && <span className="text-faint"> · {HOUR[e.hour]}</span>}</span>
                                <span className="block truncate text-[11.5px] text-faint">Q{e.quarter} {e.year} · revenue est. {money(e.revenueEstimate)}</span>
                            </span>
                            <span className="text-right">
                                {reported ? (
                                    <>
                                        <span className={cn('pill', beat === null ? '' : beat ? 'is-up' : 'is-down')}>{beat === null ? 'Reported' : beat ? 'Beat' : 'Miss'}</span>
                                        <span className="num block text-[11.5px] text-faint">EPS {e.epsActual} vs {e.epsEstimate ?? '—'}</span>
                                    </>
                                ) : (
                                    <span className="num block text-[12px] text-muted-foreground">EPS est. {e.epsEstimate ?? '—'}</span>
                                )}
                            </span>
                        </Link>
                    </li>
                );
            })}
        </ul>
    );
}
