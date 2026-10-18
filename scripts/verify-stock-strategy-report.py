"""Real upstream analyzer + report mapping; synthetic inputs and local LLM only."""
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location("bridge", Path(__file__).with_name("stock-strategy-worker.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
payload = json.load(sys.stdin)
with open(os.devnull, "w", encoding="utf-8") as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
    config = bridge.configure(payload)
    config.gemini_request_delay = 0
    from src.analyzer import GeminiAnalyzer
    from src.services.analysis_service import AnalysisService
    analyzer = GeminiAnalyzer(config=config)
    assert analyzer.is_available(), "Configured model was not available to the report analyzer"
    result = analyzer.analyze({
        "code": "AAPL", "stock_name": "测试公司", "date": "2026-10-18",
        "today": {"close": 200, "open": 202, "high": 205, "low": 198, "pct_chg": -1.2,
                  "volume": 100000, "amount": 20000000, "ma5": 195, "ma10": 190, "ma20": 185},
        "ma_status": "多头排列",
    }, news_context="仅用于本地测试的新闻资料。")
    assert result.success, result.error_message
    report = AnalysisService()._build_analysis_response(result, "local-report-test")
print(json.dumps(report, ensure_ascii=False, default=str))
