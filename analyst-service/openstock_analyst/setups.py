"""Trade setups: a regime-gated breakout read on daily candles, with its evidence attached.

For one ticker this reports (1) the market regime, (2) whether the breakout strategy is signalling an
entry, holding, or watching a breakout level, with entry / stop / target / size, and (3) whether the
strategy has actually earned the right to be trusted on this ticker: purged walk-forward results,
2x cost stress, buy-and-hold and MA-cross baselines, and a Deflated Sharpe that prices in how many
tickers and settings were searched.

A setup is only labelled "validated" when every gate passes. Most won't. That is the point:
an unvalidated setup is a hypothesis to paper-trade, not a signal.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from openstock_analyst.aqp.backtest.engine import Costs, backtest, sharpe
from openstock_analyst.aqp.features.price_action import swing_levels
from openstock_analyst.aqp.regime.detector import atr, detect_regimes
from openstock_analyst.aqp.strategies.rules import BreakoutATR
from openstock_analyst.aqp.validation.gates import run_gates
from openstock_analyst.aqp.validation.ledger import TrialLedger

DAILY_PPY = 252
MIN_BARS = 400
# Small on purpose: every extra setting is another chance to fool ourselves, and all are counted.
PARAM_GRID = {"swing_n": [3, 5, 8], "adx_min": [15.0, 22.0], "trail_atr": [2.0, 3.0, 4.0]}
WATCH_DISTANCE_ATR = 1.0   # within 1 ATR below the swing high counts as "watching a breakout"
COSTS = Costs(fee_bps=2.0, slippage_bps=8.0)  # 10 bps a side: liquid US stocks, small orders


def normalise(daily: pd.DataFrame) -> pd.DataFrame:
    """Yahoo candles (High/Low/...) -> the engine's lowercase, tz-naive, NaN-free frame."""
    df = daily.rename(columns=str.lower)[["open", "high", "low", "close", "volume"]].dropna()
    if getattr(df.index, "tz", None) is not None:
        df.index = df.index.tz_localize(None)
    return df[~df.index.duplicated()].sort_index()


def _num(x, digits: int = 4):
    if x is None:
        return None
    x = float(x)
    return round(x, digits) if math.isfinite(x) else None


def evidence(df: pd.DataFrame, universe: int = 1) -> dict:
    """Run the validation gates for this ticker. `universe` = how many tickers the same hunt covers."""
    ledger = TrialLedger()
    rep = run_gates(
        df, BreakoutATR, PARAM_GRID, ledger, costs=COSTS, n_splits=4, min_trades=15,
        ppy=DAILY_PPY, purge=10, embargo=5, extra_trials=max(0, universe - 1) * len(_grid()),
    )
    g = rep["gates"]
    return {
        "validated": bool(rep.get("promotable", False)),
        "params": rep["folds"][-1]["params"] if rep.get("folds") else None,
        "oos_sharpe": _num(rep.get("oos_sharpe_annual"), 2),
        "baselines_sharpe": {k: _num(v, 2) for k, v in rep.get("baselines_sharpe", {}).items()},
        "deflated_sharpe": _num(g.get("deflated_sharpe", {}).get("dsr"), 3),
        "trials": g.get("deflated_sharpe", {}).get("n_trials"),
        "trades": g.get("min_trades", {}).get("trades"),
        "gates": {k: bool(v["passed"]) for k, v in g.items()},
    }


def _grid() -> list[dict]:
    import itertools
    return [dict(zip(PARAM_GRID, v)) for v in itertools.product(*PARAM_GRID.values())]


def live_state(df: pd.DataFrame, params: dict) -> dict:
    """What the strategy says on the latest bar: entry today, holding, watching a level, or nothing."""
    strat = BreakoutATR(**params)
    pos = strat.positions(df)
    a = atr(df, strat.params.get("atr_n", 14))
    swing_high = swing_levels(df, params["swing_n"]).swing_high
    close, last_atr, level = float(df.close.iloc[-1]), float(a.iloc[-1]), swing_high.iloc[-1]
    k = params["trail_atr"]

    if pos.iloc[-1] == 1:
        entry_idx = len(pos) - 1
        while entry_idx > 0 and pos.iloc[entry_idx - 1] == 1:
            entry_idx -= 1
        fresh = entry_idx == len(pos) - 1
        peak = float(df.close.iloc[entry_idx:].max())
        stop = peak - k * last_atr
        return {"status": "entry" if fresh else "holding", "entry": close, "stop": stop,
                "bars_in_trade": len(pos) - entry_idx, "trigger": _num(level, 2)}

    near = pd.notna(level) and 0 <= (level - close) / last_atr <= WATCH_DISTANCE_ATR
    if near:
        return {"status": "watch", "entry": float(level), "stop": float(level) - k * last_atr,
                "bars_in_trade": 0, "trigger": _num(level, 2)}
    return {"status": "none", "entry": None, "stop": None, "bars_in_trade": 0, "trigger": _num(level, 2)}


