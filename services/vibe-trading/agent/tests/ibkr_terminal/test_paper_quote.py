from datetime import datetime, timezone, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from src.ibkr_terminal.paper_quote import read_quote, price


@pytest.mark.parametrize('value', [None, float('nan'), float('inf'), -1, 0, 1.7976931348623157e308])
def test_unavailable_prices_are_never_displayed_as_quotes(value):
    assert price(value) is None


def test_broker_quote_preserves_delay_and_session_with_bounded_subscription(api_event_loop):
    now = datetime(2026, 9, 10, 4, tzinfo=timezone.utc)
    native = SimpleNamespace(conId=265598, symbol='AAPL', secType='STK', currency='USD', primaryExchange='NASDAQ')
    detail = SimpleNamespace(contract=native, longName='Apple Inc.', minTick=.01,
        liquidSessions=lambda: [SimpleNamespace(start=now + timedelta(hours=9), end=now + timedelta(hours=16))])
    ticker = SimpleNamespace(bid=249, ask=251, last=250, close=248, high=float('nan'), low=-1, marketDataType=3)
    requests, cancelled = [], []
    ib = SimpleNamespace(reqContractDetailsAsync=AsyncMock(return_value=[detail]),
        reqMktData=lambda *args: requests.append(args) or ticker, cancelMktData=cancelled.append)
    value = api_event_loop.run_until_complete(read_quote(SimpleNamespace(_ib=ib), 265598, lambda: now))
    assert value['state'] == 'delayed'
    assert value['last'] == '250' and value['high'] is None and value['low'] is None
    assert value['regularHours'] is False and value['nextOpen'] == (now + timedelta(hours=9)).isoformat()
    assert value['fetchedAt'] == now.isoformat()
    assert requests == [(native, '', True, False)] and cancelled == [native]


def test_quote_rejects_non_equity_contract_before_subscribing(api_event_loop):
    native = SimpleNamespace(conId=123, secType='OPT', currency='USD')
    ib = SimpleNamespace(reqContractDetailsAsync=AsyncMock(return_value=[SimpleNamespace(contract=native)]))
    with pytest.raises(Exception, match='UNSUPPORTED_CONTRACT'):
        api_event_loop.run_until_complete(read_quote(SimpleNamespace(_ib=ib), 123))
