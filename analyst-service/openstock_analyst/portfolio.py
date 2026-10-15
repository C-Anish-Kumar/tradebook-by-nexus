"""Portfolio construction with skfolio, scored out of sample with empyrical metrics.

Each method is fitted on the whole window for today's suggested weights, and also run
walk-forward (refit on the past year, hold for the next quarter) so its track record
only uses data it could have known at the time.
"""

import numpy as np
import pandas as pd

from openstock_analyst.metrics import performance

TRAIN_DAYS, TEST_DAYS = 252, 63


def _models():
    from skfolio.optimization import (
        EqualWeighted, HierarchicalRiskParity, MeanRisk, ObjectiveFunction, RiskBudgeting,
    )
    return {
        "max_sharpe": ("Max Sharpe", MeanRisk(objective_function=ObjectiveFunction.MAXIMIZE_RATIO)),
        "min_variance": ("Min variance", MeanRisk()),
        "hrp": ("Hierarchical risk parity", HierarchicalRiskParity()),
        "risk_parity": ("Risk parity", RiskBudgeting()),
        "equal": ("Equal weight", EqualWeighted()),
    }


def _weekly(returns: pd.Series) -> pd.Series:
    return (10_000 * (1 + returns).cumprod()).resample("W").last().dropna()


def optimize(prices: pd.DataFrame, benchmark_prices: pd.Series) -> dict:
    from skfolio.model_selection import WalkForward, cross_val_predict
    from skfolio.optimization import MeanRisk as FrontierModel

    prices = prices.dropna(axis=1, how="all").dropna()
    # skfolio wants a plain float frame with string columns
    X = prices.pct_change().dropna()
    X = pd.DataFrame(X.to_numpy(float), index=X.index, columns=[str(c) for c in X.columns])
    if X.shape[1] < 2:
        raise ValueError("Need at least two tickers with overlapping history")
    if len(X) < TRAIN_DAYS + 2 * TEST_DAYS:
        raise ValueError("Need at least 18 months of overlapping history")
    bench = benchmark_prices.reindex(prices.index).pct_change().dropna()

    methods, curves = [], {}
    oos_start = None
    for key, (label, model) in _models().items():
        model.fit(X)
        weights = {t: round(float(w), 4) for t, w in zip(X.columns, model.weights_)}
        in_sample = model.predict(X)
        pred = cross_val_predict(model, X, cv=WalkForward(train_size=TRAIN_DAYS, test_size=TEST_DAYS))
        oos = pd.Series(np.asarray(pred.returns, float), index=pd.DatetimeIndex(pred.observations))
        oos_start = oos.index[0]
        methods.append({
            "key": key,
            "label": label,
            "weights": weights,
            "in_sample": {"annual_return": round(float(in_sample.annualized_mean), 4),
                          "annual_volatility": round(float(in_sample.annualized_standard_deviation), 4)},
            "out_of_sample": performance(oos, bench),
        })
        curves[key] = _weekly(oos)

    bench_oos = bench[bench.index >= oos_start]
    curves["benchmark"] = _weekly(bench_oos)
    frame = pd.DataFrame(curves).dropna()

    frontier = FrontierModel(efficient_frontier_size=20).fit(X).predict(X)
    assets = [{"ticker": t, "annual_return": round(float(X[t].mean() * 252), 4),
               "annual_volatility": round(float(X[t].std() * np.sqrt(252)), 4)} for t in X.columns]

    return {
        "tickers": list(X.columns),
        "start": X.index[0].strftime("%Y-%m-%d"),
        "end": X.index[-1].strftime("%Y-%m-%d"),
        "out_of_sample_start": oos_start.strftime("%Y-%m-%d"),
        "walk_forward": {"train_days": TRAIN_DAYS, "test_days": TEST_DAYS},
        "methods": methods,
        "benchmark": performance(bench_oos),
        "equity": [{"date": d.strftime("%Y-%m-%d"), **{k: round(float(v), 2) for k, v in row.items()}} for d, row in frame.iterrows()],
        "frontier": [{"annual_return": round(float(p.annualized_mean), 4),
                      "annual_volatility": round(float(p.annualized_standard_deviation), 4)} for p in frontier],
        "assets": assets,
        "correlation": {"tickers": list(X.columns), "matrix": np.round(X.corr().to_numpy(), 2).tolist()},
    }
