"""Validation gates. A strategy is only 'promotable' if it passes ALL gates."""
from __future__ import annotations
import numpy as np
import pandas as pd
from openstock_analyst.aqp.backtest.engine import Costs, backtest, sharpe, summarize
from openstock_analyst.aqp.strategies.rules import BuyHold, MaCross
from openstock_analyst.aqp.validation.stats import deflated_sharpe
from openstock_analyst.aqp.validation.walkforward import walk_forward


def lookahead_check(strategy, df: pd.DataFrame, n_cuts: int = 6, tol: float = 1e-9, min_bars: int = 300) -> dict:
    """Recompute positions on truncated history. If any earlier position changes when future bars are
    removed, the strategy peeked at the future."""
    full = strategy.positions(df)
    cuts = np.linspace(min_bars, len(df) - 1, n_cuts).astype(int)
    for k in cuts:
        part = strategy.positions(df.iloc[:k])
        a, b = full.iloc[:k].values, part.values
        if not np.allclose(a, b, atol=tol, equal_nan=True):
            return {"passed": False, "first_mismatch_cut": int(k)}
    return {"passed": True}


def run_gates(df, strategy_cls, param_grid, ledger, costs: Costs | None = None, n_splits=5,
              min_trades=20, dsr_min=0.95, ppy: float = 24 * 365, purge=24, embargo=24,
              extra_trials: int = 0) -> dict:
    """extra_trials: other strategies/tickers searched in the same hunt, so luck is priced in."""
    costs = costs or Costs()
    rep = {"strategy": strategy_cls.name, "gates": {}}
    sample = strategy_cls(**{k: v[0] for k, v in param_grid.items()})
    rep["gates"]["lookahead"] = lookahead_check(sample, df)

    oos, folds = walk_forward(df, strategy_cls, param_grid, ledger, n_splits, purge, embargo, costs=costs, ppy=ppy)
    rep["folds"] = folds
    if len(oos) == 0:
        rep["gates"]["oos_profitable"] = {"passed": False, "reason": "no folds"}
        rep["promotable"] = False
        return rep
    oos_sharpe = sharpe(oos, ppy)
    rep["oos_sharpe_annual"] = oos_sharpe
    rep["gates"]["oos_profitable"] = {"passed": oos_sharpe > 0 and oos.sum() > 0, "sharpe": oos_sharpe}

    stress, _ = walk_forward(df, strategy_cls, param_grid, None, n_splits, purge, embargo, costs=costs.scaled(2.0), ppy=ppy)
    rep["gates"]["cost_stress_2x"] = {"passed": sharpe(stress, ppy) > 0, "sharpe": sharpe(stress, ppy)}

    # baselines scored over exactly the same OOS bars
    idx = oos.index
    base = {}
    for b, bcls, bp in (("buy_hold", BuyHold, {}), ("ma_cross", MaCross, {})):
        base[b] = sharpe(backtest(df, bcls(**bp).positions(df), costs).ret.reindex(idx), ppy)
    rep["baselines_sharpe"] = base
    rep["gates"]["beats_baselines"] = {"passed": all(oos_sharpe > v for v in base.values()), "strategy": oos_sharpe, **base}

    n_tr, sr_all = ledger.n_trials + extra_trials, np.array(ledger.sharpes())
    d = deflated_sharpe(oos.values, sr_all, n_tr)
    rep["gates"]["deflated_sharpe"] = {"passed": d >= dsr_min, "dsr": d, "n_trials": n_tr, "threshold": dsr_min}

    trades = int(backtest(df, strategy_cls(**folds[-1]["params"]).positions(df), costs).turnover.gt(0).sum())
    rep["gates"]["min_trades"] = {"passed": trades >= min_trades, "trades": trades}
    rep["promotable"] = all(g["passed"] for g in rep["gates"].values())
    return rep
