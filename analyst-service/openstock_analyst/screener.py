"""The nightly market screener: every universe, every enabled strategy, every member, on daily candles.

Per stock the scan only reads the latest bar (entry, holding, watching or nothing). Whether a strategy has an edge
is decided once per strategy x universe, not per stock: its rules are walk-forward tested on a fixed sample of the
universe's members, with the universe's own slippage, and the out-of-sample returns are pooled. The same gates as
the per-stock evidence apply (no lookahead, profitable out of sample, survives 2x costs, beats buy-and-hold and an
MA cross, Deflated Sharpe that counts every setting x strategy x universe searched, enough trades). A strategy that
fails any gate marks all its rows in that universe "unvalidated", and their quant scores stay capped at 69.

Pooling is deliberate: one stock rarely has enough trades to prove anything, and the screener ranks a whole
universe, so the claim being tested is "this strategy works on stocks like these".
"""

from __future__ import annotations

import hashlib
import json
import time
from collections import Counter
from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np
import pandas as pd
import requests

from openstock_analyst.aqp.backtest.engine import Costs, backtest, sharpe
from openstock_analyst.aqp.regime.detector import detect_regimes
from openstock_analyst.aqp.strategies.rules import BuyHold, MaCross
from openstock_analyst.aqp.validation.gates import lookahead_check
from openstock_analyst.aqp.validation.ledger import TrialLedger
from openstock_analyst.aqp.validation.stats import deflated_sharpe
from openstock_analyst.aqp.validation.walkforward import walk_forward
from openstock_analyst.setups import DAILY_PPY, MIN_BARS, SPECS, _grid, _num, normalise, read_latest
from openstock_analyst.universe import (
    CACHE_DIR, MIN_SCREEN_BARS, UA, Filters, fetch_index_members, fetch_listings, load_daily, metrics,
    passes_listing, passes_metrics,
)

FEE_BPS = 2.0
SAMPLE_SIZE = 25            # stocks per universe used to validate each strategy
MIN_POOLED_TRADES = 40
VALIDATION_MAX_AGE_DAYS = 7
GAP_PCT = 20.0
LOW_FLOAT = 10_000_000
DILUTIVE_FORMS = ("S-1", "S-1/A", "S-3", "S-3/A", "F-1", "F-1/A", "F-3", "F-3/A", "424B1", "424B2", "424B3",
                  "424B4", "424B5", "424B7")
DILUTION_DAYS = 90
SPLIT_DAYS = 90


@dataclass
class UniverseSpec:
    id: str
    name: str
    filters: Filters
    slippage_bps: float = 10.0
    badges: bool = False


# ---------------------------------------------------------------- pooled validation per strategy x universe

def _sample(members: list[str], n: int = SAMPLE_SIZE) -> list[str]:
    """A stable pseudo-random sample, so the same stocks validate a strategy week after week."""
    return sorted(members, key=lambda s: hashlib.md5(s.encode()).hexdigest())[:n]


