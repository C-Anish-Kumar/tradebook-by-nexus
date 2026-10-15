"""HTTP wrapper around TradingAgents for OpenStock.

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

API_KEY = os.environ.get("ANALYST_API_KEY", "")
TICKER_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,14}$")
JOB_TTL_SECONDS = 24 * 60 * 60

# One run at a time keeps a free Gemini key under its rate limits
executor = ThreadPoolExecutor(max_workers=int(os.environ.get("ANALYST_CONCURRENCY", "1")))
jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()

app = FastAPI(title="OpenStock AI Analyst")


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
