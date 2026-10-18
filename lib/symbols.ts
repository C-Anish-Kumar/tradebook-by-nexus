/** Stocks the setups scan, Ask and the daily summary can score: US tickers plus Toronto (.TO), both on Yahoo daily data. */
export const isScannable = (s: string) => !s.includes(':') && (!s.includes('.') || /\.TO$/i.test(s));
export const isCanadian = (s: string) => /\.TO$/i.test(s);
export const currencyOf = (s: string) => (isCanadian(s) ? 'CAD' : 'USD');
