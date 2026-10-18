// The strategies the app can deliver trade signals from. Each one has a name, a switch, and (if it scans
// the watchlist) its own Setups tab and Telegram opt-in. Only enabled strategies show up anywhere, so
// adding a strategy means adding one entry here plus its scanner; turning one off is a one-word change.
//
//   EMA + Supertrend: a fixed rule checklist on the stock page. Switched off for now.
//   Trend breakout: a regime-gated breakout scan with walk-forward evidence and a 0-100 quant score.
//   The rest: daily-chart setups from the TEDucation 2.0 knowledge base, scanned and scored the same way.
//
// Users only ever see `name`, `rules` and `looksAt`, so keep them in plain words; `looksAt` mirrors what the
// analyst service actually checks (analyst-service/openstock_analyst/aqp/strategies).
import type { NotificationPrefs } from '@/database/models/notification.model';

export type StrategyId = 'ema_supertrend' | 'breakout' | 'ma_pullback' | 'golden_cross' | 'breakout_retest' | 'volume_bounce';

export type Strategy = {
    id: StrategyId;
    /** What users see everywhere: a descriptive name, never a number. */
    name: string;
    /** One plain sentence: the idea behind the trade. */
    rules: string;
    /** What the strategy checks on the daily chart, in the order it checks them. */
    looksAt: string[];
    /** Off means it appears nowhere: no panel, no Telegram switch, no scheduled message. */
    enabled: boolean;
    /** Scans the watchlist and stores a Setup per stock, so it gets a tab on the Setups page. */
    scanner: boolean;
    /** The Telegram switch that opts a user in to this strategy's messages. */
    telegramPref: keyof NotificationPrefs;
};

export const STRATEGIES: Record<StrategyId, Strategy> = {
    ema_supertrend: {
        id: 'ema_supertrend',
        name: 'EMA + Supertrend',
        rules: 'Ride a trend while the fast averages and Supertrend agree it is up',
        looksAt: [
            'Trend: the 10-day EMA above the 21-day EMA, with Supertrend (10, 3) pointing up',
            'Entry: a pullback that touches the EMAs, or a tight 4-day range that breaks out',
            'Stop: under the lowest low of the last 10 days; exits are staged as the trend weakens',
        ],
        enabled: false,
        scanner: false,
        telegramPref: 'signals',
    },
    breakout: {
        id: 'breakout',
        name: 'Trend breakout',
        rules: 'Buy when price closes above its last swing high while the market is trending, then trail a stop behind it',
        looksAt: [
            'Breakout: a daily close above the most recent swing high',
            'Trend strength: ADX above about 20, so it skips choppy, sideways markets',
            'Exit: a trailing stop a few ATRs (average daily ranges) below the highest close since entry',
            'Evidence: the rules are re-tested on this stock\'s own history (walk-forward) before the score trusts them',
        ],
        enabled: true,
        scanner: true,
        telegramPref: 'setups',
    },
    ma_pullback: {
        id: 'ma_pullback',
        name: '20/50 MA pullback',
        rules: 'In an uptrend, buy the quiet dip back to the 20-day average',
        looksAt: [
            'Trend: the 20-day average has been above the 50-day for at least 5 days, and price is above the 50',
            'Pullback: price dips to the 20-day average and closes back above it',
            'Volume: the dip happens on normal or light volume (sellers aren\'t rushing out)',
            'Exit: a close clearly back below the 20-day average, or the trailing stop',
        ],
        enabled: true,
        scanner: true,
        telegramPref: 'maPullback',
    },
    golden_cross: {
        id: 'golden_cross',
        name: 'Golden cross pullback',
        rules: 'After the 50-day average crosses above a rising 200-day, buy the dip to the 50',
        looksAt: [
            'Golden cross: the 50-day average has been above the 200-day for at least 10 days',
            'The 200-day average is rising (it skips stocks in a long-term decline)',
            'Pullback: price dips to the 50-day average on light volume and closes back above it',
            'Exit: a close below the 50-day average, or the trailing stop',
        ],
        enabled: true,
        scanner: true,
        telegramPref: 'goldenCross',
    },
    breakout_retest: {
        id: 'breakout_retest',
        name: 'Breakout and retest',
        rules: 'Wait for a loud breakout, then buy the quiet pullback that holds the broken level',
        looksAt: [
            'Breakout: a close above the last swing high on at least 1.5x average volume',
            'Retest: within 10 days price comes back to that level and closes above it',
            'Volume: the retest is on average or lighter volume',
            'Stop: just back below the broken level; the setup is dropped if price closes well under it',
        ],
        enabled: true,
        scanner: true,
        telegramPref: 'breakoutRetest',
    },
    volume_bounce: {
        id: 'volume_bounce',
        name: 'High-volume bounce',
        rules: 'Buy a strong reversal candle on heavy volume right at support',
        looksAt: [
            'Candle: a hammer (long lower wick, close in the top half) or a bullish engulfing',
            'Volume: at least 1.5x the 20-day average, so buyers clearly stepped in',
            'Support: the low tests the prior 20-day low or the 50-day average',
            'Entry after the candle closes; stop just below its low',
        ],
        enabled: true,
        scanner: true,
        telegramPref: 'volumeBounce',
    },
};

export const STRATEGY_1 = STRATEGIES.ema_supertrend;
export const STRATEGY_2 = STRATEGIES.breakout;

export const enabledStrategies = (): Strategy[] => Object.values(STRATEGIES).filter((s) => s.enabled);

/** Strategies that get a tab on the Setups page. */
export const scannerStrategies = (): Strategy[] => enabledStrategies().filter((s) => s.scanner);

/** Where a strategy's stored scan result for one stock lives. Breakout keeps its original key so existing results survive. */
export const setupCacheKey = (id: StrategyId, symbol: string) => (id === 'breakout' ? `setup:${symbol}` : `setup:${id}:${symbol}`);

/** Where the last seen status lives, so the scan can tell a fresh entry from a trade already running. */
export const setupStateKey = (id: StrategyId, symbol: string) => (id === 'breakout' ? `setup-state:${symbol}` : `setup-state:${id}:${symbol}`);
