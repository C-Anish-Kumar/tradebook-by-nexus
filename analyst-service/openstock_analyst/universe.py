"""Stock universes for the screener: who is listed, who belongs to an index, and who passes a universe's filters.

A universe is a set of filters (see config/universes.ts in the app, sent with every scan request). Membership is
decided in two passes so the expensive part stays small:

1. Listing pass (one call per exchange to Nasdaq's public screener): exchange, last price, today's volume, market
   cap and sector for every NYSE, Nasdaq and NYSE American stock. Static filters run here, plus a loose
   today's-dollar-volume floor, so only plausible candidates go on.
2. Candle pass (Yahoo daily candles, fetched in batches and cached on disk): 20-day average dollar volume,
   relative volume, ATR% and an estimated bid-ask spread decide the final members.

OTC and pink-sheet stocks never appear: the listing only covers the three exchanges.
"""

from __future__ import annotations

import csv
import io
import math
import os
import pickle
import re
import time
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from openstock_analyst.aqp.regime.detector import atr

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
NASDAQ_SCREENER = "https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true&exchange={exchange}"
NASDAQ_100 = "https://api.nasdaq.com/api/quote/list-type/nasdaq100"
SP500_CSV = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv"
EXCHANGES = {"NYSE": "nyse", "NASDAQ": "nasdaq", "AMEX": "amex"}
# Not common stock: warrants, rights, units, preferreds and notes trade on the same exchanges
NOT_COMMON = re.compile(r"\b(warrants?|rights?|units?|preferred|notes? due|debentures?|subordinated)\b", re.I)

CACHE_DIR = Path(os.environ.get("SCREEN_CACHE_DIR", "/tmp/tradebook-screener"))
WINDOW = 20                 # bars for average dollar volume, relative volume and the spread estimate
MIN_SCREEN_BARS = 260       # a 200-day average plus room to settle
PREFILTER_SLACK = 0.25      # today's dollar volume must be at least this share of the 20-day floor


@dataclass
class Filters:
    """Mirrors UniverseFilters in config/universes.ts. Missing bounds mean 'no limit'."""
    indexes: list[str] = field(default_factory=list)          # 'sp500', 'ndx': member of any
    exchanges: list[str] = field(default_factory=list)        # 'NYSE', 'NASDAQ', 'AMEX'
    price_min: float | None = None
    price_max: float | None = None
    min_avg_dollar_volume: float | None = None
    rel_volume_min: float | None = None
    rel_volume_max: float | None = None
    market_cap_min: float | None = None
    market_cap_max: float | None = None
    sectors: list[str] = field(default_factory=list)
    exclude_sectors: list[str] = field(default_factory=list)
    atr_pct_min: float | None = None
    atr_pct_max: float | None = None
    max_spread_pct: float | None = None

    @classmethod
    def from_dict(cls, d: dict) -> "Filters":
        rng = lambda k: (d.get(k) or {})  # noqa: E731
        return cls(
            indexes=[x.lower() for x in d.get("indexes") or []],
            exchanges=[x.upper() for x in d.get("exchanges") or []],
            price_min=rng("price").get("min"), price_max=rng("price").get("max"),
            min_avg_dollar_volume=d.get("minAvgDollarVolume"),
            rel_volume_min=rng("relVolume").get("min"), rel_volume_max=rng("relVolume").get("max"),
            market_cap_min=rng("marketCap").get("min"), market_cap_max=rng("marketCap").get("max"),
            sectors=list(d.get("sectors") or []), exclude_sectors=list(d.get("excludeSectors") or []),
            atr_pct_min=rng("atrPct").get("min"), atr_pct_max=rng("atrPct").get("max"),
            max_spread_pct=d.get("maxSpreadPct"),
        )


# ---------------------------------------------------------------- listings and index membership

def _num(text) -> float | None:
    if text is None:
        return None
    s = str(text).replace("$", "").replace(",", "").replace("%", "").strip()
    try:
        v = float(s)
    except ValueError:
        return None
    return v if math.isfinite(v) else None


def yahoo_symbol(symbol: str) -> str:
    """Exchange share classes use '/' or '.'; Yahoo wants '-' (BRK/B -> BRK-B)."""
    return symbol.strip().upper().replace("/", "-").replace(".", "-")


def fetch_listings(session: requests.Session | None = None) -> pd.DataFrame:
    """Every common stock on NYSE, Nasdaq and NYSE American, with the day's price, volume, market cap and sector."""
    s = session or requests.Session()
    frames = []
    for exchange, slug in EXCHANGES.items():
        res = s.get(NASDAQ_SCREENER.format(exchange=slug), headers={"User-Agent": UA, "Accept": "application/json"}, timeout=30)
        res.raise_for_status()
        rows = (res.json().get("data") or {}).get("rows") or []
        frames.append(pd.DataFrame([{
            "symbol": yahoo_symbol(r["symbol"]), "name": r.get("name") or "", "exchange": exchange,
            "price": _num(r.get("lastsale")), "volume": _num(r.get("volume")), "market_cap": _num(r.get("marketCap")),
            "sector": (r.get("sector") or "").strip() or None, "industry": (r.get("industry") or "").strip() or None,
        } for r in rows if r.get("symbol") and "^" not in r["symbol"]]))
    df = pd.concat(frames, ignore_index=True)
    df = df[~df.name.str.contains(NOT_COMMON, na=False)]
    return df.drop_duplicates("symbol").set_index("symbol")


