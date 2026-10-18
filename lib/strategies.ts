// The two strategies the app runs side by side. Each has its own page, its own Telegram message and
// its own on/off switch (Profile > Telegram), so you can follow either one, both or neither.
//
//   Strategy 1: a fixed rule checklist (10/21 EMA + Supertrend) shown on every stock page.
//   Strategy 2: a regime-gated breakout scan with walk-forward evidence, shown on the Setups page.

export const STRATEGY_1 = {
    label: 'Strategy 1',
    name: 'EMA + Supertrend',
    rules: '10/21 EMA + Supertrend (10,3) rules on the daily chart',
} as const;

export const STRATEGY_2 = {
    label: 'Strategy 2',
    name: 'Regime-aware breakout',
    rules: 'Regime-gated breakout entries with an ATR trailing stop, checked against walk-forward evidence',
} as const;
