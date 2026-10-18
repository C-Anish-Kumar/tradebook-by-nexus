import { describe, expect, it } from 'vitest';
import { evaluateTrade, summarize } from '@/lib/forward-test';

const t = { entry: 100, stop: 95, target2r: 110, signalDate: '2026-10-01', outcome: 'open' as const };
const bar = (date: string, close: number, status: 'entry' | 'holding' | 'none' = 'holding') => ({ date, close, status });

describe('evaluateTrade', () => {
    it('ignores the signal bar itself', () => expect(evaluateTrade(t, bar('2026-10-01', 90))).toBeNull());
    it('stops out on a close at or under the stop', () => expect(evaluateTrade(t, bar('2026-10-03', 94))).toMatchObject({ outcome: 'stopped', r: -1.2 }));
    it('takes the 2R target', () => expect(evaluateTrade(t, bar('2026-10-09', 111))).toMatchObject({ outcome: 'target', r: 2.2 }));
    it('closes when the strategy exits', () => expect(evaluateTrade(t, bar('2026-10-05', 102, 'none'))).toMatchObject({ outcome: 'exited', r: 0.4 }));
    it('expires old trades', () => expect(evaluateTrade(t, bar('2026-11-10', 101))).toMatchObject({ outcome: 'expired' }));
    it('stays open otherwise', () => expect(evaluateTrade(t, bar('2026-10-05', 101))).toEqual({ outcome: 'open', lastClose: 101 }));
    it('skips closed trades', () => expect(evaluateTrade({ ...t, outcome: 'stopped' }, bar('2026-10-05', 90))).toBeNull());
});

describe('summarize', () => {
    it('reports win rate and average R on closed trades only', () => {
        expect(summarize([{ outcome: 'target', r: 2 }, { outcome: 'stopped', r: -1 }, { outcome: 'open' }])).toEqual({ trades: 3, open: 1, closed: 2, winRate: 50, avgR: 0.5, totalR: 1 });
    });
    it('has no stats before any trade closes', () => expect(summarize([{ outcome: 'open' }]).winRate).toBeNull());
});
