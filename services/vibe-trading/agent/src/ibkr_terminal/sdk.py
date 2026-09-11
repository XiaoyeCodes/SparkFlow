"""Pinned ib_async read observations, before its Trade cache fills missing values.

Constructed before connect; no sockets or order requests are made here. This
wrapper only observes openOrder/orderStatus replies during an explicit read.
"""
from copy import deepcopy
import asyncio
import re
from types import SimpleNamespace

from ib_async import IB
from ib_async.client import Client
from ib_async.wrapper import Wrapper


def execution_time_fields(fields):
    # IB's dashed date/time is UTC. The pinned SDK strips the dash and
    # incorrectly localizes it to the Windows timezone. Preserve explicit
    # exchange/operator zones and the SDK's legacy timezone configuration.
    if len(fields) > 15 and re.fullmatch(r'\d{8}-\d{2}:\d{2}:\d{2}', fields[15]):
        fields = list(fields)
        fields[15] = fields[15].replace('-', ' ') + ' UTC'
    return fields


class ObservationWrapper(Wrapper):
    open_read = None
    status_read = None
    managed_observer = None
    account_read = None
    fresh_summary = None

    def accountSummary(self, reqId, account, tag, value, currency):
        super().accountSummary(reqId, account, tag, value, currency)
        if self.fresh_summary is not None and reqId == self.fresh_summary['reqId']:
            self.fresh_summary['rows'][(account, tag, currency)] = deepcopy(self.acctSummary[(account, tag, currency)])

    def accountSummaryEnd(self, reqId):
        if self.fresh_summary is not None and reqId == self.fresh_summary['reqId']:
            self._endReq(reqId, list(self.fresh_summary['rows'].values()))
        else:
            super().accountSummaryEnd(reqId)

    def updateAccountValue(self, tag, val, currency, account):
        super().updateAccountValue(tag, val, currency, account)
        if self.account_read is not None and account == self.account_read['account']:
            self.account_read['values'][(tag, currency)] = deepcopy(self.accountValues[(account, tag, currency, '')])

    def updatePortfolio(self, contract, posSize, marketPrice, marketValue, averageCost, unrealizedPNL, realizedPNL, account):
        super().updatePortfolio(contract, posSize, marketPrice, marketValue, averageCost, unrealizedPNL, realizedPNL, account)
        if self.account_read is not None and account == self.account_read['account']:
            if posSize == 0:
                self.account_read['portfolio'].pop(contract.conId, None)
            else:
                self.account_read['portfolio'][contract.conId] = deepcopy(self.portfolio[account][contract.conId])

    def accountDownloadEnd(self, account):
        if self.account_read is not None and account != self.account_read['account']:
            return
        super().accountDownloadEnd(account)

    def _observe(self, method, *args, **kwargs):
        if self.managed_observer is None:
            return True
        from .risk import RiskDenied
        try:
            getattr(self.managed_observer, method)(*args, **kwargs)
            return True
        except Exception as error:
            self.managed_observer.failed(error.code if isinstance(error, RiskDenied) else 'SDK_CALLBACK_FAILURE')
            return False

    def openOrder(self, orderId, contract, order, orderState):
        if not self._observe('open_order', orderId, contract, order, orderState):
            return
        if self.open_read is not None and not order.whatIf:
            key = self.orderKey(order.clientId, order.orderId, order.permId)
            # OrderStatus.filled/remaining default to zero in the SDK although
            # openOrder carries neither. Only wire orderStatus may supply them.
            status = self.status_read.get(key, SimpleNamespace(status=orderState.status, filled=None, remaining=None))
            self.open_read[key] = SimpleNamespace(contract=deepcopy(contract), order=deepcopy(order), orderStatus=status)
        super().openOrder(orderId, contract, order, orderState)

    def orderStatus(self, orderId, status, filled, remaining, avgFillPrice, permId, parentId, lastFillPrice, clientId, whyHeld, mktCapPrice=0.0):
        if not self._observe('order_status', orderId, status, filled, remaining, permId, clientId):
            return
        if self.status_read is not None:
            key = self.orderKey(clientId, orderId, permId)
            observed = SimpleNamespace(status=status, filled=filled, remaining=remaining)
            self.status_read[key] = observed
            if key in self.open_read:
                self.open_read[key].orderStatus = observed
        super().orderStatus(orderId, status, filled, remaining, avgFillPrice, permId, parentId, lastFillPrice, clientId, whyHeld, mktCapPrice)

    def execDetails(self, reqId, contract, execution):
        if self._observe('execution', contract, execution):
            super().execDetails(reqId, contract, execution)

    def commissionReport(self, report):
        if self._observe('commission', report):
            super().commissionReport(report)

    def error(self, reqId, errorCode, errorString, advancedOrderRejectJson=''):
        # IB uses one integer field for both order IDs and read-request IDs.
        # Streaming market-data requests do not live in _futures, and ib_async
        # deliberately retains reqId2Ticker after cancellation so late error
        # 300 callbacks can still be identified. Treat every known read ID as
        # read evidence even when it numerically equals an older order ID.
        read_request = (reqId in self._futures or reqId in self.reqId2Ticker
            or reqId in self.reqId2Subscriber or reqId in self._reqId2Contract)
        if self.managed_observer is not None:
            from .risk import RiskDenied
            try:
                managed = self.managed_observer.broker_error(reqId, errorCode, request_active=read_request)
            except Exception as error:
                self.managed_observer.failed(error.code if isinstance(error, RiskDenied) else 'SDK_CALLBACK_FAILURE')
                return
            if managed is not None:
                # SDK error() can invent Cancelled from an amendment failure.
                # The durable managed ledger now owns this diagnostic; do not
                # also publish a misleading Trade status or raw account text.
                return
            errorString, advancedOrderRejectJson = f'IBKR_{errorCode}', ''
        if read_request and reqId not in self._futures:
            # Wrapper.error otherwise assumes any non-future reqId is an order
            # ID and can falsely cancel an in-memory Trade on an ID collision.
            trade_key = (self.clientId, reqId)
            trade = self.trades.pop(trade_key, None)
            try:
                super().error(reqId, errorCode, errorString, advancedOrderRejectJson)
            finally:
                if trade is not None:
                    self.trades[trade_key] = trade
        else:
            super().error(reqId, errorCode, errorString, advancedOrderRejectJson)


