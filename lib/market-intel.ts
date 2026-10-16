// Market-wide data computed in the background (Inngest) and read by pages from MongoDB:
// earnings calendar (Finnhub), macro snapshot (FRED) and the AI market brief (Gemini).
// Approach adapted from World Monitor's seed-then-serve design (github.com/koala73/worldmonitor, AGPL-3.0).
import { cached, readCache, writeCache } from '@/lib/cache';
import { callAIProviderWithFallback } from '@/lib/ai-provider';
import { isMarketOpen, getMarket } from '@/lib/markets';

const FINNHUB_KEY = (process.env.FINNHUB_API_KEYS || process.env.NEXT_PUBLIC_FINNHUB_API_KEY || process.env.FINNHUB_API_KEY || '')
    .split(',').map((k) => k.trim()).filter(Boolean)[0];
const HOUR = 60 * 60_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysFromNow = (n: number) => isoDay(new Date(Date.now() + n * 86_400_000));

async function finnhub<T>(path: string): Promise<T> {
    if (!FINNHUB_KEY) throw new Error('No Finnhub API key configured');
    const res = await fetch(`https://finnhub.io/api/v1${path}`, {
        headers: { 'X-Finnhub-Token': FINNHUB_KEY },
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Finnhub ${path.split('?')[0]} ${res.status}`);
    return res.json() as Promise<T>;
}

/* ───────────────────────── Earnings calendar ───────────────────────── */

export type EarningsEvent = {
    symbol: string;
    date: string;
    hour: 'bmo' | 'amc' | 'dmh' | '';
    epsEstimate: number | null;
    epsActual: number | null;
    revenueEstimate: number | null;
    revenueActual: number | null;
    quarter: number;
    year: number;
};
export type EarningsCalendar = { from: string; to: string; events: EarningsEvent[] };

// Finnhub caps each response, and a month of earnings season overflows it, so ask in short windows
const EARNINGS_CHUNK_DAYS = 3;
const EARNINGS_CAP = 1500;

async function earningsWindow(from: string, to: string): Promise<EarningsEvent[]> {
    const { earningsCalendar = [] } = await finnhub<{ earningsCalendar?: EarningsEvent[] }>(`/calendar/earnings?from=${from}&to=${to}`);
    // A full page may be truncated: split the window in half and ask again
    if (earningsCalendar.length >= EARNINGS_CAP && from !== to) {
        const mid = isoDay(new Date((new Date(from).getTime() + new Date(to).getTime()) / 2));
        const next = isoDay(new Date(new Date(mid).getTime() + 86_400_000));
        return [...await earningsWindow(from, mid), ...await earningsWindow(next, to)];
    }
    return earningsCalendar;
}

async function loadEarningsCalendar(): Promise<EarningsCalendar> {
    // Last week (for beat/miss) through the next three weeks
    const from = daysFromNow(-7), to = daysFromNow(21);
    const raw: EarningsEvent[] = [];
    for (let offset = -7; offset <= 21; offset += EARNINGS_CHUNK_DAYS) {
        raw.push(...await earningsWindow(daysFromNow(offset), daysFromNow(Math.min(offset + EARNINGS_CHUNK_DAYS - 1, 21))));
    }
    const seen = new Set<string>();
    const events = raw
        .filter((e) => e.symbol && e.date && !e.symbol.includes('.'))
        .filter((e) => !seen.has(`${e.symbol}:${e.date}`) && seen.add(`${e.symbol}:${e.date}`))
        .map((e) => ({
            symbol: e.symbol, date: e.date, hour: e.hour ?? '',
            epsEstimate: e.epsEstimate ?? null, epsActual: e.epsActual ?? null,
            revenueEstimate: e.revenueEstimate ?? null, revenueActual: e.revenueActual ?? null,
            quarter: e.quarter, year: e.year,
        }));
    return { from, to, events };
}

export const getEarningsCalendar = () => cached('earnings:calendar', 6 * HOUR, loadEarningsCalendar);
export const refreshEarningsCalendar = async () => {
    const value = await loadEarningsCalendar();
    await writeCache('earnings:calendar', value);
    return value.events.length;
};

/* ───────────────────────── Macro snapshot (FRED) ───────────────────────── */

type Point = { date: string; value: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// fredgraph.csv needs no API key, but answers 503 to bursts: callers fetch one series at a time, with retries
async function fredSeries(id: string, sinceDays: number): Promise<Point[]> {
    let res: Response | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt) await sleep(1500 * attempt);
        res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${daysFromNow(-sinceDays)}`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(20_000),
        }).catch(() => null);
        if (res?.ok) break;
    }
    if (!res?.ok) throw new Error(`FRED ${id} ${res?.status ?? 'network error'}`);
    return (await res.text()).trim().split('\n').slice(1).flatMap((line) => {
        const [date, raw] = line.split(',');
        const value = Number(raw);
        return raw && raw !== '.' && Number.isFinite(value) ? [{ date, value }] : [];
    });
}

