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
- **Strategy and backtest**: a 10/21 EMA + Supertrend (10,3) checklist on every stock, a replay of it over
  1–10 years, and risk-adjusted scores (Sharpe, Sortino, Calmar, alpha/beta vs SPY)
- **Setups**: a nightly scan of your watchlist for regime-aware breakout entries with entry, stop, targets and share size, each shown with its walk-forward evidence and a Deflated Sharpe; setups that fail the gates are labelled *Unvalidated*. Optional Telegram message for fresh entries and exits (opt-in)
- **Fundamentals**: three years of SEC 10-K figures, margins, insider buys and sells and recent filings
- **RL Lab**: train a reinforcement-learning trading agent ([Nexus](https://github.com/C-Anish-Kumar/nexus), built on
  FinRL) on a strategy template, compare it with buy-and-hold on data it never saw, and see today's signal
- **Portfolio Lab**: five allocation methods tested walk-forward on your stocks, with weights, the
  efficient frontier and a correlation matrix
- **Market brief**: an AI-written summary of what moved and why, before the open, at midday and after the close
- **Macro dashboard**: a fear & greed gauge, the US Treasury yield curve and the economic calendar
- **Earnings calendar**: upcoming reports for your watchlist with beat/miss, the week's biggest reporters,
  and a countdown on each stock page
- **Telegram messages**: price alerts, a daily watchlist summary, strategy signal changes and earnings
  reminders, sent by your own Telegram bot (connect from the Profile page)
- **Market overview**: sector heatmap, movers, top stories and sentiment from Reddit, X.com, news and Polymarket
- **Emails**: AI-written welcome email and a weekly news digest

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · Better Auth · MongoDB Atlas · Finnhub ·
TradingView widgets · Inngest · Nodemailer (Gmail) · Gemini · TradingAgents, edgartools, skfolio and
empyrical on a Hugging Face Space

## How it is deployed

| Piece | Where |
|---|---|
| Web app | Vercel (this repo, `main` auto-deploys) |
| Database | MongoDB Atlas |
| Background jobs | Inngest Cloud (Vercel integration): alerts, market data every hour, the market brief 3× a weekday, and a ping that keeps the AI service awake |
| AI analyst service | Hugging Face Space running [`analyst-service/`](analyst-service/) |
| RL Lab service | Hugging Face Space running [Nexus](https://github.com/C-Anish-Kumar/nexus) (`space/` in that repo) |

## Environment variables

| Variable | |
|---|---|
| `MONGODB_URI` | Atlas connection string |
| `BETTER_AUTH_SECRET` | random secret (`openssl rand -hex 32`) |
| `BETTER_AUTH_URL` | the site's public URL |
| `NEXT_PUBLIC_FINNHUB_API_KEY`, `FINNHUB_BASE_URL` | market data (`https://finnhub.io/api/v1`) |
| `NEXT_PUBLIC_OPENSTOCK_DATA_MODE` | `realtime` for 15-second quotes and price alerts, `cached` for hourly |
| `NODEMAILER_EMAIL`, `NODEMAILER_PASSWORD` | Gmail address and app password for emails |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | set by the Inngest Vercel integration |
| `ANALYST_SERVICE_URL`, `ANALYST_API_KEY` | the AI analyst Space and its shared secret |
| `NEXUS_SERVICE_URL`, `NEXUS_API_KEY` | optional, the Nexus Space and its shared secret; turns on RL Lab |
| `NEXUS_HF_TOKEN` | optional, only if the Nexus Space is private |
| `GEMINI_API_KEY` | AI-written emails and the market brief |
| `TELEGRAM_BOT_TOKEN` | optional, from [@BotFather](https://t.me/BotFather); turns on Telegram messages |
| `TELEGRAM_WEBHOOK_SECRET` | with the token: any random string (`openssl rand -hex 24`); Telegram sends it back so the webhook knows the call is genuine. After adding both, send the Inngest event `app/telegram.setup` once |
| `FRED_API_KEY` | optional, free from https://fred.stlouisfed.org/docs/api/api_key.html; turns on the economic calendar |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | optional, shows support email links on Help and Terms |

The AI analyst service has its own setup guide in [`analyst-service/README.md`](analyst-service/README.md).

## Running locally

```bash
npm install
# create .env with the variables above
npm run dev
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
