import type { QuantScore } from '@/lib/setups';
import { cn } from '@/lib/utils';

const ringColor = (score: number) =>
    score >= 65 ? 'var(--up)' : score >= 50 ? 'var(--brand)' : score >= 35 ? 'var(--warn)' : 'var(--down)';

/** The 0-100 quant score as a ring with its label. */
export function QuantBadge({ quant, className }: { quant: QuantScore; className?: string }) {
    return (
        <div className={cn('flex items-center gap-3', className)} title="Quant score: setup quality out of 100, not a forecast">
            <div
                role="img"
                aria-label={`Quant score ${quant.score} out of 100, ${quant.label}`}
                className="grid size-[64px] flex-none place-items-center rounded-full"
                style={{ background: `conic-gradient(${ringColor(quant.score)} ${quant.score * 3.6}deg, var(--line) 0)` }}
            >
                <span className="num grid size-[56px] place-items-center rounded-full bg-card text-[20px] font-medium">{quant.score}</span>
            </div>
            <div className="leading-tight">
                <p className="kicker">Quant score</p>
                <p className="text-[13px] font-semibold">{quant.label}{quant.capped && <span className="font-normal text-faint"> · capped</span>}</p>
            </div>
        </div>
    );
}

/** Where the points came from, one bar per part. */
export function QuantBreakdown({ quant }: { quant: QuantScore }) {
    return (
        <ul className="mt-2 flex flex-col gap-2">
            {quant.components.map((c) => (
                <li key={c.key} className="text-[12px]">
                    <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-foreground">{c.label}</span>
                        <span className="num text-faint">{c.points} / {c.max}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${c.max ? (c.points / c.max) * 100 : 0}%` }} />
                    </div>
                    <p className="mt-1 text-faint">{c.note}</p>
                </li>
            ))}
            {quant.capped && (
                <li className="text-[12px] text-warn">Capped at 69: the strategy has not passed every validation gate on this stock yet.</li>
            )}
        </ul>
    );
}
