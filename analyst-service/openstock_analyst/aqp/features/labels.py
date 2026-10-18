"""Triple-barrier labels (ATR-sized). Labels intentionally look FORWARD - they are targets, never
features. Return t1 (barrier-touch time) so validation can purge overlapping samples."""
from __future__ import annotations
import numpy as np
import pandas as pd
from openstock_analyst.aqp.regime.detector import atr


def triple_barrier(df: pd.DataFrame, side: pd.Series | int = 1, pt: float = 2.0, sl: float = 1.0,
                   horizon: int = 24, atr_n: int = 14) -> pd.DataFrame:
    a = atr(df, atr_n).values
    c, h, l = df.close.values, df.high.values, df.low.values
    sd = np.broadcast_to(np.asarray(side, dtype=float), len(df)) if np.isscalar(side) else side.reindex(df.index).fillna(0).values
    n = len(df)
    lab = np.full(n, np.nan)
    t1 = np.full(n, -1)
    for i in range(n - 1):
        if np.isnan(a[i]) or sd[i] == 0:
            continue
        up, dn = c[i] + sd[i] * pt * a[i], c[i] - sd[i] * sl * a[i]
        end = min(i + horizon, n - 1)
        lab[i], t1[i] = 0, end
        for j in range(i + 1, end + 1):
            hit_pt = (h[j] >= up) if sd[i] > 0 else (l[j] <= up)
            hit_sl = (l[j] <= dn) if sd[i] > 0 else (h[j] >= dn)
            if hit_sl:            # conservative: stop wins ties
                lab[i], t1[i] = -1, j
                break
            if hit_pt:
                lab[i], t1[i] = 1, j
                break
    out = pd.DataFrame({"label": lab}, index=df.index)
    out["t1"] = pd.Series(t1, index=df.index).where(pd.Series(t1, index=df.index) >= 0)
    return out
