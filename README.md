# Apex Tradebook

A free market terminal: live prices, watchlists, email price alerts, company insights, and an
**AI analyst team** that debates any stock and rates it from Buy to Sell.

Live at **https://apex-tradebook.vercel.app**

## Features

- **Charts that move**: TradingView candles, technicals and financials for any listed company
- **Live quotes**: Finnhub prices refreshing every 15 seconds, shared through a cache
- **Watchlists and alerts**: star stocks, set price targets, get an email when they cross
- **AI Analyst**: [TradingAgents](https://github.com/TauricResearch/TradingAgents) analysts, bull/bear
  researchers, a trader and a risk team debate a stock and save a rating plus a full report
- **Trade signals from six strategies you choose between**: a nightly scan of your watchlist, one tab per strategy on
  the Setups page. Every stock gets a **0-100 quant score** and its walk-forward evidence (Deflated Sharpe, cost
  stress); setups that fail the gates are labelled *Unvalidated* and capped at 69
- **Ask**: a chat page where you ask for signals in plain words ("best setups on my watchlist today", "every strategy on
  MU"). Answers quote only the stored scans, with the score, entry, stop and whether the setup is validated
- **Fundamentals**: three years of SEC 10-K figures, margins, insider buys and sells and recent filings
- **RL Lab**: train a reinforcement-learning trading agent ([Nexus](https://github.com/C-Anish-Kumar/nexus), built on
  FinRL) on a strategy template, compare it with buy-and-hold on data it never saw, and see today's signal
- **Portfolio Lab**: five allocation methods tested walk-forward on your stocks, with weights, the
  efficient frontier and a correlation matrix
- **Market brief**: an AI-written summary of what moved and why, before the open, at midday and after the close
- **Macro dashboard**: a fear & greed gauge, the US Treasury yield curve and the economic calendar
- **Earnings calendar**: upcoming reports for your watchlist with beat/miss, the week's biggest reporters,
  and a countdown on each stock page
- **Telegram messages**: price alerts, a daily watchlist summary, trade signals (opt-in, one switch per strategy) and
  earnings reminders, sent by your own Telegram bot (connect from the Profile page)
- **Market overview**: sector heatmap, movers, top stories and sentiment from Reddit, X.com, news and Polymarket
- **Emails**: AI-written welcome email, and a weekly news digest sent through Kit

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
TradingView widgets · Inngest · Nodemailer (Gmail) · Kit · Gemini · TradingAgents, edgartools, skfolio and
empyrical on a Hugging Face Space

## How it is deployed

| Piece | Where |
|---|---|
| Web app | Vercel (this repo, `main` auto-deploys) |
| Database | MongoDB Atlas |
| Background jobs | Inngest Cloud (Vercel integration): price alerts, market data every hour, the market brief 3× a weekday, the nightly Strategy 2 scan, Telegram messages and a ping that keeps the AI service awake. The list is in [`API_DOCS.md`](API_DOCS.md) |
| AI analyst service | Hugging Face Space running [`analyst-service/`](analyst-service/) |
| RL Lab service | Hugging Face Space running [Nexus](https://github.com/C-Anish-Kumar/nexus) (`space/` in that repo) |

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

**Optional: analyst service (AI Analyst, trade-signal strategies, Ask chat, fundamentals, Portfolio Lab)**

| Variable | |
|---|---|
| `ANALYST_SERVICE_URL`, `ANALYST_API_KEY` | the analyst Space and its shared secret. Without them these features show as off |
| `ANALYST_HF_TOKEN` | only if the analyst Space is private |
| `ANALYST_DAILY_LIMIT` | AI Analyst runs per user per day (default 5) |

**Optional: RL Lab**

| Variable | |
|---|---|
| `NEXUS_SERVICE_URL`, `NEXUS_API_KEY` | the Nexus Space and its shared secret; turns on RL Lab |
| `NEXUS_HF_TOKEN` | only if the Nexus Space is private |
| `NEXUS_DAILY_LIMIT` | RL Lab runs per user per day (default 10) |

**Optional: email, Telegram, sign-in**

| Variable | |
|---|---|
| `NODEMAILER_EMAIL`, `NODEMAILER_PASSWORD` | Gmail address and app password for transactional emails |
| `KIT_API_KEY`, `KIT_API_SECRET`, `KIT_WELCOME_FORM_ID` | Kit (ConvertKit) for the weekly news broadcast and the welcome subscription |
| `TELEGRAM_BOT_TOKEN` | from [@BotFather](https://t.me/BotFather); turns on Telegram messages |
| `TELEGRAM_WEBHOOK_SECRET` | with the token: any random string (`openssl rand -hex 24`); Telegram sends it back so the webhook knows the call is genuine. After adding both, send the Inngest event `app/telegram.setup` once |
| `TELEGRAM_BOT_USERNAME` | only if the bot's username cannot be looked up automatically |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | social sign-in; each provider switches on when its id is set |
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

- **Email verification** turns on by itself when `NODEMAILER_EMAIL` and `NODEMAILER_PASSWORD` are set. Accounts created before that must confirm once: signing in re-sends them a link.
- **Failure alerts:** in the Inngest dashboard, open Settings, then Alerts (or Notifications), and add an email for failed function runs, so a broken nightly scan does not go unnoticed.
