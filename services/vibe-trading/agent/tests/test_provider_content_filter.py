"""Provider moderation errors use one safe retry without leaking raw details."""

from src.providers.chat import ProviderStreamError
from src.providers.content_filter import is_provider_content_filter_error


class _Http400Error(Exception):
    status_code = 400


def test_deepseek_content_risk_is_retryable_and_redacted():
    original = _Http400Error(
        "Error code: 400 - {'error': {'message': 'Content Exists Risk'}}"
    )

    error = ProviderStreamError(
        provider="deepseek",
        model="deepseek-v4-flash",
        original=original,
    )

    assert error.content_filter_triggered is True
    assert error.retryable is True
    assert "provider_content_filter" in str(error)
    assert "Content Exists Risk" not in str(error)


def test_ordinary_bad_request_remains_non_retryable():
    error = ProviderStreamError(
        provider="deepseek",
        model="deepseek-v4-flash",
        original=_Http400Error("invalid request body"),
    )

    assert error.content_filter_triggered is False
    assert error.retryable is False


def test_provider_content_filter_detector_accepts_compatible_markers():
    assert is_provider_content_filter_error("PROHIBITED_CONTENT") is True
    assert is_provider_content_filter_error("request timed out") is False
