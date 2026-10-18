from __future__ import annotations
import numpy as np
import pandas as pd
from openstock_analyst.aqp.strategies.base import Strategy
from openstock_analyst.aqp.regime.detector import atr, adx
from openstock_analyst.aqp.features.price_action import swing_levels


class BuyHold(Strategy):
    name = "buy_hold"

    def positions(self, df):
        return pd.Series(1.0, index=df.index)


class MaCross(Strategy):
    """Baseline every discovered strategy must beat: plain fast/slow MA cross, long/flat."""
    name = "ma_cross"

    def positions(self, df):
        f, s = self.params.get("fast", 20), self.params.get("slow", 100)
        return (df.close.rolling(f).mean() > df.close.rolling(s).mean()).astype(float)


class BreakoutATR(Strategy):
    """Regime-gated breakout: enter long when close breaks the last confirmed swing high while ADX says
    trending; exit on ATR trailing stop. Long/flat."""
    name = "breakout_atr"

    def positions(self, df):
        sn, an = self.params.get("swing_n", 5), self.params.get("atr_n", 14)
        thr, k = self.params.get("adx_min", 20.0), self.params.get("trail_atr", 3.0)
        sw = swing_levels(df, sn).swing_high.values
        a, x = atr(df, an).values, adx(df, an).values
        c = df.close.values
        pos = np.zeros(len(df))
        in_pos, peak = False, 0.0
        for i in range(len(df)):
            if np.isnan(a[i]) or np.isnan(x[i]) or np.isnan(sw[i]):
                continue
            if in_pos:
                peak = max(peak, c[i])
                if c[i] < peak - k * a[i]:
                    in_pos = False
            elif c[i] > sw[i] and x[i] > thr:
                in_pos, peak = True, c[i]
            pos[i] = 1.0 if in_pos else 0.0
        return pd.Series(pos, index=df.index)


REGISTRY = {"ma_cross": MaCross, "breakout_atr": BreakoutATR, "buy_hold": BuyHold}
