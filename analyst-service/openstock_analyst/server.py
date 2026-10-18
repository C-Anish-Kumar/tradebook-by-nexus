"""HTTP wrapper around TradingAgents for Tradebook by Nexus.

A run takes minutes, so POST /analyses queues it and returns a job id; the caller
polls GET /analyses/{id}. Jobs live in memory: a restart loses runs in flight,
and the caller treats a missing job as failed.
"""

import hmac
import os
import re
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

# Gemini by default; any TRADINGAGENTS_* variable set on the host still wins
os.environ.setdefault("TRADINGAGENTS_LLM_PROVIDER", "google")
os.environ.setdefault("TRADINGAGENTS_QUICK_THINK_LLM", "gemini-3.5-flash-lite")
os.environ.setdefault("TRADINGAGENTS_DEEP_THINK_LLM", "gemini-3.8-flash")

from tradingagents.default_config import build_default_config  # noqa: E402
from tradingagents.graph.trading_graph import TradingAgentsGraph  # noqa: E402
from tradingagents.reporting import write_report_tree  # noqa: E402

from openstock_analyst.backtest import run as run_backtest  # noqa: E402
from openstock_analyst.metrics import performance  # noqa: E402
from openstock_analyst.strategy import evaluate  # noqa: E402

API_KEY = os.environ.get("ANALYST_API_KEY", "")
TICKER_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,14}$")
JOB_TTL_SECONDS = 24 * 60 * 60

# One run at a time keeps a free Gemini key under its rate limits
executor = ThreadPoolExecutor(max_workers=int(os.environ.get("ANALYST_CONCURRENCY", "1")))
jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()

app = FastAPI(title="Tradebook AI Analyst")


def require_key(x_analyst_key: str = Header(default="")):
    if not API_KEY or not hmac.compare_digest(x_analyst_key, API_KEY):
        raise HTTPException(status_code=401, detail="Invalid analyst key")


class AnalysisRequest(BaseModel):
    ticker: str
    date: str | None = None


def _config() -> dict:
    config = build_default_config()
    # Ride out 429s from free-tier keys instead of failing the run
    if config.get("llm_max_retries") is None:
        config["llm_max_retries"] = 8
    return config


def _run(job_id: str, ticker: str, trade_date: str):
    _update(job_id, status="running", started_at=time.time())
    try:
        graph = TradingAgentsGraph(config=_config())
        final_state, rating = graph.propagate(ticker, trade_date)
        with tempfile.TemporaryDirectory() as tmp:
            md_path = write_report_tree(final_state, ticker, tmp, settings=graph.run_settings(), html=True)
            report_md = Path(md_path).read_text(encoding="utf-8")
            report_html = (Path(tmp) / "complete_report.html").read_text(encoding="utf-8")
        _update(job_id, status="done", rating=str(rating), report_md=report_md, report_html=report_html,
                finished_at=time.time())
    except Exception as exc:  # surfaced to the caller; the traceback stays in the host's logs
        import traceback
        traceback.print_exc()
        _update(job_id, status="error", error=f"{type(exc).__name__}: {exc}"[:500], finished_at=time.time())


def _update(job_id: str, **fields):
    with jobs_lock:
        jobs[job_id].update(fields)


def _prune():
    cutoff = time.time() - JOB_TTL_SECONDS
    with jobs_lock:
        for job_id in [j for j, job in jobs.items() if job["created_at"] < cutoff]:
            del jobs[job_id]


@app.get("/")
def health():
    return {"ok": True}


@app.post("/analyses", dependencies=[Depends(require_key)], status_code=202)
def create_analysis(body: AnalysisRequest):
    ticker = body.ticker.strip().upper()
    if not TICKER_PATTERN.match(ticker):
        raise HTTPException(status_code=422, detail="Invalid ticker")
    trade_date = body.date or date.today().isoformat()
    try:
        date.fromisoformat(trade_date)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid date")

    _prune()
    job_id = uuid.uuid4().hex
    with jobs_lock:
        jobs[job_id] = {"id": job_id, "ticker": ticker, "date": trade_date, "status": "queued",
                        "created_at": time.time()}
    executor.submit(_run, job_id, ticker, trade_date)
    return {"id": job_id, "status": "queued"}


