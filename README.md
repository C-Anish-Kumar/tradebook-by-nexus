# Tradebook by Nexus

A free market terminal: live prices, watchlists, email price alerts, company insights, and an
**AI analyst team** that debates any stock and rates it from Buy to Sell.

Live at **https://open-stock-nexus.vercel.app**

## Features

- **Charts that move**: TradingView candles, technicals and financials for any listed company
- **Live quotes**: Finnhub prices refreshing every 15 seconds, shared through a cache
- **Watchlists and alerts**: star stocks, set price targets, get an email when they cross
- **AI Analyst**: [TradingAgents](https://github.com/TauricResearch/TradingAgents) analysts, bull/bear
  researchers, a trader and a risk team debate a stock and save a rating plus a full report
- **Trade signals, one strategy at a time**: a nightly scan of your watchlist for **Strategy 2 (regime-aware breakout)**
  entries with entry, stop, targets and share size. Every stock gets a **0-100 quant score** and its walk-forward
  evidence (Deflated Sharpe, cost stress); setups that fail the gates are labelled *Unvalidated* and capped at 69.
  More strategies plug into the same registry and are chosen with a tab on the Setups page
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

| | Strategy 1: EMA + Supertrend | Strategy 2: Regime-aware breakout |
|---|---|---|
| Status | **Off** (set `enabled: true` to bring it back) | **On** |
| Idea | A fixed rule checklist: 10/21 EMA trend plus Supertrend (10,3) on daily candles | Trade a breakout only when the market regime (trend strength and volatility) allows it, with an ATR trailing stop |
| Where | The Strategy and Backtest panels on every stock page | The **Setups** page and a quant-score panel on every stock page |
| Evidence | A backtest over 1–10 years vs buy-and-hold | Walk-forward testing, a 2× cost stress test, baseline comparison and a Deflated Sharpe over every parameter tried |
| Verdict | Entry, trim or exit | *Validated* only if every gate passes; otherwise *Unvalidated* (a paper-trade idea, not an edge) |
| Telegram | `signals` switch, after the close (4:40 PM ET) | `setups` switch, after the close (4:55 PM ET), off by default |
| Code | `analyst-service/openstock_analyst/strategy.py`, `/signals`, `/backtest` | `analyst-service/openstock_analyst/aqp/`, `setups.py`, `/setups` |

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

**Optional: analyst service (AI Analyst, Strategy 1, Strategy 2, fundamentals, Portfolio Lab)**

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

Tradebook by Nexus is built on [OpenStock](https://github.com/Open-Dev-Society/OpenStock) by
Open Dev Society and uses [TradingAgents](https://github.com/TauricResearch/TradingAgents) by Tauric
Research (Apache-2.0), [edgartools](https://github.com/dgunning/edgartools) (MIT),
[skfolio](https://github.com/skfolio/skfolio) (BSD-3) and
[empyrical-reloaded](https://github.com/stefan-jansen/empyrical-reloaded) (Apache-2.0), and adapts ideas
from [World Monitor](https://github.com/koala73/worldmonitor) (AGPL-3.0). It is licensed under **AGPL-3.0**, like OpenStock: if you run a modified
copy for others, you must offer them its source.

Tradebook is a research and education tool, not financial advice.