const MATURITIES = [
    ['1M', 'DGS1MO'], ['3M', 'DGS3MO'], ['6M', 'DGS6MO'], ['1Y', 'DGS1'],
    ['2Y', 'DGS2'], ['5Y', 'DGS5'], ['10Y', 'DGS10'], ['30Y', 'DGS30'],
] as const;

export type YieldCurve = {
    date: string;
    monthAgoDate: string;
    points: { maturity: string; now: number; monthAgo: number | null }[];
    spread10y2y: number | null;
    spread10y3m: number | null;
};

async function loadYieldCurve(): Promise<YieldCurve> {
    const series: Point[][] = [];
    for (const [, id] of MATURITIES) series.push(await fredSeries(id, 50));
    const date = series.map((s) => s.at(-1)?.date ?? '').sort().at(-1)!;
    const target = isoDay(new Date(new Date(date).getTime() - 30 * 86_400_000));
    const at = (s: Point[], day: string) => [...s].reverse().find((p) => p.date <= day)?.value ?? null;
    const points = MATURITIES.map(([maturity], i) => ({ maturity, now: at(series[i], date)!, monthAgo: at(series[i], target) }))
        .filter((p) => p.now !== null);
    const get = (m: string) => points.find((p) => p.maturity === m)?.now ?? null;
    const diff = (a: number | null, b: number | null) => (a !== null && b !== null ? Math.round((a - b) * 100) / 100 : null);
    return { date, monthAgoDate: target, points, spread10y2y: diff(get('10Y'), get('2Y')), spread10y3m: diff(get('10Y'), get('3M')) };
}

export type FearGreed = {
    score: number;
    label: string;
    weekAgo: number | null;
    monthAgo: number | null;
    asOf: string;
    components: { key: string; label: string; score: number; detail: string }[];
};

export const fearGreedLabel = (s: number) =>
    s < 25 ? 'Extreme fear' : s < 45 ? 'Fear' : s <= 55 ? 'Neutral' : s <= 75 ? 'Greed' : 'Extreme greed';

// Share of the trailing window at or below the latest value, 0-100
function percentile(window: number[], value: number) {
    return (window.filter((v) => v <= value).length / window.length) * 100;
}

/**
 * Four equally weighted gauges, each ranked against its own past year so they share a 0-100 scale:
 * volatility (VIX, inverted), credit stress (high-yield spread, inverted),
 * momentum (S&P 500 vs its 125-day average) and strength (distance from the 52-week high).
 */
