"""Point-in-time price-action features. Swing pivots are only 'known' n bars after they form."""
from __future__ import annotations
import numpy as np
import pandas as pd
from openstock_analyst.aqp.regime.detector import atr


def swing_levels(df: pd.DataFrame, n: int = 5) -> pd.DataFrame:
    """Last confirmed swing high/low. A pivot at i needs n bars on each side, so it is
    released at i+n (shifted forward) - never earlier."""
    w = 2 * n + 1
    ph = df.high.where(df.high == df.high.rolling(w, center=True).max())
    pl = df.low.where(df.low == df.low.rolling(w, center=True).min())
    return pd.DataFrame({"swing_high": ph.shift(n).ffill(), "swing_low": pl.shift(n).ffill()}, index=df.index)


def price_action_features(df: pd.DataFrame, swing_n: int = 5, atr_n: int = 14, vol_n: int = 20) -> pd.DataFrame:
    a = atr(df, atr_n)
    sw = swing_levels(df, swing_n)
    rng = (df.high - df.low).replace(0, np.nan)
    f = pd.DataFrame(index=df.index)
    f["dist_swing_high_atr"] = (sw.swing_high - df.close) / a          # <0 => broken out
    f["dist_swing_low_atr"] = (df.close - sw.swing_low) / a
    f["breakout_up"] = (df.close > sw.swing_high).astype(float)
    f["breakout_dn"] = (df.close < sw.swing_low).astype(float)
    hh = df.high.rolling(20).max()
    f["pullback_depth_atr"] = (hh - df.close) / a
    f["body_ratio"] = (df.close - df.open).abs() / rng
    f["close_loc"] = (df.close - df.low) / rng
    f["upper_wick"] = (df.high - df[["open", "close"]].max(axis=1)) / rng
    f["lower_wick"] = (df[["open", "close"]].min(axis=1) - df.low) / rng
    f["vol_expansion"] = df.volume / df.volume.rolling(vol_n).mean()
    f["ret_atr_1"] = df.close.diff() / a
    f["atr_pct"] = a / df.close
    return f
