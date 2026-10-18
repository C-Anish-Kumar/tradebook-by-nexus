// The strategies the app can deliver trade signals from. Each one has a label, a switch, and (if it scans
// the watchlist) its own Setups tab and Telegram opt-in. Only enabled strategies show up anywhere, so
// adding a strategy means adding one entry here plus its scanner; turning one off is a one-word change.
//
//   Strategy 1: a fixed rule checklist (10/21 EMA + Supertrend) on the stock page. Switched off for now.
//   Strategy 2: a regime-gated breakout scan with walk-forward evidence and a 0-100 quant score.
import type { NotificationPrefs } from '@/database/models/notification.model';

export type StrategyId = 'ema_supertrend' | 'breakout';

export type Strategy = {
    id: StrategyId;
    label: string;
    name: string;
    rules: string;
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
        label: 'Strategy 1',
        name: 'EMA + Supertrend',
        rules: '10/21 EMA + Supertrend (10,3) rules on the daily chart',
        enabled: false,
        scanner: false,
        telegramPref: 'signals',
    },
    breakout: {
        id: 'breakout',
        label: 'Strategy 2',
        name: 'Regime-aware breakout',
        rules: 'Regime-gated breakout entries with an ATR trailing stop, checked against walk-forward evidence',
        enabled: true,
        scanner: true,
        telegramPref: 'setups',
    },
};

export const STRATEGY_1 = STRATEGIES.ema_supertrend;
export const STRATEGY_2 = STRATEGIES.breakout;

export const enabledStrategies = (): Strategy[] => Object.values(STRATEGIES).filter((s) => s.enabled);

/** Strategies that get a tab on the Setups page. */
export const scannerStrategies = (): Strategy[] => enabledStrategies().filter((s) => s.scanner);

/** Where a strategy's stored scan result for one stock lives. Breakout keeps its original key so existing results survive. */
export const setupCacheKey = (id: StrategyId, symbol: string) => (id === 'breakout' ? `setup:${symbol}` : `setup:${id}:${symbol}`);
