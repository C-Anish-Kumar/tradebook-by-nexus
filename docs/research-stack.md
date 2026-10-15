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

## How it fits together

```
Stock page                                   Portfolio Lab (/portfolio)
├─ Strategy checklist   /signals             ├─ pick 2–12 tickers (watchlist prefilled), 3/5/10 years
├─ Backtest             /backtest            ├─ methods table: out-of-sample return, volatility,
│   └─ risk tiles (empyrical)                │  Sharpe, Sortino, max drawdown, Calmar, alpha/beta vs SPY
├─ Fundamentals         /fundamentals        ├─ chosen method vs SPY equity curve + weights today
│   (edgartools: 10-K, Form 4, filings)      ├─ efficient frontier with each stock plotted
└─ AI Analyst           /analyses            └─ correlation matrix
```

Everything heavy runs on the analyst service (`analyst-service/`, a Hugging Face Space); the web app
calls it with the shared `X-Analyst-Key` and caches results.

## Caveats

- Fundamentals cover SEC filers only. Banks and insurers don't report operating income, so margins
  are hidden for them.
- Portfolio Lab is long only, fully invested and ignores trading costs; cvxportfolio would add those.
- Every figure is historical. Past results don't predict future returns.
