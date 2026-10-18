"""Causal regime detection. Every value at t uses only data up to and including t."""
from __future__ import annotations
import numpy as np
import pandas as pd


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    pc = df.close.shift(1)
    tr = pd.concat([df.high - df.low, (df.high - pc).abs(), (df.low - pc).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


def adx(df: pd.DataFrame, n: int = 14) -> pd.Series:
    up, dn = df.high.diff(), -df.low.diff()
    plus = np.where((up > dn) & (up > 0), up, 0.0)
    minus = np.where((dn > up) & (dn > 0), dn, 0.0)
    a = atr(df, n)
    pdi = 100 * pd.Series(plus, index=df.index).ewm(alpha=1 / n, adjust=False, min_periods=n).mean() / a
    mdi = 100 * pd.Series(minus, index=df.index).ewm(alpha=1 / n, adjust=False, min_periods=n).mean() / a
    dx = 100 * (pdi - mdi).abs() / (pdi + mdi).replace(0, np.nan)
    return dx.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


def detect_regimes(df: pd.DataFrame, n: int = 14, slope_n: int = 50, adx_thr: float = 22.0,
                   vol_window: int = 250, vol_hi: float = 0.7) -> pd.DataFrame:
    """Returns columns: adx, atr_pct_rank, trend (up/down/range), vol (high/low), regime (e.g. 'up|low')."""
    a = adx(df, n)
    slope = df.close - df.close.shift(slope_n)  # causal slope proxy
    rank = (atr(df, n) / df.close).rolling(vol_window, min_periods=vol_window // 2).rank(pct=True)
    trend = np.where(a > adx_thr, np.where(slope > 0, "up", "down"), "range")
    vol = np.where(rank > vol_hi, "high", "low")
    out = pd.DataFrame({"adx": a, "atr_pct_rank": rank, "trend": trend, "vol": vol}, index=df.index)
    out.loc[a.isna() | rank.isna(), ["trend", "vol"]] = np.nan
    out["regime"] = out.trend.astype("string") + "|" + out.vol.astype("string")
    return out
