"""Read-only index prices and 10-year daily bars from the user's local IBKR API.

No account synchronization, orders, regulatory snapshots, or substitute tickers.
Completed calendar-year chunks survive process restarts; a cold load is bounded
and subsequent refreshes resume any incomplete historical download.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import socket
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".sparkflow" / "valuation" / "ibkr-history"
CONTRACTS = {"vix": ("VIX", "CBOE"), "spx": ("SPX", "CBOE"), "ndx": ("NDX", "NASDAQ")}
SOURCE_URL = "https://www.interactivebrokers.com/docs/tws-api/doc/market-data-historical/historical-bars/requesting-historical-bars"
ENTITLEMENT_CODES = {354, 10089, 10090, 10091, 10167, 10168, 10186, 10197}
logging.disable(logging.CRITICAL)


def positive(value: Any) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) and 0 < number < 1e9 else None
    except (ValueError, TypeError):
        return None


def unavailable(key: str, note: str, points: list | None = None) -> dict:
    rows = points or []
    latest = rows[-1] if rows else None
    return dict(points=rows, current=latest["value"] if latest else None,
                asOf=latest["date"] if latest else None,
                source=f"IBKR · {CONTRACTS[key][0]} IND · {CONTRACTS[key][1]}",
                sourceUrl=SOURCE_URL, status="stale" if latest else "missing", note=note)


def cache_read(key: str) -> dict:
    try:
        data = json.loads((CACHE / f"{key}.json").read_text(encoding="utf-8"))
        return data if data.get("version") == 1 and isinstance(data.get("chunks"), dict) else {"version": 1, "chunks": {}}
    except (OSError, ValueError, AttributeError):
        return {"version": 1, "chunks": {}}


def cache_write(key: str, data: dict) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    target = CACHE / f"{key}.json"
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    temporary.replace(target)


def cache_points(data: dict) -> list[dict]:
    cutoff = (datetime.now(timezone.utc).date() - timedelta(days=3653 + 10)).isoformat()
    today = datetime.now(timezone.utc).date().isoformat()
    unique = {}
    for chunk in data["chunks"].values():
        for row in chunk.get("points", []):
            if isinstance(row, dict) and isinstance(row.get("date"), str) and cutoff <= row["date"] <= today and positive(row.get("value")):
                unique[row["date"]] = {"date": row["date"], "value": float(row["value"])}
    return [unique[stamp] for stamp in sorted(unique)]


def connection_settings() -> tuple[str, int, int]:
    # A dedicated local market-data endpoint may override the existing paper bridge.
    host = os.environ.get("SPARKFLOW_VALUATION_IBKR_HOST", "127.0.0.1")
    configured_port = os.environ.get("SPARKFLOW_VALUATION_IBKR_PORT")
    port = int(configured_port or "4002")
    client_id = int(os.environ.get("SPARKFLOW_VALUATION_IBKR_CLIENT_ID", "179"))
    if host not in {"127.0.0.1", "localhost", "::1"} or not 1 <= port <= 65535 or not 1 <= client_id < 2**31:
        raise ValueError("INVALID_LOCAL_MARKET_DATA_CONFIG")
    if not configured_port:
        for candidate in (4002, 4001, 7497, 7496):
            try:
                with socket.create_connection((host, candidate), timeout=0.2):
                    port = candidate
                    break
            except OSError:
                continue
    return host, port, client_id


async def read_snapshot() -> dict:
    captured = datetime.now(timezone.utc).isoformat()
    cache = {key: cache_read(key) for key in CONTRACTS}
    series = {key: unavailable(key, "IBKR 行情连接尚未完成", cache_points(cache[key])) for key in CONTRACTS}
    try:
        from ib_async import IB, Index, StartupFetch
    except ImportError:
        for item in series.values():
            item["note"] = "缺少 ib_async 行情依赖"
        return {"fetchedAt": captured, "series": series}

    ib = IB()
    issues: dict[str, set[int]] = {key: set() for key in CONTRACTS}

    def on_error(_request_id, code, _message, contract=None, *_args):
        symbol = getattr(contract, "symbol", "")
        for key, (expected, _) in CONTRACTS.items():
            if symbol == expected and (code in ENTITLEMENT_CODES or code in {162, 165, 166, 200, 321, 366, 420}):
                issues[key].add(code)

    ib.errorEvent += on_error
    port = 4002
    try:
        host, port, client_id = connection_settings()
        await ib.connectAsync(host, port, clientId=client_id, timeout=5,
                              readonly=True, fetchFields=StartupFetch(0))
        limiter = asyncio.Semaphore(2)

        async def instrument(key: str):
            symbol, exchange = CONTRACTS[key]
            try:
                qualified = await asyncio.wait_for(ib.qualifyContractsAsync(Index(symbol, exchange, "USD")), 5)
                if len(qualified) != 1 or qualified[0].secType != "IND" or qualified[0].symbol != symbol:
                    series[key]["note"] = "IBKR 指数合约未能唯一确认"
                    return
                contract = qualified[0]
            except Exception:
                series[key]["note"] = "IBKR 指数合约确认超时或不可用"
                return

            # Type 3 permits delayed data; IBKR returns type 1 automatically when
            # this index's live subscription is available. Neither buys a snapshot.
            ib.reqMarketDataType(3)
            ticker = ib.reqMktData(contract, "", False, False)
            observed_quote: dict = {}

            async def quote():
                try:
                    await asyncio.sleep(4)
                    price = positive(ticker.last)
                    if price is not None:
                        kind = {1: "live", 2: "frozen", 3: "delayed", 4: "frozen"}.get(ticker.marketDataType, "snapshot")
                        stamp = getattr(ticker, "rtTime", None)
                        exchange_time = isinstance(stamp, datetime) and stamp.tzinfo is not None
                        if not exchange_time:
                            stamp = ticker.time if isinstance(ticker.time, datetime) else None
                        observed_quote.update(current=price, status=kind, asOf=stamp.isoformat() if stamp else None,
                                              quote_note=("券商成交时间" if exchange_time else "时间为 IBKR 报价接收时间，未提供成交时间")
                                              + ("；延迟冻结行情" if ticker.marketDataType == 4 else ""))
                finally:
                    ib.cancelMktData(contract)

            async def history():
                today = datetime.now(timezone.utc).date()
                # One year / one day respects IBKR duration / bar-size guidance.
                # Newest chunks first make a partially warmed cache useful.
                for year in range(today.year, today.year - 11, -1):
                    chunk_key = str(year)
                    saved = cache[key]["chunks"].get(chunk_key, {})
                    ttl = 3600 if year == today.year else 30 * 86400
                    if not saved.get("points"):
                        ttl = 120
                    if time.time() - saved.get("at", 0) < ttl:
                        continue
                    end = "" if year == today.year else datetime(year + 1, 1, 1, tzinfo=timezone.utc)
                    async with limiter:
                        try:
                            bars = await ib.reqHistoricalDataAsync(contract, endDateTime=end, durationStr="1 Y",
                                barSizeSetting="1 day", whatToShow="TRADES", useRTH=True, formatDate=1,
                                keepUpToDate=False, timeout=7)
                            rows = []
                            for bar in bars:
                                stamp = bar.date.date() if isinstance(bar.date, datetime) else bar.date
                                value = positive(bar.close)
                                if isinstance(stamp, date) and value is not None and stamp <= today:
                                    rows.append({"date": stamp.isoformat(), "value": value})
                            cache[key]["chunks"][chunk_key] = {"at": time.time(), "points": rows or saved.get("points", [])}
                            cache_write(key, cache[key])
                            if not rows:
                                break  # No entitlement / no history: do not issue ten failing requests.
                        except asyncio.CancelledError:
                            raise
                        except Exception:
                            break
                    await asyncio.sleep(0.3)

            tasks = [asyncio.create_task(quote()), asyncio.create_task(history())]
            try:
                await asyncio.gather(*tasks)
            finally:
                for task in tasks:
                    if not task.done():
                        task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                points = cache_points(cache[key])
                note = f"IND 指数；本机 API {port} 只读；IBKR 日收盘历史 {len(points)} 条"
                if points:
                    note += f"（{points[0]['date']} 至 {points[-1]['date']}）"
                if issues[key]:
                    note += "；IBKR 错误码 " + ", ".join(map(str, sorted(issues[key])))
                if any(code in ENTITLEMENT_CODES for code in issues[key]):
                    note += "，需核对该指数 API 行情订阅"
                item = unavailable(key, note, points)
                if observed_quote:
                    quote_note = observed_quote.pop("quote_note")
                    item.update(observed_quote)
                    item["note"] += "；" + quote_note
                elif points:
                    item["status"] = "close" if (datetime.now(timezone.utc).date() - date.fromisoformat(points[-1]["date"])).days <= 7 else "stale"
                    item["note"] += "；实时价未返回，当前值使用 IBKR 最近历史日收盘"
                else:
                    item["note"] += "；未返回指数行情，请检查 Gateway 连接及订阅权限"
                series[key] = item

        tasks = [asyncio.create_task(instrument(key)) for key in CONTRACTS]
        try:
            await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), timeout=18)
        except asyncio.TimeoutError:
            for item in series.values():
                item["note"] += "；本次历史同步达到时限，后续刷新续传"
    except Exception as exc:
        code = "连接超时" if isinstance(exc, (asyncio.TimeoutError, TimeoutError)) else "连接不可用"
        for item in series.values():
            item["note"] = f"IBKR {code}；请确认本机 Gateway / TWS 已登录并开启 Socket API（当前 {port}）"
    finally:
        ib.disconnect()
    return {"fetchedAt": datetime.now(timezone.utc).isoformat(), "series": series}


if __name__ == "__main__":
    print(json.dumps(asyncio.run(read_snapshot()), ensure_ascii=False, allow_nan=False))
