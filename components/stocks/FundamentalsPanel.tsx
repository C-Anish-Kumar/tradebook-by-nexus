import { ExternalLink } from "lucide-react";
import type { Fundamentals } from "@/lib/analyst";
import { cn } from "@/lib/utils";

const compact = (n: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const money = (n: number | null) => (n === null ? '—' : `${n < 0 ? '−' : ''}$${compact(Math.abs(n))}`);
const pct = (n: number | null | undefined, signed = false) =>
    n === null || n === undefined ? '—' : `${signed && n > 0 ? '+' : ''}${n.toFixed(1)}%`;

// Rows shown as plain counts instead of dollars
const COUNT_LINES = new Set(['diluted_shares']);

export default function FundamentalsPanel({ data }: { data: Fundamentals }) {
    const { periods, lines, derived, insiders, filings } = data;
    const cols = periods.length ? periods : lines[0]?.values.map((_, i) => (i === 0 ? 'Latest FY' : `FY −${i}`)) ?? [];
    // Banks and insurers report interest income and no operating income, so the generic lines read oddly
    const financialCo = /bank|insurance|savings|credit|finance/i.test(data.industry ?? '') || !lines.some((l) => l.key === 'operating_income');
    const ratios = [
        { label: 'Revenue growth', values: derived.revenue_growth_pct, signed: true },
        { label: 'Operating margin', values: derived.operating_margin_pct, signed: false },
        { label: 'Net margin', values: derived.net_margin_pct, signed: false },
        { label: 'Free cash flow margin', values: derived.fcf_margin_pct, signed: false },
    ]
        // Margins on a bank's "revenue" line aren't comparable with other companies
        .filter((r) => !financialCo || r.label === 'Revenue growth')
        .filter((r) => r.values?.some((v) => v !== null));
    const net = insiders.bought_value - insiders.sold_value;

    return (
        <div className="flex flex-col gap-5 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[13px] text-muted-foreground">
                    <span className="font-semibold text-foreground">{data.name}</span>
                    {data.industry && <> · {data.industry}</>}
                </p>
                <a href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${data.cik}`} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-ink hover:underline">
                    EDGAR CIK {data.cik} <ExternalLink className="size-3" />
                </a>
            </div>

            {lines.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[420px] text-left text-[13px]">
                        <caption className="sr-only">Annual figures from 10-K filings, latest year first</caption>
                        <thead className="text-[11px] uppercase tracking-wide text-faint">
                            <tr>
                                <th className="py-1.5 pr-3 font-semibold">Annual (10-K)</th>
                                {cols.map((p) => (
                                    <th key={p} className="py-1.5 pl-3 text-right font-semibold">
                                        {/^\d{4}-\d{2}-\d{2}$/.test(p) ? <abbr title={`Fiscal year ended ${p}`} className="no-underline">FY{p.slice(0, 4)}</abbr> : p}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {lines.map((l) => (
                                <tr key={l.key} className="border-t border-line">
                                    <th scope="row" className="py-1.5 pr-3 font-normal text-muted-foreground">{l.label}</th>
                                    {cols.map((p, i) => {
                                        const v = l.values[i] ?? null;
                                        return (
                                            <td key={p} className={cn('num py-1.5 pl-3 text-right', v !== null && v < 0 && 'text-down')}>
                                                {COUNT_LINES.has(l.key) ? (v === null ? '—' : compact(v)) : money(v)}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                            {ratios.map((r) => (
                                <tr key={r.label} className="border-t border-line">
                                    <th scope="row" className="py-1.5 pr-3 font-normal text-muted-foreground">{r.label}</th>
                                    {cols.map((p, i) => {
                                        const v = r.values?.[i] ?? null;
                                        return (
                                            <td key={p} className={cn('num py-1.5 pl-3 text-right font-semibold', v !== null && (v >= 0 ? 'text-up' : 'text-down'))}>
                                                {pct(v, r.signed)}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {financialCo && (
                        <p className="mt-2 text-[12px] text-warn">
                            Financial companies report interest income and provisions rather than operating income, so some lines are missing and margins are hidden.
                        </p>
                    )}
                </div>
            )}

            <section className="flex flex-col gap-2" aria-labelledby="insiders-head">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 id="insiders-head" className="kicker">Insider trades · last {insiders.days} days</h3>
                    {insiders.trades.length > 0 && (
                        <p className="num text-[12px] text-muted-foreground">
                            Bought <span className="text-up">{money(insiders.bought_value)}</span> · Sold <span className="text-down">{money(insiders.sold_value)}</span>
                            {' '}· Net <span className={net >= 0 ? 'text-up' : 'text-down'}>{money(net)}</span>
                        </p>
                    )}
                </div>
                {insiders.trades.length === 0 ? (
                    <p className="text-[13px] text-faint">
                        No open-market buys or sells by officers or directors in the last {insiders.filings_scanned} Form 4 filings.
                    </p>
                ) : (
                    <ul className="flex flex-col">
                        {insiders.trades.map((t, i) => (
                            <li key={`${t.url}-${i}`} className="flex items-center gap-3 border-t border-line py-2 first:border-t-0">
                                <span className={cn('pill', t.side === 'buy' ? 'is-up' : 'is-down')}>{t.side === 'buy' ? 'Buy' : 'Sell'}</span>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-[13px] font-semibold">{t.name}</p>
                                    <p className="truncate text-[12px] text-faint">
                                        {t.position || 'Insider'} · {t.date}{t.planned && ' · 10b5-1 plan'}
                                    </p>
                                </div>
                                <div className="text-right">
                                    <p className="num text-[13px] font-semibold">{money(t.value)}</p>
                                    <p className="num text-[12px] text-faint">{compact(t.shares)} sh</p>
                                </div>
                                <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-faint hover:text-foreground" aria-label={`Form 4 filing by ${t.name}`}>
                                    <ExternalLink className="size-3.5" />
                                </a>
                            </li>
                        ))}
                    </ul>
                )}
                <p className="text-[12px] text-faint">A 10b5-1 sale was scheduled in advance, so it says less about the insider’s view than an unplanned one.</p>
            </section>

            {filings.length > 0 && (
                <section className="flex flex-col gap-2" aria-labelledby="filings-head">
                    <h3 id="filings-head" className="kicker">Recent filings</h3>
                    <ul className="flex flex-wrap gap-2">
                        {filings.map((f) => (
                            <li key={f.url}>
                                <a href={f.url} target="_blank" rel="noopener noreferrer"
                                   className="inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-[12px] shadow-[inset_0_0_0_1px_var(--line)] hover:bg-hover">
                                    <span className="font-semibold">{f.form}</span>
                                    <span className="num text-faint">{f.date}</span>
                                </a>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
}
