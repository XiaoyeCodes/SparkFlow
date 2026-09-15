"""Offline validation: a full portfolio is not truncated at 5,000 chars."""
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services/vibe-trading/agent"))
from src.api.sessions_routes import SendMessageRequest


def test_portfolio_prompt_preserves_large_snapshot():
    prompt = "持仓" * 32000
    assert SendMessageRequest(content=prompt).content == prompt


@pytest.mark.parametrize("content", ["", "x" * 64001], ids=["empty", "too-long"])
def test_prompt_size_is_still_bounded(content):
    with pytest.raises(ValidationError):
        SendMessageRequest(content=content)


@pytest.mark.parametrize("status", ["pending", "running"])
def test_follow_up_rejects_active_session_before_appending_any_message(status):
    import asyncio
    from types import SimpleNamespace
    from src.session.service import SessionService
    from src.session.models import AttemptStatus

    request = SendMessageRequest(content="继续当前报告", require_idle=True)
    service = object.__new__(SessionService)
    service.store = SimpleNamespace(
        get_session=lambda _: SimpleNamespace(last_attempt_id="existing"),
        get_attempt=lambda *_: SimpleNamespace(status=AttemptStatus(status)),
        append_message=lambda _: pytest.fail("busy sessions must not append messages"),
    )
    with pytest.raises(RuntimeError, match="ASSISTANT_SESSION_BUSY"):
        asyncio.run(service.send_message("session", request.content, require_idle=request.require_idle))


def test_cancel_follow_up_cannot_cancel_a_later_turn_in_same_session():
    from types import SimpleNamespace
    from src.session.service import SessionService

    calls = []
    service = object.__new__(SessionService)
    service.store = SimpleNamespace(get_session=lambda _: SimpleNamespace(last_attempt_id="new-turn"))
    service._active_loops = {"session": SimpleNamespace(cancel=lambda: calls.append("cancel"))}
    assert service.cancel_current("session", expected_attempt_id="old-turn") is False
    assert calls == []
    assert service.cancel_current("session", expected_attempt_id="new-turn") is True
    assert calls == ["cancel"]
