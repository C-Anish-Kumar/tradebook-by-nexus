import numpy as np
import pandas as pd
import pytest

from openstock_analyst import screener, universe
from openstock_analyst.aqp.backtest.engine import Costs
from openstock_analyst.aqp.data.synthetic import make_ohlcv, random_walk
from openstock_analyst.setups import SPECS
from openstock_analyst.universe import Filters, metrics, passes_listing, passes_metrics, spread_estimate_pct


def candles(n=600, seed=1, price=50.0, volume=1e6, **kw):
    df = make_ohlcv(n, seed=seed, freq="B", **kw)[["open", "high", "low", "close", "volume"]]
    scale = price / df.close.iloc[-1]
    df[["open", "high", "low", "close"]] *= scale
    df["volume"] = volume
    return df


def test_filters_read_the_app_config_shape():
    f = Filters.from_dict({
        "indexes": ["SP500"], "exchanges": ["nyse"], "price": {"min": 1, "max": 5}, "minAvgDollarVolume": 2e6,
        "relVolume": {"min": 2.5}, "atrPct": {"max": 12}, "maxSpreadPct": 1.0, "excludeSectors": ["Finance"],
    })
    assert f.indexes == ["sp500"] and f.exchanges == ["NYSE"]
    assert (f.price_min, f.price_max, f.rel_volume_min, f.atr_pct_max) == (1, 5, 2.5, 12)
    assert f.min_avg_dollar_volume == 2e6 and f.max_spread_pct == 1.0 and f.exclude_sectors == ["Finance"]


def test_listing_pass_applies_static_filters_with_slack():
    row = pd.Series({"exchange": "NASDAQ", "price": 5.3, "volume": 1e6, "market_cap": 2e8, "sector": "Technology"})
    under5 = Filters(exchanges=["NYSE", "NASDAQ", "AMEX"], price_min=1, price_max=5, min_avg_dollar_volume=1.5e6)
    assert passes_listing(row, under5, None, "ABC")              # 5.30 is inside the 10% slack; candles decide
    assert not passes_listing(row, Filters(exchanges=["NYSE"]), None, "ABC")
    assert not passes_listing(row, Filters(indexes=["sp500"]), {"XYZ"}, "ABC")
    assert passes_listing(row, Filters(indexes=["sp500"]), {"ABC"}, "ABC")
    quiet = row.copy()
    quiet["volume"] = 10_000                                       # $53k today: far below a $1.5M floor
    assert not passes_listing(quiet, under5, None, "ABC")


def test_metrics_pass_uses_candles():
    df = candles(price=3.0, volume=1e6)
    m = metrics(df)
    assert m["close"] == pytest.approx(3.0)
    assert m["avg_dollar_volume"] == pytest.approx(3e6, rel=0.2)
    assert m["rel_volume"] == pytest.approx(1.0)
    assert passes_metrics(m, Filters(price_min=1, price_max=5, min_avg_dollar_volume=1.5e6))
    assert not passes_metrics(m, Filters(price_min=5))
    assert not passes_metrics(m, Filters(rel_volume_min=2.5))
    assert not passes_metrics(metrics(df.iloc[:200]), Filters())   # too short for a 200-day average


def test_unusual_volume_is_seen():
    df = candles()
    df.iloc[-1, df.columns.get_loc("volume")] = 3e6
    assert metrics(df)["rel_volume"] == pytest.approx(3.0)


def test_spread_estimate_is_small_for_tight_bars_and_grows_with_range():
    tight = candles()
    wide = tight.copy()
    mid = (wide.high + wide.low) / 2
    wide["high"], wide["low"] = mid * 1.08, mid * 0.92
    a, b = spread_estimate_pct(tight), spread_estimate_pct(wide)
    assert 0 <= a < b


def test_price_badges_flag_gaps_and_reverse_splits():
    df = candles()
    df["splits"] = 0.0
    df.iloc[-3, df.columns.get_loc("open")] = df.close.iloc[-4] * 1.3
    df.iloc[-10, df.columns.get_loc("splits")] = 0.1
    codes = {b["code"]: b["label"] for b in screener.price_badges(df)}
    assert "gap" in codes and "+30%" in codes["gap"]
    assert codes["reverse_split"].startswith("Reverse split 1:10")
    assert screener.price_badges(candles()) == []


def test_pooled_validation_rejects_noise():
    dfs = {f"N{i}": random_walk(900, seed=i, vol=0.015) for i in range(4)}
    ev = screener.pooled_evidence(SPECS["ma_pullback"], dfs, Costs(2, 10), search_size=60)
    assert set(ev["gates"]) == {"lookahead", "oos_profitable", "cost_stress_2x", "beats_baselines", "deflated_sharpe", "min_trades"}
    assert ev["validated"] is False and ev["sample"] == 4
    assert set(ev["params"]) == set(SPECS["ma_pullback"].grid)


