from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pandas as pd
import requests
import yfinance as yf


ROOT = Path(__file__).resolve().parent
INPUTS = ROOT / "inputs"
SNAPSHOT_URL = "http://127.0.0.1:5180/api/ibkr-valuation/snapshot"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    INPUTS.mkdir(parents=True, exist_ok=True)
    response = requests.get(SNAPSHOT_URL, timeout=180)
    response.raise_for_status()
    snapshot = response.json()["windows"]["10"]
    valuation_inputs = snapshot["audit"]["inputs"]

    pe_rows: list[dict[str, object]] = []
    for series_id, ticker in (("pe", "SPY"), ("qqqPe", "QQQ")):
        series = valuation_inputs["series"][series_id]
        for point in series["points"]:
            pe_rows.append({
                "date": point["date"],
                "ticker": ticker,
                "pe": point["value"],
                "source": series["source"],
                "source_url": series["sourceUrl"],
                "snapshot_fetched_at": valuation_inputs["fetchedAt"],
            })
    pe = pd.DataFrame(pe_rows)
    pe["date"] = pd.to_datetime(pe["date"])
    pe = pe.sort_values(["ticker", "date"]).reset_index(drop=True)
    assert not pe.duplicated(["ticker", "date"]).any()
    assert pe["pe"].notna().all() and (pe["pe"] > 0).all()

    start = (pe["date"].min() - pd.Timedelta(days=40)).strftime("%Y-%m-%d")
    end = (pe["date"].max() + pd.Timedelta(days=3)).strftime("%Y-%m-%d")
    raw = yf.download(["SPY", "QQQ"], start=start, end=end, auto_adjust=False,
                      actions=True, progress=False, threads=False)
    adjusted = raw["Adj Close"].rename_axis(index="date", columns="ticker").reset_index()
    adjusted.columns.name = None
    adjusted = adjusted[["date", "SPY", "QQQ"]].dropna(how="all", subset=["SPY", "QQQ"])
    assert adjusted["date"].is_monotonic_increasing and not adjusted["date"].duplicated().any()
    assert adjusted[["SPY", "QQQ"]].notna().all().all()

    pe_path = INPUTS / "pe_history.csv"
    price_path = INPUTS / "etf_adjusted_close.csv"
    pe.to_csv(pe_path, index=False, date_format="%Y-%m-%d")
    adjusted.to_csv(price_path, index=False, date_format="%Y-%m-%d")
    manifest = {
        "created_at": pd.Timestamp.now(tz="UTC").isoformat(),
        "valuation_snapshot_fetched_at": valuation_inputs["fetchedAt"],
        "pe": {
            "rows": len(pe), "first": pe["date"].min().date().isoformat(),
            "last": pe["date"].max().date().isoformat(), "sha256": sha256(pe_path),
            "sources": sorted(pe["source"].unique().tolist()),
            "source_urls": sorted(pe["source_url"].unique().tolist()),
        },
        "prices": {
            "rows": len(adjusted), "first": adjusted["date"].min().date().isoformat(),
            "last": adjusted["date"].max().date().isoformat(), "sha256": sha256(price_path),
            "source": "Yahoo Finance via yfinance; adjusted close includes splits and cash distributions",
            "source_urls": ["https://finance.yahoo.com/quote/SPY/history/", "https://finance.yahoo.com/quote/QQQ/history/"],
        },
    }
    (INPUTS / "source_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
