"""Synthetic regime-switching OHLCV generator (for tests/demo; real data loaders in loader.py)."""
from __future__ import annotations
import numpy as np
import pandas as pd

# (drift per bar, vol per bar)
REGIMES = {"bull": (0.0006, 0.008), "bear": (-0.0006, 0.012), "chop": (0.0, 0.006)}


def make_ohlcv(n: int = 4000, seed: int = 0, switch_prob: float = 0.01,
               regimes: dict | None = None, freq: str = "h") -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    regimes = regimes or REGIMES
    names = list(regimes)
    state = rng.integers(len(names))
    rets = np.empty(n)
    lab = []
    for i in range(n):
        if rng.random() < switch_prob:
            state = rng.integers(len(names))
        mu, sd = regimes[names[state]]
        rets[i] = rng.normal(mu, sd)
        lab.append(names[state])
    close = 100 * np.exp(np.cumsum(rets))
    open_ = np.concatenate([[100.0], close[:-1]]) * np.exp(rng.normal(0, 0.001, n))
    spread = np.abs(rng.normal(0, 0.004, n)) + 0.001
    high = np.maximum(open_, close) * (1 + spread)
    low = np.minimum(open_, close) * (1 - spread)
    vol = rng.lognormal(10, 0.4, n) * (1 + 5 * np.abs(rets))
    idx = pd.date_range("2022-01-01", periods=n, freq=freq)
    df = pd.DataFrame({"open": open_, "high": high, "low": low, "close": close, "volume": vol}, index=idx)
    df["true_regime"] = lab
    return df


def random_walk(n: int = 4000, seed: int = 0, vol: float = 0.008) -> pd.DataFrame:
    """Pure noise, zero drift: no strategy should show a real edge here."""
    return make_ohlcv(n, seed, switch_prob=0.0, regimes={"noise": (0.0, vol)})
