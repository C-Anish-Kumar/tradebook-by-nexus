"""Daily-chart strategies from the TEDucation 2.0 trading knowledge base (ThiccTeddy's playbook).

Only the setups that can be read from daily open/high/low/close/volume are here; the intraday ones (VWAP,
opening range, premarket levels, 9 EMA flip on 5-minute bars, volume profile) need minute data and are not.
The PDF gives the idea and, for stops, often "per your plan", so the numbers below are this project's
reading of the rules, stated as parameters and put through the same validation gates as every other
strategy. They are hypotheses until a stock passes those gates.

Every strategy is long/flat and causal: the position at bar t uses only bars up to t.

Teddy's volume rules, used throughout: breakouts need high volume, pullbacks and retests want low volume,
and a wick only counts when it is over half the candle's range on standout (about 2x average) volume.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from openstock_analyst.aqp.features.price_action import swing_levels
from openstock_analyst.aqp.regime.detector import atr
from openstock_analyst.aqp.strategies.base import Strategy

VOL_WINDOW = 20


def vol_ratio(df: pd.DataFrame, n: int = VOL_WINDOW) -> pd.Series:
    """Volume as a multiple of the PREVIOUS n bars' average (the current bar is not in its own baseline)."""
    avg = df.volume.rolling(n).mean().shift(1)
    return df.volume / avg.replace(0, np.nan)


def _nan(n: int) -> np.ndarray:
    return np.full(n, np.nan)


class PlaybookStrategy(Strategy):
    """Shared engine: subclasses say when an entry fires; this class manages the stop and the position.

    Stop while in a trade = the highest of: highest close since entry minus trail_atr x ATR, the stop fixed
    at entry (e.g. below the wick low), and a moving structural stop (e.g. just under the 20 MA).
    """

    defaults: dict = {}

    def p(self, key):
        return self.params.get(key, self.defaults[key])

    def _signals(self, df: pd.DataFrame) -> dict[str, np.ndarray]:
        """entry (bool), entry_stop, dyn_stop and watch (price where an entry would trigger), each one value per bar."""
        raise NotImplementedError

    def _scan(self, df: pd.DataFrame):
        sig = self._signals(df)
        a, c = atr(df, 14).values, df.close.values
        k, n = self.p("trail_atr"), len(df)
        pos, stop = np.zeros(n), _nan(n)
        in_pos, peak, fixed = False, 0.0, np.nan
        for i in range(n):
            if np.isnan(a[i]):
                continue
            if in_pos:
                peak = max(peak, c[i])
                s = peak - k * a[i]
                if not np.isnan(fixed):
                    s = max(s, fixed)
                if not np.isnan(sig["dyn_stop"][i]):
                    s = max(s, sig["dyn_stop"][i])
                if c[i] < s:
                    in_pos = False
                else:
                    stop[i] = s
            elif sig["entry"][i]:
                in_pos, peak, fixed = True, c[i], sig["entry_stop"][i]
                s = c[i] - k * a[i]
                stop[i] = max(s, fixed) if not np.isnan(fixed) else s
            pos[i] = 1.0 if in_pos else 0.0
        return pos, stop, a, sig

    def positions(self, df: pd.DataFrame) -> pd.Series:
        return pd.Series(self._scan(df)[0], index=df.index)

    def live(self, df: pd.DataFrame) -> dict:
        """The latest bar's state: entry today, holding, watching a level, or nothing."""
        pos, stop, a, sig = self._scan(df)
        close, k = float(df.close.iloc[-1]), self.p("trail_atr")
        level = sig["watch"][-1]
        trigger = None if np.isnan(level) else round(float(level), 2)
        if pos[-1] == 1:
            idx = len(pos) - 1
            while idx > 0 and pos[idx - 1] == 1:
                idx -= 1
            return {"status": "entry" if idx == len(pos) - 1 else "holding", "entry": close, "stop": float(stop[-1]),
                    "bars_in_trade": len(pos) - idx, "trigger": trigger}
        if trigger is not None:
            return {"status": "watch", "entry": float(level), "stop": float(level) - k * float(a[-1]),
                    "bars_in_trade": 0, "trigger": trigger}
        return {"status": "none", "entry": None, "stop": None, "bars_in_trade": 0, "trigger": None}


class MaPullback(PlaybookStrategy):
    """Buy the pullback to the faster moving average once a cross is established (PDF pp. 6-7, 18).

    Trend: fast MA above slow MA for `settle` bars ("skip it when the cross is not established yet"), close above
    the slow MA. Entry: a pullback that touches the fast MA (within tol_atr x ATR) and closes back above it, on
    volume no higher than max_pb_vol x average (a low-volume pullback). Exit: close back through the fast MA by
    `wiggle` x ATR, or the ATR trail.
    """

    name = "ma_pullback"
    defaults = {"fast": 20, "slow": 50, "settle": 5, "tol_atr": 0.75, "trail_atr": 3.0, "wiggle": 0.5,
                "max_pb_vol": 1.2, "watch_atr": 1.5, "slow_rising": False}

    def _signals(self, df):
        c, a, n = df.close, atr(df, 14), len(df)
        fast, slow = c.rolling(self.p("fast")).mean(), c.rolling(self.p("slow")).mean()
        established = (fast > slow).astype(float).rolling(self.p("settle")).min() == 1
        trend = established & (c > slow)
        if self.p("slow_rising"):
            trend &= slow > slow.shift(20)
        touch = (df.low <= fast + self.p("tol_atr") * a) & (c > fast)
        entry = (trend & touch & (vol_ratio(df) <= self.p("max_pb_vol"))).fillna(False).values
        near = trend & (c > fast) & ((c - fast) / a <= self.p("watch_atr"))
        watch = np.where(near.fillna(False).values & ~entry, fast.values, np.nan)
        return {"entry": entry, "entry_stop": _nan(n), "dyn_stop": (fast - self.p("wiggle") * a).values, "watch": watch}


