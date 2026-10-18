"""Adapter regressions; --live also exercises public feeds, without any LLM key."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from datetime import datetime, timezone, timedelta
from email.utils import format_datetime

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "services" / "daily-stock-analysis"))
os.environ["PYTHON_DOTENV_DISABLED"] = "1"
from stock_strategy_data import history_frame, tencent_quote, us_history, us_financials
from stock_strategy_news import PublicNewsProvider


class Response:
    def __init__(self, text="", payload=None):
        self.text = text
        self.content = text.encode("gb18030")
        self.payload = payload

    def json(self):
        return self.payload

    def raise_for_status(self):
        pass


def quote_body(symbol="AMD.OQ"):
    values = [""] * 70
    for index, value in {1: "测试", 2: symbol, 3: "120", 4: "125", 5: "124", 6: "100",
                         30: datetime.now().strftime("%Y-%m-%d") + " 00:00:01", 31: "-5", 32: "-4",
                         33: "124", 34: "119", 35: "USD"}.items():
        values[index] = value
    return 'v_usAMD="' + "~".join(values) + '";'


class AdapterTests(unittest.TestCase):
    def setUp(self):
        tencent_quote.cache_clear()
        us_history.cache_clear()
        us_financials.cache_clear()

    def test_reject_wrong_instrument(self):
        with patch("stock_strategy_data.public_get", return_value=Response(quote_body("AAPL.OQ"))):
            with self.assertRaisesRegex(ValueError, "identity"):
                tencent_quote("AMD", 0)

    def test_valid_quote_preserves_zero_and_missing(self):
        with patch("stock_strategy_data.public_get", return_value=Response(quote_body())):
            quote, identity = tencent_quote("AMD", 0)
            self.assertEqual(identity, "AMD.OQ")
            self.assertEqual(quote.change_pct, -4)
            self.assertIsNone(quote.pe_ratio)
            self.assertTrue(quote.provider_timestamp.endswith("-04:00") or quote.provider_timestamp.endswith("-05:00"))

    def test_history_never_uses_unqualified_symbol(self):
        end = datetime.now().date().isoformat()
        def fake_get(url, **kwargs):
            if "qt.gtimg" in url:
                return Response(quote_body())
            self.assertIn("usAMD.OQ,", kwargs["params"]["param"])
            return Response(payload={"data": {"usAMD.OQ": {"qfqday": [[end, "124", "120", "124", "119", "100"]]}}})
        with patch("stock_strategy_data.public_get", side_effect=fake_get):
            frame, source = us_history("AMD", end, end, 0)
            self.assertEqual(frame.iloc[-1]["close"], 120)
            self.assertIn("Tencent", source)

    def test_reject_stale_history(self):
        with self.assertRaisesRegex(ValueError, "stale"):
            history_frame([{"date": "2011-01-01", "open": 1, "high": 2, "low": 1, "close": 2, "volume": 100}], "2026-01-01", "2026-01-05")

    def test_financial_identity_and_period_preserved(self):
        rows = [{"SECURITY_CODE": "OTHER", "REPORT_DATE": "2025-12-31", "OPERATE_INCOME": 999},
                {"SECURITY_CODE": "AMD", "REPORT_DATE": "2025-12-31", "START_DATE": "2025-01-01", "CURRENCY_ABBR": "USD", "OPERATE_INCOME": 100, "PARENT_HOLDER_NETPROFIT": 0}]
        with patch("stock_strategy_data.public_get", return_value=Response(payload={"result": {"data": rows}})):
            result = us_financials("AMD", 0)
            self.assertEqual(len(result), 1)
            self.assertEqual(result[0]["net_income"], 0)
            self.assertEqual(result[0]["period_start"], "2025-01-01")

    def test_news_filters_dates_deduplicates_and_has_no_model_auth(self):
        now = datetime.now(timezone.utc)
        items = "".join(f'<item><title>AMD {title}</title><link>{link}</link><pubDate>{format_datetime(date)}</pubDate><source>Test News</source></item>' for title, link, date in [
            ("earnings", "https://example.com/a", now), ("duplicate", "https://example.com/a", now),
            ("old", "https://example.com/b", now - timedelta(days=50)), ("future", "https://example.com/c", now + timedelta(days=2))])
        with patch("stock_strategy_news.requests.Session") as factory:
            session = factory.return_value.__enter__.return_value
            session.get.return_value = Response("<rss><channel>" + items + "</channel></rss>")
            result = PublicNewsProvider("Google", "http://127.0.0.1:7890").search("AMD", 5, 7)
            self.assertTrue(result.success)
            self.assertEqual(len(result.results), 1)
            self.assertEqual(result.results[0].source, "Test News")
            self.assertNotIn("Authorization", session.get.call_args.kwargs["headers"])
            self.assertFalse(session.trust_env)


def live_check():
    from concurrent.futures import ThreadPoolExecutor
    spec = importlib.util.spec_from_file_location("bridge", ROOT / "scripts" / "stock-strategy-worker.py")
    bridge = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bridge)
    with tempfile.TemporaryDirectory(prefix="sparkflow-data-check-", ignore_cleanup_errors=True) as directory:
        bridge.configure({"dataDir": directory, "ai": {"apiKey": "unused-public-data-test", "baseUrl": "http://127.0.0.1:1/v1", "model": "unused", "useProxy": False}, "proxyUrl": "http://127.0.0.1:7890"})
        from data_provider import DataFetcherManager
        from src.search_service import get_search_service
        from src.agent.tools.data_tools import _handle_get_daily_history, _handle_get_realtime_quote
        manager = DataFetcherManager()
        news = get_search_service()
        assert news.is_available
        def inspect(kind):
            if kind == "quote":
                item = _handle_get_realtime_quote("AMD")
                assert item.get("price", 0) > 0, item
                return {key: item.get(key) for key in ("code", "price", "source", "provider_timestamp")}
            if kind == "history":
                frame, source = manager.get_daily_data("AMD", days=180)
                assert len(frame) > 100, len(frame)
                return {"rows": len(frame), "source": source, "latest": str(frame.date.max()), "ma20": float(frame.iloc[-1].ma20)}
            if kind == "fundamentals":
                data = manager.get_fundamental_context("AMD")
                assert data["earnings"]["status"] == "ok", data["coverage"]
                return {"coverage": data["coverage"], "period": data["earnings"]["data"]["reports"][0]["period_end"]}
            if kind == "indices":
                data = manager.get_main_indices(region="us")
                assert len(data) == 3
                return [{"code": item["code"], "price": item["price"]} for item in data]
            symbol, name = ("AMD", "AMD") if kind == "news_us" else ("000001", "平安银行")
            data = news.search_stock_news(symbol, name)
            assert data.success and data.results, {"provider": data.provider, "error": data.error_message}
            return {"provider": data.provider, "count": len(data.results), "first": data.results[0].title, "published": data.results[0].published_date}
        with ThreadPoolExecutor(max_workers=4) as executor:
            kinds = ["quote", "history", "fundamentals", "indices", "news_us", "news_cn"]
            for kind, result in zip(kinds, executor.map(inspect, kinds)):
                print(json.dumps({"check": kind, "result": result}, ensure_ascii=False), flush=True)
        os.chdir(ROOT)


if __name__ == "__main__":
    if "--live" in sys.argv:
        live_check()
    else:
        unittest.main()
