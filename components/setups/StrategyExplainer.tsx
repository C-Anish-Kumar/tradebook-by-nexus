import type { Strategy } from "@/lib/strategies";
import { cn } from "@/lib/utils";

/** The idea behind a strategy and what it checks on the chart, in plain words. */
export default function StrategyExplainer({ strategy, className }: { strategy: Strategy; className?: string }) {
    return (
        <div className={cn("flex flex-col gap-1.5 text-[12.5px]", className)}>
            <p className="text-muted-foreground">{strategy.rules}.</p>
            <p className="kicker">What it looks at (daily candles)</p>
            <ul className="list-disc pl-5 text-muted-foreground marker:text-faint">
                {strategy.looksAt.map((item) => <li key={item}>{item}</li>)}
            </ul>
        </div>
    );
}