def fetch_index_members(session: requests.Session | None = None) -> tuple[dict[str, set[str]], list[str]]:
    """S&P 500 and Nasdaq-100 members (Yahoo symbols). Returns (members by index, problems)."""
    s = session or requests.Session()
    out: dict[str, set[str]] = {}
    problems: list[str] = []
    try:
        res = s.get(SP500_CSV, timeout=30)
        res.raise_for_status()
        out["sp500"] = {yahoo_symbol(r["Symbol"]) for r in csv.DictReader(io.StringIO(res.text)) if r.get("Symbol")}
    except Exception as exc:  # noqa: BLE001 - reported to the caller, the scan goes on
        problems.append(f"S&P 500 list unavailable ({type(exc).__name__})")
    try:
        res = s.get(NASDAQ_100, headers={"User-Agent": UA, "Accept": "application/json"}, timeout=30)
        res.raise_for_status()
        rows = res.json()["data"]["data"]["rows"]
        out["ndx"] = {yahoo_symbol(r["symbol"]) for r in rows if r.get("symbol")}
    except Exception as exc:  # noqa: BLE001
        problems.append(f"Nasdaq-100 list unavailable ({type(exc).__name__})")
    return out, problems


# ---------------------------------------------------------------- candles (batched, cached on disk)

def _cache_path(kind: str, symbol: str) -> Path:
    return CACHE_DIR / kind / f"{symbol}.pkl"


def _read(kind: str, symbol: str) -> pd.DataFrame | None:
    p = _cache_path(kind, symbol)
    try:
        with p.open("rb") as f:
            return pickle.load(f)
    except Exception:  # noqa: BLE001 - a missing or broken cache file just means "download it"
        return None


def _write(kind: str, symbol: str, df: pd.DataFrame) -> None:
    p = _cache_path(kind, symbol)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    with tmp.open("wb") as f:
        pickle.dump(df, f)
    tmp.replace(p)


def _clean(raw: pd.DataFrame) -> pd.DataFrame:
    """Yahoo columns -> lowercase open/high/low/close/volume (+ splits), tz-naive, no empty rows."""
    df = raw.rename(columns=lambda c: str(c).lower().replace(" ", "_"))
    keep = [c for c in ("open", "high", "low", "close", "volume", "stock_splits") if c in df.columns]
    df = df[keep].rename(columns={"stock_splits": "splits"}).dropna(subset=["open", "high", "low", "close"])
    if getattr(df.index, "tz", None) is not None:
        df.index = df.index.tz_localize(None)
    df.index = pd.DatetimeIndex(df.index).normalize()
    return df[~df.index.duplicated(keep="last")].sort_index()


def _download(symbols: list[str], period: str) -> dict[str, pd.DataFrame]:
    """One batched Yahoo download, retried with backoff when Yahoo rate-limits."""
    import yfinance as yf

    for attempt in range(4):
        try:
            raw = yf.download(symbols, period=period, interval="1d", auto_adjust=False, actions=True,
                              group_by="ticker", threads=True, progress=False)
            break
        except Exception:  # noqa: BLE001 - rate limits and dropped connections both retry
            if attempt == 3:
                return {}
            time.sleep(5 * 3 ** attempt)
    out: dict[str, pd.DataFrame] = {}
    if raw is None or raw.empty:
        return out
    if isinstance(raw.columns, pd.MultiIndex):
        for sym in symbols:
            if sym in raw.columns.get_level_values(0):
                df = _clean(raw[sym])
                if len(df):
                    out[sym] = df
    elif len(symbols) == 1:
        df = _clean(raw)
        if len(df):
            out[symbols[0]] = df
    return out


