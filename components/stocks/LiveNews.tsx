"use client";

import { useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ArrowUpRight, Newspaper } from "lucide-react";
import { refreshStockNews } from "@/lib/actions/news.actions";

const POLL_MS = 60_000;

/** A stock's headlines, re-checked every minute while the tab is visible. New stories are marked until the next check. */
export default function LiveNews({ symbol, initial }: { symbol: string; initial: MarketNewsArticle[] }) {
    const [news, setNews] = useState(initial);
    const [fresh, setFresh] = useState<Set<string>>(new Set());
    const [checkedAt, setCheckedAt] = useState(() => Date.now());
    const [, tick] = useState(0);
    const known = useRef(new Set(initial.map((n) => n.url)));

    useEffect(() => {
        let stopped = false;
        const check = async () => {
            if (document.hidden) return;
            const res = await refreshStockNews(symbol).catch(() => null);
            if (stopped || !res || 'error' in res) return;
            setFresh(new Set(res.data.filter((n) => !known.current.has(n.url)).map((n) => n.url)));
            res.data.forEach((n) => known.current.add(n.url));
            setNews(res.data);
            setCheckedAt(Date.now());
        };
        const poll = setInterval(check, POLL_MS);
        const clock = setInterval(() => tick((t) => t + 1), 15_000); // keeps "x minutes ago" honest
        const onVisible = () => { if (!document.hidden) check(); };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            stopped = true;
            clearInterval(poll);
            clearInterval(clock);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [symbol]);

    if (news.length === 0) {
        return (
            <div className="empty-state py-10">
                <span className="empty-icon"><Newspaper className="size-5" /></span>
                <h3>No news in the last three days</h3>
                <p className="max-w-80 text-[13px]">This panel checks again every minute.</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col">
            <p className="flex items-center gap-2 px-4 pt-3 text-[12px] text-faint">
                <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-up opacity-60" />
                    <span className="relative inline-flex size-2 rounded-full bg-up" />
                </span>
                Live · checked {formatDistanceToNow(checkedAt, { addSuffix: true })}
            </p>
            <ul className="row-list max-h-[520px] overflow-y-auto">
                {news.map((item) => (
                    <li key={item.url}>
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-hover/50">
                            <span className="min-w-0 flex-1">
                                <span className="line-clamp-2 font-semibold text-foreground transition-colors group-hover:text-brand-ink">
                                    {fresh.has(item.url) && <span className="pill is-up mr-2 align-middle">New</span>}
                                    {item.headline}
                                </span>
                                <span className="mt-1 line-clamp-2 text-[12.5px] text-muted-foreground">{item.summary}</span>
                                <span className="mt-1 block truncate text-[12px] text-faint">
                                    {item.source} · {formatDistanceToNow(item.datetime * 1000, { addSuffix: true })}
                                </span>
                            </span>
                            <ArrowUpRight className="mt-1 size-4 flex-none text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                        </a>
                    </li>
                ))}
            </ul>
        </div>
    );
}
