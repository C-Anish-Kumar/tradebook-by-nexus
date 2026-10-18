"""Load + validate OHLCV. Parquet/CSV. Live exchange pulls (ccxt) are a Phase-2 adapter."""
from __future__ import annotations
import pandas as pd

COLS = ["open", "high", "low", "close", "volume"]


def validate_ohlcv(df: pd.DataFrame) -> pd.DataFrame:
    missing = [c for c in COLS if c not in df.columns]
    if missing:
        raise ValueError(f"missing columns: {missing}")
    if not df.index.is_monotonic_increasing or df.index.has_duplicates:
        raise ValueError("index must be sorted and unique")
    if df[COLS].isna().any().any():
        raise ValueError("NaNs in OHLCV")
    bad = (df.high < df[["open", "close"]].max(axis=1) - 1e-9) | (df.low > df[["open", "close"]].min(axis=1) + 1e-9)
    if bad.any():
        raise ValueError(f"{int(bad.sum())} bars violate high/low bounds")
    return df


def load_ohlcv(path: str, ts_col: str = "timestamp") -> pd.DataFrame:
    df = pd.read_parquet(path) if path.endswith(".parquet") else pd.read_csv(path)
    if ts_col in df.columns:
        df[ts_col] = pd.to_datetime(df[ts_col], utc=True)
        df = df.set_index(ts_col)
    return validate_ohlcv(df.sort_index())
