// Finnhub key pool, read once for every server module that calls Finnhub.
// FINNHUB_API_KEYS takes a comma-separated list; each free key has its own 60 req/min.
// NEXT_PUBLIC_FINNHUB_API_KEY and FINNHUB_API_KEY are the older single-key names.
export const FINNHUB_KEYS: string[] = (
    process.env.FINNHUB_API_KEYS || process.env.NEXT_PUBLIC_FINNHUB_API_KEY || process.env.FINNHUB_API_KEY || ''
)
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
