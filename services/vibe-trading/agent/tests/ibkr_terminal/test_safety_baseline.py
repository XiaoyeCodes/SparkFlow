import socket

import pytest
from pytest_socket import SocketBlockedError

from src.trading.connectors.ibkr.profiles import IBKR_PROFILES
from src.trading import service


def test_default_suite_cannot_open_a_broker_socket():
    with pytest.raises(SocketBlockedError):
        socket.socket()


@pytest.mark.parametrize('profile', IBKR_PROFILES, ids=lambda p: p.id)
def test_existing_profiles_never_reach_a_write_adapter(profile, monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail('IBKR write reached SDK adapter')
    monkeypatch.setattr(service, '_sdk_module', forbidden)
    assert profile.readonly is True
    assert not any(cap.startswith('orders.place') for cap in profile.capabilities)
    result = service.place_order(profile_id=profile.id, symbol='ENGINEERING-TEST', side='buy', quantity=1)
    assert result['status'] != 'ok'
    assert service.cancel_order('ENGINEERING-TEST', profile_id=profile.id)['status'] != 'ok'
