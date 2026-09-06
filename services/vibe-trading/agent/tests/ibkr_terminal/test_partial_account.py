from test_readonly import FakeIB, Item
from src.ibkr_terminal.readonly import ReadonlyConnection
from src.ibkr_terminal.session import AccountBinding, AccountSession
from src.ibkr_terminal.store import SnapshotStore


def test_partial_account_has_real_metrics_but_never_claims_empty_positions(tmp_path, api_event_loop):
    async def run():
        with SnapshotStore(tmp_path / 'snapshot.db', allow_fixtures=True) as store:
            session = AccountSession('paper', store)
            session.bind(AccountBinding(mode='paper', accountKey='paper:configured', brokerAccount='TEST-ACCOUNT', confirmed=True))
            fake = FakeIB()
            async def unavailable():
                raise TimeoutError('no complete position response')
            fake.reqPositionsAsync = unavailable
            fake.reqAllOpenOrdersAsync = unavailable
            fake.reqExecutionsAsync = lambda _: unavailable()
            connection = ReadonlyConnection(session, sdk=fake, allow_partial=True)
            await connection.connect()
            await connection.refresh()
            assert await connection.reconcile()
            current = session.snapshot()
            assert current.baseCurrency == 'USD'
            assert current.metrics.netLiquidation == '1234.56'
            assert current.state == 'permission-required' and current.connection == 'connected'
            assert 'positions' in current.missing and 'active-reconciliation' in current.missing
            assert current.positions == () and not current.capabilities.placeOrders
            assert connection.healthy()
            assert connection.reconciliation_blocked
            connection.close()
    api_event_loop.run_until_complete(run())


def test_base_currency_is_never_guessed_from_cash_or_base_placeholder(tmp_path, api_event_loop):
    async def run():
        with SnapshotStore(tmp_path / 'snapshot.db', allow_fixtures=True) as store:
            session = AccountSession('paper', store)
            session.bind(AccountBinding(mode='paper', accountKey='paper:configured', brokerAccount='TEST-ACCOUNT', confirmed=True))
            fake = FakeIB()
            fake.rows = [Item(account='TEST-ACCOUNT',tag='NetLiquidation',value='1',currency='BASE'),
                Item(account='TEST-ACCOUNT',tag='CashBalance',value='10',currency='EUR')]
            connection = ReadonlyConnection(session, sdk=fake, allow_partial=True)
            await connection.connect()
            await connection.refresh()
            assert session.snapshot().baseCurrency is None
            assert session.snapshot().metrics.netLiquidation is None
            connection.close()
    api_event_loop.run_until_complete(run())