class Ma20x50Pullback(MaPullback):
    name = "ma_pullback"
    defaults = {**MaPullback.defaults, "fast": 20, "slow": 50, "settle": 5, "wiggle": 0.5}


class GoldenCrossPullback(MaPullback):
    """Golden cross (50 MA over 200 MA), then buy the pullback toward the 50 MA (PDF pp. 7, 18-19).
    The 200 MA must be rising ("skip it when the 200 MA is falling steeply"); exit when the 50 MA breaks."""

    name = "golden_cross"
    defaults = {**MaPullback.defaults, "fast": 50, "slow": 200, "settle": 10, "wiggle": 0.0, "slow_rising": True}


class BreakoutRetest(PlaybookStrategy):
    """Breakout on rising volume, then buy the low-volume retest (PDF pp. 4, 9, 16).

    A breakout is a close above the last confirmed swing high on at least vol_mult x average volume. It stays
    armed for `window` bars. Entry: price comes back to the broken level (low within 0.5 ATR of it), closes above
    it, on volume at or under retest_vol x average. Stop: back across the level.
    """

    name = "breakout_retest"
    defaults = {"swing_n": 5, "vol_mult": 1.5, "trail_atr": 3.0, "window": 10, "retest_vol": 1.0, "watch_atr": 1.5}

    def _signals(self, df):
        n = len(df)
        sw = swing_levels(df, self.p("swing_n")).swing_high.values
        a, vr = atr(df, 14).values, vol_ratio(df).values
        c, low = df.close.values, df.low.values
        entry, entry_stop, watch = np.zeros(n, bool), _nan(n), _nan(n)
        level, armed_at = np.nan, -1
        for i in range(1, n):
            if np.isnan(a[i]) or np.isnan(sw[i]):
                continue
            if not np.isnan(level):
                if c[i] < level - 0.5 * a[i] or i - armed_at > self.p("window"):
                    level = np.nan                                   # the breakout failed or went stale
                elif low[i] <= level + 0.5 * a[i] and c[i] > level and vr[i] <= self.p("retest_vol"):
                    entry[i], entry_stop[i] = True, level - 0.5 * a[i]
                    level = np.nan
                elif c[i] > level and (c[i] - level) / a[i] <= self.p("watch_atr"):
                    watch[i] = level
                continue
            if c[i] > sw[i] and c[i - 1] <= sw[i] and vr[i] >= self.p("vol_mult"):
                level, armed_at = sw[i], i
                if (c[i] - level) / a[i] <= self.p("watch_atr"):
                    watch[i] = level
        return {"entry": entry, "entry_stop": entry_stop, "dyn_stop": _nan(n), "watch": watch}


class VolumeBounce(PlaybookStrategy):
    """High-volume bounce at support: a hammer or bullish engulfing on standout volume (PDF pp. 9, 19-20).

    Wick rule: the lower wick must be over half the candle's range and the close in its upper half; volume at
    least vol_mult x average. Support: the low tests the prior `support_n`-bar low (within 0.5 ATR) or the 50 MA.
    Entry after the candle closes; stop below the wick low.
    """

    name = "volume_bounce"
    defaults = {"vol_mult": 1.5, "trail_atr": 3.0, "support_n": 20}

    def _signals(self, df):
        n, a = len(df), atr(df, 14)
        o, h, l, c = df.open, df.high, df.low, df.close
        rng = (h - l).replace(0, np.nan)
        hammer = ((np.minimum(o, c) - l) / rng >= 0.5) & (c >= (h + l) / 2)
        engulf = (c > o) & (c.shift(1) < o.shift(1)) & (c >= o.shift(1)) & (o <= c.shift(1))
        loud = vol_ratio(df) >= self.p("vol_mult")
        prior_low = l.rolling(self.p("support_n")).min().shift(1)
        ma50 = c.rolling(50).mean()
        support = (l <= prior_low + 0.5 * a) | ((l <= ma50 + 0.5 * a) & (l >= ma50 - a))
        entry = ((hammer | engulf) & loud & support).fillna(False).values
        return {"entry": entry, "entry_stop": (l - 0.1 * a).values, "dyn_stop": _nan(n), "watch": _nan(n)}


PLAYBOOK = {
    "ma_pullback": Ma20x50Pullback,
    "golden_cross": GoldenCrossPullback,
    "breakout_retest": BreakoutRetest,
    "volume_bounce": VolumeBounce,
}
