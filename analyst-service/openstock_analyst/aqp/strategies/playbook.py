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
        """entry (bool), entry_stop, dyn_stop and watch (price where an entry would trigger), each one value per bar.
        An optional `exit` (bool) closes the trade at that bar's close even if no stop is hit (profit-taking rules)."""
        raise NotImplementedError

    def _scan(self, df: pd.DataFrame):
        sig = self._signals(df)
        exit_rule = sig.get("exit")
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
                if c[i] < s or (exit_rule is not None and exit_rule[i]):
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


# ---------------------------------------------------------------- ideas adapted from freqtrade-strategies
# Re-implemented for daily candles and long/flat swing holds (days to weeks); the originals are crypto, 5m-4h.

def rsi(close: pd.Series, n: int) -> pd.Series:
    """Wilder's RSI, causal."""
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    return 100 - 100 / (1 + up / dn.replace(0, np.nan))


def directional(df: pd.DataFrame, n: int = 14) -> tuple[pd.Series, pd.Series, pd.Series]:
    """(+DI, -DI, ADX), causal, Wilder smoothing."""
    up, dn = df.high.diff(), -df.low.diff()
    plus = pd.Series(np.where((up > dn) & (up > 0), up, 0.0), index=df.index)
    minus = pd.Series(np.where((dn > up) & (dn > 0), dn, 0.0), index=df.index)
    a = atr(df, n)
    pdi = 100 * plus.ewm(alpha=1 / n, adjust=False, min_periods=n).mean() / a
    mdi = 100 * minus.ewm(alpha=1 / n, adjust=False, min_periods=n).mean() / a
    dx = 100 * (pdi - mdi).abs() / (pdi + mdi).replace(0, np.nan)
    return pdi, mdi, dx.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


class RsiDip(PlaybookStrategy):
    """Oversold dip in an uptrend (from BbandRsi / Strategy002 / MultiRSI's RSI mean-reversion).

    Trend: close above the 200-day average. Entry: the 2-day RSI closes under rsi_max. Exit: a close above the 5-day
    average or the 2-day RSI back above exit_rsi (the snap-back happened), else the ATR trail.
    """

    name = "rsi_dip"
    defaults = {"rsi_n": 2, "rsi_max": 10.0, "trend_n": 200, "exit_ma": 5, "exit_rsi": 70.0, "trail_atr": 3.0}

    def _signals(self, df):
        c, n = df.close, len(df)
        r = rsi(c, self.p("rsi_n"))
        trend = c > c.rolling(self.p("trend_n")).mean()
        entry = (trend & (r < self.p("rsi_max"))).fillna(False).values
        exit_ = ((c > c.rolling(self.p("exit_ma")).mean()) | (r > self.p("exit_rsi"))).fillna(False).values
        return {"entry": entry, "entry_stop": _nan(n), "dyn_stop": _nan(n), "watch": _nan(n), "exit": exit_}


class BollingerSnapBack(PlaybookStrategy):
    """Bollinger band snap-back (from Low_BB / Bandtastic's lower-band reversion).

    In an uptrend (close above the 200-day average), price closes below the lower band (20-day, k sigma), then the
    first close back inside it is the entry, provided the 14-day RSI dipped under rsi_max on the way down. Stop just
    under the lowest low of the dip; exit at the middle band.
    """

    name = "bb_snapback"
    defaults = {"bb_n": 20, "bb_k": 2.0, "rsi_max": 35.0, "trend_n": 200, "lookback": 3, "trail_atr": 3.0}

    def _signals(self, df):
        c, n, a = df.close, len(df), atr(df, 14)
        mid = c.rolling(self.p("bb_n")).mean()
        lower = mid - self.p("bb_k") * c.rolling(self.p("bb_n")).std()
        trend = c > c.rolling(self.p("trend_n")).mean()
        lb = self.p("lookback")
        was_below = (c < lower).shift(1).fillna(False).astype(bool)
        dipped = rsi(c, 14).rolling(lb).min() < self.p("rsi_max")
        entry = (trend & was_below & (c > lower) & dipped).fillna(False).values
        dip_low = df.low.rolling(lb + 1).min() - 0.1 * a
        watch = np.where((trend & (c < lower)).fillna(False).values, lower.values, np.nan)
        exit_ = (c >= mid).fillna(False).values
        return {"entry": entry, "entry_stop": dip_low.values, "dyn_stop": _nan(n), "watch": watch, "exit": exit_}


