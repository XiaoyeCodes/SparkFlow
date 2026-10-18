"""SparkFlow's public US-data adapters. The vendored DSA engine stays unmodified."""
from datetime import datetime, timedelta, timezone
from functools import lru_cache
import json
import math
import re
import time
from zoneinfo import ZoneInfo

import pandas as pd
import requests
from data_provider.base import BaseFetcher
from data_provider.realtime_types import UnifiedRealtimeQuote, RealtimeSource
from data_provider.us_index_mapping import is_us_stock_code


def public_get(url, **kwargs):
    with requests.Session() as session:
        session.trust_env = False
        response = session.get(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://finance.sina.com.cn/"},
                               timeout=(3, 7), **kwargs)
        response.raise_for_status()
        return response


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


@lru_cache(maxsize=64)
def tencent_quote(symbol, bucket):
    raw = public_get("https://qt.gtimg.cn/q=" + "us" + symbol).content.decode("gb18030", errors="replace")
    match = re.search(r'="([^"\r\n]+)"', raw)
    parts = match.group(1).split("~") if match else []
    is_index = symbol in ("DJI", "IXIC", "INX")
    identity = ("." + symbol) if is_index else symbol
    if len(parts) < 50 or re.sub(r"\.(OQ|N|O|AM)$", "", parts[2]) != identity or parts[35] != "USD":
        raise ValueError("Tencent quote identity mismatch")
    price = number(parts[3])
    if not price or price <= 0:
        raise ValueError("Tencent quote has no valid price")
    stamp = datetime.strptime(parts[30], "%Y-%m-%d %H:%M:%S").replace(tzinfo=ZoneInfo("America/New_York"))
    now = datetime.now(timezone.utc)
    age = int((now - stamp).total_seconds())
    if age < -600 or age > 10 * 86400:
        raise ValueError("Tencent quote is outside the usable time window")
    quote = UnifiedRealtimeQuote(
        code=symbol, name=parts[1] or symbol, source=RealtimeSource.TENCENT,
        fetched_at=now.isoformat(), provider_timestamp=stamp.isoformat(), market="us", currency="USD",
        is_stale=age > 900, stale_seconds=max(0, age), data_quality="partial",
        missing_fields=["pe_ratio", "pb_ratio"], price=price, pre_close=number(parts[4]),
        open_price=number(parts[5]), volume=number(parts[6]), change_amount=number(parts[31]),
        change_pct=number(parts[32]), high=number(parts[33]), low=number(parts[34]),
        amount=None if is_index else number(parts[37]), high_52w=number(parts[48]), low_52w=number(parts[49]),
    )
    return quote, parts[2]


def history_frame(rows, start, end):
    frame = pd.DataFrame(rows)
    if frame.empty:
        raise ValueError("No historical bars returned")
    frame = BaseFetcher._clean_data(None, frame).drop_duplicates("date", keep="last")
    frame = frame.loc[(frame.date <= pd.Timestamp(end)) & (frame.date >= pd.Timestamp(start) - pd.Timedelta(days=90))]
    numeric = frame[["open", "high", "low", "close", "volume"]]
    valid = numeric.notna().all(axis=1) & numeric.apply(lambda column: column.map(math.isfinite)).all(axis=1)
    valid &= (frame[["open", "high", "low", "close"]] > 0).all(axis=1) & (frame.volume >= 0)
    valid &= (frame.high >= frame[["open", "close", "low"]].max(axis=1)) & (frame.low <= frame[["open", "close", "high"]].min(axis=1))
    frame = frame.loc[valid].copy()
    if frame.empty or (pd.Timestamp(end) - frame.date.max()).days > 10:
        raise ValueError("Historical feed is stale or invalid")
    frame["amount"] = float("nan")  # Provider does not expose turnover; never synthesize it.
    frame["pct_chg"] = frame.close.pct_change() * 100
    frame = BaseFetcher._calculate_indicators(None, frame)
    frame = frame.loc[frame.date >= pd.Timestamp(start)].reset_index(drop=True)
    if frame.empty:
        raise ValueError("No historical bars in requested range")
    return frame


