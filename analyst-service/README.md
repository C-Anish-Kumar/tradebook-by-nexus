# AI Analyst service (Tradebook by Nexus)

Runs [TradingAgents](https://github.com/TauricResearch/TradingAgents) (Apache-2.0) for Tradebook's
**AI Analyst** panel. A run takes 5–15 minutes and dozens of LLM calls, which is longer than a Vercel
function can live, so this service runs on its own host and Tradebook polls it through Inngest.

## API

All routes except `/` need the `X-Analyst-Key` header.

| Route | |
|---|---|
| `GET /` | health check |
| `POST /analyses` `{"ticker": "AAPL", "date": "2026-10-15"}` | queues a run, returns `{"id", "status"}` |
| `GET /analyses/{id}` | `status` is `queued`, `running`, `done` (with `rating`, `report_html`, `report_md`) or `error` |
| `GET /signals/{ticker}` | 10/21 EMA + Supertrend (10,3) checklist on daily Yahoo Finance candles, cached 15 minutes |
| `GET /setups/{ticker}?account=&risk_pct=1&universe=1` | Regime (ADX / ATR percentile) + ATR-trailed breakout setup on daily candles: status, entry, stop, 2R/3R reference targets and share size, with its evidence: purged walk-forward Sharpe, 2x-cost stress, buy-and-hold and MA-cross baselines and a Deflated Sharpe that counts every ticker and setting searched (`universe`). `validated` is true only if every gate passes. Cached 30 minutes; validation reused per last bar. Engine: `openstock_analyst/aqp/` |
| `GET /backtest/{ticker}?years=5` | Replays the strategy over 1–10 years (next-open fills, 0.1% cost per side) with stats, weekly equity vs buy & hold and every trade, plus Sharpe, Sortino, Calmar and alpha/beta vs SPY ([empyrical](https://github.com/stefan-jansen/empyrical-reloaded)), cached 6 hours |
| `GET /fundamentals/{ticker}` | US filers only: three years of 10-K figures with margins and growth, open-market insider buys and sells (Form 4, last 180 days, 10b5-1 flagged) and the latest filings, all from SEC EDGAR via [edgartools](https://github.com/dgunning/edgartools), cached 12 hours |
| `POST /portfolio/optimize` `{"tickers": ["AAPL", "MSFT"], "years": 5}` | Max Sharpe, min variance, hierarchical risk parity, risk parity and equal weight ([skfolio](https://github.com/skfolio/skfolio)), each scored walk-forward (fit 252 days, hold 63) against SPY, with weights, efficient frontier and correlations, cached 6 hours |

Jobs live in memory for 24 hours; one run at a time by default (`ANALYST_CONCURRENCY`).

## Environment

| Variable | |
|---|---|
| `ANALYST_API_KEY` | shared secret; Tradebook sends the same value |
| `GOOGLE_API_KEY` | Gemini key from https://aistudio.google.com/apikey |
| `SEC_IDENTITY` | optional, `"Your Name you@example.com"`; the SEC asks every EDGAR client to identify itself |
| `TRADINGAGENTS_QUICK_THINK_LLM` | optional, default `gemini-3.5-flash-lite` |
| `TRADINGAGENTS_DEEP_THINK_LLM` | optional, default `gemini-3.8-flash` |

Any other `TRADINGAGENTS_*` variable from TradingAgents works too (another provider, debate rounds, ...).

## Hosting on Hugging Face Spaces (free)

Docker Spaces need a paid plan, but a Gradio Space runs any `app.py`, so the service installs as a package
there and serves its own API on port 7860.

1. https://huggingface.co/new-space → SDK **Gradio** (or **Docker**, using [`space/Dockerfile`](space/Dockerfile) as its only file), template **Blank**, hardware **CPU basic (free)**.
2. Replace the Space's `README.md`, `app.py` and `requirements.txt` with the files in [`space/`](space/)
   (**Files → Add file → Create a new file**, or edit each file in the browser). The README sets
   `python_version: "3.12"`, which TradingAgents needs.
3. **Settings → Variables and secrets**: add the secrets `ANALYST_API_KEY` and `GOOGLE_API_KEY`.
4. The Space URL is `https://<user>-<space>.hf.space`. In Vercel set `ANALYST_SERVICE_URL` to it and
   `ANALYST_API_KEY` to the same secret, then redeploy. For a private Space also set
   `ANALYST_HF_TOKEN` to a Hugging Face read token.

`requirements.txt` installs this folder from the fork's `main`; use **Settings → Factory rebuild** in the
Space to pick up changes.

## Running locally

```bash
docker build -t openstock-analyst analyst-service
docker run -p 7860:7860 -e ANALYST_API_KEY=... -e GOOGLE_API_KEY=... openstock-analyst
```