async function loadFearGreed(): Promise<FearGreed> {
    const vix = await fredSeries('VIXCLS', 800);
    const hy = await fredSeries('BAMLH0A0HYM2', 800);
    const spx = await fredSeries('SP500', 800);
    const carry = (s: Point[]) => {
        const map = new Map(s.map((p) => [p.date, p.value]));
        let last: number | null = null;
        return (day: string) => (last = map.get(day) ?? last);
    };
    const vixAt = carry(vix), hyAt = carry(hy);
    const rows = spx.map((p, i) => {
        const prev = spx.slice(Math.max(0, i - 251), i + 1).map((q) => q.value);
        const ma125 = prev.slice(-125).reduce((a, b) => a + b, 0) / Math.min(125, prev.length);
        return { date: p.date, spx: p.value, vix: vixAt(p.date), hy: hyAt(p.date), momentum: p.value / ma125 - 1, strength: p.value / Math.max(...prev) - 1 };
    }).filter((r) => r.vix !== null && r.hy !== null) as { date: string; spx: number; vix: number; hy: number; momentum: number; strength: number }[];
    if (rows.length < 300) throw new Error('Not enough FRED history for the fear & greed gauge');

    const scoreAt = (i: number) => {
        const w = rows.slice(i - 251, i + 1);
        const r = rows[i];
        const parts = {
            volatility: 100 - percentile(w.map((x) => x.vix), r.vix),
            credit: 100 - percentile(w.map((x) => x.hy), r.hy),
            momentum: percentile(w.map((x) => x.momentum), r.momentum),
            strength: percentile(w.map((x) => x.strength), r.strength),
        };
        return { parts, total: Math.round((parts.volatility + parts.credit + parts.momentum + parts.strength) / 4) };
    };
    const last = rows.length - 1;
    const now = scoreAt(last);
    const r = rows[last];
    const pct = (n: number) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
    return {
        score: now.total,
        label: fearGreedLabel(now.total),
        weekAgo: last >= 256 ? scoreAt(last - 5).total : null,
        monthAgo: last >= 272 ? scoreAt(last - 21).total : null,
        asOf: r.date,
        components: [
            { key: 'volatility', label: 'Volatility', score: Math.round(now.parts.volatility), detail: `VIX ${r.vix.toFixed(1)}` },
            { key: 'credit', label: 'Credit stress', score: Math.round(now.parts.credit), detail: `High-yield spread ${r.hy.toFixed(2)}%` },
            { key: 'momentum', label: 'Momentum', score: Math.round(now.parts.momentum), detail: `S&P 500 ${pct(r.momentum)} vs 125-day avg` },
            { key: 'strength', label: 'Strength', score: Math.round(now.parts.strength), detail: `${pct(r.strength)} from 52-week high` },
        ],
    };
}

// FRED release ids for the reports that move markets most (FOMC comes from the Fed's own calendar)
const RELEASES: Record<number, { name: string; high: boolean }> = {
    10: { name: 'Consumer prices (CPI)', high: true },
    50: { name: 'Jobs report', high: true },
    53: { name: 'GDP', high: true },
    54: { name: 'PCE inflation', high: true },
    46: { name: 'Producer prices (PPI)', high: false },
    9: { name: 'Retail sales', high: false },
    192: { name: 'Job openings (JOLTS)', high: false },
    180: { name: 'Jobless claims', high: false },
};
export type EconomicEvent = { date: string; name: string; high: boolean };

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * Fed rate decision days from federalreserve.gov's FOMC calendar page. Each meeting is a month label
 * ("October", "Apr/May") and a day range ("27-28", "17-18*"); the decision is announced on the last day.
 */
export function parseFomcDates(html: string): string[] {
    const out: string[] = [];
    let year: number | null = null, month: string | null = null;
    const re = /(\d{4}) FOMC Meetings|fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>|fomc-meeting__date[^>]*>([^<]+)</g;
    for (const m of html.matchAll(re)) {
        if (m[1]) year = Number(m[1]);
        else if (m[2]) month = m[2].trim();
        else if (m[3] && year && month) {
            const text = m[3].trim();
            if (/notation|unscheduled|cancel/i.test(text)) continue;
            const days = text.replace(/[^\d-]/g, '').split('-').filter(Boolean).map(Number);
            if (!days.length) continue;
            const months = month.toLowerCase().split('/').map((p) => MONTHS.findIndex((n) => n.startsWith(p.trim().slice(0, 3))));
            // "Apr/May 30-1": the last day falls in the second month
            const mi = months.length > 1 && days.length > 1 && days[1] < days[0] ? months[1] : months[0];
            if (mi < 0) continue;
            out.push(`${year}-${String(mi + 1).padStart(2, '0')}-${String(days.at(-1)).padStart(2, '0')}`);
        }
    }
    return [...new Set(out)].sort();
}

