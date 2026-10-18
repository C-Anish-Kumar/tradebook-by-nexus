'use server';

import { searchStocks as searchStocksImpl } from '@/lib/finnhub';

// The only Finnhub call the browser can reach. The implementation checks the session before it
// spends API quota; everything else in lib/finnhub.ts is server-only.
export async function searchStocks(query?: string) {
    return searchStocksImpl(query);
}
