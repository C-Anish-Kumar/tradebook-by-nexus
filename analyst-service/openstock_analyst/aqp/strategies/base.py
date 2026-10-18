from __future__ import annotations
from abc import ABC, abstractmethod
import pandas as pd


class Strategy(ABC):
    """positions(df) must be CAUSAL: value at t depends only on rows <= t. The lookahead gate enforces this."""
    name = "strategy"

    def __init__(self, **params):
        self.params = params

    @abstractmethod
    def positions(self, df: pd.DataFrame) -> pd.Series: ...

    def __repr__(self):
        return f"{self.name}({self.params})"
