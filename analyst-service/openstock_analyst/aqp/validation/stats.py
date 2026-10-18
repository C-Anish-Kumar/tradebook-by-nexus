"""Deflated Sharpe Ratio (Bailey & Lopez de Prado) - corrects for the number of strategies tried."""
from __future__ import annotations
import numpy as np
from scipy import stats

EULER = 0.5772156649015329


def expected_max_sharpe(trial_sharpes: np.ndarray, n_trials: int) -> float:
    """Expected best per-period Sharpe among n_trials with zero true edge."""
    if n_trials <= 1:
        return 0.0
    v = float(np.var(trial_sharpes, ddof=1)) if len(trial_sharpes) > 1 else 0.0
    sd = np.sqrt(v)
    return sd * ((1 - EULER) * stats.norm.ppf(1 - 1 / n_trials) + EULER * stats.norm.ppf(1 - 1 / (n_trials * np.e)))


def deflated_sharpe(returns: np.ndarray, trial_sharpes: np.ndarray, n_trials: int) -> float:
    """Probability the observed per-period Sharpe exceeds what luck alone would produce after n_trials."""
    r = np.asarray(returns, float)
    r = r[~np.isnan(r)]
    t = len(r)
    if t < 30 or r.std(ddof=1) == 0:
        return 0.0
    sr = r.mean() / r.std(ddof=1)
    sk, ku = stats.skew(r), stats.kurtosis(r, fisher=False)
    sr0 = expected_max_sharpe(np.asarray(trial_sharpes, float), n_trials)
    denom = np.sqrt(max(1e-12, 1 - sk * sr + (ku - 1) / 4 * sr**2))
    return float(stats.norm.cdf((sr - sr0) * np.sqrt(t - 1) / denom))
