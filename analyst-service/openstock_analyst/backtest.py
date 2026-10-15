"""Replays the 10/21 EMA + Supertrend (10,3) strategy over daily history.

Signals are read on a bar's close and filled at the next bar's open, so nothing uses
information from the future. Stops and the 4R target fill intrabar. A full position
is four quarters bought with all available equity; staged exits sell a quarter of the
original shares and add-backs buy one back, never above the original size.
"""

import numpy as np
import pandas as pd

from openstock_analyst.strategy import (
    PIVOT_SPAN, PULLBACK_TOLERANCE, SWING_LOOKBACK, TIGHT_RANGE_MAX, ema, supertrend,
)

START_EQUITY = 10_000.0


def _confirmed_pivots(values: np.ndarray, t: int, kind: str) -> list[int]:
    """Pivots known by the close of bar t (each needs PIVOT_SPAN bars after it)."""
    out = []
    for i in range(PIVOT_SPAN, t - PIVOT_SPAN + 1):
        window = values[i - PIVOT_SPAN:i + PIVOT_SPAN + 1]
        if (kind == "high" and values[i] == window.max()) or (kind == "low" and values[i] == window.min()):
            out.append(i)
    return out


def run(df: pd.DataFrame, cost: float = 0.001, warmup: int = 60) -> dict:
    df = df[["Open", "High", "Low", "Close"]].astype(float)
    o, h, l, c = (df[k].to_numpy() for k in ("Open", "High", "Low", "Close"))
    e10, e21 = ema(df["Close"], 10).to_numpy(), ema(df["Close"], 21).to_numpy()
    st_up = supertrend(df)[1].to_numpy()
    dates = df.index
    n = len(df)

    cash, shares = START_EQUITY, 0.0
    trade = None            # the open trade
    pending = []            # orders to fill at the next open: ("buy" | "sell", quarters, reason)
    trades, equity = [], []
    below10 = below21 = 0
    last_cross_up = None

    def fill(side, qty, price, reason, t):
        nonlocal cash, shares
        if side == "buy":
            price *= 1 + cost
            cash -= qty * price
            shares += qty
        else:
            price *= 1 - cost
            cash += qty * price
            shares -= qty
        trade["log"].append({"date": dates[t].strftime("%Y-%m-%d"), "side": side, "shares": round(float(qty), 4),
                             "price": round(float(price), 4), "reason": reason})
        trade["cash_flow"] += -qty * price if side == "buy" else qty * price

    def close_trade(t):
        nonlocal trade
        invested = sum(x["shares"] * x["price"] for x in trade["log"] if x["side"] == "buy")
        pnl = trade["cash_flow"]
        trades.append({
            "entry_date": trade["log"][0]["date"],
            "entry_price": trade["log"][0]["price"],
            "exit_date": dates[t].strftime("%Y-%m-%d"),
            "return_pct": round(100 * pnl / invested, 2) if invested else 0.0,
            "pnl": round(pnl, 2),
            "r_multiple": round(pnl / (trade["risk_per_share"] * trade["quarter"] * 4), 2),
            "bars": t - trade["start"],
            "log": trade["log"],
        })
        trade = None

    for t in range(n):
        # 1. Fill yesterday's orders at today's open
        for side, quarters, reason in pending:
            if side == "buy" and trade is None:
                quarter = (cash / (o[t] * (1 + cost))) / 4
                trade = {"start": t, "quarter": quarter, "held": 0, "stop": pending_stop, "cash_flow": 0.0,
                         "risk_per_share": o[t] - pending_stop, "target": o[t] + 4 * (o[t] - pending_stop),
                         "took_4r": False, "sold10": False, "sold21": False, "log": []}
                fill("buy", quarter * 4, o[t], reason, t)
                trade["held"] = 4
            elif trade is not None:
                qty = min(quarters, trade["held"] if side == "sell" else 4 - trade["held"])
                if qty <= 0:
                    continue
                fill(side, trade["quarter"] * qty, o[t], reason, t)
                trade["held"] += qty if side == "buy" else -qty
                if trade["held"] == 0:
                    close_trade(t)
        pending = []

        # 2. Intrabar stop and 4R target
        if trade is not None:
            if l[t] <= trade["stop"]:
                fill("sell", trade["quarter"] * trade["held"], min(o[t], trade["stop"]), "stop loss", t)
                trade["held"] = 0
                close_trade(t)
            elif not trade["took_4r"] and h[t] >= trade["target"]:
                fill("sell", trade["quarter"], max(o[t], trade["target"]), "4R target", t)
                trade["held"] -= 1
                trade["took_4r"] = True
                if trade["held"] == 0:
                    close_trade(t)

        # 3. Read today's close for tomorrow's orders
        above = e10[t] > e21[t]
        if t > 0 and above and not e10[t - 1] > e21[t - 1]:
            last_cross_up = t
        below10 = below10 + 1 if c[t] < e10[t] else 0
        below21 = below21 + 1 if c[t] < e21[t] else 0
        equity.append(cash + shares * c[t])
        if t < warmup:
            continue

        if trade is None:
            lo = slice(t - 2, t + 1)
            pullback = ((l[lo] <= e10[lo] * (1 + PULLBACK_TOLERANCE)).any() or
                        (l[lo] <= e21[lo] * (1 + PULLBACK_TOLERANCE)).any()) and c[t] > e21[t]
            box_h, box_l = h[t - 4:t].max(), l[t - 4:t].min()
            breakout = (box_h - box_l) / c[t] <= TIGHT_RANGE_MAX and c[t] > box_h
            bullish = c[t] > o[t] and c[t] > c[t - 1]
            stop = l[t - SWING_LOOKBACK + 1:t + 1].min()
            if above and st_up[t] and (pullback or breakout) and bullish and stop < c[t] and t + 1 < n:
                pending_stop = stop
                pending.append(("buy", 4, "entry"))
            continue

        # Staged exits
        if below10 == 2 and not trade["sold10"]:
            pending.append(("sell", 1, "2nd close below 10 EMA"))
            trade["sold10"] = True
        if below21 == 2 and not trade["sold21"]:
            pending.append(("sell", 1, "2nd close below 21 EMA"))
            trade["sold21"] = True
        if not above:
            highs = _confirmed_pivots(h, t, "high")
            if len(highs) >= 2 and h[highs[-1]] < h[highs[-2]]:
                pending = [("sell", 4, "lower high after 10 < 21")]
                continue
        # A new leg up re-arms the staged exits
        if c[t] > e10[t]:
            trade["sold10"] = False
        if c[t] > e21[t]:
            trade["sold21"] = False

        # Add-backs, one quarter per day while Supertrend is green
        if trade["held"] + sum(q for s, q, _ in pending if s == "buy") - sum(q for s, q, _ in pending if s == "sell") < 4 and st_up[t]:
            reason = None
            if c[t - 1] < e10[t - 1] and c[t] > e10[t]:
                reason = "close back above 10 EMA"
            elif c[t - 1] < e21[t - 1] and c[t] > e21[t] and e10[t] > e10[t - 1]:
                reason = "close back above 21 EMA"
            else:
                highs = _confirmed_pivots(h, t, "high")
                lows = _confirmed_pivots(l, t, "low")
                if lows and len(lows) >= 2 and lows[-1] == t - PIVOT_SPAN and l[lows[-1]] > l[lows[-2]] \
                        and above and last_cross_up is not None and t - last_cross_up <= 15:
                    reason = "higher low after crossover"
                elif highs and c[t - 1] <= h[highs[-1]] < c[t]:
                    reason = "breakout above pivot high"
            if reason:
                pending.append(("buy", 1, reason))

    # Mark any open trade to the last close
    open_trade = None
    if trade is not None:
        open_trade = {"entry_date": trade["log"][0]["date"], "entry_price": float(trade["log"][0]["price"]),
                      "quarters_held": int(trade["held"]), "stop": round(float(trade["stop"]), 4)}

    eq = pd.Series(equity, index=dates)
    years = max((dates[-1] - dates[warmup]).days / 365.25, 1e-9)
    strat_return = eq.iloc[-1] / START_EQUITY - 1
    bh_return = c[-1] / c[warmup] - 1
    drawdown = (eq / eq.cummax() - 1).min()
    bh_curve = START_EQUITY * c / c[warmup]
    bh_dd = (pd.Series(bh_curve[warmup:]) / pd.Series(bh_curve[warmup:]).cummax() - 1).min()
    rets = [tr["return_pct"] for tr in trades]
    wins, losses = [r for r in rets if r > 0], [r for r in rets if r <= 0]
    gross_win = sum(tr["pnl"] for tr in trades if tr["pnl"] > 0)
    gross_loss = -sum(tr["pnl"] for tr in trades if tr["pnl"] <= 0)
    in_market = sum(1 for t in range(warmup, n) if equity[t] != 0 and _held_on(trades, open_trade, dates[t]))

    # Weekly points keep the curve light for the browser
    weekly = eq.iloc[warmup:].resample("W").last().dropna()
    bh_weekly = pd.Series(bh_curve, index=dates).iloc[warmup:].resample("W").last().dropna()

    return {
        "start": dates[warmup].strftime("%Y-%m-%d"),
        "end": dates[-1].strftime("%Y-%m-%d"),
        "stats": {
            "total_return_pct": round(100 * strat_return, 2),
            "cagr_pct": round(100 * ((1 + strat_return) ** (1 / years) - 1), 2),
            "max_drawdown_pct": round(100 * drawdown, 2),
            "buy_hold_return_pct": round(100 * bh_return, 2),
            "buy_hold_max_drawdown_pct": round(100 * bh_dd, 2),
            "trades": len(trades),
            "win_rate_pct": round(100 * len(wins) / len(trades), 1) if trades else None,
            "avg_win_pct": round(float(np.mean(wins)), 2) if wins else None,
            "avg_loss_pct": round(float(np.mean(losses)), 2) if losses else None,
            "profit_factor": round(gross_win / gross_loss, 2) if gross_loss > 0 else None,
            "avg_r": round(float(np.mean([tr["r_multiple"] for tr in trades])), 2) if trades else None,
            "exposure_pct": round(100 * in_market / max(n - warmup, 1), 1),
        },
        "equity": [{"date": d.strftime("%Y-%m-%d"), "strategy": round(float(v), 2), "buy_hold": round(float(bh_weekly.get(d, np.nan)), 2)}
                   for d, v in weekly.items()],
        "trades": trades,
        "open_trade": open_trade,
        "assumptions": {"start_equity": START_EQUITY, "cost_per_side_pct": cost * 100, "fills": "signals at close, fills at next open; stops and 4R intrabar"},
    }


def _held_on(trades, open_trade, date) -> bool:
    d = date.strftime("%Y-%m-%d")
    if open_trade and d >= open_trade["entry_date"]:
        return True
    return any(tr["entry_date"] <= d < tr["exit_date"] for tr in trades)
