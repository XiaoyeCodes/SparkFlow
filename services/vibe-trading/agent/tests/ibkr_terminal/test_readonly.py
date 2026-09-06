from types import SimpleNamespace as Item

import pytest

from src.ibkr_terminal.readonly import ReadonlyConnection
from src.ibkr_terminal.session import AccountBinding, AccountSession
from src.ibkr_terminal.store import SnapshotStore


class FakeEvent:
    def __init__(self):
        self.handlers = []
    def __iadd__(self, handler):
        self.handlers.append(handler)
        return self
    def __isub__(self, handler):
        self.handlers.remove(handler)
        return self
    def emit(self, *args):
        for handler in list(self.handlers):
            handler(*args)


class FakeIB:
    def __init__(self):
        self.connects = []
        self.connected = False
        self.accounts = ['TEST-ACCOUNT', 'OTHER-ACCOUNT']
        self.rows = [Item(account='TEST-ACCOUNT', tag='NetLiquidation', value='1234.56', currency='USD'), Item(account='OTHER-ACCOUNT', tag='NetLiquidation', value='999999', currency='USD'), Item(account='TEST-ACCOUNT', tag='CashBalance', value='100', currency='EUR')]
        self.accountSummaryEvent = FakeEvent()
        self.positionEvent = FakeEvent()
        self.disconnectedEvent = FakeEvent()

    async def connectAsync(self, host, port, **kwargs):
        self.connects.append(kwargs)
        self.connected = True

    def managedAccounts(self):
        return self.accounts

    def isConnected(self):
        return self.connected

    def disconnect(self):
        self.connected = False

    async def accountSummaryAsync(self, account):
        return self.rows

    def positions(self):
        return [Item(account='TEST-ACCOUNT', contract=Item(conId=12, symbol='TEST', currency='USD'), position=2, avgCost=float('nan'))]


def test_persistent_connection_is_readonly_filters_account_and_closes(tmp_path, api_event_loop):
    binding = AccountBinding(mode='paper', accountKey='paper:configured', brokerAccount='TEST-ACCOUNT', confirmed=True, baseCurrency='USD')
    with SnapshotStore(tmp_path / 'db', allow_fixtures=True) as store:
        session = AccountSession('paper', store)
        session.bind(binding)
        fake = FakeIB()
        connection = ReadonlyConnection(session, sdk=fake)
        api_event_loop.run_until_complete(connection.connect())
        api_event_loop.run_until_complete(connection.refresh())
        api_event_loop.run_until_complete(connection.refresh())
        assert len(fake.connects) == 1
        assert fake.connects[0]['readonly'] is True
        assert fake.connects[0]['account'] == 'TEST-ACCOUNT'
        state = session.snapshot()
        assert state.metrics.netLiquidation == '1234.56'
        assert state.positions[0].averageCost is None
        assert state.cash[0].currency == 'EUR'
        assert state.capabilities.placeOrders is False
        assert connection.healthy()
        assert len(fake.accountSummaryEvent.handlers) == 1
        fake.accountSummaryEvent.emit(Item(account='TEST-ACCOUNT'))
        assert api_event_loop.run_until_complete(connection.wait_for_change(0.01))
        connection.close()
        assert not fake.accountSummaryEvent.handlers
        assert not fake.positionEvent.handlers
        assert not fake.disconnectedEvent.handlers
        assert not fake.connected
        assert session.snapshot().state == 'stale'


def test_wrong_broker_account_disconnects_and_client_zero_is_forbidden(tmp_path, api_event_loop):
    with pytest.raises(ValueError):
        AccountBinding(mode='paper', accountKey='paper:configured', brokerAccount='TEST', confirmed=True, clientId=0)
    binding = AccountBinding(mode='paper', accountKey='paper:configured', brokerAccount='NOT-RETURNED', confirmed=True, baseCurrency='USD')
    with SnapshotStore(tmp_path / 'db', allow_fixtures=True) as store:
        session = AccountSession('paper', store)
        session.bind(binding)
        fake = FakeIB()
        with pytest.raises(ValueError, match='account'):
            api_event_loop.run_until_complete(ReadonlyConnection(session, sdk=fake).connect())
        assert not fake.connected
        assert session.snapshot().metrics.netLiquidation is None


def test_broker_disconnect_invalidates_snapshot_without_waiting_for_reconciliation(tmp_path, api_event_loop):
    binding = AccountBinding(mode='paper', accountKey='paper:configured', brokerAccount='TEST-ACCOUNT', confirmed=True, baseCurrency='USD')
    with SnapshotStore(tmp_path / 'db', allow_fixtures=True) as store:
        session = AccountSession('paper', store)
        session.bind(binding)
        fake = FakeIB()
        connection = ReadonlyConnection(session, sdk=fake)
        api_event_loop.run_until_complete(connection.connect())
        api_event_loop.run_until_complete(connection.refresh())
        fake.connected = False
        fake.disconnectedEvent.emit()
        assert session.snapshot().connection == 'disconnected'
        assert session.snapshot().state == 'stale'
        assert not connection.healthy()
        connection.close()
