import numpy as np
import pandas as pd
import pytest

from openstock_analyst.metrics import performance
from openstock_analyst.portfolio import optimize


def prices(n=900, seed=7):
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2020-01-01", periods=n)
    drift = np.array([0.0006, 0.0004, 0.0003, 0.0005])
    vol = np.array([0.02, 0.012, 0.009, 0.016])
    rets = rng.normal(drift, vol, size=(n, 4))
    px = 100 * np.cumprod(1 + rets, axis=0)
    frame = pd.DataFrame(px, index=idx, columns=["AAA", "BBB", "CCC", "DDD"])
    bench = pd.Series(100 * np.cumprod(1 + rng.normal(0.0004, 0.01, n)), index=idx)
    return frame, bench


def test_performance_metrics_are_sane():
    r = pd.Series([0.01, -0.005, 0.002, 0.003] * 100, index=pd.bdate_range("2020-01-01", periods=400))
    out = performance(r, r)
    assert out["annual_return"] > 0 and out["sharpe"] > 0
    assert out["max_drawdown"] <= 0
    assert out["beta"] == pytest.approx(1.0, abs=1e-6)


def test_optimize_returns_valid_weights_for_every_method():
    px, bench = prices()
    result = optimize(px, bench)
    assert {m["key"] for m in result["methods"]} == {"max_sharpe", "min_variance", "hrp", "risk_parity", "equal"}
    for m in result["methods"]:
        weights = np.array(list(m["weights"].values()))
        assert weights.min() >= -1e-6 and weights.sum() == pytest.approx(1.0, abs=1e-3)
        assert m["out_of_sample"]["sharpe"] is not None
    assert len(result["frontier"]) == 20
    assert result["equity"] and "benchmark" in result["equity"][-1]
    assert result["out_of_sample_start"] > result["start"]   # walk-forward never scores the training year


def test_min_variance_is_least_volatile_in_sample():
    px, bench = prices()
    result = optimize(px, bench)
    vols = {m["key"]: m["in_sample"]["annual_volatility"] for m in result["methods"]}
    assert vols["min_variance"] <= min(vols.values()) + 1e-6


def test_short_history_is_rejected():
    px, bench = prices(n=200)
    with pytest.raises(ValueError):
        optimize(px, bench)