def pooled_evidence(spec, dfs: dict[str, pd.DataFrame], costs: Costs, search_size: int) -> dict:
    """Walk-forward each sampled stock, pool the out-of-sample returns equal-weight by day, and run the gates."""
    ledger = TrialLedger()
    oos, stress, bh, mac, last_params = [], [], [], [], []
    trades, lookahead = 0, None
    for sym, raw in dfs.items():
        df = normalise(raw)
        if len(df) < MIN_BARS:
            continue
        if lookahead is None:
            lookahead = lookahead_check(spec.cls(**{k: v[0] for k, v in spec.grid.items()}), df)["passed"]
        r, folds = walk_forward(df, spec.cls, spec.grid, ledger, 4, 10, 5, costs=costs, ppy=DAILY_PPY)
        if not len(r):
            continue
        s, _ = walk_forward(df, spec.cls, spec.grid, None, 4, 10, 5, costs=costs.scaled(2.0), ppy=DAILY_PPY)
        idx = r.index
        oos.append(r.rename(sym))
        stress.append(s.rename(sym))
        bh.append(backtest(df, BuyHold().positions(df), costs).ret.reindex(idx).rename(sym))
        mac.append(backtest(df, MaCross().positions(df), costs).ret.reindex(idx).rename(sym))
        p = folds[-1]["params"]
        last_params.append(tuple(sorted(p.items())))
        trades += int(backtest(df, spec.cls(**p).positions(df), costs).turnover.gt(0).sum())

    gates = {"lookahead": bool(lookahead) if lookahead is not None else False}
    if not oos:
        gates.update(oos_profitable=False, cost_stress_2x=False, beats_baselines=False, deflated_sharpe=False, min_trades=False)
        return {"validated": False, "params": None, "oos_sharpe": None, "baselines_sharpe": {}, "deflated_sharpe": None,
                "trials": search_size, "trades": 0, "gates": gates, "sample": 0}

    pool = lambda parts: pd.concat(parts, axis=1).mean(axis=1).dropna()  # noqa: E731
    p_oos, p_stress, p_bh, p_mac = pool(oos), pool(stress), pool(bh), pool(mac)
    p_bh, p_mac = p_bh.reindex(p_oos.index), p_mac.reindex(p_oos.index)
    sr = sharpe(p_oos, DAILY_PPY)
    base = {"buy_hold": sharpe(p_bh, DAILY_PPY), "ma_cross": sharpe(p_mac, DAILY_PPY)}
    dsr = deflated_sharpe(p_oos.values, np.array(ledger.sharpes()), max(search_size, 1))
    gates.update(
        oos_profitable=bool(sr > 0 and p_oos.sum() > 0),
        cost_stress_2x=bool(sharpe(p_stress, DAILY_PPY) > 0),
        beats_baselines=bool(all(sr > v for v in base.values())),
        deflated_sharpe=bool(dsr >= 0.95),
        min_trades=bool(trades >= MIN_POOLED_TRADES),
    )
    params = dict(Counter(last_params).most_common(1)[0][0])
    return {
        "validated": all(gates.values()),
        "params": params,
        "oos_sharpe": _num(sr, 2),
        "baselines_sharpe": {k: _num(v, 2) for k, v in base.items()},
        "deflated_sharpe": _num(dsr, 3),
        "trials": search_size,
        "trades": trades,
        "gates": gates,
        "sample": len(oos),
    }


def _validation_key(u: UniverseSpec, strategy: str, search_size: int) -> str:
    raw = json.dumps([u.id, u.filters.__dict__, u.slippage_bps, strategy, search_size, SPECS[strategy].grid], sort_keys=True, default=str)
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


def _cached_validation(key: str) -> dict | None:
    p = CACHE_DIR / "validation" / f"{key}.json"
    try:
        if time.time() - p.stat().st_mtime < VALIDATION_MAX_AGE_DAYS * 86400:
            return json.loads(p.read_text())
    except OSError:
        pass
    return None


def _store_validation(key: str, ev: dict) -> None:
    p = CACHE_DIR / "validation" / f"{key}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(ev))


# ---------------------------------------------------------------- warning badges (small-cap risk flags)

def price_badges(df: pd.DataFrame) -> list[dict]:
    """Gaps over 20% in the last 5 sessions and reverse splits in the last 90 days, read from the candles."""
    out = []
    if len(df) >= 6:
        gaps = (df.open / df.close.shift(1) - 1).iloc[-5:] * 100
        big = gaps[gaps.abs() >= GAP_PCT]
        if len(big):
            when, g = big.index[-1], float(big.iloc[-1])
            out.append({"code": "gap", "label": f"Gapped {g:+.0f}% on {when.date().isoformat()}"})
    if "splits" in df.columns:
        since = df.index[-1] - pd.Timedelta(days=SPLIT_DAYS)
        rev = df.splits[(df.index >= since) & (df.splits > 0) & (df.splits < 1)]
        if len(rev):
            ratio = round(1 / float(rev.iloc[-1]))
            out.append({"code": "reverse_split", "label": f"Reverse split 1:{ratio} on {rev.index[-1].date().isoformat()}"})
    return out


