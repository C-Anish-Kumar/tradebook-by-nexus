"""Vectorised, cost-aware backtester.
Timing: a position decided at the close of bar t is filled at the OPEN of bar t+1, then held to the
close of t+1. Costs (fee + slippage, in bps of notional) are charged on every position change."""
from __future__ import annotations
from dataclasses import dataclass
import numpy as np
import pandas as pd


@dataclass
class Costs:
    fee_bps: float = 5.0
    slippage_bps: float = 5.0

    def scaled(self, k: float) -> "Costs":
        return Costs(self.fee_bps * k, self.slippage_bps * k)

    @property
    def per_unit(self) -> float:
        return (self.fee_bps + self.slippage_bps) / 1e4


def backtest(df: pd.DataFrame, positions: pd.Series, costs: Costs | None = None) -> pd.DataFrame:
    costs = costs or Costs()
    pos = positions.reindex(df.index).fillna(0.0)          # decided at close t
    held_prev = pos.shift(1).fillna(0.0)                    # position carried into bar t (decided at t-1)
    held_prev2 = pos.shift(2).fillna(0.0)                   # position carried into bar t-1 -> still held until open t
    overnight = df.open / df.close.shift(1) - 1             # close t-1 -> open t, old position
    intrabar = df.close / df.open - 1                       # open t -> close t, new position
    gross = held_prev2 * overnight.fillna(0.0) + held_prev * intrabar
    turnover = (held_prev - held_prev2).abs()               # trade executes at open of t
    cost = turnover * costs.per_unit
    net = gross - cost
    return pd.DataFrame({"gross": gross, "cost": cost, "ret": net, "pos": held_prev, "turnover": turnover})


def sharpe(r: pd.Series, periods_per_year: float = 24 * 365) -> float:
    r = r.dropna()
    sd = r.std(ddof=1)
    return float(r.mean() / sd * np.sqrt(periods_per_year)) if len(r) > 2 and sd > 0 else 0.0


def summarize(bt: pd.DataFrame, periods_per_year: float = 24 * 365) -> dict:
    r = bt.ret
    eq = (1 + r).cumprod()
    trades = int((bt.turnover > 0).sum())
    return {
        "sharpe": sharpe(r, periods_per_year),
        "total_return": float(eq.iloc[-1] - 1) if len(eq) else 0.0,
        "max_drawdown": float((eq / eq.cummax() - 1).min()) if len(eq) else 0.0,
        "trades": trades,
        "exposure": float((bt.pos != 0).mean()),
        "n": int(len(r)),
    }
