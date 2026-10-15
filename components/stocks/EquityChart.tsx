"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BacktestResult } from "@/lib/analyst";

// Validated pair for the dark surface (dataviz palette: aqua, blue); buy & hold is also dashed
const STRATEGY = '#199e70';
const BUY_HOLD = '#3987e5';
const H = 240, PAD = { l: 60, r: 86, t: 12, b: 24 };

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const compact = (n: number) => `$${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)}`;

// Round tick steps (1, 2, 2.5, 5 × 10^k) so the axis reads $20K, $40K, ...
function niceTicks(lo: number, hi: number, count = 4) {
    const raw = (hi - lo) / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw) ?? 10 * mag;
    const out = [];
    for (let k = Math.ceil(lo / step); k * step <= hi; k++) out.push(k * step || 0); // `|| 0` turns -0 into 0
    return out;
}

export default function EquityChart({ points }: { points: BacktestResult['equity'] }) {
    const svgRef = useRef<SVGSVGElement>(null);
    const boxRef = useRef<HTMLDivElement>(null);
    const [hover, setHover] = useState<number | null>(null);
    // Draw at the real pixel width so text stays 11px on phones instead of shrinking with the SVG
    const [W, setW] = useState(720);
    useEffect(() => {
        const el = boxRef.current;
        if (!el) return;
        const ro = new ResizeObserver(([entry]) => setW(Math.max(300, Math.round(entry.contentRect.width))));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const { x, y, ticks, strategyPath, holdPath } = useMemo(() => {
        const values = points.flatMap((p) => [p.strategy, p.buy_hold]).filter(Number.isFinite);
        const min = Math.min(...values), max = Math.max(...values);
        const pad = (max - min) * 0.06 || 1;
        const lo = min - pad, hi = max + pad;
        const x = (i: number) => PAD.l + (i / Math.max(points.length - 1, 1)) * (W - PAD.l - PAD.r);
        const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
        const path = (key: 'strategy' | 'buy_hold') =>
            points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
        return { x, y, ticks: niceTicks(lo, hi), strategyPath: path('strategy'), holdPath: path('buy_hold') };
    }, [points, W]);

    if (points.length < 2) return null;
    const last = points[points.length - 1];
    const allYears = [...new Set(points.map((p) => p.date.slice(0, 4)))];
    const every = Math.ceil(allYears.length / Math.max(1, Math.floor((W - PAD.l - PAD.r) / 48)));
    const years = allYears.filter((_, i) => i % every === 0);

    const onMove = (e: React.PointerEvent) => {
        const rect = svgRef.current!.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * W;
        const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (points.length - 1));
        setHover(Math.max(0, Math.min(points.length - 1, i)));
    };
    const h = hover !== null ? points[hover] : null;

    return (
        <figure className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-4 text-[12px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke={STRATEGY} strokeWidth="2" /></svg>Strategy</span>
                <span className="flex items-center gap-1.5"><svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke={BUY_HOLD} strokeWidth="2" strokeDasharray="4 3" /></svg>Buy &amp; hold</span>
                <span className="text-faint">Growth of $10,000</span>
            </div>
            <div ref={boxRef} className="relative">
                <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full touch-none" role="img"
                     aria-label={`Equity curve: strategy ends at ${money(last.strategy)}, buy and hold at ${money(last.buy_hold)}`}
                     onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
                    {ticks.map((v) => (
                        <g key={v}>
                            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth="1" />
                            <text x={PAD.l - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--faint)">{compact(v)}</text>
                        </g>
                    ))}
                    {years.map((yr) => {
                        const i = points.findIndex((p) => p.date.startsWith(yr));
                        return i > 0 ? <text key={yr} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--faint)">{yr}</text> : null;
                    })}
                    <path d={holdPath} fill="none" stroke={BUY_HOLD} strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" />
                    <path d={strategyPath} fill="none" stroke={STRATEGY} strokeWidth="2" strokeLinejoin="round" />
                    {/* direct labels at the line ends */}
                    <text x={W - PAD.r + 8} y={y(last.strategy)} dy="0.32em" fontSize="11" fill="var(--foreground)">Strategy</text>
                    <text x={W - PAD.r + 8} y={y(last.buy_hold)} dy="0.32em" fontSize="11" fill="var(--muted-foreground)">Buy &amp; hold</text>
                    {h && hover !== null && (
                        <g>
                            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--faint)" strokeWidth="1" />
                            <circle cx={x(hover)} cy={y(h.strategy)} r="4" fill={STRATEGY} stroke="var(--card)" strokeWidth="2" />
                            <circle cx={x(hover)} cy={y(h.buy_hold)} r="4" fill={BUY_HOLD} stroke="var(--card)" strokeWidth="2" />
                        </g>
                    )}
                </svg>
                {h && hover !== null && (
                    <div className="pointer-events-none absolute top-1 rounded-[8px] bg-page px-2.5 py-1.5 text-[12px] shadow-[inset_0_0_0_1px_var(--line)]"
                         style={{ left: `${(x(hover) / W) * 100}%`, transform: hover > points.length / 2 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)' }}>
                        <p className="text-faint">Week of {h.date}</p>
                        <p className="num text-foreground">Strategy {money(h.strategy)}</p>
                        <p className="num text-muted-foreground">Buy &amp; hold {money(h.buy_hold)}</p>
                    </div>
                )}
            </div>
        </figure>
    );
}
