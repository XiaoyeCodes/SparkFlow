"""BaseTool wrapper for registering factors/strategies into the strategy store."""

from __future__ import annotations

import json
from dataclasses import asdict
from typing import Any

from src.agent.tools import BaseTool
from src.strategy_store.models import (
    Artifact,
    ArtifactStatus,
    ArtifactType,
)
from src.strategy_store._shared import get_store as _get_store


def _ok(payload: dict[str, Any]) -> str:
    return json.dumps({"status": "ok", **payload}, ensure_ascii=False)


def _error(exc: Exception) -> str:
    return json.dumps({"status": "error", "error": str(exc)}, ensure_ascii=False)


class SdmRegisterTool(BaseTool):
    """Register a new factor or strategy into the strategy store."""

    name = "sdm_register"
    description = (
        "Register a new factor or strategy extracted from a paper into the "
        "strategy store. Research-only: does not place trades."
    )
    is_readonly = False
    repeatable = True
    parameters = {
        "type": "object",
        "properties": {
            "artifact_type": {
                "type": "string",
                "enum": ["factor", "strategy"],
                "description": "Type of artifact",
            },
            "name": {
                "type": "string",
                "description": "Unique name for the factor or strategy",
            },
            "universe": {
                "type": "string",
                "description": "Target market universe (e.g. CSI300, SP500, BTC)",
            },
            "source_paper": {
                "type": "string",
                "description": "Source paper title or DOI",
            },
            "source_url": {
                "type": "string",
                "description": "Source paper URL",
            },
            "formula_latex": {
                "type": "string",
                "description": "Factor formula in LaTeX (factor only)",
            },
            "theme": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Factor themes (factor only)",
            },
            "columns_required": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Required data columns (factor only)",
            },
            "signal_definition": {
                "type": "string",
                "description": "Signal logic description (strategy only)",
            },
            "signal_engine_path": {
                "type": "string",
                "description": "Path to signal_engine.py",
            },
            "hypothesis_id": {
                "type": "string",
                "description": "Linked hypothesis ID",
            },
        },
        "required": ["artifact_type", "name", "universe"],
    }

    def execute(self, **kwargs: Any) -> str:
        """Build an Artifact from kwargs, register it, and return the record."""
        try:
            store = _get_store()

            artifact_type = ArtifactType(kwargs["artifact_type"])

            theme_raw = kwargs.get("theme")
            theme = tuple(theme_raw) if theme_raw else ()

            columns_raw = kwargs.get("columns_required")
            columns_required = tuple(columns_raw) if columns_raw else ()

            artifact = Artifact(
                id="",
                type=artifact_type,
                name=str(kwargs["name"]),
                universe=str(kwargs["universe"]),
                source_paper=kwargs.get("source_paper"),
                source_url=kwargs.get("source_url"),
                formula_latex=kwargs.get("formula_latex"),
                theme=theme,
                columns_required=columns_required,
                signal_definition=kwargs.get("signal_definition"),
                signal_engine_path=kwargs.get("signal_engine_path"),
                hypothesis_id=kwargs.get("hypothesis_id"),
                status=ArtifactStatus.CREATED,
            )

            artifact_id = store.register_artifact(artifact)
            stored = store.get_artifact(artifact_id)
            return _ok({"artifact": asdict(stored)})  # type: ignore[arg-type]
        except Exception as exc:
            return _error(exc)