def size_position(entry: float, stop: float, account: float | None, risk_pct: float = 1.0) -> dict | None:
    """Whole shares that risk `risk_pct`% of the account if the stop is hit. None if inputs don't allow it."""
    if not account or account <= 0 or entry is None or stop is None or entry <= stop:
        return None
    risk_per_share = entry - stop
    shares = int((account * risk_pct / 100) // risk_per_share)
    return {"shares": shares, "cost": _num(shares * entry, 2), "risk_dollars": _num(shares * risk_per_share, 2),
            "fits_account": shares * entry <= account}


_EVIDENCE_CACHE: dict[tuple, dict] = {}


def build_setup(daily: pd.DataFrame, account: float | None = None, risk_pct: float = 1.0, universe: int = 1,
                key: str | None = None) -> dict:
    """`key` (the ticker) lets the heavy validation be reused for the same last bar."""
    df = normalise(daily)
    if len(df) < MIN_BARS:
        raise ValueError(f"Need at least {MIN_BARS} daily bars, got {len(df)}")

    reg = detect_regimes(df).iloc[-1]
    ck = (key, df.index[-1], universe) if key else None
    if ck and ck in _EVIDENCE_CACHE:
        ev = _EVIDENCE_CACHE[ck]
    else:
        ev = evidence(df, universe)
        if ck:
            if len(_EVIDENCE_CACHE) > 500:
                _EVIDENCE_CACHE.clear()
            _EVIDENCE_CACHE[ck] = ev
    params = ev["params"] or {k: v[0] for k, v in PARAM_GRID.items()}
    st = live_state(df, params)

    out = {
        "date": df.index[-1].date().isoformat(),
        "close": _num(df.close.iloc[-1], 2),
        "regime": {"trend": None if pd.isna(reg.trend) else str(reg.trend), "vol": None if pd.isna(reg.vol) else str(reg.vol),
                   "adx": _num(reg.adx, 1), "atr_pct_rank": _num(reg.atr_pct_rank, 2)},
        "status": st["status"],
        "params": params,
        "evidence": ev,
        "trigger": st["trigger"],
    }
    if st["entry"] is not None:
        r = st["entry"] - st["stop"]
        out["plan"] = {
            "entry": _num(st["entry"], 2), "stop": _num(st["stop"], 2), "risk_per_share": _num(r, 2),
            "risk_pct_of_price": _num(r / st["entry"] * 100, 2),
            "target_2r": _num(st["entry"] + 2 * r, 2), "target_3r": _num(st["entry"] + 3 * r, 2),
            "bars_in_trade": st["bars_in_trade"],
            "exit_rule": f"close below highest close since entry minus {params['trail_atr']} x ATR(14)",
        }
        out["size"] = size_position(st["entry"], st["stop"], account, risk_pct)
    out["warnings"] = _warnings(out)
    return out


def _warnings(s: dict) -> list[str]:
    w = []
    ev = s["evidence"]
    if not ev["validated"]:
        failed = [k for k, ok in ev["gates"].items() if not ok]
        w.append("Unvalidated: failed " + ", ".join(failed) + ". Paper-trade it; do not size it like an edge.")
    if s["regime"]["trend"] == "range" and s["status"] in ("entry", "watch"):
        w.append("Breakouts fail more often in a range regime (ADX is low).")
    if s["regime"]["vol"] == "high":
        w.append("Volatility is in its top band: stops are wide, so size shrinks.")
    if ev["trades"] is not None and ev["trades"] < 15:
        w.append("Few historical trades: the evidence is thin.")
    return w
