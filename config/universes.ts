// The screener's universes, risk defaults and account, in one place. Edit this file to change what gets scanned.
//
// Every universe is a set of filters. The nightly scan (lib/inngest/screener.ts) sends these definitions to the
// analyst service, which builds each universe from the day's listings and daily candles, runs every enabled
// strategy on every member, and validates each strategy separately per universe. Each universe gets its own
// screener tab, risk settings, slippage assumption, validation and forward-test record.
//
// A stock that belongs to several universes appears once, in the first one listed here, tagged with the others.
// Keep the list to about 3-4: every extra universe adds candles to download and strategies to validate.
//
// Everything here is a default: the account size and each universe's risk, regime gate and Telegram settings can be
// overridden per user on the Positions page (stored in TradingSettings), without a deploy.

export type UniverseId = 'large_cap' | 'unusual_volume' | 'under_5';

export type Range = { min?: number; max?: number };

export type UniverseFilters = {
    /** Member of any of these indexes. */
    indexes?: ('sp500' | 'ndx')[];
    /** Listing exchange. OTC and pink sheets are never scanned. */
    exchanges?: ('NYSE' | 'NASDAQ' | 'AMEX')[];
    /** Last close, in dollars. */
    price?: Range;
    /** 20-day average of close x volume, in dollars. */
    minAvgDollarVolume?: number;
    /** Latest volume as a multiple of the previous 20 days' average. */
    relVolume?: Range;
    /** Market capitalisation, in dollars. */
    marketCap?: Range;
    /** Only these sectors (Nasdaq's sector names, e.g. "Technology"). */
    sectors?: string[];
    excludeSectors?: string[];
    /** ATR(14) as a % of the price: how far the stock typically moves in a day. */
    atrPct?: Range;
    /** Estimated bid-ask spread (Corwin-Schultz, from daily highs and lows), as a % of the price. */
    maxSpreadPct?: number;
};

export type RiskSettings = {
    /** % of the account lost if a trade hits its stop; position size is worked out from the stop. */
    riskPctPerTrade: number;
    /** Most positions open at once. */
    maxOpenPositions: number;
    /** Most of the account in any one sector, %. */
    maxSectorExposurePct: number;
    /** Most of the account in this universe's positions together, %. */
    maxTotalExposurePct: number;
};

export type Universe = {
    id: UniverseId;
    name: string;
    description: string;
    filters: UniverseFilters;
    /** Slippage assumed per side in validation and the forward test, in basis points (fees are added on top). */
    slippageBps: number;
    /** Overrides for DEFAULT_RISK. */
    risk?: Partial<RiskSettings>;
    /** Only take new entries while the broad market (SPY) closes above its 200-day average. Exits are always reported. */
    regimeGate: boolean;
    /** Telegram alerts for new top-ranked entries: off, or on above a minimum quant score. */
    telegram: { enabled: boolean; minScore: number };
    /** Small-cap warning badges: reverse split, offering/dilution filings, low float, big gaps. */
    badges: boolean;
};

/** Your trading account. Position sizes on the screener use this unless you set your own on the Positions page. */
export const ACCOUNT = {
    size: 10_000,
    /** Typical hold, in trading days: 2-3 weeks. All strategies run on daily candles. */
    holdDays: { min: 10, max: 15 },
};

/** The range the Positions page accepts for risk per trade, in % of the account. */
export const RISK_PCT_LIMITS = { min: 0.25, max: 1 };

/**
 * Kill switches. A strategy in a universe stops producing takeable entries once its forward test falls this many R
 * from its best point; the whole account stops once your own closed positions fall this % of the account from
 * their best. Both stay tripped until you reset them on the Performance or Positions page.
 */
export const KILL_SWITCH = { strategyDrawdownR: 6, accountDrawdownPct: 10 };

/** Most entries listed per universe in one Telegram alert. */
export const TELEGRAM_TOP_N = 5;

export const DEFAULT_RISK: RiskSettings = {
    riskPctPerTrade: 0.75,
    maxOpenPositions: 4,
    maxSectorExposurePct: 40,
    maxTotalExposurePct: 100,
};

export const UNIVERSES: Universe[] = [
    {
        id: 'large_cap',
        name: 'Large-cap liquid',
        description: 'S&P 500 and Nasdaq-100 members trading at least $20M a day, priced $5 or more',
        filters: { indexes: ['sp500', 'ndx'], price: { min: 5 }, minAvgDollarVolume: 20_000_000 },
        slippageBps: 5,
        regimeGate: true,
        telegram: { enabled: true, minScore: 60 },
        badges: false,
    },
    {
        id: 'unusual_volume',
        name: 'Unusual volume',
        description: "Today's volume at least 2.5x its 20-day average, with at least $5M a day of liquidity and a $3 price floor",
        filters: {
            exchanges: ['NYSE', 'NASDAQ', 'AMEX'],
            price: { min: 3 },
            minAvgDollarVolume: 5_000_000,
            relVolume: { min: 2.5 },
        },
        slippageBps: 15,
        risk: { riskPctPerTrade: 0.5, maxOpenPositions: 3 },
        regimeGate: true,
        telegram: { enabled: true, minScore: 65 },
        badges: false,
    },
    {
        id: 'under_5',
        name: 'Under $5',
        description: 'NYSE, Nasdaq and NYSE American stocks priced $1-$5 with at least $1.5M a day and a tight estimated spread',
        filters: {
            exchanges: ['NYSE', 'NASDAQ', 'AMEX'],
            price: { min: 1, max: 5 },
            minAvgDollarVolume: 1_500_000,
            maxSpreadPct: 1.0,
        },
        slippageBps: 40,
        risk: { riskPctPerTrade: 0.35, maxOpenPositions: 2, maxTotalExposurePct: 25 },
        regimeGate: true,
        telegram: { enabled: false, minScore: 70 },
        badges: true,
    },
];

export const universeById = (id: string): Universe | undefined => UNIVERSES.find((u) => u.id === id);

export const riskFor = (u: Universe): RiskSettings => ({ ...DEFAULT_RISK, ...u.risk });