def test_more_slippage_never_helps():
    dfs = {f"T{i}": make_ohlcv(900, seed=10 + i, freq="B") for i in range(3)}
    cheap = screener.pooled_evidence(SPECS["breakout"], dfs, Costs(2, 5), 18)
    dear = screener.pooled_evidence(SPECS["breakout"], dfs, Costs(2, 60), 18)
    assert dear["oos_sharpe"] <= cheap["oos_sharpe"]


def test_run_screen_end_to_end(monkeypatch, tmp_path):
    """Listings, index lists and candles are faked; everything after that is the real pipeline."""
    monkeypatch.setattr(screener, "CACHE_DIR", tmp_path)
    syms = [f"S{i}" for i in range(8)]
    listings = pd.DataFrame({
        "name": [f"Co {s}" for s in syms], "exchange": ["NYSE"] * 4 + ["NASDAQ"] * 4,
        "price": [60.0] * 4 + [3.0] * 4, "volume": [2e6] * 8, "market_cap": [5e10] * 4 + [1e8] * 4,
        "sector": ["Technology", "Energy"] * 4, "industry": [None] * 8,
    }, index=syms)
    data = {s: candles(700, seed=i, price=60.0 if i < 4 else 3.0, volume=2e6) for i, s in enumerate(syms)}
    data["S1"].iloc[-1, data["S1"].columns.get_loc("volume")] = 8e6   # a large cap with unusual volume
    monkeypatch.setattr(screener, "fetch_listings", lambda: listings)
    monkeypatch.setattr(screener, "fetch_index_members", lambda: ({"sp500": set(syms[:4])}, []))
    monkeypatch.setattr(screener, "load_daily", lambda wanted, period, **kw: {s: data[s] for s in wanted if s in data})

    specs = [
        screener.UniverseSpec("large_cap", "Large-cap liquid", Filters(indexes=["sp500"], price_min=5, min_avg_dollar_volume=2e7), 5),
        screener.UniverseSpec("unusual_volume", "Unusual volume", Filters(rel_volume_min=2.5, min_avg_dollar_volume=5e6), 10),
        screener.UniverseSpec("under_5", "Under $5", Filters(exchanges=["NYSE", "NASDAQ", "AMEX"], price_min=1, price_max=5,
                                                             min_avg_dollar_volume=1.5e6), 30),
    ]
    out = screener.run_screen(specs, ["breakout", "ma_pullback"])
    u = out["universes"]
    assert u["large_cap"]["members"] == ["S0", "S1", "S2", "S3"]
    assert u["unusual_volume"]["all_members"] == 1 and u["unusual_volume"]["members"] == []   # S1 lives in large-cap
    assert u["under_5"]["members"] == ["S4", "S5", "S6", "S7"]
    assert set(u["large_cap"]["validation"]) == {"breakout", "ma_pullback"}
    for row in out["rows"]:
        assert row["status"] in {"entry", "holding", "watch"}
        assert row["universe"] in {"large_cap", "under_5"}
        assert 0 <= row["quant"]["score"] <= 100
        assert row["validated"] is u[row["universe"]]["validation"][row["strategy"]]["validated"]
        if row["ticker"] == "S1":
            assert row["tags"] == ["Unusual volume"]
    assert (tmp_path / "validation").exists()   # the weekly validation is cached for the next night


def test_tracked_trades_are_reported_even_when_quiet_or_gone(monkeypatch, tmp_path):
    monkeypatch.setattr(screener, "CACHE_DIR", tmp_path)
    listings = pd.DataFrame({"name": ["Co A"], "exchange": ["NYSE"], "price": [40.0], "volume": [2e6], "market_cap": [1e10],
                             "sector": ["Energy"], "industry": [None]}, index=["A"])
    data = {"A": candles(700, seed=2, price=40.0, volume=2e6), "GONE": candles(700, seed=3, price=40.0, volume=2e6)}
    monkeypatch.setattr(screener, "fetch_listings", lambda: listings)
    monkeypatch.setattr(screener, "load_daily", lambda wanted, period, **kw: {s: data[s] for s in wanted if s in data})
    specs = [screener.UniverseSpec("all", "All", Filters(min_avg_dollar_volume=1e6), 10)]
    track = [{"ticker": "A", "strategy": s, "universe": "all"} for s in ("breakout", "ma_pullback")] + \
            [{"ticker": "GONE", "strategy": "breakout", "universe": "all"}, {"ticker": "A", "strategy": "breakout", "universe": "nope"}]
    out = screener.run_screen(specs, ["breakout", "ma_pullback"], track=track)
    pairs = {(r["ticker"], r["strategy"]) for r in out["rows"]}
    assert {("A", "breakout"), ("A", "ma_pullback"), ("GONE", "breakout")} <= pairs   # reported whatever the status
    assert ("GONE", "ma_pullback") not in pairs                                         # only what was tracked
    gone = next(r for r in out["rows"] if r["ticker"] == "GONE")
    assert gone["universe"] == "all" and gone["name"] is None
