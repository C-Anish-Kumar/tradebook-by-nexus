// How fresh market numbers are. Safe to import from client components (no keys here).
//
//   cached   (default) Public instance: quotes refresh hourly, shared by every user via the data cache.
//   realtime           with your own Finnhub keys: quotes refresh every 15s.
export type DataMode = 'cached' | 'realtime';

const DATA_MODE: DataMode = process.env.NEXT_PUBLIC_OPENSTOCK_DATA_MODE === 'realtime' ? 'realtime' : 'cached';

export const QUOTE_TTL_SECONDS = DATA_MODE === 'realtime' ? 15 : 3600;

export const isRealtime = DATA_MODE === 'realtime';

// Email price alerts are on in realtime mode and off in cached (hourly) mode.
export const alertsEnabled = isRealtime;
