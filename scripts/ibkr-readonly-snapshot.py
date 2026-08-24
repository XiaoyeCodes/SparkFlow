"""Read-only SparkFlow bridge for a local IB Gateway paper session."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
AGENT_ROOT = ROOT / "services" / "vibe-trading" / "agent"
sys.path.insert(0, str(AGENT_ROOT))

from src.trading.connectors.ibkr.local import (  # noqa: E402
    IBKRLocalConfig,
    check_local_status,
    get_account_snapshot,
    get_positions,
)


CONFIG = IBKRLocalConfig(
    host="127.0.0.1",
    port=4002,
    client_id=77,
    profile="paper",
    timeout=8.0,
    readonly=True,
)


def _mask_account(value: Any) -> str:
    text = str(value or "")
    if len(text) <= 4:
        return "****" if text else ""
    return f"{text[:2]}{'*' * max(4, len(text) - 4)}{text[-2:]}"


def _json_safe(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _mask_payload(payload: dict[str, Any]) -> dict[str, Any]:
    masked = _json_safe(payload)
    if isinstance(masked.get("accounts"), list):
        masked["accounts"] = [_mask_account(account) for account in masked["accounts"]]
    for key in ("summary", "positions"):
        rows = masked.get(key)
        if not isinstance(rows, list):
            continue
        for row in rows:
            if isinstance(row, dict) and row.get("account"):
                row["account"] = _mask_account(row["account"])
    return masked


def read_status() -> dict[str, Any]:
    report = check_local_status(CONFIG, scan=False)
    accounts = report.get("account", {}).get("accounts", []) if isinstance(report.get("account"), dict) else []
    return {
        "ok": report.get("status") == "ok",
        "connected": report.get("status") == "ok",
        "mode": "paper",
        "readonly": True,
        "gateway": {"host": CONFIG.host, "port": CONFIG.port, "clientId": CONFIG.client_id},
        "sdkInstalled": bool(report.get("sdk", {}).get("installed")),
        "account": [_mask_account(account) for account in accounts],
        "detail": report.get("error", "IB Gateway 模拟盘已连接"),
        "checkedAt": datetime.now(timezone.utc).isoformat(),
    }


def read_snapshot() -> dict[str, Any]:
    account = _mask_payload(get_account_snapshot(CONFIG))
    positions = _mask_payload(get_positions(CONFIG))
    return {
        "ok": True,
        "connected": True,
        "mode": "paper",
        "readonly": True,
        "gateway": {"host": CONFIG.host, "port": CONFIG.port, "clientId": CONFIG.client_id},
        "accounts": account.get("accounts", []),
        "summary": account.get("summary", []),
        "positions": positions.get("positions", []),
        "syncedAt": datetime.now(timezone.utc).isoformat(),
    }


def main() -> None:
    action = (sys.argv[1] if len(sys.argv) > 1 else "status").strip().lower()
    if action not in {"status", "snapshot"}:
        raise ValueError("unsupported action")
    try:
        payload = read_snapshot() if action == "snapshot" else read_status()
    except Exception as exc:  # noqa: BLE001 - return a safe diagnostic to the local UI
        payload = {
            "ok": False,
            "connected": False,
            "mode": "paper",
            "readonly": True,
            "gateway": {"host": CONFIG.host, "port": CONFIG.port, "clientId": CONFIG.client_id},
            "detail": str(exc),
            "checkedAt": datetime.now(timezone.utc).isoformat(),
        }
    print(json.dumps(_json_safe(payload), ensure_ascii=False))


if __name__ == "__main__":
    main()
