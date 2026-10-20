# AI Analyst service (Apex Tradebook)

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
| `GET /setups/{ticker}?strategy=breakout&account=&risk_pct=1&universe=1` | `strategy` is `breakout` (default), `ma_pullback`, `golden_cross`, `breakout_retest` or `volume_bounce` (the last four from `aqp/strategies/playbook.py`). Regime (ADX / ATR percentile) + the strategy's setup on daily candles: status, entry, stop, 2R/3R reference targets and share size, with its evidence: purged walk-forward Sharpe, 2x-cost stress, buy-and-hold and MA-cross baselines and a Deflated Sharpe that counts every ticker and setting searched (`universe`). `validated` is true only if every gate passes. `quant` is a 0-100 setup-quality score (evidence 40, trend and regime 20, readiness 20, volume 10, risk 10; capped at 69 until validated) with its per-part breakdown, from `openstock_analyst/quant_score.py`. Cached 30 minutes; validation reused per last bar. Engine: `openstock_analyst/aqp/` |
| `GET /backtest/{ticker}?years=5` | Replays the strategy over 1–10 years (next-open fills, 0.1% cost per side) with stats, weekly equity vs buy & hold and every trade, plus Sharpe, Sortino, Calmar and alpha/beta vs SPY ([empyrical](https://github.com/stefan-jansen/empyrical-reloaded)), cached 6 hours |
| `POST /screen` `{"universes": [...], "strategies": [...], "track": [...]}` | Starts the market screener in the background (one at a time; a second request joins the running one) and returns `{"id", "status"}`. Universes are the filter sets from the app's `config/universes.ts`; `track` lists `{ticker, strategy, universe}` trades in play last time, which are always reported so exits are seen. Engine: `openstock_analyst/universe.py` (listings from Nasdaq's screener, S&P 500 / Nasdaq-100 lists, Yahoo candles batched and cached under `SCREEN_CACHE_DIR`) and `openstock_analyst/screener.py` (validation per strategy x universe, pooled over a fixed 25-stock sample and cached a week; latest-bar reads; small-cap badges from the candles, SEC EDGAR and Yahoo) |
| `GET /screen/{id}` | `status` is `queued`, `running` (with `stage`, `done`, `total`), `done` (with `result`: rows, universe members, validation with each strategy's backtest trades in R, and `market`: SPY against its 50- and 200-day averages) or `error` |
| `GET /fundamentals/{ticker}` | US filers only: three years of 10-K figures with margins and growth, open-market insider buys and sells (Form 4, last 180 days, 10b5-1 flagged) and the latest filings, all from SEC EDGAR via [edgartools](https://github.com/dgunning/edgartools), cached 12 hours |

Jobs live in memory for 24 hours; one run at a time by default (`ANALYST_CONCURRENCY`).

## Environment

| Variable | |
|---|---|
| `ANALYST_API_KEY` | shared secret; Tradebook sends the same value |
| `GOOGLE_API_KEY` | Gemini key from https://aistudio.google.com/apikey |
| `SEC_IDENTITY` | optional, `"Your Name you@example.com"`; the SEC asks every EDGAR client to identify itself (fundamentals and the screener's offering-filing badge) |
| `SCREEN_CACHE_DIR` | optional, where the screener caches candles and weekly validation (default `/tmp/tradebook-screener`) |
| `TRADINGAGENTS_QUICK_THINK_LLM` | optional, default `gemini-3.5-flash-lite` |
| `TRADINGAGENTS_DEEP_THINK_LLM` | optional, default `gemini-3.8-flash` |

Any other `TRADINGAGENTS_*` variable from TradingAgents works too (another provider, debate rounds, ...).

## Hosting on Hugging Face Spaces (free)

Docker Spaces need a paid plan, but a Gradio Space runs any `app.py`, so the service runs there and
serves its own API on port 7860. The repo is private, so the Space does not install from GitHub:
the **Sync analyst Space** workflow (`.github/workflows/sync-space.yml`) copies this folder into it.

1. https://huggingface.co/new-space → SDK **Gradio**, template **Blank**, hardware **CPU basic (free)**,
   visibility **Private**.
2. Create a Hugging Face token with write access to the Space (https://huggingface.co/settings/tokens,
   fine-grained, "Write access to contents/settings" on that Space only) and add it to this GitHub repo
   as the Actions secret `HF_TOKEN`. If the Space isn't `Akumar90/openstock-analyst`, set the repo
   variable `HF_SPACE` to its id.
3. Run the workflow (**Actions → Sync analyst Space → Run workflow**). It runs `space/build.py`,
   which puts `README.md`, `app.py`, a copy of `openstock_analyst/` and a `requirements.txt` made from
   `pyproject.toml` into the Space, then the Space rebuilds. After that it runs on every push to `main`
   that touches `analyst-service/`.
4. **Settings → Variables and secrets** in the Space: add the secrets `ANALYST_API_KEY` and `GOOGLE_API_KEY`.
5. The Space URL is `https://<user>-<space>.hf.space`. In Vercel set `ANALYST_SERVICE_URL` to it,
   `ANALYST_API_KEY` to the same secret, and (because the Space is private) `ANALYST_HF_TOKEN` to a
   Hugging Face **read** token, then redeploy.

To build the Space folder locally: `python analyst-service/space/build.py /tmp/space`.

## Running locally

```bash
docker build -t openstock-analyst analyst-service
docker run -p 7860:7860 -e ANALYST_API_KEY=... -e GOOGLE_API_KEY=... openstock-analyst
```
