"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { YieldCurve } from "@/lib/market-intel";

// Same validated pair as the equity charts: today solid aqua, a month ago dashed blue
const NOW = '#199e70';
const AGO = '#3987e5';
const H = 220, PAD = { l: 44, r: 72, t: 12, b: 26 };

function niceTicks(lo: number, hi: number, count = 4) {
    const raw = (hi - lo) / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw) ?? 10 * mag;
    const out = [];
    for (let k = Math.ceil(lo / step); k * step <= hi + 1e-9; k++) out.push(Number((k * step).toFixed(4)));
    return out;
}

export default function YieldCurveChart({ curve }: { curve: YieldCurve }) {
    const boxRef = useRef<HTMLDivElement>(null);
    const [W, setW] = useState(480);
    const [hover, setHover] = useState<number | null>(null);
    useEffect(() => {
        const el = boxRef.current;
        if (!el) return;
        const ro = new ResizeObserver(([entry]) => setW(Math.max(280, Math.round(entry.contentRect.width))));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const pts = curve.points;
    const { x, y, ticks, nowPath, agoPath } = useMemo(() => {
        const vals = pts.flatMap((p) => [p.now, p.monthAgo ?? p.now]);
        const pad = (Math.max(...vals) - Math.min(...vals)) * 0.15 || 0.25;
        const lo = Math.min(...vals) - pad, hi = Math.max(...vals) + pad;
        const x = (i: number) => PAD.l + (i / Math.max(pts.length - 1, 1)) * (W - PAD.l - PAD.r);
        const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
        const path = (vs: (number | null)[]) => vs.map((v, i) => (v === null ? '' : `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join('');
        return { x, y, ticks: niceTicks(lo, hi), nowPath: path(pts.map((p) => p.now)), agoPath: path(pts.map((p) => p.monthAgo)) };
    }, [pts, W]);

    const last = pts[pts.length - 1];
    const inverted = curve.spread10y2y !== null && curve.spread10y2y < 0;
    const h = hover !== null ? pts[hover] : null;

    return (
        <figure className="flex flex-col gap-2 p-4">
            <div className="flex flex-wrap items-center gap-4 text-[12px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke={NOW} strokeWidth="2" /></svg>{curve.date}</span>
                <span className="flex items-center gap-1.5"><svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke={AGO} strokeWidth="2" strokeDasharray="4 3" /></svg>A month earlier</span>
            </div>
            <div ref={boxRef} className="relative">
                <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full touch-none" role="img"
                     aria-label={`US Treasury yield curve on ${curve.date}: ${pts.map((p) => `${p.maturity} ${p.now}%`).join(', ')}`}
                     onPointerLeave={() => setHover(null)}>
                    {ticks.map((v) => (
                        <g key={v}>
                            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" />
                            <text x={PAD.l - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--faint)">{v}%</text>
                        </g>
                    ))}
                    {pts.map((p, i) => (
                        <text key={p.maturity} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--faint)">{p.maturity}</text>
                    ))}
                    <path d={agoPath} fill="none" stroke={AGO} strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" />
                    <path d={nowPath} fill="none" stroke={NOW} strokeWidth="2" strokeLinejoin="round" />
                    {pts.map((p, i) => (
                        <circle key={p.maturity} cx={x(i)} cy={y(p.now)} r="4" fill={NOW} stroke="var(--card)" strokeWidth="2" />
                    ))}
                    {last && <text x={W - PAD.r + 8} y={y(last.now)} dy="0.32em" fontSize="11" fill="var(--foreground)">Today</text>}
                    {last?.monthAgo != null && <text x={W - PAD.r + 8} y={y(last.monthAgo)} dy="0.32em" fontSize="11" fill="var(--muted-foreground)">Month ago</text>}
                    {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--faint)" />}
                    {/* hit targets wider than the marks */}
                    {pts.map((p, i) => (
                        <rect key={p.maturity} x={x(i) - (W - PAD.l - PAD.r) / (2 * Math.max(pts.length - 1, 1))} y={PAD.t}
                              width={(W - PAD.l - PAD.r) / Math.max(pts.length - 1, 1)} height={H - PAD.t - PAD.b}
                              fill="transparent" onPointerEnter={() => setHover(i)} />
                    ))}
                </svg>
                {h && hover !== null && (
                    <div className="pointer-events-none absolute top-1 rounded-[8px] bg-page px-2.5 py-1.5 text-[12px] shadow-[inset_0_0_0_1px_var(--line)]"
                         style={{ left: `${(x(hover) / W) * 100}%`, transform: hover > pts.length / 2 ? 'translateX(calc(-100% - 8px))' : 'translateX(8px)' }}>
                        <p className="text-faint">{h.maturity} Treasury</p>
                        <p className="num text-foreground">Today {h.now.toFixed(2)}%</p>
                        {h.monthAgo !== null && <p className="num text-muted-foreground">Month ago {h.monthAgo.toFixed(2)}%</p>}
                    </div>
                )}
            </div>
            <p className="text-[12.5px]">
                10Y minus 2Y: <span className="num font-semibold">{curve.spread10y2y ?? '—'} pts</span>
                <span className="text-faint"> · </span>10Y minus 3M: <span className="num font-semibold">{curve.spread10y3m ?? '—'} pts</span>
                {inverted && <span className="pill ml-2 text-warn">Inverted</span>}
            </p>
            <p className="text-[12px] text-faint">
                {inverted ? 'Short rates above long rates. Inversions have often come before recessions, with a long and variable lag.' : 'Long rates above short rates, the normal shape.'} Source: FRED.
            </p>
        </figure>
    );
}