class ObservedIB(IB):
    def __init__(self, *, managed_observer=None):
        super().__init__()
        # IB constructs a disconnected Client. Replace it before any connection
        # so its decoder dispatches to the observation wrapper from the outset.
        self.client.apiEnd -= self.disconnectedEvent
        self.wrapper = ObservationWrapper(self)
        self.wrapper.managed_observer = managed_observer
        self.client = Client(self.wrapper)
        decode_execution = self.client.decoder.handlers[11]
        self.client.decoder.handlers[11] = lambda fields: decode_execution(execution_time_fields(fields))
        self.client.apiEnd += self.disconnectedEvent
        self.RaiseRequestErrors = True
        self._account_snapshot_lock = asyncio.Lock()

    async def _connectScopedAsync(self, host, port, *, clientId, account, timeout=8):
        # Handshake first; individual reads report their own completeness.
        # IB.connectAsync unconditionally waits for all-account positions,
        # which can hide a successful account-summary connection.
        if clientId <= 0:
            raise ValueError('explicit positive client id required')
        self.wrapper.clientId = clientId
        try:
            await self.client.connectAsync(host, port, clientId, timeout)
            if account not in self.client.getAccounts():
                raise ValueError('configured account not returned by broker')
        except BaseException:
            self.disconnect()
            raise
        return self

    async def connectReadOnlyAsync(self, host, port, *, clientId, account, timeout=8, **kwargs):
        if kwargs.get('readonly') is not True:
            raise ValueError('explicit readonly client required')
        return await self._connectScopedAsync(host, port, clientId=clientId, account=account, timeout=timeout)

    async def connectManagedPaperAsync(self, host, port, *, clientId, account, timeout=8, **kwargs):
        if kwargs.get('readonly') is not False:
            raise ValueError('explicit paper execution client required')
        return await self._connectScopedAsync(host, port, clientId=clientId, account=account, timeout=timeout)

    async def reqAllOpenOrdersAsync(self):
        if self.wrapper.open_read is not None:
            raise RuntimeError('overlapping order reconciliation')
        self.wrapper.open_read, self.wrapper.status_read = {}, {}
        try:
            await super().reqAllOpenOrdersAsync()
            return list(self.wrapper.open_read.values())
        finally:
            self.wrapper.open_read = self.wrapper.status_read = None

    async def reqAccountSnapshotAsync(self, account):
        # Background refresh and order risk checks share one IB subscription.
        # Queue complete reads so neither caller consumes the other's replies.
        async with self._account_snapshot_lock:
            return await self._account_snapshot_once(account)

    async def _account_snapshot_once(self, account):
        if self.wrapper.account_read is not None or 'accountValues' in self.wrapper._futures:
            raise RuntimeError('overlapping account reconciliation')
        observed = {'account': account, 'values': {}, 'portfolio': {}}
        self.wrapper.account_read = observed
        try:
            future = self.wrapper.startReq('accountValues')
            self.client.reqAccountUpdates(False, account)
            self.client.reqAccountUpdates(True, account)
            await future
            return {'values': list(observed['values'].values()), 'portfolio': list(observed['portfolio'].values())}
        finally:
            self.wrapper.account_read = None
            self.wrapper._endReq('accountValues')

    def cachedAccountSummary(self, account):
        """Read already observed values without entering the SDK sync event loop."""
        return [row for row in self.wrapper.acctSummary.values() if row.account == account]

    async def reqFreshSummaryAsync(self):
        if self.wrapper.fresh_summary is not None:
            raise RuntimeError('overlapping risk summary request')
        req_id = self.client.getReqId()
        self.wrapper.fresh_summary = {'reqId': req_id, 'rows': {}}
        try:
            future = self.wrapper.startReq(req_id)
            self.client.reqAccountSummary(req_id, 'All', 'NetLiquidation,SettledCash,TotalCashValue,AvailableFunds,$LEDGER:USD')
            return await future
        finally:
            try:
                self.client.cancelAccountSummary(req_id)
            finally:
                self.wrapper.fresh_summary = None
                self.wrapper._endReq(req_id)

    async def reqExecutionsAsync(self, execFilter=None):
        fills = await super().reqExecutionsAsync(execFilter)
        # Repeated execDetails makes a fresh Fill with an empty commission
        # report while late reports update wrapper.fills[execId]. Use that
        # report only with the matching immutable execution identity.
        results = []
        for fill in fills:
            original = self.wrapper.fills.get(fill.execution.execId)
            if original is not None and original.execution == fill.execution:
                fill = fill._replace(commissionReport=original.commissionReport)
            results.append(fill)
        return results
