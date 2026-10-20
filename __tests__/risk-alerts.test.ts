import { describe, expect, it } from 'vitest';
import { dailySummaryMessage, entriesMessage, exitMessage, type AlertPick } from '@/lib/risk-alerts';
import type { PositionData } from '@/lib/risk';

const link = (t: string) => `<a>${t}</a>`;
const pick = (ticker: string, score: number, validated = false): AlertPick => ({
    row: { ticker, strategy: 'breakout', score, validated, entry: 50, stop: 47.5, target2r: 55, scanDate: '2026-10-20' },
    plan: { reason: 'fits', shares: 30, cost: 1500, risk: 75, riskPct: 0.75 },
});
const position: PositionData = {
    id: 'p1', ticker: 'AAA', name: null, strategy: 'ma_pullback', universe: 'large_cap', sector: 'Energy', shares: 30,
    entry: 50, stop: 47.5, target2r: 55, openedOn: '2026-10-01', status: 'open', exitPrice: null, closedOn: null, lastClose: 52, alerted: [],
};

describe('screener Telegram messages', () => {
    it('lists entries with size, stop and risk, and flags unvalidated ones', () => {
        const html = entriesMessage('Large-cap liquid', [pick('AAA', 69), pick('BBB', 61)], link);
        expect(html).toContain('Large-cap liquid: 2 entries fit your plan');
        expect(html).toContain('daily bar of 2026-10-20');
        expect(html).toContain('1. <b><a>AAA</a></b> · Trend breakout · score 69 (unvalidated)');
        expect(html).toContain('30 sh near $50.00, stop $47.50 · risk $75.00 (0.75%) · 2R $55.00');
        expect(html).toContain('Unvalidated strategies');
        expect(entriesMessage('X', [pick('AAA', 70, true)], link)).not.toContain('Unvalidated strategies');
    });

    it('tells you to exit with your P&L in dollars and R', () => {
        const stop = exitMessage(position, 'stop', 47, link);
        expect(stop).toContain('<a>AAA</a>: time to exit');
        expect(stop).toContain('Open P&L −$90.00 (-1.2R)');
        const target = exitMessage(position, 'target', 55.5, link);
        expect(target).toContain('reached 2R');
        expect(target).toContain('+$165.00 (+2.2R)');
    });

    it('summarises the night', () => {
        const html = dailySummaryMessage({
            date: '2026-10-20',
            market: { symbol: 'SPY', date: '2026-10-20', close: 540, sma50: 560, sma200: 550, above_200: false, trend_up: true },
            universes: [{ name: 'Large-cap liquid', members: 512, entries: 39, fits: 4, top: [pick('AAA', 69)] }],
            positions: [position],
            killed: ['breakout|under_5'],
            accountKilled: false,
            link,
            appUrl: 'https://example.test',
        });
        expect(html).toContain('Risk off');
        expect(html).toContain('Large-cap liquid</b>: 512 stocks, 39 entries, 4 fit your plan');
        expect(html).toContain('<a>AAA</a> 30 sh @ $50.00 → $52.00 +$60.00 (+0.8R)');
        expect(html).toContain('Kill switch on</b>: Trend breakout in Under $5');
        expect(html).not.toContain('Account kill switch');
    });
});
