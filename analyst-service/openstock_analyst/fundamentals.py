"""Company fundamentals from SEC EDGAR via edgartools: annual statements, insider trades, filings."""

import os
from datetime import date, timedelta

# edgartools' own getters pick the right line per company (a raw statement row can be a sub-total)
METRICS = [
    ("revenue", "Revenue", "get_revenue"),
    ("operating_income", "Operating income", "get_operating_income"),
    ("net_income", "Net income", "get_net_income"),
    ("operating_cash_flow", "Operating cash flow", "get_operating_cash_flow"),
    ("capital_expenditures", "Capital expenditure", "get_capital_expenditures"),
    ("free_cash_flow", "Free cash flow", "get_free_cash_flow"),
    ("total_assets", "Total assets", "get_total_assets"),
    ("total_liabilities", "Total liabilities", "get_total_liabilities"),
    ("stockholders_equity", "Shareholders' equity", "get_stockholders_equity"),
    ("diluted_shares", "Diluted shares", "get_shares_outstanding_diluted"),
]
YEARS = 3
MARKET_ACTIVITIES = {"Purchase": "buy", "Sale": "sell"}
INSIDER_DAYS = 180
INSIDER_LIMIT = 15


def _identity() -> str:
    # The SEC asks every client to identify itself with a contact address
    return os.environ.get("SEC_IDENTITY") or "Apex Tradebook research@tradebook-by-nexus.app"


def _periods(financials) -> list[str]:
    try:
        cols = [c for c in financials.income_statement().to_dataframe().columns if c.endswith("(FY)")]
        return [c.split(" ")[0] for c in cols[:YEARS]]
    except Exception:
        return []


def _num(v):
    return None if v is None or v != v else float(v)


def get_fundamentals(ticker: str) -> dict:
    from edgar import Company, set_identity

    set_identity(_identity())
    company = Company(ticker)
    if getattr(company, "not_found", False) or not getattr(company, "cik", None):
        raise LookupError(f"{ticker} is not an SEC registrant")
    financials = company.get_financials()
    if financials is None:
        raise LookupError(f"No annual financials filed for {ticker}")

    lines, by_key = [], {}
    for key, label, getter in METRICS:
        try:
            values = [_num(getattr(financials, getter)(period_offset=i)) for i in range(YEARS)]
        except Exception:
            continue
        if any(v is not None for v in values):
            by_key[key] = values
            lines.append({"key": key, "label": label, "values": values})

    def margin(key):
        num, rev = by_key.get(key), by_key.get("revenue")
        if not num or not rev:
            return None
        return [round(a / b * 100, 1) if a is not None and b else None for a, b in zip(num, rev)]

    rev = by_key.get("revenue")
    growth = [round((rev[i] / rev[i + 1] - 1) * 100, 1) if rev[i] and rev[i + 1] else None
              for i in range(YEARS - 1)] if rev else None

    return {
        "ticker": ticker,
        "name": company.name,
        "cik": int(company.cik),
        "industry": getattr(company, "industry", None),
        "periods": _periods(financials),
        "lines": lines,
        "derived": {
            "operating_margin_pct": margin("operating_income"),
            "net_margin_pct": margin("net_income"),
            "fcf_margin_pct": margin("free_cash_flow"),
            "revenue_growth_pct": growth,
        },
        "filings": _filings(company),
        "insiders": _insiders(company),
    }


def _filings(company) -> list[dict]:
    out = []
    for filing in company.get_filings(form=["10-K", "10-Q", "8-K"]).head(8):
        out.append({"form": filing.form, "date": str(filing.filing_date), "url": filing.homepage_url})
    return out


def _insiders(company) -> dict:
    """Open-market buys and sells by officers and directors (grants, gifts and exercises are skipped)."""
    since = date.today() - timedelta(days=INSIDER_DAYS)
    trades, bought, sold, scanned = [], 0.0, 0.0, 0
    for filing in company.get_filings(form="4").head(30):
        if filing.filing_date < since or len(trades) >= INSIDER_LIMIT:
            break
        scanned += 1
        try:
            summary = filing.obj().get_ownership_summary()
        except Exception:  # an unparseable filing shouldn't sink the panel
            continue
        side = MARKET_ACTIVITIES.get(summary.primary_activity)
        if not side:
            continue
        value = abs(float(summary.net_value or 0))
        if side == "buy":
            bought += value
        else:
            sold += value
        trades.append({
            "date": str(summary.reporting_date),
            "name": summary.insider_name,
            "position": summary.position,
            "side": side,
            "shares": abs(float(summary.net_change or 0)),
            "value": value,
            "planned": bool(summary.has_10b5_1_plan),
            "url": filing.homepage_url,
        })
    return {"days": INSIDER_DAYS, "filings_scanned": scanned, "bought_value": round(bought), "sold_value": round(sold), "trades": trades}
