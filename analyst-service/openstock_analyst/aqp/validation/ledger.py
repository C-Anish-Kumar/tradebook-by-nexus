"""Append-only trial ledger: every strategy variant ever evaluated is logged, so multiple-testing
deflation uses the TRUE number of trials, including the failures."""
from __future__ import annotations
import json, hashlib, time
from pathlib import Path


class TrialLedger:
    def __init__(self, path: str | None = None):
        self.path = Path(path) if path else None
        self.rows: list[dict] = []
        if self.path and self.path.exists():
            self.rows = [json.loads(l) for l in self.path.read_text().splitlines() if l.strip()]

    def log(self, strategy: str, params: dict, sharpe_per_period: float, n_obs: int, note: str = "") -> None:
        row = {"ts": time.time(), "strategy": strategy, "params": params,
               "id": hashlib.sha1(f"{strategy}{sorted(params.items())}".encode()).hexdigest()[:10],
               "sharpe_pp": sharpe_per_period, "n_obs": n_obs, "note": note}
        self.rows.append(row)
        if self.path:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a") as f:
                f.write(json.dumps(row) + "\n")

    @property
    def n_trials(self) -> int:
        return max(1, len({r["id"] for r in self.rows}))

    def sharpes(self):
        return [r["sharpe_pp"] for r in self.rows]