def load_daily(symbols: list[str], period: str = "2y", kind: str = "daily", max_age_days: int = 0,
               batch: int = 50, pause: float = 1.0, on_progress=None) -> dict[str, pd.DataFrame]:
    """Daily candles for many symbols. Cached files are topped up with the last month instead of re-downloaded.

    `max_age_days` > 0 skips the top-up for files written within that many days (used for the weekly validation set).
    """
    have: dict[str, pd.DataFrame] = {}
    stale, missing = [], []
    for sym in symbols:
        df = _read(kind, sym)
        p = _cache_path(kind, sym)
        if df is None or len(df) == 0:
            missing.append(sym)
        elif max_age_days and time.time() - p.stat().st_mtime < max_age_days * 86400:
            have[sym] = df
        else:
            have[sym] = df
            stale.append(sym)

    jobs = [(missing, period), (stale, "1mo")]
    total = len(missing) + len(stale)
    done = 0
    for group, per in jobs:
        for i in range(0, len(group), batch):
            chunk = group[i:i + batch]
            fresh = _download(chunk, per)
            for sym, df in fresh.items():
                merged = df if per == period or sym not in have else pd.concat([have[sym], df])
                merged = merged[~merged.index.duplicated(keep="last")].sort_index()
                have[sym] = merged
                _write(kind, sym, merged)
            done += len(chunk)
            if on_progress:
                on_progress(done, total)
            if pause and i + batch < len(group):
                time.sleep(pause)
    return have


# ---------------------------------------------------------------- per-stock liquidity and volatility metrics

def spread_estimate_pct(df: pd.DataFrame, window: int = WINDOW) -> float | None:
    """Corwin-Schultz (2012) bid-ask spread estimate from daily highs and lows, averaged over `window` day pairs.

    Free data has no quotes, so this is the standard academic stand-in; real spreads come with live quotes later.
    """
    if len(df) < window + 1:
        return None
    h, l = df.high.values[-(window + 1):], df.low.values[-(window + 1):]
    if (l <= 0).any():
        return None
    k = 3 - 2 * math.sqrt(2)
    beta = np.log(h[:-1] / l[:-1]) ** 2 + np.log(h[1:] / l[1:]) ** 2
    gamma = np.log(np.maximum(h[:-1], h[1:]) / np.minimum(l[:-1], l[1:])) ** 2
    alpha = (np.sqrt(2 * beta) - np.sqrt(beta)) / k - np.sqrt(gamma / k)
    s = 2 * (np.exp(alpha) - 1) / (1 + np.exp(alpha))
    s = np.clip(s, 0, None)
    return float(np.nanmean(s) * 100)


def metrics(df: pd.DataFrame) -> dict | None:
    """Liquidity and volatility numbers for the latest bar, or None when there is too little history."""
    if len(df) < WINDOW + 2:
        return None
    close = float(df.close.iloc[-1])
    vol = df.volume.astype(float)
    dollar = (df.close * vol).iloc[-WINDOW:]
    prior = float(vol.iloc[-WINDOW - 1:-1].mean())
    a = atr(df, 14).iloc[-1]
    return {
        "close": close,
        "avg_dollar_volume": float(dollar.mean()),
        "rel_volume": float(vol.iloc[-1] / prior) if prior > 0 else None,
        "atr_pct": float(a / close * 100) if close > 0 and pd.notna(a) else None,
        "spread_pct": spread_estimate_pct(df),
        "bars": len(df),
        "date": df.index[-1].date().isoformat(),
    }


def _between(x, lo, hi) -> bool:
    if lo is None and hi is None:
        return True
    if x is None:
        return False
    return (lo is None or x >= lo) and (hi is None or x <= hi)


def passes_listing(row: pd.Series, f: Filters, members: set[str] | None, symbol: str) -> bool:
    """Static filters plus a loose dollar-volume floor, before any candles are fetched."""
    if f.indexes and (members is None or symbol not in members):
        return False
    if f.exchanges and row.exchange not in f.exchanges:
        return False
    price = row.price
    # The listing price is today's last sale; allow 10% slack, the candle pass decides exactly
    lo = f.price_min * 0.9 if f.price_min is not None else None
    hi = f.price_max * 1.1 if f.price_max is not None else None
    if not _between(price, lo, hi):
        return False
    if not _between(row.market_cap if row.market_cap else None, f.market_cap_min, f.market_cap_max):
        return False
    if f.sectors and row.sector not in f.sectors:
        return False
    if f.exclude_sectors and row.sector in f.exclude_sectors:
        return False
    if f.min_avg_dollar_volume and price and row.volume is not None:
        if price * row.volume < f.min_avg_dollar_volume * PREFILTER_SLACK:
            return False
    return True


def passes_metrics(m: dict | None, f: Filters) -> bool:
    if m is None or m["bars"] < MIN_SCREEN_BARS:
        return False
    if not _between(m["close"], f.price_min, f.price_max):
        return False
    if f.min_avg_dollar_volume and m["avg_dollar_volume"] < f.min_avg_dollar_volume:
        return False
    if not _between(m["rel_volume"], f.rel_volume_min, f.rel_volume_max):
        return False
    if not _between(m["atr_pct"], f.atr_pct_min, f.atr_pct_max):
        return False
    if f.max_spread_pct is not None and (m["spread_pct"] is None or m["spread_pct"] > f.max_spread_pct):
        return False
    return True


def latest_session(today: date | None = None) -> str:
    """The most recent weekday (no holiday calendar: a holiday just means the scan sees yesterday's bar)."""
    d = today or date.today()
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d.isoformat()
