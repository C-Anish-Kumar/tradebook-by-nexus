"""10/21 EMA + Supertrend (10,3) trend-following checklist.

Computes the indicators on daily candles and evaluates the strategy's rules on the
latest bar: trend state, long entry, staged exits and add-back setups. It reports
what the rules say about the chart; it does not know anyone's position.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd

PULLBACK_TOLERANCE = 0.005   # a low within 0.5% of the EMA counts as a touch
TIGHT_RANGE_MAX = 0.05       # a 4-bar range under 5% of price counts as consolidation
SWING_LOOKBACK = 10          # stop goes under the lowest low of the last 10 bars
PIVOT_SPAN = 2               # a pivot is the extreme of the 2 bars either side


def ema(series: pd.Series, length: int) -> pd.Series:
    return series.ewm(span=length, adjust=False).mean()


def dema(series: pd.Series, length: int) -> pd.Series:
    first = ema(series, length)
    return 2 * first - ema(first, length)


def supertrend(df: pd.DataFrame, length: int = 10, multiplier: float = 3.0) -> tuple[pd.Series, pd.Series]:
    """Returns (line, is_up), matching TradingView's ta.supertrend (Wilder ATR)."""
    high, low, close = df["High"].to_numpy(), df["Low"].to_numpy(), df["Close"].to_numpy()
    prev_close = np.roll(close, 1)
    prev_close[0] = close[0]
    tr = np.maximum.reduce([high - low, np.abs(high - prev_close), np.abs(low - prev_close)])
    atr = pd.Series(tr).ewm(alpha=1 / length, adjust=False).mean().to_numpy()

    hl2 = (high + low) / 2
    upper, lower = hl2 + multiplier * atr, hl2 - multiplier * atr
    final_upper, final_lower = upper.copy(), lower.copy()
    is_up = np.ones(len(close), dtype=bool)
    for i in range(1, len(close)):
        final_lower[i] = lower[i] if lower[i] > final_lower[i - 1] or close[i - 1] < final_lower[i - 1] else final_lower[i - 1]
        final_upper[i] = upper[i] if upper[i] < final_upper[i - 1] or close[i - 1] > final_upper[i - 1] else final_upper[i - 1]
        if is_up[i - 1]:
            is_up[i] = close[i] >= final_lower[i]
        else:
            is_up[i] = close[i] > final_upper[i]
    line = np.where(is_up, final_lower, final_upper)
    return pd.Series(line, index=df.index), pd.Series(is_up, index=df.index)


def _pivots(values: pd.Series, kind: str) -> list[int]:
    """Positions of confirmed pivot highs or lows (needs PIVOT_SPAN bars after)."""
    arr, out = values.to_numpy(), []
    for i in range(PIVOT_SPAN, len(arr) - PIVOT_SPAN):
        window = arr[i - PIVOT_SPAN:i + PIVOT_SPAN + 1]
        if (kind == "high" and arr[i] == window.max()) or (kind == "low" and arr[i] == window.min()):
            out.append(i)
    return out


def _consecutive(flags: pd.Series) -> int:
    count = 0
    for flag in reversed(flags.to_list()):
        if not flag:
            break
        count += 1
    return count


@dataclass
class Check:
    rule: str
    passed: bool
    detail: str

    def as_dict(self):
        return {"rule": self.rule, "passed": bool(self.passed), "detail": self.detail}


