"""SparkFlow 个股研报生成器。

调用 Coze 项目域名的 /run 接口，向 stdout 输出完整研报文本。
stdout 只用于正文，诊断信息与错误写入 stderr，便于 Node 后台任务可靠接收。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import requests


DEFAULT_URL = "https://274d0c8f-47e6-46aa-b386-e1e79a1f8425.dev.coze.site"


def _content_to_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "".join(_content_to_text(item) for item in value)
    if isinstance(value, dict):
        for key in ("text", "answer", "content", "output"):
            if key in value:
                text = _content_to_text(value[key])
                if text:
                    return text
    return ""


def extract_report(result: Any) -> str:
    """按响应顺序提取全部 AI 消息，不截断、不摘要。"""
    if not isinstance(result, dict):
        return _content_to_text(result)

    ai_contents: list[str] = []
    messages = result.get("messages")
    if isinstance(messages, list):
        for message in messages:
            if not isinstance(message, dict):
                continue
            role = str(message.get("type") or message.get("role") or "").lower()
            if role not in {"ai", "assistant", "answer"}:
                continue
            content = _content_to_text(message.get("content"))
            if content:
                ai_contents.append(content)
    if ai_contents:
        return "\n".join(ai_contents)

    for key in ("answer", "content", "output", "result"):
        content = _content_to_text(result.get(key))
        if content:
            return content
    return ""


def generate_report(query: str, timeout: int = 300) -> str:
    token = os.environ.get("COZE_REPORT_TOKEN", "").strip()
    if not token:
        raise RuntimeError("COZE_REPORT_TOKEN 未配置")

    base_url = os.environ.get("COZE_REPORT_URL", DEFAULT_URL).strip().rstrip("/")
    endpoint = base_url if base_url.endswith("/run") else f"{base_url}/run"
    payload = {
        "messages": [
            {"role": "user", "content": f"请为{query}生成投资研报"},
        ],
    }
    response = requests.post(
        endpoint,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        json=payload,
        timeout=timeout,
    )
    response.raise_for_status()
    try:
        result = response.json()
    except json.JSONDecodeError as error:
        raise RuntimeError("研报接口未返回有效 JSON") from error

    report = extract_report(result)
    if not report.strip():
        raise RuntimeError("研报接口已响应，但没有返回 AI 研报正文")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="生成完整个股投资研报")
    parser.add_argument("query", help="公司名称或股票代码")
    parser.add_argument("--timeout", type=int, default=300, help="单次请求超时秒数")
    args = parser.parse_args()
    query = args.query.strip()
    if not query:
        parser.error("公司名称或股票代码不能为空")

    try:
        report = generate_report(query, max(30, args.timeout))
    except Exception as error:  # noqa: BLE001 - CLI 必须把完整错误传给父进程
        print(str(error), file=sys.stderr)
        return 1
    # 直接写 UTF-8 字节，避免 Windows 文本模式把换行改成 CRLF 或使用本地代码页。
    sys.stdout.buffer.write(report.encode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
