import numpy as np
import pandas as pd

from openstock_analyst.backtest import START_EQUITY, run


def candles(closes, spread=1.0):
    closes = np.asarray(closes, dtype=float)
    idx = pd.date_range("2020-01-01", periods=len(closes), freq="B")
    opens = np.concatenate([[closes[0]], closes[:-1]])
    return pd.DataFrame({"Open": opens, "High": np.maximum(opens, closes) + spread,
                         "Low": np.minimum(opens, closes) - spread, "Close": closes}, index=idx)


def wavy_uptrend(n=600, seed=1):
    rng = np.random.default_rng(seed)
    t = np.arange(n)
    return 100 + 0.15 * t + 6 * np.sin(t / 9) + rng.normal(0, 0.6, n)


def test_flat_market_never_trades_and_keeps_equity():
    result = run(candles(np.full(400, 100.0), spread=0.2))
    assert result["stats"]["trades"] == 0
    assert result["equity"][-1]["strategy"] == START_EQUITY


def test_downtrend_takes_no_trades():
    result = run(candles(np.linspace(300, 100, 500)))
    assert result["stats"]["trades"] == 0


def test_uptrend_with_pullbacks_trades_and_is_consistent():
    result = run(candles(wavy_uptrend()))
    stats = result["stats"]
    assert stats["trades"] > 0
    assert 0 < stats["exposure_pct"] <= 100
    assert stats["max_drawdown_pct"] <= 0
    for trade in result["trades"]:
        log = trade["log"]
        assert log[0]["side"] == "buy" and log[0]["reason"] == "entry"
        bought = sum(x["shares"] for x in log if x["side"] == "buy")
        sold = sum(x["shares"] for x in log if x["side"] == "sell")
        assert abs(bought - sold) < 1e-2           # every closed trade is fully exited (log rounds to 4 dp)
        assert trade["entry_date"] <= trade["exit_date"]


def test_fills_happen_the_day_after_the_signal():
    # The entry fills at an open, so its price equals that day's open plus costs
    df = candles(wavy_uptrend())
    result = run(df, cost=0.0)
    first = result["trades"][0]["log"][0]
    assert abs(first["price"] - df.loc[first["date"], "Open"]) < 1e-3


def test_buy_and_hold_reference_is_correct():
    df = candles(np.linspace(100, 200, 400))
    result = run(df, warmup=60)
    expected = 100 * (df["Close"].iloc[-1] / df["Close"].iloc[60] - 1)
    assert abs(result["stats"]["buy_hold_return_pct"] - round(expected, 2)) < 0.01