def evaluate(df: pd.DataFrame, weekly: pd.DataFrame | None = None) -> dict:
    """Evaluate the strategy on daily OHLC candles (oldest first)."""
    if len(df) < 120:
        raise ValueError("Need at least 120 daily candles")
    df = df[["Open", "High", "Low", "Close"]].astype(float)
    close, high, low, open_ = df["Close"], df["High"], df["Low"], df["Open"]
    e10, e21, d50 = ema(close, 10), ema(close, 21), dema(close, 50)
    st_line, st_up = supertrend(df)

    c, o = close.iloc[-1], open_.iloc[-1]
    pc = close.iloc[-2]
    up, prev_up = bool(st_up.iloc[-1]), bool(st_up.iloc[-2])
    above = e10 > e21
    cross_up = above & ~above.shift(1, fill_value=False)
    cross_down = ~above & above.shift(1, fill_value=True)
    last_up = int(np.flatnonzero(cross_up.to_numpy())[-1]) if cross_up.any() else None
    last_down = int(np.flatnonzero(cross_down.to_numpy())[-1]) if cross_down.any() else None
    n = len(df) - 1

    if c > e10.iloc[-1] and c > e21.iloc[-1] and up:
        trend = "up"
    elif c < e10.iloc[-1] and c < e21.iloc[-1] and not up:
        trend = "down"
    else:
        trend = "mixed"

    # Entry: 10>21, Supertrend green, pullback or tight-range breakout, bullish candle
    recent = slice(-3, None)
    touched_10 = (low.iloc[recent] <= e10.iloc[recent] * (1 + PULLBACK_TOLERANCE)).any()
    touched_21 = (low.iloc[recent] <= e21.iloc[recent] * (1 + PULLBACK_TOLERANCE)).any()
    pullback = bool((touched_10 or touched_21) and c > e21.iloc[-1])
    box_high, box_low = high.iloc[-5:-1].max(), low.iloc[-5:-1].min()
    tight = (box_high - box_low) / c <= TIGHT_RANGE_MAX
    breakout = bool(tight and c > box_high)
    bullish = bool(c > o and c > pc)
    entry = [
        Check("10 EMA above 21 EMA", above.iloc[-1],
              f"Crossed above {n - last_up} bars ago" if above.iloc[-1] and last_up is not None else "10 EMA is below 21 EMA"),
        Check("Supertrend green", up, "Trend structure intact" if up else "Supertrend is red: no new longs"),
        Check("Pullback or tight-range breakout", pullback or breakout,
              "Pulled back to the 10/21 EMA" if pullback else ("Broke out of a tight 4-day range" if breakout else "No pullback or breakout yet")),
        Check("Bullish confirmation candle", bullish, "Closed up and above yesterday" if bullish else "Wait for a bullish close"),
    ]
    entry_ok = all(ch.passed for ch in entry)

    stop = float(low.iloc[-SWING_LOOKBACK:].min())
    risk = c - stop
    target_4r = c + 4 * risk if risk > 0 else None

    # Staged exits (for an open long)
    below10, below21 = _consecutive(close < e10), _consecutive(close < e21)
    highs = _pivots(high, "high")
    lows = _pivots(low, "low")
    lower_high = len(highs) >= 2 and high.iloc[highs[-1]] < high.iloc[highs[-2]]
    final_exit = bool(not above.iloc[-1] and lower_high and last_down is not None and highs[-1] >= last_down - PIVOT_SPAN)
    exits = [
        Check("2nd close below 10 EMA: sell 25%", below10 >= 2, f"{below10} consecutive close(s) below the 10 EMA"),
        Check("2nd close below 21 EMA: sell 25%", below21 >= 2, f"{below21} consecutive close(s) below the 21 EMA"),
        Check("Lower high after 10 < 21: sell the rest", final_exit,
              "10 EMA under 21 EMA with a confirmed lower high" if final_exit else "Not triggered"),
        Check("Supertrend turned red", not up, "Optional trailing exit: reduce" if not up else "Still green"),
    ]

    # Add-backs (for a trimmed long)
    rising10 = e10.iloc[-1] > e10.iloc[-2]
    back10 = bool(pc < e10.iloc[-2] and c > e10.iloc[-1])
    back21 = bool(pc < e21.iloc[-2] and c > e21.iloc[-1] and rising10)
    higher_low = (len(lows) >= 2 and low.iloc[lows[-1]] > low.iloc[lows[-2]]
                  and last_up is not None and n - last_up <= 15 and lows[-1] >= last_up - PIVOT_SPAN)
    pivot_break = bool(highs and pc <= high.iloc[highs[-1]] < c)
    adds = [
        Check("Close back above 10 EMA: add 25%", back10 and up, "Reclaimed the 10 EMA today" if back10 else "Not today"),
        Check("Close back above 21 EMA: add 25%", back21 and up, "Reclaimed a rising 21 EMA today" if back21 else "Not today"),
        Check("Higher low after 10 crosses back above 21: add 25%", bool(higher_low and up and above.iloc[-1]),
              "Confirmed higher low since the crossover" if higher_low else "No confirmed higher low"),
        Check("Breakout above previous pivot high: add final 25%", pivot_break and up,
              (f"Closed above the pivot at {high.iloc[highs[-1]]:.2f}" if pivot_break
               else f"Waiting for a close above {high.iloc[highs[-1]]:.2f}") if highs else "No pivot yet"),
    ]

    weekly_up = None
    if weekly is not None and len(weekly) >= 20:
        weekly_up = bool(supertrend(weekly[["Open", "High", "Low", "Close"]].astype(float))[1].iloc[-1])

    if not above.iloc[-1]:
        verdict, tone = ("Exit remaining position", "down") if final_exit else ("No long setup", "down")
    elif any(ch.passed for ch in exits[:2]):
        verdict, tone = "Trim 25%", "warn"
    elif entry_ok:
        verdict, tone = "Entry setup", "up"
    elif any(ch.passed for ch in adds):
        verdict, tone = "Add-back setup", "up"
    elif trend == "up":
        verdict, tone = "Hold / wait for a pullback", "neutral"
    else:
        verdict, tone = "Wait", "neutral"

    return {
        "date": df.index[-1].strftime("%Y-%m-%d"),
        "close": round(c, 4),
        "verdict": verdict,
        "tone": tone,
        "trend": trend,
        "indicators": {
            "ema10": round(float(e10.iloc[-1]), 4),
            "ema21": round(float(e21.iloc[-1]), 4),
            "dema50": round(float(d50.iloc[-1]), 4),
            "supertrend": round(float(st_line.iloc[-1]), 4),
            "supertrend_up": up,
            "supertrend_flipped_today": up != prev_up,
            "weekly_supertrend_up": weekly_up,
        },
        "risk": {"stop": round(stop, 4), "target_4r": round(target_4r, 4) if target_4r else None},
        "entry": [ch.as_dict() for ch in entry],
        "exits": [ch.as_dict() for ch in exits],
        "add_backs": [ch.as_dict() for ch in adds],
    }
