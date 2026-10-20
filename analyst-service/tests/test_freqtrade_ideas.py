"""Hand-built price paths for the strategies adapted from freqtrade-strategies: each entry and exit fires where the
rule says, and not before."""
import numpy as np
import pandas as pd

from openstock_analyst.aqp.strategies.playbook import BollingerSnapBack, MacdTrend, RsiDip, TdExhaustion, rsi, td_count


def frame(close, spread=0.005, volume=1e6):
    close = np.asarray(close, float)
    idx = pd.bdate_range("2022-01-03", periods=len(close))
    open_ = np.r_[close[0], close[:-1]]
    return pd.DataFrame({"open": open_, "high": np.maximum(open_, close) * (1 + spread),
                         "low": np.minimum(open_, close) * (1 - spread), "close": close, "volume": volume}, index=idx)


def uptrend(n=300, start=50.0, step=0.003, seed=0):
    rng = np.random.default_rng(seed)
    return start * np.exp(np.cumsum(step + rng.normal(0, 0.004, n)))


def first_entry(strategy, df):
    pos = strategy.positions(df)
    on = np.flatnonzero(np.diff(np.r_[0, pos.values]) > 0)
    return on, pos


def test_rsi_is_bounded_and_falls_on_selling():
    c = pd.Series(np.r_[np.linspace(100, 120, 40), np.linspace(120, 110, 5)])
    r = rsi(c, 2).dropna()
    assert ((r >= 0) & (r <= 100)).all() and r.iloc[-1] < 10


def test_rsi_dip_buys_a_sharp_dip_in_an_uptrend_and_sells_the_bounce():
    c = uptrend()
    path = np.r_[c, c[-1] * np.array([0.97, 0.94, 0.92]), c[-1] * np.array([0.95, 0.99, 1.02, 1.03])]
    df = frame(path)
    on, pos = first_entry(RsiDip(), df)
    dip = len(c)
    assert any(dip <= i <= dip + 2 for i in on)                       # enters during the dip
    assert pos.iloc[-1] == 0                                           # out once price is back above the 5-day average


def test_rsi_dip_ignores_dips_in_a_downtrend():
    c = uptrend(step=-0.003)
    df = frame(np.r_[c, c[-1] * np.array([0.97, 0.94, 0.92])])
    assert RsiDip().positions(df).sum() == 0


def test_bollinger_snap_back_enters_on_the_first_close_back_inside():
    c = uptrend(step=0.002)
    drop = c[-1] * np.array([0.96, 0.92, 0.89])                       # closes under the lower band
    back = c[-1] * np.array([0.93])                                   # first close back inside
    df = frame(np.r_[c, drop, back, c[-1] * np.array([0.96, 0.99, 1.0, 1.01])])
    s = BollingerSnapBack()
    sig = s._signals(df)
    i = len(c) + len(drop)
    assert sig["entry"][i] and not sig["entry"][i - 1]
    assert sig["entry_stop"][i] < df.low.iloc[i - 3:i + 1].min()       # stop under the dip's low
    assert not np.isnan(sig["watch"][i - 1])                           # watching while below the band


def test_macd_entries_only_in_a_confirmed_uptrend():
    rng = np.random.default_rng(4)
    c = 50 * np.exp(np.cumsum(0.0015 + rng.normal(0, 0.012, 900)))
    df = frame(c)
    s = MacdTrend()
    sig = s._signals(df)
    close = df.close
    e50, e200 = close.ewm(span=50, adjust=False).mean(), close.ewm(span=200, adjust=False, min_periods=200).mean()
    macd = close.ewm(span=12, adjust=False).mean() - close.ewm(span=26, adjust=False).mean()
    idx = np.flatnonzero(sig["entry"])
    assert len(idx) > 0
    assert all(e50.iloc[i] > e200.iloc[i] and macd.iloc[i] > 0 and close.iloc[i] > e50.iloc[i] for i in idx)


def test_td_count_counts_runs():
    assert list(td_count(pd.Series([True, True, False, True, True, True]))) == [1, 2, 0, 1, 2, 3]


def test_td_exhaustion_fires_on_a_perfected_nine_in_an_uptrend():
    c = uptrend(n=260, step=0.004)
    nine = c[-1] * (0.98 - 0.006 * np.arange(9))                       # nine closes, each below the close 4 bars back
    df = frame(np.r_[c, nine, c[-1] * np.array([0.97, 0.99])], spread=0.002)
    sig = TdExhaustion()._signals(df)
    i = len(c) + 8                                                     # the ninth bar
    assert sig["entry"][i] and sig["entry"].sum() == 1
    assert sig["entry_stop"][i] < df.low.iloc[i]
