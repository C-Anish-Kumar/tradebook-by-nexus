"""A 0-100 quant rating for one stock under the breakout strategy.

It is a transparent checklist, not a forecast: five parts with fixed weights, each explained in plain
words so the number can be audited. The biggest part is the evidence (does the strategy actually work on
this stock out-of-sample), and a setup that has not passed every validation gate is capped, so an
unproven idea can never look like a proven one.

    Evidence             40   validation gates passed (24) + out-of-sample Sharpe (16)
    Trend and regime     20   trend direction, trend strength, volatility band
    Setup readiness      20   entry today > watching a breakout > in a trend > nothing
    Volume confirmation  10   breakouts need heavy volume, approaches to a level want it quiet
    Risk quality         10   how tight the stop is relative to the price
"""

from __future__ import annotations

WEIGHTS = {"evidence": 40, "regime": 20, "readiness": 20, "volume": 10, "risk": 10}
UNVALIDATED_CAP = 69
BANDS = [(80, "Strong"), (65, "Good"), (50, "Fair"), (35, "Weak"), (0, "Poor")]

READINESS = {"entry": 20.0, "watch": 12.0, "holding": 6.0, "none": 0.0}
GATE_POINTS = 4.0          # six gates x 4 = 24
SHARPE_FULL = 1.5          # out-of-sample Sharpe that earns every edge point
STOP_TIGHT, STOP_WIDE = 3.0, 10.0   # stop distance as % of price: <= tight scores full, >= wide scores 0


def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def label_for(score: float) -> str:
    return next(name for floor, name in BANDS if score >= floor)


def _part(key: str, label: str, points: float, note: str) -> dict:
    return {"key": key, "label": label, "points": round(points, 1), "max": WEIGHTS[key], "note": note}


def _evidence(ev: dict) -> dict:
    gates = ev.get("gates", {})
    passed = sum(1 for ok in gates.values() if ok)
    sharpe = ev.get("oos_sharpe")
    sharpe_pts = 16 * _clamp((sharpe or 0.0) / SHARPE_FULL)
    pts = passed * GATE_POINTS + sharpe_pts
    note = f"{passed} of {len(gates)} validation gates passed; out-of-sample Sharpe {sharpe if sharpe is not None else 'n/a'}"
    return _part("evidence", "Evidence", min(pts, WEIGHTS["evidence"]), note)


def _regime(regime: dict, adx_min: float) -> dict:
    trend, vol, adx = regime.get("trend"), regime.get("vol"), regime.get("adx")
    pts = {"up": 12.0, "range": 4.0}.get(trend, 0.0)
    if trend == "up" and adx is not None:
        pts += 4 * _clamp((adx - adx_min) / 15.0)   # trend strength above the strategy's own threshold
    pts += {"low": 4.0, "high": 0.0}.get(vol, 2.0)  # a calm market keeps stops tight
    note = f"{trend or 'unknown'} trend, ADX {adx if adx is not None else 'n/a'}, {vol or 'normal'} volatility"
    return _part("regime", "Trend and regime", pts, note)


def _readiness(status: str) -> dict:
    notes = {"entry": "entry signalled on the latest bar", "watch": "price is near the level where an entry would trigger",
             "holding": "already in the trade, so not a fresh entry", "none": "no entry in play"}
    return _part("readiness", "Setup readiness", READINESS.get(status, 0.0), notes.get(status, ""))


def _volume(status: str, rel_volume: float | None, rule: str = "high") -> dict:
    """Volume rule from the VPA playbook: breakouts and bounces need high volume, pullbacks and retests want low."""
    if rel_volume is None or status == "none":
        return _part("volume", "Volume confirmation", 0.0, "no entry in play to confirm")
    rv = rel_volume
    if status == "watch" or rule == "low":
        pts = 10 * _clamp((1.2 - rv) / 0.6)      # quiet: 0.6x average or less scores full
        note = f"{rv:.2f}x average volume; a quiet approach or pullback is healthier"
    else:
        pts = 10 * _clamp((rv - 0.8) / 0.7)      # heavy volume: 1.5x average or more scores full
        note = f"{rv:.2f}x average volume; this entry should come on heavy volume"
    return _part("volume", "Volume confirmation", pts, note)


def _risk(setup: dict, atr_pct_of_price: float | None) -> dict:
    plan = setup.get("plan")
    stop_pct = plan["risk_pct_of_price"] if plan else atr_pct_of_price
    if stop_pct is None:
        return _part("risk", "Risk quality", 0.0, "stop distance unavailable")
    pts = 10 * (1 - _clamp((stop_pct - STOP_TIGHT) / (STOP_WIDE - STOP_TIGHT)))
    return _part("risk", "Risk quality", pts, f"stop is about {stop_pct:.1f}% below the price; tighter means a smaller position risk")


def score_setup(setup: dict, rel_volume: float | None = None, stop_pct_estimate: float | None = None,
                volume_rule: str = "high") -> dict:
    """Score a built setup (the dict from `build_setup`, before warnings). Returns score, label and the breakdown."""
    ev = setup["evidence"]
    parts = [
        _evidence(ev),
        _regime(setup["regime"], setup["params"].get("adx_min", 22.0)),
        _readiness(setup["status"]),
        _volume(setup["status"], rel_volume, volume_rule),
        _risk(setup, stop_pct_estimate),
    ]
    raw = sum(p["points"] for p in parts)
    capped = not ev["validated"] and raw > UNVALIDATED_CAP
    score = int(round(min(raw, UNVALIDATED_CAP) if not ev["validated"] else raw))
    return {
        "score": score,
        "label": label_for(score),
        "capped": capped,
        "validated": bool(ev["validated"]),
        "components": parts,
    }
