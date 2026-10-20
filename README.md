# Apex Tradebook

A private swing-trading workspace: a ranked screener over whole market universes, daily-candle strategies with
walk-forward evidence, forward testing, and an **AI analyst team** that debates any stock and rates it from Buy to Sell.
Research tooling, not financial advice: nothing here places trades.

Live at **https://apex-tradebook.vercel.app**

## Features

- **Ranked market screener** (the home page): every universe in [`config/universes.ts`](config/universes.ts) is
  built each weekday after the US close, every enabled strategy is run on every member, and each universe gets its own
  tab ranked by quant score. See [Screener](#screener)
- **Charts that move**: TradingView candles, technicals and financials for any listed company
- **Live quotes**: Finnhub prices refreshing every 15 seconds, shared through a cache
- **Watchlists and alerts**: star stocks, set price targets, get an email when they cross
- **AI Analyst**: [TradingAgents](https://github.com/TauricResearch/TradingAgents) analysts, bull/bear
  researchers, a trader and a risk team debate a stock and save a rating plus a full report
- **Trade signals from ten strategies you choose between**: a nightly scan of your watchlist, one tab per strategy on
  the Setups page. Every stock gets a **0-100 quant score** and its walk-forward evidence (Deflated Sharpe, cost
  stress); setups that fail the gates are labelled *Unvalidated* and capped at 69
- **Ask**: a chat page where you ask for signals in plain words ("best setups on my watchlist today", "every strategy on
  MU"). Answers quote only the stored scans, with the score, entry, stop and whether the setup is validated
- **Fundamentals**: three years of SEC 10-K figures, margins, insider buys and sells and recent filings
- **Market brief**: an AI-written summary of what moved and why, before the open, at midday and after the close
- **Macro dashboard**: a fear & greed gauge, the US Treasury yield curve and the economic calendar
- **Earnings calendar**: upcoming reports for your watchlist with beat/miss, the week's biggest reporters,
  and a countdown on each stock page
- **Telegram messages**: price alerts, a daily watchlist summary, trade signals (opt-in, one switch per strategy) and
  earnings reminders, sent by your own Telegram bot (connect from the Profile page)
- **Market overview**: sector heatmap, movers, top stories and sentiment from Reddit, X.com, news and Polymarket
- **Emails**: AI-written welcome email, and a weekly news digest sent through Kit

## Screener

`/` is a ranked table per universe. Universes, risk settings and the account size live in one file,
[`config/universes.ts`](config/universes.ts):

| Universe | Filters | Risk a trade | Slippage | Telegram |
|---|---|---|---|---|
| Large-cap liquid | S&P 500 or Nasdaq-100 member, $20M+ average daily dollar volume, price $5+ | 0.75% | 5 bps | on, score 60+ |
| Unusual volume | today's volume 2.5x+ its 20-day average, $5M+ a day, price $3+ | 0.5% | 15 bps | on, score 65+ |
| Under $5 | NYSE, Nasdaq or NYSE American, $1-$5, $1.5M+ a day, estimated spread under 1% | 0.35%, 25% of the account at most | 40 bps | off |

How a scan works (`lib/inngest/screener.ts`, 5:20 PM New York time on weekdays, or **Run scan now**):

1. The analyst service builds each universe from the day's listings (Nasdaq's public screener: every NYSE, Nasdaq and
   NYSE American stock, so OTC and pink sheets never appear), the S&P 500 and Nasdaq-100 lists, and daily candles from
   Yahoo, fetched in batches and cached on the Space. Average dollar volume, relative volume, ATR% and an estimated
   bid-ask spread (Corwin-Schultz, from daily highs and lows) are computed from the candles.
2. A stock in several universes is listed once, in the first universe it belongs to, tagged with the others.
3. Each strategy is validated **per universe**: walk-forward on a fixed sample of 25 members with that universe's
   slippage, out-of-sample returns pooled, then the same gates as everywhere else (no lookahead, profitable out of
   sample, survives 2x costs, beats buy-and-hold and an MA cross, Deflated Sharpe counting every setting x strategy x
   universe, enough trades). It is re-run weekly. Rows of a strategy that fails any gate are *unvalidated* and their
   score stays capped at 69.
4. Each member is read under every strategy on its latest daily bar. Only stocks with something in play are stored:
   **Entry**, **Watch** (near the trigger), **Holding**, or **Exit** (in play last scan, off today).
5. Every entry is logged as a paper trade in its universe's forward-test record and judged on later daily closes.

Columns: ticker, strategy name, signal, quant score, validated, entry, stop, 2R/3R targets, risk per share, position
size (account x the universe's risk per trade, sized from the stop), regime, sector, scan date, and flags: other
universes the stock belongs to, earnings within 5 days, and for the under-$5 universe reverse splits, offering
filings (S-1/S-3/424B in the last 90 days), floats under 10M shares and gaps over 20%. Clicking a row opens the stock
page led by that strategy's "what it looks at" and the scan's numbers.

**Data limits.** Finnhub's free plan (60 calls a minute, no bulk daily candles) cannot cover thousands of stocks, so
the screener never calls it per stock: listings come from Nasdaq and candles from Yahoo through the analyst service.
Finnhub is used once per scan for the earnings calendar. Spreads are estimated, not quoted; real quotes come with the
IBKR connection.

## Strategies

Trade signals come from a registry of strategies in [`lib/strategies.ts`](lib/strategies.ts). Each entry has a
label, a switch (`enabled`), and, if it scans the watchlist, a tab on the Setups page and its own Telegram
opt-in. A strategy that is off appears nowhere: no panel, no Telegram switch, no scheduled message.

| | Idea | Status |
|---|---|---|
| Strategy 1: EMA + Supertrend | A fixed checklist: 10/21 EMA trend plus Supertrend (10,3). Stock-page panels, `/signals`, `/backtest` | **Off** (set `enabled: true`) |
| Strategy 2: Regime-aware breakout | Breakout above a swing high only when ADX says trending, ATR trailing stop | On |
| Strategy 3: 20/50 MA pullback | Buy a low-volume pullback to the 20 MA once the 20/50 cross is established | On |
| Strategy 4: Golden cross pullback | After the 50 MA crosses above a rising 200 MA, buy the pullback toward the 50 | On |
| Strategy 5: Breakout and retest | Breakout on rising volume, then buy the low-volume retest of the broken level | On |
| Strategy 6: High-volume bounce | Hammer or bullish engulfing on standout volume at support, stop below its low | On |
| Oversold dip in an uptrend | Above the 200-day average, 2-day RSI under 5-10; exit above the 5-day average or RSI over 70 | On, new |
| Bollinger band snap-back | Above the 200-day average, a close below the lower band then back inside, RSI(14) under 35; exit at the middle band | On, new |
| MACD trend continuation | 50 EMA over 200 EMA, MACD crosses up above zero, ADX up with +DI over -DI; exit on the MACD cross down | On, new |
| TD Sequential exhaustion | A perfected 9-count TD buy setup in a stock above its 200-day average; exit on a TD sell setup | On, new |

The last four re-implement ideas from [freqtrade-strategies](https://github.com/freqtrade/freqtrade-strategies)
(RSI and Bollinger mean-reversion, MACD/EMA trend filters, TD Sequential). Those are written for crypto on 5-minute to
4-hour candles and tuned by hyperopt, so only the idea is kept: the rules are re-written for daily candles and holds of
days to weeks in `analyst-service/openstock_analyst/aqp/strategies/playbook.py`, with a small grid that the
validation counts. They start unvalidated like every new strategy.

Strategies 3-6 come from the TEDucation 2.0 trading knowledge base (daily-chart setups only; the VWAP, opening-range,
premarket and volume-profile setups need minute data and are not built). The PDF often says "per your plan" for stops,
so the numbers are this project's reading of the rules, listed in
`analyst-service/openstock_analyst/aqp/strategies/playbook.py`. Every strategy goes through the same gates:
walk-forward testing, a 2x cost stress test, buy-and-hold and MA-cross baselines, and a Deflated Sharpe. The scan
tells the Deflated Sharpe that it searched every stock x strategy pair, so choosing the best of many is priced in.
Slow signals such as the golden cross trade rarely, so they often fail the "enough trades" gate: that is the evidence
speaking, not a bug.

Telegram: each strategy has its own opt-in switch (Strategy 2 uses `setups`; Strategy 1 uses `signals`), sent after the
close (the 4:55 PM ET scan; Strategy 1's job runs at 4:40 PM ET).

### Quant score (0-100)

A transparent rating of how good a setup is right now, computed in `analyst-service/openstock_analyst/quant_score.py`.
It is a checklist, not a forecast, and every part is shown on the Setups page.

| Part | Points | What earns them |
|---|---|---|
| Evidence | 40 | Validation gates passed (24) and out-of-sample Sharpe (16) |
| Trend and regime | 20 | Uptrend, trend strength above the strategy's own ADX threshold, calm volatility |
| Setup readiness | 20 | Entry today 20, watching a breakout 12, already in a trend 6, nothing 0 |
| Volume confirmation | 10 | A breakout on 1.5× average volume or more; a quiet approach to the level |
| Risk quality | 10 | A tight stop: 3% of price or less scores full, 10% or more scores zero |

Bands: 80+ Strong, 65-79 Good, 50-64 Fair, 35-49 Weak, below 35 Poor. A setup that has not passed every
validation gate is **capped at 69**, so an unproven idea can never look like a proven one.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · Better Auth · MongoDB Atlas · Finnhub ·
TradingView widgets · Inngest · Nodemailer (Gmail) · Kit · Gemini · TradingAgents, edgartools, yfinance and
empyrical on a Hugging Face Space

## How it is deployed

| Piece | Where |
|---|---|
| Web app | Vercel (this repo, `main` auto-deploys) |
| Database | MongoDB Atlas |
| Background jobs | Inngest Cloud (Vercel integration): the nightly market screener, the watchlist setups scan, price alerts, market data every hour, the market brief 3× a weekday, Telegram messages and a ping that keeps the AI service awake. The list is in [`API_DOCS.md`](API_DOCS.md) |
| AI analyst service | Hugging Face Space running [`analyst-service/`](analyst-service/) |

## Environment variables

Run `npm run check-env` to see which of these your `.env` has.

**Required**

| Variable | |
|---|---|
| `MONGODB_URI` | Atlas connection string |
| `BETTER_AUTH_SECRET` | random secret (`openssl rand -hex 32`) |
| `BETTER_AUTH_URL` | the site's public URL |
| `FINNHUB_API_KEYS` | market data. One key, or several separated by commas: each free key has its own 60 requests a minute and they are rotated. The older `NEXT_PUBLIC_FINNHUB_API_KEY` and `FINNHUB_API_KEY` still work |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | set by the Inngest Vercel integration |

**Optional: data and AI**

| Variable | |
|---|---|
| `NEXT_PUBLIC_OPENSTOCK_DATA_MODE` | `realtime` for 15-second quotes and price alerts, `cached` (default) for hourly. The name keeps its OpenStock-era prefix so existing deployments keep working |
| `GEMINI_API_KEY` | AI-written emails and the market brief |
| `GEMINI_MODEL` | Gemini model id (default `gemini-3.5-flash-lite`; older ids are tried if one is retired) |
| `AI_PROVIDER` | `gemini` (default), `minimax` or `siray` |
| `MINIMAX_API_KEY`, `MINIMAX_BASE_URL`, `MINIMAX_MODEL` | MiniMax as a primary or fallback provider (base URL and model have defaults) |
| `SIRAY_API_KEY` | Siray.ai as a fallback provider |
| `FRED_API_KEY` | free from https://fred.stlouisfed.org/docs/api/api_key.html; turns on the economic calendar |
| `ADANOS_API_KEY`, `ADANOS_API_BASE_URL` | stock sentiment from Reddit, X.com, news and Polymarket |

**Optional: analyst service (screener, AI Analyst, trade-signal strategies, Ask chat, fundamentals)**

| Variable | |
|---|---|
| `ANALYST_SERVICE_URL`, `ANALYST_API_KEY` | the analyst Space and its shared secret. Without them these features show as off |
| `ANALYST_HF_TOKEN` | only if the analyst Space is private |
| `ANALYST_DAILY_LIMIT` | AI Analyst runs per user per day (default 5) |

**Sign-in (required), email, Telegram**

| Variable | |
|---|---|
| `NODEMAILER_EMAIL`, `NODEMAILER_PASSWORD` | Gmail address and app password for the welcome and price-alert emails |
| `KIT_API_KEY`, `KIT_API_SECRET`, `KIT_WELCOME_FORM_ID` | Kit (ConvertKit) for the weekly news broadcast and the welcome subscription |
| `TELEGRAM_BOT_TOKEN` | from [@BotFather](https://t.me/BotFather); turns on Telegram messages |
| `TELEGRAM_WEBHOOK_SECRET` | with the token: any random string (`openssl rand -hex 24`); Telegram sends it back so the webhook knows the call is genuine. After adding both, send the Inngest event `app/telegram.setup` once |
| `TELEGRAM_BOT_USERNAME` | only if the bot's username cannot be looked up automatically |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | **required**: Google is the only way to sign in. Create an OAuth client (Web application) in Google Cloud Console with the redirect URI `<your site>/api/auth/callback/google` |
| `ALLOWED_EMAILS` | optional, comma-separated Google addresses allowed to sign in. Default: the owner's address in `lib/better-auth/access.ts`. Everyone else is refused, and new sign-ups are blocked |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | shows a support email link on Help and Terms |

The AI analyst service has its own setup guide in [`analyst-service/README.md`](analyst-service/README.md).

## Running locally

```bash
npm install
# create .env with the variables above, then check it
npm run check-env
npm run dev
npm test            # unit tests
npx tsc --noEmit    # type check
```

## Credits and license

Apex Tradebook is built on [OpenStock](https://github.com/Open-Dev-Society/OpenStock) by
Open Dev Society and uses [TradingAgents](https://github.com/TauricResearch/TradingAgents) by Tauric
Research (Apache-2.0), [edgartools](https://github.com/dgunning/edgartools) (MIT),
[skfolio](https://github.com/skfolio/skfolio) (BSD-3) and
[empyrical-reloaded](https://github.com/stefan-jansen/empyrical-reloaded) (Apache-2.0), and adapts ideas
from [World Monitor](https://github.com/koala73/worldmonitor) (AGPL-3.0). It is licensed under **AGPL-3.0**, like OpenStock: if you run a modified
copy for others, you must offer them its source.

Apex Tradebook is a research and education tool, not financial advice. It is not a registered dealer or adviser.

## Operations notes

- **Sign-in is Google only, and private.** Only the addresses in `ALLOWED_EMAILS` can sign in; any other Google account is refused at sign-up and at sign-in, and an existing session for one counts as signed out. There are no public pages: `/` goes to the app and everything else asks for sign-in.
- **Failure alerts:** in the Inngest dashboard, open Settings, then Alerts (or Notifications), and add an email for failed function runs, so a broken nightly scan does not go unnoticed.
