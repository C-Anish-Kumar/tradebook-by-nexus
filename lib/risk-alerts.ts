// Telegram messages for the screener's risk layer: entries that fit your plan, exits on positions you took, and the
// nightly summary. Pure text builders (links are passed in), so the tests can read exactly what gets sent.
import { universeById } from '@/config/universes';
import { STRATEGIES, type StrategyId } from '@/lib/strategies';
import type { ScreenerRowData } from '@/lib/screener';
import {
    EXIT_LABEL, positionPnl, positionR, regimeLabel,
    type ExitReason, type MarketRegime, type PlanDecision, type PositionData,
} from '@/lib/risk';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signedUsd = (n: number) => `${n < 0 ? '−' : '+'}${usd(Math.abs(n))}`;
const signedR = (r: number | null) => (r === null ? '' : ` (${r > 0 ? '+' : ''}${r}R)`);
const strategyName = (id: string) => STRATEGIES[id as StrategyId]?.name ?? id;

type Link = (ticker: string) => string;
export type AlertPick = {
    row: Pick<ScreenerRowData, 'ticker' | 'strategy' | 'score' | 'validated' | 'entry' | 'stop' | 'target2r' | 'scanDate'>;
    plan: PlanDecision;
};

const FOOTER = '<i>Research tooling, not financial advice. Nothing is ordered for you.</i>';

function pickLine(link: Link, { row, plan }: AlertPick, i: number): string {
    return [
        `${i + 1}. <b>${link(row.ticker)}</b> · ${esc(strategyName(row.strategy))} · score ${row.score}${row.validated ? '' : ' (unvalidated)'}`,
        `   ${plan.shares} sh near ${usd(row.entry ?? 0)}, stop ${usd(row.stop ?? 0)} · risk ${usd(plan.risk)} (${plan.riskPct}%)${row.target2r != null ? ` · 2R ${usd(row.target2r)}` : ''}`,
    ].join('\n');
}

/** Tonight's entries in one universe that fit your caps, best first. */
export function entriesMessage(universe: string, picks: AlertPick[], link: Link): string {
    const unvalidated = picks.some((p) => !p.row.validated);
    return [
        `🟢 <b>${esc(universe)}: ${picks.length} entr${picks.length === 1 ? 'y fits' : 'ies fit'} your plan</b> (daily bar of ${picks[0]?.row.scanDate ?? '?'})`,
        ...picks.map((p, i) => pickLine(link, p, i)),
        ...(unvalidated ? ['<i>⚠️ Unvalidated strategies have no proven edge yet: paper-trade them, or size them down.</i>'] : []),
        FOOTER,
    ].join('\n');
}

/** A position you marked as taken has hit its stop, its strategy's exit, or 2R. */
export function exitMessage(p: PositionData, reason: ExitReason, close: number, link: Link): string {
    const pnl = positionPnl(p, close);
    const head = reason === 'target' ? `🎯 <b>${link(p.ticker)} reached 2R</b>` : `🔴 <b>${link(p.ticker)}: time to exit</b>`;
    return [
        head,
        `${esc(EXIT_LABEL[reason])} (${esc(strategyName(p.strategy))}).`,
        `Close ${usd(close)} · your entry ${usd(p.entry)} · stop ${usd(p.stop)} · ${p.shares} sh`,
        `Open P&L ${signedUsd(pnl)}${signedR(positionR(p, close))}`,
        reason === 'target' ? 'Consider taking profit or tightening the stop.' : 'Close it at your broker, then mark it closed on the Positions page.',
        FOOTER,
    ].join('\n');
}

export type SummaryUniverse = { name: string; members: number; entries: number; fits: number; top: AlertPick[] };

/** The nightly screener summary: market regime, each universe's entries and what fits, your positions, kill switches. */
export function dailySummaryMessage(input: {
    date: string | null;
    market: MarketRegime | null | undefined;
    universes: SummaryUniverse[];
    positions: PositionData[];
    killed: string[];
    accountKilled: boolean;
    link: Link;
    appUrl: string;
}): string {
    const lines = [`📋 <b>Screener · daily bar of ${input.date ?? '?'}</b>`, esc(regimeLabel(input.market)), ''];
    for (const u of input.universes) {
        lines.push(`<b>${esc(u.name)}</b>: ${u.members} stocks, ${u.entries} entr${u.entries === 1 ? 'y' : 'ies'}, ${u.fits} fit${u.fits === 1 ? 's' : ''} your plan`);
        u.top.forEach((p) => lines.push(`  · ${input.link(p.row.ticker)} ${esc(strategyName(p.row.strategy))}, score ${p.row.score}, ${p.plan.shares} sh`));
    }
    if (input.positions.length) {
        lines.push('', '<b>Your positions</b>');
        for (const p of input.positions) {
            const px = p.lastClose ?? p.entry;
            lines.push(`  · ${input.link(p.ticker)} ${p.shares} sh @ ${usd(p.entry)} → ${usd(px)} ${signedUsd(positionPnl(p, px))}${signedR(positionR(p, px))}`);
        }
    }
    if (input.accountKilled) lines.push('', '⛔ <b>Account kill switch is on</b>: no new entries until you reset it on the Positions page.');
    if (input.killed.length) {
        lines.push('', `⛔ <b>Kill switch on</b>: ${input.killed.map((k) => { const [s, u] = k.split('|'); return esc(`${strategyName(s)} in ${universeById(u)?.name ?? u}`); }).join(', ')}`);
    }
    lines.push('', `<a href="${input.appUrl}/">Open the screener</a>`, FOOTER);
    return lines.join('\n');
}