@lru_cache(maxsize=32)
def us_history(symbol, start, end, bucket):
    try:
        _, qualified = tencent_quote(symbol, bucket)
        # Unqualified usAMD can return a different, long-delisted security.
        key = "us" + qualified
        payload = public_get("https://web.ifzq.gtimg.cn/appstock/app/usfqkline/get",
                             params={"param": f"{key},day,,,640,qfq"}).json()
        rows = payload["data"][key]["qfqday"]
        frame = history_frame([dict(zip(["date", "open", "close", "high", "low", "volume"], row[:6])) for row in rows], start, end)
        return frame, "Tencent US (前复权)"
    except (requests.RequestException, ValueError, KeyError, TypeError):
        raw = public_get("https://stock.finance.sina.com.cn/usstock/api/jsonp_v2.php/var%20x=/US_MinKService.getDailyK",
                         params={"symbol": symbol}).text
        match = re.search(r"\((\[.*\])\)\s*;?\s*$", raw, re.S)
        if not match:
            raise ValueError("Sina historical response is not valid JSONP")
        data = json.loads(match.group(1))
        rows = [{"date": row.get("d"), "open": row.get("o"), "close": row.get("c"),
                 "high": row.get("h"), "low": row.get("l"), "volume": row.get("v")} for row in data]
        return history_frame(rows, start, end), "Sina US (日线；复权口径未声明)"


@lru_cache(maxsize=32)
def us_financials(symbol, bucket):
    payload = public_get("https://datacenter.eastmoney.com/securities/api/data/v1/get", params={
        "reportName": "RPT_USF10_FN_GMAININDICATOR", "columns": "ALL",
        "filter": f'(SECURITY_CODE="{symbol}")', "sortColumns": "REPORT_DATE", "sortTypes": "-1", "pageSize": 8,
    }).json()
    rows = (payload.get("result") or {}).get("data") or []
    fields = {
        "REPORT_DATE": "period_end", "START_DATE": "period_start", "REPORT_TYPE": "report_type",
        "CURRENCY_ABBR": "currency", "OPERATE_INCOME": "revenue", "OPERATE_INCOME_YOY": "revenue_yoy_pct",
        "PARENT_HOLDER_NETPROFIT": "net_income", "PARENT_HOLDER_NETPROFIT_YOY": "net_income_yoy_pct",
        "DILUTED_EPS": "diluted_eps", "GROSS_PROFIT_RATIO": "gross_margin_pct",
        "NET_PROFIT_RATIO": "net_margin_pct", "ROE_AVG": "roe_pct", "DEBT_ASSET_RATIO": "debt_asset_pct",
    }
    result = []
    for row in rows:
        if row.get("SECURITY_CODE") != symbol or not row.get("REPORT_DATE"):
            continue
        if row["REPORT_DATE"][:10] > datetime.now(timezone.utc).date().isoformat():
            continue
        record = {label: row[key] for key, label in fields.items() if row.get(key) is not None}
        if any(key in record for key in ("revenue", "net_income", "diluted_eps")):
            result.append(record)
    if not result:
        raise ValueError("No matching financial reports")
    return result


def is_us_request(code, target):
    if target is not None and target.raw_input != (code or "").strip():
        raise ValueError("Data identity does not match the requested code")
    return is_us_stock_code(code)


