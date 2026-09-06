from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from src.ibkr_terminal.market_data import fetch_ibkr_historical
from test_analytics import NOW, snapshot


class FakeHistoricalSdk:
    def __init__(self):
        self.calls = []

    async def reqHistoricalDataAsync(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return [SimpleNamespace(date=datetime(2026, 9, 5, 10, minute, tzinfo=timezone.utc),
            open=100 + minute, high=101 + minute, low=99 + minute, close=100.5 + minute, volume=1000 + minute)
            for minute in range(3)]


def test_sdk_historical_request_is_read_only_fixed_and_conid_scoped(api_event_loop):
    sdk = FakeHistoricalSdk()
    result = api_event_loop.run_until_complete(fetch_ibkr_historical(sdk, snapshot(), 12, '1D', now=NOW, test_data=True))
    assert result.state == 'ready' and result.testData and result.source == 'fixture.ibkr.historicalData'
    assert len(result.bars) == 3 and result.bars[0].open == '100'
    assert len(sdk.calls) == 1
    args, kwargs = sdk.calls[0]
    contract = args[0]
    assert contract.conId == 12 and contract.secType == 'STK' and contract.exchange == 'SMART' and contract.currency == 'USD'
    assert args[1:] == ('', '1 D', '1 min', 'TRADES', True)
    assert kwargs == {'formatDate': 2, 'keepUpToDate': False, 'timeout': 8}


def test_sdk_historical_rejects_non_position_contract_and_bad_period_without_calling_sdk(api_event_loop):
    sdk = FakeHistoricalSdk()
    with pytest.raises(ValueError, match='current account snapshot'):
        api_event_loop.run_until_complete(fetch_ibkr_historical(sdk, snapshot(), 999, '1D', now=NOW, test_data=True))
    with pytest.raises(ValueError, match='unsupported period'):
        api_event_loop.run_until_complete(fetch_ibkr_historical(sdk, snapshot(), 12, '2Y', now=NOW, test_data=True))
    assert sdk.calls == []
