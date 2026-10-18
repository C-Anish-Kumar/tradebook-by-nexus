# Research stack blueprint

How six open-source quant projects were assessed for Tradebook, and where the ones we kept live.

The workflow they cover: **corporate financials → AI research → portfolio construction → optimisation
→ risk → performance**.

| Project | Verdict | Why | Where it lives |
|---|---|---|---|
| [edgartools](https://github.com/dgunning/edgartools) (MIT) | Used | Free, no API key, reads SEC filings directly; its getters pick the right statement line per company | `GET /fundamentals/{ticker}` → **Fundamentals** panel on stock pages |
| [StockAgent](https://github.com/MingyuJ666/Stockagent) | Not used | No licence, pinned to 2022-era packages, and it simulates trader behaviour rather than researching a stock. The AI Analyst (TradingAgents) already covers AI research | — |
| [skfolio](https://github.com/skfolio/skfolio) (BSD-3) | Used | scikit-learn style optimisers plus walk-forward cross-validation, so methods are scored on data they never saw | `POST /portfolio/optimize` → **Portfolio Lab** (`/portfolio`) |
| [cvxportfolio](https://github.com/cvxgrp/cvxportfolio) (GPL-3) | Later | Strong at multi-period rebalancing with trading costs, but overlaps skfolio and its licence needs care | Phase 2: cost-aware rebalancing in Portfolio Lab |
| [FinQuant](https://github.com/fmilthaler/FinQuant) | Not used | Little activity, Quandl dependency, and everything it does skfolio does better | — |
| [empyrical-reloaded](https://github.com/stefan-jansen/empyrical-reloaded) (Apache-2) | Used | The standard Sharpe / Sortino / Calmar / alpha / beta implementations | `metrics.performance()` used by Portfolio Lab and the strategy backtest |

### Round two: World Monitor

[World Monitor](https://github.com/koala73/worldmonitor) (AGPL-3.0, same as Tradebook) is a geopolitics
dashboard with a finance edition. Its map, conflict and webcam panels don't fit a stock terminal; these did:

| Idea | Where it lives in Tradebook |
|---|---|
| Seed-then-serve: background jobs fill a cache, pages only read it | `lib/cache.ts` (MongoDB stale-while-revalidate) + `lib/inngest/market.ts` |
| Earnings calendar (Finnhub) | Watchlist panel, "Earnings this week" on Overview, countdown pill on stock pages |
| Daily market brief (LLM over quotes + headlines) | "Market brief" on Overview |
| Fear & greed composite | Overview, rebuilt on FRED only: VIX, high-yield spread, S&P momentum and strength, each ranked against its past year |
| Yield curve (FRED DGS series) | Overview |
| Economic calendar (FRED release dates) | Overview, when `FRED_API_KEY` is set |

## How it fits together

```
Stock page                                   Portfolio Lab (/portfolio)
├─ Quant score          /setups              ├─ pick 2–12 tickers (watchlist prefilled), 3/5/10 years
│   (Strategy 2)                             ├─ methods table: out-of-sample return, volatility,
├─ Fundamentals         /fundamentals        │  Sharpe, Sortino, max drawdown, Calmar, alpha/beta vs SPY
│   (edgartools: 10-K, Form 4, filings)      ├─ chosen method vs SPY equity curve + weights today
├─ AI Analyst           /analyses            ├─ efficient frontier with each stock plotted
└─ (Strategy 1: /signals, /backtest; off)    └─ correlation matrix
```

Everything heavy runs on the analyst service (`analyst-service/`, a Hugging Face Space); the web app
calls it with the shared `X-Analyst-Key` and caches results.

## Caveats

- Fundamentals cover SEC filers only. Banks and insurers don't report operating income, so margins
  are hidden for them.
- Portfolio Lab is long only, fully invested and ignores trading costs; cvxportfolio would add those.
- Every figure is historical. Past results don't predict future returns.
