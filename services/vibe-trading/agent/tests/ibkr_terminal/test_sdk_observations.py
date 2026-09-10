"""Actual pinned SDK callbacks with an allowlisted, socket-free transport."""
from datetime import datetime, timezone

from ib_async import Contract, Order, OrderState, Execution, CommissionReport

from src.ibkr_terminal.broker_views import decimal_text, order_view, execution_view
from src.ibkr_terminal.sdk import ObservedIB


def test_dashed_utc_execution_and_exchange_timezone_decode_to_same_instant(api_event_loop):
    ib = ObservedIB()
    ib.TimezoneTWS = 'Asia/Shanghai'
    ib.client.decoder.serverVersion = 178
    observed = []
    ib.wrapper.execDetails = lambda req, contract, execution: observed.append(execution.time)
    fields = ['11', '-1', '20', '265598', 'AAPL', 'STK', '', '0', '', '', 'NASDAQ',
        'USD', 'AAPL', 'NMS', 'EXEC-1', '', 'TEST', 'NASDAQ', 'BOT', '10', '322.8',
        '123', '78', '0', '10', '322.8', 'reference', '', '0', '', '1', '0']
    for wire in ('20260910-14:58:38', '20260910 10:58:38 US/Eastern'):
        fields[15] = wire
        ib.client.decoder.handlers[11](fields)
    assert observed == [datetime(2026, 9, 10, 14, 58, 38, tzinfo=timezone.utc)] * 2


class ReadTransport:
    def __init__(self, wrapper):
        self.wrapper = wrapper
        self.calls = []
        self.req_id = 10
        self.status = 'Submitted'
        self.send_counts = False
        self.contract = Contract(conId=12, symbol='TEST', currency='USD', secType='STK')

    def isConnected(self):
        return False

    def getReqId(self):
        self.req_id += 1
        return self.req_id

    def updateReqId(self, value):
        self.req_id = max(self.req_id, value)

    def reqAllOpenOrders(self):
        self.calls.append('read-open-orders')
        self.wrapper.openOrder(7, self.contract, Order(orderId=7, clientId=91, permId=123, account='TEST', totalQuantity=5, action='BUY'), OrderState(status=self.status))
        if self.send_counts:
            self.wrapper.orderStatus(7, self.status, 0, 5, 0, 123, 0, 0, 91, '')
        self.wrapper.openOrderEnd()

    def reqExecutions(self, req_id, execution_filter):
        self.calls.append('read-executions')
        self.wrapper.execDetails(req_id, self.contract, Execution(execId='EXEC-1', acctNumber='TEST', orderId=7, clientId=91, permId=123, shares=2, price=99, side='BOT', time=datetime(2026, 9, 4, 14, tzinfo=timezone.utc)))
        self.wrapper.execDetailsEnd(req_id)


def test_wire_open_order_has_unknown_counts_and_fresh_status_not_cached_sdk_defaults(api_event_loop):
    async def scenario():
        ib = ObservedIB()
        transport = ReadTransport(ib.wrapper)
        ib.client = transport
        first = order_view((await ib.reqAllOpenOrdersAsync())[0], 'paper:test')
        assert first.filled is None and first.remaining is None
        assert first.execution == 'OPEN'
        transport.status = 'PendingCancel'
        second = order_view((await ib.reqAllOpenOrdersAsync())[0], 'paper:test')
        assert second.execution == 'CANCEL_PENDING'  # SDK's Trade may still say Submitted
        transport.send_counts = True
        third = order_view((await ib.reqAllOpenOrdersAsync())[0], 'paper:test')
        assert third.filled == '0' and third.remaining == '5'
        transport.send_counts = False
        fourth = order_view((await ib.reqAllOpenOrdersAsync())[0], 'paper:test')
        assert fourth.filled is None  # don't silently promote prior counts to a fresh response
        assert transport.calls == ['read-open-orders'] * 4
    api_event_loop.run_until_complete(scenario())


def test_ibkr_unset_money_is_missing_not_a_large_account_number():
    from ib_async.util import UNSET_DOUBLE
    assert decimal_text(UNSET_DOUBLE) is None
    assert decimal_text(0) == '0'


def test_repeated_execution_query_keeps_late_commission_from_original_callback(api_event_loop):
    async def scenario():
        ib = ObservedIB()
        transport = ReadTransport(ib.wrapper)
        ib.client = transport
        first = execution_view((await ib.reqExecutionsAsync())[0], 'paper:test')
        assert first.commission is None
        ib.wrapper.commissionReport(CommissionReport(execId='EXEC-1', commission=0, currency='USD'))
        second = execution_view((await ib.reqExecutionsAsync())[0], 'paper:test')
        assert second.commission == '0' and second.commissionCurrency == 'USD'
        assert transport.calls == ['read-executions'] * 2
    api_event_loop.run_until_complete(scenario())
