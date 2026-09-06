from datetime import datetime, timezone, timedelta
from types import SimpleNamespace as Item

import pytest

from src.ibkr_terminal.session import AccountBinding, AccountSession
from src.ibkr_terminal.store import SnapshotStore
from src.ibkr_terminal.readonly import ReadonlyConnection
from test_readonly import FakeIB


def test_concurrent_account_reconciliation_is_serialized(tmp_path,api_event_loop):
    import asyncio
    async def run():
        with SnapshotStore(tmp_path/'db',allow_fixtures=True) as store:
            session=AccountSession('paper',store)
            session.bind(AccountBinding(mode='paper',accountKey='paper:test',brokerAccount='TEST-ACCOUNT',confirmed=True,baseCurrency='USD'))
            fake=ReconcileIB(); active=0; peak=0
            async def positions():
                nonlocal active,peak
                active+=1;peak=max(peak,active)
                await asyncio.sleep(0)
                active-=1
                return []
            fake.reqPositionsAsync=positions
            connection=ReadonlyConnection(session,sdk=fake)
            await connection.connect()
            assert all(await asyncio.gather(connection.reconcile(),connection.reconcile()))
            assert peak==1
            connection.close()
    api_event_loop.run_until_complete(run())


class ReconcileIB(FakeIB):
    def __init__(self):
        super().__init__()
        self.reads = []
        self.fresh_positions = []
        self.fail_orders = False

    async def reqPositionsAsync(self):
        self.reads.append('positions')
        return self.fresh_positions

    async def reqAllOpenOrdersAsync(self):
        self.reads.append('orders')
        if self.fail_orders:
            raise TimeoutError('engineering timeout')
        return [Item(contract=Item(conId=12, symbol='TEST', currency='USD'),
            order=Item(account='TEST-ACCOUNT', orderId=7, clientId=91, permId=123, totalQuantity=5, action='BUY', orderType='LMT', lmtPrice=100),
            orderStatus=Item(status='PendingCancel', filled=2, remaining=3, avgFillPrice=99))]

    async def reqExecutionsAsync(self, execution_filter):
        self.reads.append(('executions', execution_filter.acctCode))
        def fill(account, exec_id):
            return Item(contract=Item(conId=12, symbol='TEST', currency='USD'),
                execution=Item(acctNumber=account, execId=exec_id, orderId=7, clientId=91, permId=123, shares=2, price=99, side='BOT', time=datetime(2026, 9, 4, 14, tzinfo=timezone.utc)),
                commissionReport=Item(execId=exec_id, commission=float('nan'), currency='USD'))
        return [fill('TEST-ACCOUNT', 'EXEC-1'), fill('TEST-ACCOUNT', 'EXEC-1'), fill('OTHER-ACCOUNT', 'PRIVATE')]


def test_active_reads_replace_ghost_positions_preserve_order_identity_and_do_not_refresh_source_time(tmp_path, api_event_loop):
    now = [datetime(2026, 9, 4, 14, tzinfo=timezone.utc)]
    with SnapshotStore(tmp_path / 'db', allow_fixtures=True) as store:
        session = AccountSession('paper', store)
        session.bind(AccountBinding(mode='paper', accountKey='paper:test', brokerAccount='TEST-ACCOUNT', confirmed=True, baseCurrency='USD'))
        fake = ReconcileIB()
        connection = ReadonlyConnection(session, sdk=fake, clock=lambda: now[0])
        api_event_loop.run_until_complete(connection.connect())
        fake.accountSummaryEvent.emit(fake.rows[0])
        api_event_loop.run_until_complete(connection.refresh())
        first = session.snapshot()
        assert len(first.positions) == 1
        observed = first.provenance['metrics.netLiquidation'].observedAt
        assert observed == now[0].isoformat()
        now[0] += timedelta(seconds=30)
        assert api_event_loop.run_until_complete(connection.reconcile())
        state = session.snapshot()
        assert fake.reads == ['positions', 'orders', ('executions', 'TEST-ACCOUNT')]
        assert state.positions == ()  # a fresh empty response beats a populated SDK cache
        assert state.provenance['metrics.netLiquidation'].observedAt == observed
        assert state.provenance['metrics.netLiquidation'].brokerAsOf is None
        assert state.provenance['positions'].requestCompletedAt == now[0].isoformat()
        assert state.orders[0].managed is False
        assert state.orders[0].orderId == 7 and state.orders[0].permId == 123
        assert state.orders[0].execution == 'CANCEL_PENDING'
        assert state.orders[0].filled == '2'
        assert len(state.executions) == 1
        assert state.executions[0].commission is None
        assert state.executions[0].execId == 'EXEC-1'
        fake.fail_orders = True
        with pytest.raises(TimeoutError):
            api_event_loop.run_until_complete(connection.reconcile())
        assert session.snapshot().state == 'stale'
        assert session.snapshot().orders == state.orders
        connection.close()
