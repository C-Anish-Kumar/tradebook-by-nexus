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
- **Market overview**: sector heatmap, movers, top stories and sentiment from Reddit, X.com, news and Polymarket
- **Emails**: AI-written welcome email and a weekly news digest

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · Better Auth · MongoDB Atlas · Finnhub ·
TradingView widgets · Inngest · Nodemailer (Gmail) · Gemini · TradingAgents on a Hugging Face Space

## How it is deployed

| Piece | Where |
|---|---|
| Web app | Vercel (this repo, `main` auto-deploys) |
| Database | MongoDB Atlas |
| Background jobs | Inngest Cloud (Vercel integration) |
| AI analyst service | Hugging Face Space running [`analyst-service/`](analyst-service/) |

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
| `GEMINI_API_KEY` | optional, AI-written emails |
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
Research (Apache-2.0). It is licensed under **AGPL-3.0**, like OpenStock: if you run a modified
copy for others, you must offer them its source.

Tradebook is a research and education tool, not financial advice.
