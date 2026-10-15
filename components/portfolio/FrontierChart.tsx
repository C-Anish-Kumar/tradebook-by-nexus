"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PortfolioResult } from "@/lib/analyst";

// One accent (the chosen portfolio) on neutral context: frontier line, stock dots
const ACCENT = '#199e70';
const H = 260, PAD = { l: 48, r: 16, t: 14, b: 34 };

const pct = (n: number) => `${Math.round(n * 100)}%`;

function niceTicks(lo: number, hi: number, count = 4) {
    const raw = (hi - lo) / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= raw) ?? 10 * mag;
    const out = [];
    for (let k = Math.ceil(lo / step); k * step <= hi + 1e-9; k++) out.push(Number((k * step).toFixed(6)) || 0);
    return out;
}

type Props = {
    frontier: PortfolioResult['frontier'];
    assets: PortfolioResult['assets'];
    selected: { label: string; annual_return: number; annual_volatility: number };
};

// Risk (volatility) on x, return on y, both yearly and in-sample over the whole window
export default function FrontierChart({ frontier, assets, selected }: Props) {
    const boxRef = useRef<HTMLDivElement>(null);
    const [W, setW] = useState(560);
    useEffect(() => {
        const el = boxRef.current;
        if (!el) return;
        const ro = new ResizeObserver(([entry]) => setW(Math.max(280, Math.round(entry.contentRect.width))));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const { x, y, xTicks, yTicks, path } = useMemo(() => {
        const pts = [...frontier, ...assets, selected];
        const vols = pts.map((p) => p.annual_volatility), rets = pts.map((p) => p.annual_return);
        const vMin = Math.min(0, ...vols), vMax = Math.max(...vols) * 1.08;
        const rPad = (Math.max(...rets) - Math.min(...rets)) * 0.1 || 0.05;
        const rMin = Math.min(0, Math.min(...rets) - rPad), rMax = Math.max(...rets) + rPad;
        const x = (v: number) => PAD.l + ((v - vMin) / (vMax - vMin)) * (W - PAD.l - PAD.r);
        const y = (r: number) => PAD.t + (1 - (r - rMin) / (rMax - rMin)) * (H - PAD.t - PAD.b);
        const sorted = [...frontier].sort((a, b) => a.annual_volatility - b.annual_volatility);
        const path = sorted.map((p, i) => `${i ? 'L' : 'M'}${x(p.annual_volatility).toFixed(1)},${y(p.annual_return).toFixed(1)}`).join('');
        return { x, y, xTicks: niceTicks(vMin, vMax), yTicks: niceTicks(rMin, rMax), path };
    }, [frontier, assets, selected, W]);

    return (
        <figure className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-4 text-[12px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke="var(--muted-foreground)" strokeWidth="2" /></svg>Efficient frontier</span>
                <span className="flex items-center gap-1.5"><svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="var(--faint)" /></svg>Single stock</span>
                <span className="flex items-center gap-1.5"><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill={ACCENT} /></svg>{selected.label}</span>
            </div>
            <div ref={boxRef}>
                <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img"
                     aria-label={`Efficient frontier. ${selected.label}: ${pct(selected.annual_return)} yearly return at ${pct(selected.annual_volatility)} volatility.`}>
                    {yTicks.map((v) => (
                        <g key={`y${v}`}>
                            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" />
                            <text x={PAD.l - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--faint)">{pct(v)}</text>
                        </g>
                    ))}
                    {xTicks.map((v) => (
                        <text key={`x${v}`} x={x(v)} y={H - PAD.b + 16} textAnchor="middle" fontSize="11" fill="var(--faint)">{pct(v)}</text>
                    ))}
                    <text x={W - PAD.r} y={H - 4} textAnchor="end" fontSize="11" fill="var(--faint)">Volatility (yearly) →</text>
                    <text x={PAD.l} y={PAD.t - 4} fontSize="11" fill="var(--faint)">Return ↑</text>
                    <path d={path} fill="none" stroke="var(--muted-foreground)" strokeWidth="2" strokeLinejoin="round" />
                    {assets.map((a) => (
                        <g key={a.ticker}>
                            <circle cx={x(a.annual_volatility)} cy={y(a.annual_return)} r="4" fill="var(--faint)" />
                            <text x={x(a.annual_volatility) + 7} y={y(a.annual_return)} dy="0.32em" fontSize="11" fill="var(--muted-foreground)">{a.ticker}</text>
                        </g>
                    ))}
                    <circle cx={x(selected.annual_volatility)} cy={y(selected.annual_return)} r="6" fill={ACCENT} stroke="var(--card)" strokeWidth="2" />
                </svg>
            </div>
        </figure>
    );
}
