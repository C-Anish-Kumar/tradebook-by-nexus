import type { FearGreed } from "@/lib/market-intel";
import { fearGreedLabel } from "@/lib/market-intel";

const BANDS = [[0, 25, 'Extreme fear'], [25, 45, 'Fear'], [45, 55, 'Neutral'], [55, 75, 'Greed'], [75, 100, 'Extreme greed']] as const;

// A single headline number on a neutral meter: the label, not a colour, says fear or greed
export default function FearGreedCard({ data }: { data: FearGreed }) {
    const ago = [['A week ago', data.weekAgo], ['A month ago', data.monthAgo]] as const;
    return (
        <div className="flex flex-col gap-4 p-4">
            <div className="flex items-end justify-between gap-3">
                <div>
                    <p className="num text-[40px] font-bold leading-none tracking-[-0.03em]">{data.score}</p>
                    <p className="mt-1 text-[15px] font-semibold">{data.label}</p>
                </div>
                <dl className="flex gap-4 text-right">
                    {ago.map(([label, v]) => v !== null && (
                        <div key={label}>
                            <dt className="text-[11px] text-faint">{label}</dt>
                            <dd className="num text-[13px] font-semibold">{v} <span className="font-normal text-muted-foreground">{fearGreedLabel(v)}</span></dd>
                        </div>
                    ))}
                </dl>
            </div>

            <div role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={data.score} aria-valuetext={`${data.score}, ${data.label}`}>
                <div className="relative flex h-2.5 gap-[2px]">
                    {BANDS.map(([lo, hi, label]) => (
                        <span key={label} className="h-full rounded-[3px] bg-hover" style={{ width: `${hi - lo}%`, opacity: data.score >= lo && data.score < hi + (hi === 100 ? 1 : 0) ? 1 : 0.55 }} />
                    ))}
                    <span className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--card)] bg-foreground" style={{ left: `${data.score}%` }} aria-hidden />
                </div>
                <div className="mt-1.5 flex justify-between text-[11px] text-faint"><span>Fear</span><span>Neutral</span><span>Greed</span></div>
            </div>

            <ul className="flex flex-col gap-2">
                {data.components.map((c) => (
                    <li key={c.key} className="grid grid-cols-[96px_1fr_28px] items-center gap-2 text-[12.5px]">
                        <span className="text-muted-foreground">{c.label}</span>
                        <span className="flex flex-col gap-0.5">
                            <span className="h-1.5 rounded-full bg-hover" aria-hidden><span className="block h-1.5 rounded-full bg-muted-foreground" style={{ width: `${c.score}%` }} /></span>
                            <span className="text-[11px] text-faint">{c.detail}</span>
                        </span>
                        <span className="num text-right font-semibold">{c.score}</span>
                    </li>
                ))}
            </ul>
            <p className="text-[12px] text-faint">Each gauge is ranked against its past year (0 = most fearful). Data from FRED, as of {data.asOf}.</p>
        </div>
    );
}