@app.get("/analyses/{job_id}", dependencies=[Depends(require_key)])
def get_analysis(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Unknown job")
        return dict(job)


SIGNAL_TTL_SECONDS = 15 * 60
signal_cache: dict[str, tuple[float, dict]] = {}


@app.get("/signals/{ticker}", dependencies=[Depends(require_key)])
def get_signals(ticker: str):
    """10/21 EMA + Supertrend (10,3) checklist on daily candles, cached for 15 minutes."""
    ticker = ticker.strip().upper()
    if not TICKER_PATTERN.match(ticker):
        raise HTTPException(status_code=422, detail="Invalid ticker")
    cached = signal_cache.get(ticker)
    if cached and time.time() - cached[0] < SIGNAL_TTL_SECONDS:
        return cached[1]

    import yfinance as yf

    history = yf.Ticker(ticker)
    daily = history.history(period="2y", interval="1d", auto_adjust=False)
    if len(daily) < 120:
        raise HTTPException(status_code=404, detail="Not enough price history for this ticker")
    weekly = history.history(period="5y", interval="1wk", auto_adjust=False)
    result = {"ticker": ticker, **evaluate(daily, weekly)}
    signal_cache[ticker] = (time.time(), result)
    return result


BACKTEST_TTL_SECONDS = 6 * 60 * 60
backtest_cache: dict[tuple[str, int], tuple[float, dict]] = {}


@app.get("/backtest/{ticker}", dependencies=[Depends(require_key)])
def get_backtest(ticker: str, years: int = 5):
    """Replay the strategy over the last `years` of daily candles, cached for 6 hours."""
    ticker = ticker.strip().upper()
    if not TICKER_PATTERN.match(ticker):
        raise HTTPException(status_code=422, detail="Invalid ticker")
    years = max(1, min(years, 10))
    key = (ticker, years)
    cached = backtest_cache.get(key)
    if cached and time.time() - cached[0] < BACKTEST_TTL_SECONDS:
        return cached[1]

    import yfinance as yf

    daily = yf.Ticker(ticker).history(period=f"{years}y", interval="1d", auto_adjust=False)
    if len(daily) < 250:
        raise HTTPException(status_code=404, detail="Not enough price history to backtest")
    result = {"ticker": ticker, "years": years, **run_backtest(daily)}
    result["risk"] = _strategy_risk(result, years)
    backtest_cache[key] = (time.time(), result)
    return result


def _strategy_risk(result: dict, years: int) -> dict | None:
    """Sharpe, Sortino, Calmar and alpha/beta vs SPY for the strategy's equity curve."""
    import pandas as pd
    import yfinance as yf

    try:
        equity = pd.Series({pd.Timestamp(p["date"]): p["strategy"] for p in result["equity"]})
        spy = yf.Ticker("SPY").history(period=f"{years}y", interval="1d")["Close"]
        spy.index = spy.index.tz_localize(None)
        weekly_spy = spy.resample("W").last().pct_change()
        # Weekly points: annualise with 52 periods
        import empyrical as ep
        rets = equity.pct_change().dropna()
        out = performance(rets, weekly_spy)
        out["annual_return"] = round(float(ep.annual_return(rets, period="weekly")), 4)
        out["annual_volatility"] = round(float(ep.annual_volatility(rets, period="weekly")), 4)
        out["sharpe"] = round(float(ep.sharpe_ratio(rets, period="weekly")), 4)
        out["sortino"] = round(float(ep.sortino_ratio(rets, period="weekly")), 4)
        out["calmar"] = round(float(ep.calmar_ratio(rets, period="weekly")), 4)
        aligned = pd.concat([rets, weekly_spy], axis=1, join="inner").dropna()
        if len(aligned) > 20:
            alpha, beta = ep.alpha_beta(aligned.iloc[:, 0], aligned.iloc[:, 1], period="weekly")
            out["alpha"], out["beta"] = round(float(alpha), 4), round(float(beta), 4)
        return out
    except Exception:
        return None


FUNDAMENTALS_TTL_SECONDS = 12 * 60 * 60
fundamentals_cache: dict[str, tuple[float, dict]] = {}


@app.get("/fundamentals/{ticker}", dependencies=[Depends(require_key)])
def get_fundamentals_route(ticker: str):
    """Annual SEC financials, open-market insider trades and recent filings (US registrants)."""
    from openstock_analyst.fundamentals import get_fundamentals

    ticker = ticker.strip().upper()
    if not TICKER_PATTERN.match(ticker) or "." in ticker:
        raise HTTPException(status_code=422, detail="SEC data covers US tickers only")
    cached = fundamentals_cache.get(ticker)
    if cached and time.time() - cached[0] < FUNDAMENTALS_TTL_SECONDS:
        return cached[1]
    try:
        result = get_fundamentals(ticker)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    fundamentals_cache[ticker] = (time.time(), result)
    return result


class PortfolioRequest(BaseModel):
    tickers: list[str]
    years: int = 5
    benchmark: str = "SPY"


PORTFOLIO_TTL_SECONDS = 6 * 60 * 60
portfolio_cache: dict[tuple, tuple[float, dict]] = {}


@app.post("/portfolio/optimize", dependencies=[Depends(require_key)])
def optimize_portfolio(body: PortfolioRequest):
    """Five allocation methods (skfolio), scored walk-forward with empyrical metrics."""
    import yfinance as yf
    from openstock_analyst.portfolio import optimize

    tickers = sorted({t.strip().upper() for t in body.tickers})
    benchmark = body.benchmark.strip().upper()
    if not 2 <= len(tickers) <= 12 or not all(TICKER_PATTERN.match(t) for t in tickers + [benchmark]):
        raise HTTPException(status_code=422, detail="Pick 2 to 12 valid tickers")
    years = max(2, min(body.years, 10))
    key = (tuple(tickers), years, benchmark)
    cached = portfolio_cache.get(key)
    if cached and time.time() - cached[0] < PORTFOLIO_TTL_SECONDS:
        return cached[1]

    prices = yf.download(tickers + [benchmark], period=f"{years}y", auto_adjust=True, progress=False)["Close"]
    missing = [t for t in tickers if t not in prices.columns or prices[t].dropna().empty]
    if missing:
        raise HTTPException(status_code=404, detail=f"No price history for {', '.join(missing)}")
    try:
        result = optimize(prices[tickers], prices[benchmark])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    result = {"benchmark_ticker": benchmark, "years": years, **result}
    portfolio_cache[key] = (time.time(), result)
    return result


SETUP_TTL_SECONDS = 30 * 60
setup_cache: dict[tuple, tuple[float, dict]] = {}
daily_cache: dict[str, tuple[float, object]] = {}


def _daily_5y(ticker: str):
    """Five years of daily candles, shared by every strategy scanned for the same ticker (one Yahoo call, not five)."""
    hit = daily_cache.get(ticker)
    if hit and time.time() - hit[0] < SETUP_TTL_SECONDS:
        return hit[1]
    import yfinance as yf

    daily = yf.Ticker(ticker).history(period="5y", interval="1d", auto_adjust=False)
    if len(daily_cache) > 200:
        daily_cache.clear()
    daily_cache[ticker] = (time.time(), daily)
    return daily


@app.get("/setups/{ticker}", dependencies=[Depends(require_key)])
def get_setup(ticker: str, account: float | None = None, risk_pct: float = 1.0, universe: int = 1,
              strategy: str = "breakout"):
    """A strategy's setup (entry/stop/targets/size) with walk-forward evidence and a 0-100 quant score, on daily candles.

    `strategy` is one of the ids in setups.SPECS (default: the regime-aware breakout).

    `universe` is how many tickers the caller is scanning, so the Deflated Sharpe prices in the search.
    The stock-specific validation is cached per last bar; sizing is applied fresh on every call.
    """
    from openstock_analyst.setups import MIN_BARS, SPECS, build_setup

    ticker = ticker.strip().upper()
    if not TICKER_PATTERN.match(ticker):
        raise HTTPException(status_code=422, detail="Invalid ticker")
    if strategy not in SPECS:
        raise HTTPException(status_code=422, detail=f"Unknown strategy. Use one of: {', '.join(SPECS)}")
    universe = max(1, min(universe, 200))
    risk_pct = max(0.1, min(risk_pct, 5.0))
    key = (ticker, strategy, universe, round(account or 0, 2), risk_pct)
    cached = setup_cache.get(key)
    if cached and time.time() - cached[0] < SETUP_TTL_SECONDS:
        return cached[1]

    daily = _daily_5y(ticker)
    if len(daily) < MIN_BARS:
        raise HTTPException(status_code=404, detail="Not enough price history for this ticker")
    result = {"ticker": ticker, **build_setup(daily, account, risk_pct, universe, key=ticker, strategy=strategy)}
    setup_cache[key] = (time.time(), result)
    return result


def main():
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT") or os.environ.get("GRADIO_SERVER_PORT") or 7860))