class MacdTrend(PlaybookStrategy):
    """MACD trend continuation (from hlhb / AwesomeMacd / AdxSmas's MACD and EMA trend filters).

    Trend: 50-day EMA above the 200-day EMA and close above the 50. Entry: MACD (12, 26, 9) crosses above its signal
    line while above zero, with ADX over adx_min and +DI over -DI. Exit: MACD crosses back below its signal, or the
    ATR trail.
    """

    name = "macd_trend"
    defaults = {"fast": 12, "slow": 26, "signal": 9, "adx_min": 20.0, "trail_atr": 3.0}

    def _signals(self, df):
        c, n = df.close, len(df)
        e50, e200 = c.ewm(span=50, adjust=False).mean(), c.ewm(span=200, adjust=False, min_periods=200).mean()
        macd = c.ewm(span=self.p("fast"), adjust=False).mean() - c.ewm(span=self.p("slow"), adjust=False).mean()
        sig = macd.ewm(span=self.p("signal"), adjust=False).mean()
        pdi, mdi, x = directional(df)
        trend = (e50 > e200) & (c > e50) & (x > self.p("adx_min")) & (pdi > mdi)
        cross_up = (macd > sig) & (macd.shift(1) <= sig.shift(1))
        entry = (trend & cross_up & (macd > 0)).fillna(False).values
        exit_ = ((macd < sig) & (macd.shift(1) >= sig.shift(1))).fillna(False).values
        return {"entry": entry, "entry_stop": _nan(n), "dyn_stop": _nan(n), "watch": _nan(n), "exit": exit_}


def td_count(cond: pd.Series) -> np.ndarray:
    """Consecutive bars where `cond` holds (resets to 0 when it fails)."""
    out, k = np.zeros(len(cond)), 0
    for i, v in enumerate(cond.values):
        k = k + 1 if v else 0
        out[i] = k
    return out


class TdExhaustion(PlaybookStrategy):
    """TD Sequential exhaustion (from TDSequentialStrategy's 9-count setup).

    A buy setup is nine consecutive closes below the close four bars earlier. It counts when "perfected" (the low of
    bar 8 or 9 undercuts the lows of bars 6 and 7) and the stock is still above its 200-day average. Entry on the
    ninth bar; stop under the setup's lowest low; exit when a sell setup (nine closes above the close four bars
    earlier) completes, or the ATR trail.
    """

    name = "td_exhaustion"
    defaults = {"trend_n": 200, "trail_atr": 3.5}

    def _signals(self, df):
        c, l, n, a = df.close, df.low, len(df), atr(df, 14)
        down = td_count(c < c.shift(4))
        up = td_count(c > c.shift(4))
        low67 = np.minimum(l.shift(2), l.shift(3))                       # bars 6 and 7 when this bar is 9
        perfect = (np.minimum(l, l.shift(1)) <= low67).fillna(False).values
        trend = (c > c.rolling(self.p("trend_n")).mean()).fillna(False).values
        entry = (down == 9) & perfect & trend
        entry_stop = (l.rolling(9).min() - 0.1 * a).values
        return {"entry": entry, "entry_stop": entry_stop, "dyn_stop": _nan(n), "watch": _nan(n), "exit": up == 9}


PLAYBOOK = {
    "ma_pullback": Ma20x50Pullback,
    "golden_cross": GoldenCrossPullback,
    "breakout_retest": BreakoutRetest,
    "volume_bounce": VolumeBounce,
    "rsi_dip": RsiDip,
    "bb_snapback": BollingerSnapBack,
    "macd_trend": MacdTrend,
    "td_exhaustion": TdExhaustion,
}
