"""One isolated DSA task. Private configuration arrives on stdin, never argv."""
import contextlib
import json
import logging
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
ENGINE = ROOT / "services" / "daily-stock-analysis"
sys.path.insert(0, str(ENGINE))
WIRE = sys.stdout


def emit(kind, **payload):
    WIRE.write(json.dumps({"type": kind, **payload}, ensure_ascii=False, default=str) + "\n")
    WIRE.flush()


def configure(payload):
    ai = payload["ai"]
    data = Path(payload["dataDir"]).resolve()
    data.mkdir(parents=True, exist_ok=True)
    # Do not import any upstream module before disabling dotenv and ambient keys.
    keep = {key: value for key, value in os.environ.items() if key.upper() in {
        "PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE",
        "LOCALAPPDATA", "APPDATA", "PROGRAMDATA", "SSL_CERT_FILE", "SSL_CERT_DIR",
    }}
    os.environ.clear()
    os.environ.update(keep)
    os.environ.update({
        "ENV_FILE": str(data / ".disabled-env"), "PYTHON_DOTENV_DISABLED": "1",
        "DATABASE_PATH": str(data / "stock-analysis.db"),
        "LOG_DIR": str(data / "logs"), "REPORT_LANGUAGE": "zh",
        "OPENAI_API_KEY": ai["apiKey"], "OPENAI_BASE_URL": ai["baseUrl"],
        "OPENAI_MODEL": ai["model"], "LITELLM_MODEL": "openai/" + ai["model"].removeprefix("openai/"),
        "LITELLM_FALLBACK_MODELS": "", "AGENT_MODE": "false",
        "AGENT_SKILL_DIR": str(ENGINE / "strategies"),
        "AGENT_MAX_STEPS": "12",
        "MAX_WORKERS": "1", "SCHEDULE_ENABLED": "false",
        "SINGLE_STOCK_NOTIFY": "false", "NEWS_LANGUAGE": "zh",
        "NEWS_STRATEGY_PROFILE": "medium", "NEWS_MAX_AGE_DAYS": "7",
        "NO_PROXY": "localhost,127.0.0.1,::1",
        "LITELLM_LOCAL_MODEL_COST_MAP": "True",
        "LITELLM_LOCAL_ANTHROPIC_BETA_HEADERS": "True",
        "TIKTOKEN_CACHE_DIR": str(ENGINE / ".venv" / "tiktoken-cache"),
    })
    if ai.get("useProxy"):
        os.environ["HTTP_PROXY"] = os.environ["HTTPS_PROXY"] = payload["proxyUrl"]
    os.chdir(data)
    # Silence third-party logging: raw provider exceptions can contain credentials.
    logging.disable(logging.CRITICAL)
    from src.config import get_config
    config = get_config()
    # Explicit routing preserves slash-containing OpenAI-compatible model names.
    config.litellm_model = "sparkflow"
    config.litellm_fallback_models = []
    config.llm_model_list = [{"model_name": "sparkflow", "litellm_params": {
        "model": "openai/" + ai["model"].removeprefix("openai/"),
        "api_key": ai["apiKey"], "api_base": ai["baseUrl"], "timeout": 120,
    }}]
    from stock_strategy_data import install_data_adapter
    from stock_strategy_news import install_news_adapter
    install_data_adapter()
    install_news_adapter(payload.get("proxyUrl", ""))
    return config


def execute(payload):
    config = configure(payload)
    from src.services.analysis_service import AnalysisService
    from src.agent.factory import build_agent_executor
    if payload.get("check"):
        from src.core.pipeline import StockAnalysisPipeline
        from src.agent.factory import get_skill_manager
        emit("result", result={"ready": True, "strategies": len(get_skill_manager(config).list_skills())})
        return
    emit("progress", progress=8, message="研究引擎已就绪，正在收集数据")
    if payload["mode"] == "chat":
        executor = build_agent_executor(config, skills=payload["strategies"] or None)
        previous = payload.get("previousReport") or {}
        meta = previous.get("meta") or {}
        result = executor.chat(
            message=payload["question"], session_id=payload["sessionId"],
            context={"stock_code": payload["symbol"], "report_language": "zh",
                     "stock_name": meta.get("stock_name"), "previous_price": meta.get("current_price"),
                     "previous_analysis_summary": previous.get("summary"),
                     "previous_strategy": previous.get("strategy")},
        )
        if not result.success:
            raise RuntimeError(result.error or "策略问答未完成")
        emit("result", result={"content": result.content})
    else:
        service = AnalysisService()
        result = service.analyze_stock(
            stock_code=payload["symbol"], report_type="detailed", query_id=payload["id"],
            send_notification=False, skills=payload["strategies"] or None,
            query_source="sparkflow", report_language="zh",
            progress_callback=lambda percent, message: emit("progress", progress=percent, message=message),
        )
        if result is None:
            raise RuntimeError(service.last_error or "未取得可用分析结果，请稍后重试")
        emit("result", result=result)


if __name__ == "__main__":
    payload = json.load(sys.stdin)
    try:
        # Provider print statements must not corrupt our JSON-lines protocol.
        with open(os.devnull, "w", encoding="utf-8") as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            execute(payload)
    except Exception as exc:
        message = str(exc).replace(payload.get("ai", {}).get("apiKey") or "\0", "[redacted]")
        emit("error", message=message[:800])
        sys.exit(1)
