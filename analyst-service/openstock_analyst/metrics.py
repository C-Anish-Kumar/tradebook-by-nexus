"""Performance metrics on daily returns, via empyrical-reloaded."""

import numpy as np
import pandas as pd


def _clean(x):
    x = float(x)
    return None if not np.isfinite(x) else round(x, 4)


def performance(returns: pd.Series, benchmark: pd.Series | None = None) -> dict:
    import empyrical as ep

    returns = returns.dropna()
    out = {
        "annual_return": _clean(ep.annual_return(returns)),
        "annual_volatility": _clean(ep.annual_volatility(returns)),
        "sharpe": _clean(ep.sharpe_ratio(returns)),
        "sortino": _clean(ep.sortino_ratio(returns)),
        "max_drawdown": _clean(ep.max_drawdown(returns)),
        "calmar": _clean(ep.calmar_ratio(returns)),
        "alpha": None,
        "beta": None,
    }
    if benchmark is not None:
        aligned = pd.concat([returns, benchmark], axis=1, join="inner").dropna()
        if len(aligned) > 20:
            alpha, beta = ep.alpha_beta(aligned.iloc[:, 0], aligned.iloc[:, 1])
            out["alpha"], out["beta"] = _clean(alpha), _clean(beta)
    return out
