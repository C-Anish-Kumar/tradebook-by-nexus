import numpy as np
import pandas as pd
import pytest

from openstock_analyst.aqp.data.synthetic import make_ohlcv, random_walk
from openstock_analyst.setups import build_setup, live_state, normalise, size_position, PARAM_GRID


def yahoo_like(df: pd.DataFrame) -> pd.DataFrame:
    out = df[["open", "high", "low", "close", "volume"]].rename(columns=str.capitalize)
    out.index = out.index.tz_localize("America/New_York")
    return out


@pytest.fixture(scope="module")
def trending():
    return yahoo_like(make_ohlcv(900, seed=3, freq="D"))


def test_setup_shape(trending):
    s = build_setup(trending, account=1000, risk_pct=1.0)
    assert s["status"] in {"entry", "holding", "watch", "none"}
    assert set(s["regime"]) == {"trend", "vol", "adx", "atr_pct_rank"}
    assert set(s["evidence"]["gates"]) >= {"lookahead", "oos_profitable", "cost_stress_2x", "beats_baselines", "deflated_sharpe"}
    assert s["evidence"]["gates"]["lookahead"] is True
    if "plan" in s:
        p = s["plan"]
        assert p["stop"] < p["entry"] < p["target_2r"] < p["target_3r"]


def test_unvalidated_setups_are_flagged():
    s = build_setup(yahoo_like(random_walk(900, seed=5, vol=0.015)), account=1000)
    assert s["evidence"]["validated"] is False
    assert any(w.startswith("Unvalidated") for w in s["warnings"])


def test_searching_more_tickers_never_helps(trending):
    one = build_setup(trending, universe=1)["evidence"]["deflated_sharpe"]
    many = build_setup(trending, universe=150)["evidence"]["deflated_sharpe"]
    assert many <= one


def test_latest_state_ignores_the_future(trending):
    """Positions on day t must not change when later bars exist (no lookahead in the live read)."""
    from openstock_analyst.aqp.strategies.rules import BreakoutATR

    df = normalise(trending)
    strat = BreakoutATR(swing_n=5, adx_min=15.0, trail_atr=3.0)
    full = strat.positions(df)
    for cut in (500, 650, 800):
        assert np.allclose(full.iloc[:cut].values, strat.positions(df.iloc[:cut]).values)


def test_position_size_respects_risk():
    s = size_position(entry=50.0, stop=48.0, account=1000, risk_pct=1.0)
    assert s["shares"] == 5 and s["risk_dollars"] == 10.0 and s["fits_account"] is True
    assert size_position(50, 48, None) is None
    assert size_position(48, 50, 1000) is None  # stop above entry


def test_too_little_history_is_rejected(trending):
    with pytest.raises(ValueError):
        build_setup(trending.iloc[:100])


def test_quant_score_shape_and_bounds(trending):
    q = build_setup(trending, account=1000)["quant"]
    assert 0 <= q["score"] <= 100
    assert q["label"] in {"Strong", "Good", "Fair", "Weak", "Poor"}
    assert [c["key"] for c in q["components"]] == ["evidence", "regime", "readiness", "volume", "risk"]
    assert sum(c["max"] for c in q["components"]) == 100
    assert all(0 <= c["points"] <= c["max"] for c in q["components"])


def test_unvalidated_setups_cannot_score_above_the_cap():
    from openstock_analyst.quant_score import UNVALIDATED_CAP, score_setup

    perfect = {
        "status": "entry", "params": {"adx_min": 22.0},
        "regime": {"trend": "up", "vol": "low", "adx": 40.0},
        "plan": {"risk_pct_of_price": 2.0},
        "evidence": {"validated": False, "oos_sharpe": 2.0, "gates": {g: True for g in "abcdef"}},
    }
    q = score_setup(perfect, rel_volume=2.0)
    assert q["score"] == UNVALIDATED_CAP and q["capped"] is True
    perfect["evidence"]["validated"] = True
    assert score_setup(perfect, rel_volume=2.0)["score"] == 100


def test_quant_score_rewards_the_right_things():
    from openstock_analyst.quant_score import score_setup

    base = {
        "status": "none", "params": {"adx_min": 22.0},
        "regime": {"trend": "down", "vol": "high", "adx": 10.0},
        "evidence": {"validated": False, "oos_sharpe": None, "gates": {"a": False, "b": False}},
    }
    low = score_setup(base, rel_volume=None, stop_pct_estimate=12.0)["score"]
    base["status"] = "entry"
    base["plan"] = {"risk_pct_of_price": 3.0}
    high = score_setup(base, rel_volume=1.8)["score"]
    assert low == 0 and high > low


def test_relative_volume_uses_prior_bars_only():
    from openstock_analyst.setups import relative_volume

    df = pd.DataFrame({"volume": [100.0] * 25 + [300.0]})
    assert relative_volume(df) == pytest.approx(3.0)
    assert relative_volume(df.iloc[:10]) is None