async function loadFomcDates(): Promise<string[]> {
    const res = await fetch('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Tradebook market calendar)' },
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Fed calendar ${res.status}`);
    return parseFomcDates(await res.text());
}

// FRED's release calendar needs a (free) key; the Fed's meeting dates don't
async function loadEconomicCalendar(): Promise<EconomicEvent[] | null> {
    const key = process.env.FRED_API_KEY;
    const today = daysFromNow(0), end = daysFromNow(35);
    const fomc = (await loadFomcDates().catch((error) => { console.error('FOMC calendar failed', error); return []; }))
        .filter((d) => d >= today && d <= end)
        .map((date) => ({ date, name: 'Fed rate decision (FOMC)', high: true }));
    if (!key) return fomc.length ? fomc : null;

    const params = new URLSearchParams({
        api_key: key, file_type: 'json', realtime_start: today, realtime_end: end,
        include_release_dates_with_no_data: 'true', sort_order: 'asc', limit: '1000',
    });
    const res = await fetch(`https://api.stlouisfed.org/fred/releases/dates?${params}`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`FRED calendar ${res.status}`);
    const { release_dates = [] } = await res.json() as { release_dates?: { release_id: number; date: string }[] };
    const seen = new Set<string>();
    const releases = release_dates.flatMap((r) => {
        const info = RELEASES[r.release_id];
        const id = `${r.release_id}:${r.date}`;
        if (!info || seen.has(id)) return [];
        seen.add(id);
        return [{ date: r.date, name: info.name, high: info.high }];
    });
    // Weekly jobless claims would crowd out the monthly reports; keep the next two
    let claims = 0;
    return [...fomc, ...releases]
        .sort((a, b) => a.date.localeCompare(b.date) || Number(b.high) - Number(a.high))
        .filter((e) => e.name !== 'Jobless claims' || claims++ < 2)
        .slice(0, 12);
}

export type MacroSnapshot = {
    yieldCurve: YieldCurve | null;
    fearGreed: FearGreed | null;
    calendar: EconomicEvent[] | null;
    updatedAt: string;
};

async function loadMacroSnapshot(): Promise<MacroSnapshot> {
    // Each piece fails on its own; one flaky source shouldn't blank the others
    const settle = async <T,>(p: Promise<T>) => p.catch((error) => { console.error('macro piece failed', error); return null; });
    const yieldCurve = await settle(loadYieldCurve());
    const fearGreed = await settle(loadFearGreed());
    const calendar = await settle(loadEconomicCalendar());
    if (!yieldCurve && !fearGreed) throw new Error('FRED is unavailable');
    return { yieldCurve, fearGreed, calendar, updatedAt: new Date().toISOString() };
}

export const getMacroSnapshot = () => cached('macro:snapshot', HOUR, loadMacroSnapshot);
export const refreshMacroSnapshot = async () => {
    const value = await loadMacroSnapshot();
    await writeCache('macro:snapshot', value);
    return { yieldCurve: Boolean(value.yieldCurve), fearGreed: Boolean(value.fearGreed), calendar: value.calendar?.length ?? null };
};

/* ───────────────────────── AI market brief ───────────────────────── */

const BRIEF_SYMBOLS = [
    ['SPY', 'S&P 500'], ['QQQ', 'Nasdaq 100'], ['DIA', 'Dow'], ['IWM', 'Small caps'],
    ['XLK', 'Tech'], ['XLC', 'Communication'], ['XLY', 'Consumer disc.'], ['XLF', 'Financials'],
    ['XLV', 'Health care'], ['XLI', 'Industrials'], ['XLE', 'Energy'], ['XLP', 'Staples'],
    ['XLU', 'Utilities'], ['XLB', 'Materials'], ['XLRE', 'Real estate'],
    ['TLT', 'Long Treasuries'], ['GLD', 'Gold'], ['USO', 'Oil'],
] as const;

export type MarketBrief = {
    headline: string;
    summary: string;
    bullets: { title: string; detail: string }[];
    watch: string;
    moves: { symbol: string; label: string; change: number }[];
    session: 'open' | 'closed';
    generatedAt: string;
    // False when the AI provider failed and only the moves are shown; aiError says why
    ai?: boolean;
    aiError?: string;
};

function parseJson(text: string) {
    const body = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    return JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1));
}