class SecFilings:
    """Recent offering filings (S-1/S-3/424B...) from SEC EDGAR, for the dilution badge."""

    def __init__(self, identity: str, session: requests.Session | None = None):
        self.s = session or requests.Session()
        self.headers = {"User-Agent": identity or "Apex Tradebook research tool"}
        self.ciks: dict[str, int] | None = None

    def _load_ciks(self):
        res = self.s.get("https://www.sec.gov/files/company_tickers_exchange.json", headers=self.headers, timeout=30)
        res.raise_for_status()
        d = res.json()
        i_cik, i_t = d["fields"].index("cik"), d["fields"].index("ticker")
        self.ciks = {str(r[i_t]).upper().replace(".", "-"): int(r[i_cik]) for r in d["data"] if r[i_t]}

    def dilution(self, symbol: str, today: date) -> dict | None:
        if self.ciks is None:
            self._load_ciks()
        cik = self.ciks.get(symbol)
        if not cik:
            return None
        time.sleep(0.15)  # SEC asks for at most 10 requests a second
        res = self.s.get(f"https://data.sec.gov/submissions/CIK{cik:010d}.json", headers=self.headers, timeout=30)
        res.raise_for_status()
        recent = res.json().get("filings", {}).get("recent", {})
        since = (today - timedelta(days=DILUTION_DAYS)).isoformat()
        for form, filed in zip(recent.get("form", []), recent.get("filingDate", [])):
            if filed < since:
                break
            if form in DILUTIVE_FORMS:
                return {"code": "dilution", "label": f"{form} filed {filed} (possible offering)"}
        return None


def float_badge(symbol: str) -> dict | None:
    import yfinance as yf

    shares = (yf.Ticker(symbol).get_info() or {}).get("floatShares")
    if shares and shares < LOW_FLOAT:
        return {"code": "low_float", "label": f"Low float ({shares / 1e6:.1f}M shares)"}
    return None


# ---------------------------------------------------------------- the scan

