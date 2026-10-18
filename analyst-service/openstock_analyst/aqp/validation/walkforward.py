from __future__ import annotations
import itertools
import numpy as np
import pandas as pd
from openstock_analyst.aqp.backtest.engine import Costs, backtest, sharpe


def purged_splits(n: int, n_splits: int = 5, min_train: float = 0.3, purge: int = 24, embargo: int = 24):
    """Expanding-window walk-forward. Train ends `purge` bars before test starts (label overlap);
    the first `embargo` bars of test are excluded from scoring (serial-correlation leak)."""
    start = int(n * min_train)
    edges = np.linspace(start, n, n_splits + 1).astype(int)
    for a, b in zip(edges[:-1], edges[1:]):
        tr_end = max(0, a - purge)
        yield np.arange(0, tr_end), np.arange(min(a + embargo, b), b)


def walk_forward(df, strategy_cls, param_grid: dict, ledger=None, n_splits=5, purge=24, embargo=24,
                 costs: Costs | None = None, ppy: float = 24 * 365):
    """Per fold: pick the best params on TRAIN, score them on unseen TEST. Every grid point is logged
    to the ledger as a trial. Returns (oos_returns, fold_details)."""
    costs = costs or Costs()
    keys = list(param_grid)
    combos = [dict(zip(keys, v)) for v in itertools.product(*param_grid.values())]
    # positions are causal, so computing on the full frame is equivalent to computing fold-by-fold
    cache = {tuple(c.items()): backtest(df, strategy_cls(**c).positions(df), costs).ret for c in combos}
    oos, folds = [], []
    for tr, te in purged_splits(len(df), n_splits, purge=purge, embargo=embargo):
        if len(tr) < 50 or len(te) < 20:
            continue
        scores = {k: sharpe(v.iloc[tr], ppy) for k, v in cache.items()}
        best = max(scores, key=scores.get)
        r = cache[best].iloc[te]
        oos.append(r)
        folds.append({"params": dict(best), "train_sharpe": scores[best], "test_sharpe": sharpe(r, ppy)})
    if ledger is not None:
        for k, v in cache.items():
            r = v.dropna()
            ledger.log(strategy_cls.name, dict(k), float(r.mean() / r.std(ddof=1)) if r.std() > 0 else 0.0, len(r))
    return (pd.concat(oos) if oos else pd.Series(dtype=float)), folds
