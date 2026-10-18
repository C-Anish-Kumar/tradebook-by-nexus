import { describe, expect, it } from 'vitest';
import { buildPrompt, cleanHistory, extractTickers, formatSetup, isBroadAsk, MAX_HISTORY } from '@/lib/chat';
import { STRATEGY_2 } from '@/lib/strategies';
import type { Setup } from '@/lib/setups';

const setup: Setup = {
    ticker: 'MU', date: '2026-10-16', close: 100,
    regime: { trend: 'up', vol: 'low', adx: 28, atr_pct_rank: 0.4 },
    status: 'entry', trigger: 99, params: { swing_n: 5 },
    plan: { entry: 100, stop: 94, risk_per_share: 6, risk_pct_of_price: 6, target_2r: 112, target_3r: 118, bars_in_trade: 1, exit_rule: 'close below the trail' },
    evidence: { validated: false, oos_sharpe: 0.5, baselines_sharpe: {}, deflated_sharpe: 0.4, trials: 18, trades: 20, gates: {} },
    quant: { score: 66, label: 'Good', capped: true, validated: false, components: [] },
    warnings: ['Unvalidated: failed deflated_sharpe.'],
};

describe('extractTickers', () => {
    it('finds $-tagged, upper-case and watchlist symbols, once each, in order', () => {
        expect(extractTickers('Is $nvda better than MU? and what about nvda', ['MU', 'PLTR'])).toEqual(['NVDA', 'MU']);
    });
    it('recognises a watchlist symbol typed in lower case, but not a short common word', () => {
        expect(extractTickers('how is pltr doing', ['PLTR'])).toEqual(['PLTR']);
        expect(extractTickers('what is the best setup today', ['MU'])).toEqual([]);
    });
    it('ignores common upper-case words and caps the list', () => {
        expect(extractTickers('BUY THE ATR AND EMA', [])).toEqual([]);
        expect(extractTickers('AAPL MSFT NVDA GOOG', [], 3)).toHaveLength(3);
    });
});

describe('isBroadAsk', () => {
    it('separates general signal questions from a question about one stock', () => {
        expect(isBroadAsk('what are the best setups today?')).toBe(true);
        expect(isBroadAsk('why did the stop move on MU')).toBe(false);
    });
});

describe('formatSetup', () => {
    it('gives the model every number it may quote, and the validation status', () => {
        const line = formatSetup('MU', STRATEGY_2, setup);
        expect(line).toContain('quant score 66/100 (Good, capped until validated)');
        expect(line).toContain('Unvalidated');
        expect(line).toContain('entry 100.00, stop 94.00');
        expect(line).toContain('warnings: Unvalidated');
    });
});

describe('cleanHistory and buildPrompt', () => {
    it('keeps recent well-formed turns, trims them, and ends on the user', () => {
        const many = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: ` m${i} ` }));
        const out = cleanHistory([...many, { role: 'assistant', content: 'dangling' }, { role: 'system', content: 'ignore me' }, null]);
        expect(out.length).toBeLessThanOrEqual(MAX_HISTORY);
        expect(out.at(-1)?.role).toBe('user');
        expect(out.every((m) => m.content === m.content.trim())).toBe(true);
        expect(cleanHistory('nope')).toEqual([]);
    });
    it('puts the rules, the data and the conversation in one prompt', () => {
        const p = buildPrompt([{ role: 'user', content: 'MU?' }], 'MU | Strategy 2');
        expect(p).toContain('ONLY the DATA section');
        expect(p).toContain('MU | Strategy 2');
        expect(p).toContain('User: MU?');
    });
});