def run_screen(universes: list[UniverseSpec], strategies: list[str], sec_identity: str = "",
               progress=lambda stage, done=None, total=None: None, track: list[dict] | None = None) -> dict:
    """Build every universe, validate every strategy per universe, and read the latest bar for every member.

    Returns rows only for stocks with something in play (entry, holding or watch); each stock appears in the first
    universe (config order) it belongs to, tagged with the others. `track` lists {ticker, strategy, universe} pairs
    that were in play last time: they are always reported, even when they show nothing today or have dropped out
    of their universe, so the caller can see the exit.
    """
    started = time.time()
    problems: list[str] = []
    strategies = [s for s in strategies if s in SPECS]

    progress("listings")
    listings = fetch_listings()
    index_members: dict[str, set[str]] = {}
    if any(u.filters.indexes for u in universes):
        index_members, bad = fetch_index_members()
        problems += bad

    candidates: dict[str, list[str]] = {}
    for u in universes:
        members = None
        if u.filters.indexes:
            sets = [index_members[i] for i in u.filters.indexes if i in index_members]
            if not sets:
                problems.append(f"{u.name}: no index list could be loaded, so it was skipped")
                candidates[u.id] = []
                continue
            members = set().union(*sets)
        candidates[u.id] = [sym for sym, row in listings.iterrows() if passes_listing(row, u.filters, members, sym)]

    track = [t for t in (track or []) if t.get("strategy") in strategies and t.get("universe") in {u.id for u in universes}]
    tracked = {(t["ticker"], t["strategy"]) for t in track}
    wanted = sorted(set().union(*candidates.values(), {t["ticker"] for t in track})) if candidates else []
    candles = load_daily(wanted, "2y", on_progress=lambda d, t: progress("candles", d, t))
    stats = {sym: metrics(normalise(df)) for sym, df in candles.items()}

    members: dict[str, list[str]] = {
        u.id: [s for s in candidates[u.id] if passes_metrics(stats.get(s), u.filters)] for u in universes
    }
    primary: dict[str, str] = {}
    for u in universes:
        for s in members[u.id]:
            primary.setdefault(s, u.id)
    names = {u.id: u.name for u in universes}

    # One validation per strategy x universe; the search counted is every setting x strategy x universe
    validation: dict[str, dict[str, dict]] = {}
    for n, u in enumerate(universes):
        progress("validation", n, len(universes))
        validation[u.id] = {}
        sample = _sample(members[u.id])
        need = {sid: _validation_key(u, sid, len(_grid(SPECS[sid].grid)) * len(strategies) * len(universes)) for sid in strategies}
        cached = {sid: _cached_validation(k) for sid, k in need.items()}
        five_years = load_daily(sample, "5y", kind="daily5y", max_age_days=VALIDATION_MAX_AGE_DAYS) \
            if any(v is None for v in cached.values()) and sample else {}
        costs = Costs(fee_bps=FEE_BPS, slippage_bps=u.slippage_bps)
        for sid in strategies:
            ev = cached[sid]
            if ev is None:
                search = len(_grid(SPECS[sid].grid)) * len(strategies) * len(universes)
                ev = pooled_evidence(SPECS[sid], five_years, costs, search)
                _store_validation(need[sid], ev)
            validation[u.id][sid] = ev

    progress("signals")
    rows: list[dict] = []
    # Members under every strategy, then tracked trades whose stock is no longer in any universe
    work = [(sym, uid, strategies) for sym, uid in primary.items()]
    for t in track:
        if t["ticker"] not in primary and t["ticker"] in candles:
            work.append((t["ticker"], t["universe"], [t["strategy"]]))
    for sym, uid, sids in work:
        df = normalise(candles[sym])
        if len(df) < MIN_SCREEN_BARS:
            continue
        reg = detect_regimes(df).iloc[-1]
        meta = listings.loc[sym] if sym in listings.index else None
        m = stats.get(sym) or metrics(df) or {}
        tags = [names[u.id] for u in universes if u.id != uid and sym in members[u.id]]
        for sid in sids:
            read = read_latest(df, sid, validation[uid][sid], reg=reg)
            if read["status"] == "none" and (sym, sid) not in tracked:
                continue
            rows.append({
                "ticker": sym, "name": None if meta is None else meta["name"],
                "exchange": None if meta is None else meta["exchange"],
                "sector": None if meta is None else meta["sector"],
                "market_cap": None if meta is None else _num(meta["market_cap"], 0),
                "universe": uid, "tags": tags, "strategy": sid,
                "date": read["date"], "close": read["close"], "status": read["status"], "trigger": read["trigger"],
                "plan": read.get("plan"), "regime": read["regime"], "quant": read["quant"],
                "validated": read["evidence"]["validated"],
                "rel_volume": _num(m.get("rel_volume"), 2), "atr_pct": _num(m.get("atr_pct"), 2),
                "avg_dollar_volume": _num(m.get("avg_dollar_volume"), 0), "spread_pct": _num(m.get("spread_pct"), 2),
                "badges": [],
            })

    # Risk badges only where a universe asks for them, and only for rows actually in play
    flagged = {u.id for u in universes if u.badges}
    sec = SecFilings(sec_identity)
    today = date.today()
    seen: dict[str, list[dict]] = {}
    for row in rows:
        if row["universe"] not in flagged or row["status"] == "none":
            continue
        sym = row["ticker"]
        if sym not in seen:
            badges = price_badges(candles[sym])
            for fn in (lambda: sec.dilution(sym, today), lambda: float_badge(sym)):
                try:
                    b = fn()
                    if b:
                        badges.append(b)
                except Exception:  # noqa: BLE001 - a missing badge must not fail the scan
                    pass
            seen[sym] = badges
        row["badges"] = seen[sym]

    return {
        "date": max((r["date"] for r in rows), default=None),
        "universes": {
            u.id: {
                "name": u.name,
                "candidates": len(candidates[u.id]),
                "members": sorted(s for s, p in primary.items() if p == u.id),
                "all_members": len(members[u.id]),
                "validation": validation[u.id],
            } for u in universes
        },
        "strategies": strategies,
        "rows": rows,
        "problems": problems,
        "seconds": round(time.time() - started, 1),
    }