async function generateMarketBrief(): Promise<MarketBrief> {
    const quotes = await Promise.all(BRIEF_SYMBOLS.map(async ([symbol, label]) => {
        try {
            const q = await finnhub<{ c: number; dp: number | null }>(`/quote?symbol=${symbol}`);
            return q.c && q.dp !== null ? { symbol, label, change: Math.round(q.dp * 100) / 100 } : null;
        } catch {
            return null;
        }
    }));
    const moves = quotes.filter((q): q is NonNullable<typeof q> => q !== null);
    if (moves.length < 4) throw new Error('Not enough quotes for a market brief');

    const news = await finnhub<{ headline: string; source: string; datetime: number }[]>('/news?category=general').catch(() => []);
    const headlines = news.filter((n) => Date.now() / 1000 - n.datetime < 36 * 3600).slice(0, 18)
        .map((n) => `- ${n.headline} (${n.source})`).join('\n');
    const macro = (await readCache<MacroSnapshot>('macro:snapshot'))?.value;
    const session = isMarketOpen(getMarket('us')) ? 'open' : 'closed';

    const prompt = `You are a markets editor writing a short brief for retail investors. The US market is ${session === 'open' ? 'open; describe moves so far today' : 'closed; describe the latest session'}.
Use ONLY the data below. Don't invent numbers, causes or events. If the headlines don't explain a move, say so plainly.

Moves (% change on the session):
${moves.map((m) => `${m.label} (${m.symbol}): ${m.change > 0 ? '+' : ''}${m.change}%`).join('\n')}
${macro?.fearGreed ? `\nFear & greed gauge: ${macro.fearGreed.score}/100 (${macro.fearGreed.label})` : ''}${macro?.yieldCurve ? `\n10Y Treasury ${macro.yieldCurve.points.find((p) => p.maturity === '10Y')?.now}%, 10Y-2Y spread ${macro.yieldCurve.spread10y2y}` : ''}

Headlines from the last 36 hours:
${headlines || '(none available)'}

Reply with JSON only, no markdown:
{"headline": "max 12 words", "summary": "2 plain sentences", "bullets": [{"title": "max 5 words", "detail": "1 sentence"}, ... 3 or 4 items], "watch": "1 sentence on what to watch next, or empty string"}`;

    let parsed: { headline?: unknown; summary?: unknown; bullets?: unknown; watch?: unknown } | null = null;
    let aiError: string | undefined;
    try {
        parsed = parseJson(await callAIProviderWithFallback(prompt));
        if (!parsed?.headline || !parsed?.summary) throw new Error('The model returned an unusable brief');
    } catch (error) {
        aiError = error instanceof Error ? error.message : String(error);
        console.error('market brief: AI unavailable, saving moves only:', aiError);
    }
    if (!parsed || aiError) {
        // Still useful without AI: a plain-numbers headline from the index and sector moves
        const fmt = (m: { label: string; change: number }) => `${m.label} ${m.change > 0 ? '+' : ''}${m.change.toFixed(2)}%`;
        const sectors = moves.slice(4, 15).sort((x, y) => y.change - x.change);
        return {
            headline: moves.slice(0, 2).map(fmt).join(', '),
            summary: sectors.length ? `${sectors[0].label} led (${fmt(sectors[0]).split(' ').pop()}) and ${sectors.at(-1)!.label} lagged (${fmt(sectors.at(-1)!).split(' ').pop()}).` : '',
            bullets: [],
            watch: '',
            moves,
            session,
            generatedAt: new Date().toISOString(),
            ai: false,
            aiError,
        };
    }
    return {
        headline: String(parsed.headline),
        summary: String(parsed.summary),
        bullets: (Array.isArray(parsed.bullets) ? parsed.bullets : []).slice(0, 4).map((b: { title?: unknown; detail?: unknown }) => ({ title: String(b.title ?? ''), detail: String(b.detail ?? '') })),
        watch: String(parsed.watch ?? ''),
        moves,
        session,
        generatedAt: new Date().toISOString(),
        ai: true,
    };
}

export const getMarketBrief = () => cached('market:brief', 8 * HOUR, generateMarketBrief);
export const refreshMarketBrief = async () => {
    const value = await generateMarketBrief();
    await writeCache('market:brief', value);
    // Shown in Inngest so a broken AI key is visible instead of silent
    return value.ai ? value.headline : { headline: value.headline, aiError: value.aiError };
};