def install_data_adapter():
    import data_provider
    import data_provider.base as base
    if getattr(data_provider.DataFetcherManager, "_sparkflow_public_data", False):
        return
    original = data_provider.DataFetcherManager

    class SparkFlowDataManager(original):
        _sparkflow_public_data = True

        def get_main_indices(self, region="cn"):
            if region == "us":
                rows = []
                for symbol, code in (("DJI", "^DJI"), ("IXIC", "^IXIC"), ("INX", "^GSPC")):
                    try:
                        quote, _ = tencent_quote(symbol, int(time.time() // 300))
                        rows.append({**quote.to_dict(), "code": code, "current": quote.price, "change": quote.change_amount})
                    except (requests.RequestException, ValueError, KeyError):
                        continue
                if rows:
                    return rows
            return super().get_main_indices(region=region)

        def get_realtime_quote(self, stock_code, *, log_final_failure=True, analysis_target=None):
            if is_us_request(stock_code, analysis_target):
                try:
                    quote, _ = tencent_quote(stock_code.upper(), int(time.time() // 300))
                    return quote
                except (requests.RequestException, ValueError, KeyError):
                    pass
            return super().get_realtime_quote(stock_code, log_final_failure=log_final_failure, analysis_target=analysis_target)

        def get_daily_data(self, stock_code, start_date=None, end_date=None, days=30, *, analysis_target=None):
            if is_us_request(stock_code, analysis_target):
                end = end_date or datetime.now(timezone.utc).date().isoformat()
                # DSA's days parameter is a trading-day target; match its 2x
                # calendar buffer so a 120-day tool call has at least 120 bars.
                start = start_date or (pd.Timestamp(end) - pd.Timedelta(days=max(1, days) * 2)).date().isoformat()
                try:
                    frame, source = us_history(stock_code.upper(), str(start), str(end), int(time.time() // 300))
                    return frame.copy(), source
                except (requests.RequestException, ValueError, KeyError, TypeError):
                    pass
            return super().get_daily_data(stock_code, start_date, end_date, days, analysis_target=analysis_target)

        def get_fundamental_context(self, stock_code, budget_seconds=None, *, analysis_target=None):
            if not is_us_request(stock_code, analysis_target):
                return super().get_fundamental_context(stock_code, budget_seconds, analysis_target=analysis_target)
            try:
                rows = us_financials(stock_code.upper(), int(time.time() // 300))
            except (requests.RequestException, ValueError, KeyError, TypeError):
                return super().get_fundamental_context(stock_code, budget_seconds, analysis_target=analysis_target)
            source = [{"provider": "Eastmoney US financial reports", "result": "ok"}]
            result = {"market": "us", "provider": "Eastmoney", "as_of": datetime.now(timezone.utc).isoformat(),
                      "status": "partial", "data_quality": "partial", "source_chain": source, "errors": [], "belong_boards": []}
            for key in ("valuation", "growth", "earnings", "institution", "capital_flow", "dragon_tiger", "boards"):
                if key in ("growth", "earnings"):
                    payload = {"reports": rows, "note": "金额单位依 currency；同比单位 %。按 period_start/end 区分单季与累计，不混合计算。"}
                    result[key] = self._build_fundamental_block("ok", payload, source)
                else:
                    status = "not_supported" if key in ("dragon_tiger", "capital_flow", "boards") else "unavailable"
                    result[key] = self._build_fundamental_block(status, {}, [], ["此数据源未提供该项；不可据此推算"])
            result["coverage"] = {key: result[key]["status"] for key in ("valuation", "growth", "earnings", "institution", "capital_flow", "dragon_tiger", "boards")}
            result["missing_fields"] = [key for key, status in result["coverage"].items() if status != "ok"]
            return result

    data_provider.DataFetcherManager = base.DataFetcherManager = SparkFlowDataManager
    # Upstream's compact quote tool drops freshness fields. Carry them through so
    # a weekend close cannot be described by the agent as a live intraday quote.
    from src.agent.tools import data_tools
    original_quote_tool = data_tools._handle_get_realtime_quote

    def quote_with_freshness(stock_code):
        result = original_quote_tool(stock_code)
        if result.get("source") == "tencent" and is_us_stock_code(stock_code):
            quote, _ = tencent_quote(stock_code.upper(), int(time.time() // 300))
            for key in ("provider_timestamp", "fetched_at", "is_stale", "stale_seconds", "currency", "data_quality", "missing_fields"):
                result[key] = getattr(quote, key)
            result["note"] = "公开行情可能延迟；按 provider_timestamp 标明报价时间，休市报价不是当前盘中成交。"
        return result

    data_tools._handle_get_realtime_quote = quote_with_freshness
    data_tools.get_realtime_quote_tool.handler = quote_with_freshness
