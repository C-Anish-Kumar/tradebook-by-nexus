import numpy as np
import pandas as pd
import pytest

from openstock_analyst.strategy import dema, ema, evaluate, supertrend


def candles(closes, spread=1.0):
    closes = np.asarray(closes, dtype=float)
    idx = pd.date_range("2024-01-01", periods=len(closes), freq="B")
    opens = np.concatenate([[closes[0]], closes[:-1]])
    return pd.DataFrame({
        "Open": opens,
        "High": np.maximum(opens, closes) + spread,
        "Low": np.minimum(opens, closes) - spread,
        "Close": closes,
    }, index=idx)


def test_ema_matches_definition():
    s = pd.Series([1.0, 2.0, 3.0, 4.0])
    alpha = 2 / (3 + 1)
    expected = 1.0
    for x in [2.0, 3.0, 4.0]:
        expected = alpha * x + (1 - alpha) * expected
    assert ema(s, 3).iloc[-1] == pytest.approx(expected)


def test_dema_tracks_a_linear_trend_without_lag():
    s = pd.Series(np.arange(400, dtype=float))
    # DEMA removes the steady-state lag of an EMA on a straight line
    assert dema(s, 50).iloc[-1] == pytest.approx(399, abs=0.5)
    assert ema(s, 50).iloc[-1] < 380


def test_supertrend_follows_direction():
    up = candles(np.linspace(100, 200, 150))
    line, is_up = supertrend(up)
    assert is_up.iloc[-1] and line.iloc[-1] < up["Close"].iloc[-1]

    down = candles(np.linspace(200, 100, 150))
    line, is_up = supertrend(down)
    assert not is_up.iloc[-1] and line.iloc[-1] > down["Close"].iloc[-1]


def test_steady_uptrend_is_up_and_not_an_exit():
    result = evaluate(candles(np.linspace(100, 200, 200)))
    assert result["trend"] == "up"
    assert result["indicators"]["supertrend_up"] is True
    assert not any(check["passed"] for check in result["exits"][:3])
    assert result["risk"]["stop"] < result["close"]


def test_downtrend_gives_no_long_setup():
    result = evaluate(candles(np.linspace(200, 100, 200)))
    assert result["trend"] == "down"
    assert result["verdict"] in {"No long setup", "Exit remaining position"}
    assert result["entry"][0]["passed"] is False


def test_two_closes_below_the_10_ema_trims():
    closes = list(np.linspace(100, 200, 200)) + [196, 195]
    result = evaluate(candles(closes, spread=0.5))
    assert result["exits"][0]["passed"] is True
    assert result["verdict"] == "Trim 25%"


def test_too_little_history_is_rejected():
    with pytest.raises(ValueError):
        evaluate(candles(np.linspace(100, 110, 50)))
