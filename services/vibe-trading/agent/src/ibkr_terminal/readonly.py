"""Persistent SDK connection with an explicit account and no order methods."""
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4
import asyncio

from src.trading.connectors.ibkr.local import _account_value_to_dict, _contract_to_dict, _obj_get
from .schemas import Snapshot, Metrics, Capabilities, Position, CashBalance, SourceStamp
from .session import AccountSession
from .broker_views import decimal_text, order_view, execution_view
from .market_data import fetch_ibkr_historical


class ReadonlyConnection:
    def __init__(self, session: AccountSession, *, sdk=None, clock=None, allow_partial=False):
        if session.binding is None:
            raise ValueError('confirmed account binding required')
        self.session = session
        self.binding = session.binding
        self.revision = session.revision
        self._fixture = sdk is not None
        if sdk is None:
            from .sdk import ObservedIB
            sdk = ObservedIB()
        self._ib = sdk
        self._changed = asyncio.Event()
        self._handlers = []
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._summary_observed = {}
        self._positions = None
        self._position_version = 0
        self._position_events = {}
        self._orders = ()
        self._executions = ()
        self._reconciled_at = None
        self.allow_partial = allow_partial
        self.reconciliation_blocked = False
        self._read_error = None
        self._reconcile_lock = asyncio.Lock()

    def _on_error(self, req_id, code, *args):
        if code in (321, 322, 502, 504):
            self._read_error = f'IBKR_{code}'

    def _on_summary(self, row):
        if _obj_get(row, 'account') == self.binding.brokerAccount:
            self._summary_observed[(_obj_get(row, 'tag'), _obj_get(row, 'currency'))] = self._clock().isoformat()
            self._changed.set()

    def _on_position(self, row):
        if _obj_get(row, 'account') == self.binding.brokerAccount:
            self._position_version += 1
            con_id = _obj_get(_obj_get(row, 'contract'), 'conId')
            self._position_events[con_id] = (self._position_version, row)
            if self._positions is not None:
                self._positions[con_id] = row
            self._changed.set()

    def healthy(self):
        return self._ib.isConnected() and self.session.revision == self.revision and self.session.binding == self.binding

    def _on_change(self, *args):
        self._changed.set()

    def _on_disconnect(self, *args):
        self.session.disconnected(expected_revision=self.revision)
        self._changed.set()

    async def wait_for_change(self, timeout):
        try:
            await asyncio.wait_for(self._changed.wait(), timeout)
            self._changed.clear()
            return True
        except asyncio.TimeoutError:
            return False

    async def connect(self):
        from ib_async import StartupFetch
        try:
            connect = getattr(self._ib, 'connectReadOnlyAsync', self._ib.connectAsync)
            await connect(self.binding.host, self.binding.port,
                clientId=self.binding.clientId, readonly=True, account=self.binding.brokerAccount,
                timeout=8, raiseSyncErrors=True, fetchFields=StartupFetch.ACCOUNT_UPDATES)
            if self.binding.brokerAccount not in self._ib.managedAccounts():
                raise ValueError('configured account not returned by broker')
            for name, handler in (('accountSummaryEvent', self._on_summary), ('positionEvent', self._on_position), ('disconnectedEvent', self._on_disconnect)):
                event = getattr(self._ib, name)
                event += handler
                self._handlers.append((event, handler))
            if hasattr(self._ib, 'errorEvent'):
                self._ib.errorEvent += self._on_error
                self._handlers.append((self._ib.errorEvent, self._on_error))
        except BaseException:
            self.close()
            raise

    async def reconcile(self):
        async with self._reconcile_lock:
            return await self._reconcile_once()

    async def _reconcile_once(self):
        from ib_async import ExecutionFilter
        if not self.healthy():
            return False
        if self.reconciliation_blocked:
            return await self.refresh()
        version = self._position_version
        try:
            # Fresh response collections, not positions()/openTrades() caches. Never bind orders.
            results = await asyncio.gather(
                asyncio.wait_for(self._ib.reqPositionsAsync(), timeout=8),
                asyncio.wait_for(self._ib.reqAllOpenOrdersAsync(), timeout=8),
                asyncio.wait_for(self._ib.reqExecutionsAsync(ExecutionFilter(acctCode=self.binding.brokerAccount)), timeout=8),
                return_exceptions=True)
            for result in results:
                if isinstance(result, BaseException):
                    raise result
            positions, trades, fills = results
            orders = tuple(order_view(row, self.binding.accountKey) for row in trades if _obj_get(_obj_get(row, 'order'), 'account') == self.binding.brokerAccount)
            executions = {}
            for fill in fills:
                if _obj_get(_obj_get(fill, 'execution'), 'acctNumber') != self.binding.brokerAccount:
                    continue
                mapped = execution_view(fill, self.binding.accountKey)
                if mapped.execId in executions and executions[mapped.execId] != mapped:
                    raise ValueError('conflicting duplicate execution')
                executions[mapped.execId] = mapped
            if not self.healthy():
                return False
            fresh = {_obj_get(_obj_get(row, 'contract'), 'conId'): row for row in positions if _obj_get(row, 'account') == self.binding.brokerAccount}
            fresh.update({con_id: row for con_id, (seen, row) in self._position_events.items() if seen > version})
            self._positions = fresh
            self._orders, self._executions = orders, tuple(executions.values())
            self._reconciled_at = self._clock().isoformat()
            return await self.refresh()
        except (TimeoutError, ConnectionError):
            if self.allow_partial and self._reconciled_at is None and self.healthy():
                self.reconciliation_blocked = True
                self._positions = {}
                return await self.refresh()
            self.session.disconnected('主动只读对账未完成；保留旧快照并暂停。', expected_revision=self.revision)
            raise
        except BaseException:
            self.session.disconnected('主动只读对账未完成；保留旧快照并暂停。', expected_revision=self.revision)
            raise

    async def refresh(self):
        if not self._ib.isConnected():
            self.session.disconnected(expected_revision=self.revision)
            return False
        if self.binding.brokerAccount not in self._ib.managedAccounts():
            self.close()
            raise ValueError('configured account no longer returned by broker')
        summary_rows, account_read = await asyncio.gather(
            self._ib.accountSummaryAsync(self.binding.brokerAccount),
            self._ib.reqAccountSnapshotAsync(self.binding.brokerAccount))
        summary_rows = [_account_value_to_dict(row) for row in summary_rows]
        account_rows = [_account_value_to_dict(row) for row in account_read['values']]
        # Account Summary omits CashBalance and does not carry the portfolio
        # valuation rows. Prefer the scoped Account Updates read where both
        # transports returned the same tag/currency.
        merged_rows = {(row['tag'], row['currency']): row for row in summary_rows
            if row['account'] == self.binding.brokerAccount}
        merged_rows.update({(row['tag'], row['currency']): row for row in account_rows
            if row['account'] == self.binding.brokerAccount})
        rows = list(merged_rows.values())
        account_keys = {(row['tag'], row['currency']) for row in account_rows
            if row['account'] == self.binding.brokerAccount}
        account_read_at = self._clock().isoformat()
        base = self.binding.baseCurrency
        if base is None:
            currencies = {row['currency'] for row in rows if row['tag'] == 'NetLiquidation'
                and row['currency'] and len(row['currency']) == 3 and row['currency'].isalpha()}
            if len(currencies) == 1:
                base = currencies.pop()
        provenance = {}

        def metric(tag, field):
            matches = [row for row in rows if row['tag'] == tag and base and row['currency'] in ('BASE', base)]
            observed = self._summary_observed.get((tag, matches[0]['currency'])) if len(matches) == 1 else None
            from_updates = len(matches) == 1 and (tag, matches[0]['currency']) in account_keys
            provenance[f'metrics.{field}'] = SourceStamp(source='ibkr.accountUpdates' if from_updates else 'ibkr.accountSummary',
                observedAt=observed, requestCompletedAt=account_read_at if from_updates else None)
            return decimal_text(matches[0]['value']) if len(matches) == 1 else None

        positions = []
        portfolio_rows = account_read['portfolio']
        portfolio = {_obj_get(_obj_get(row, 'contract'), 'conId'): row for row in portfolio_rows
            if _obj_get(row, 'account') == self.binding.brokerAccount}
        missing = ['quotes', 'execution-history-before-broker-window']
        if self._reconciled_at is None:
            missing.extend(['orders', 'executions', 'active-reconciliation'])
            if self.allow_partial:
                missing.append('positions')
        for row in (() if self.allow_partial and self._reconciled_at is None else self._ib.positions() if self._positions is None else self._positions.values()):
            if _obj_get(row, 'account') != self.binding.brokerAccount:
                continue
            contract = _contract_to_dict(_obj_get(row, 'contract'))
            quantity = decimal_text(_obj_get(row, 'position'))
            if quantity is not None and Decimal(quantity) == 0:
                continue
            if not contract['con_id'] or not contract['currency'] or quantity is None:
                raise ValueError('incomplete position identity or quantity')
            broker_contract = _obj_get(row, 'contract')
            entry = portfolio.get(contract['con_id'])
            if entry is not None and decimal_text(_obj_get(entry, 'position')) != quantity:
                entry = None  # Never combine a position update with an older portfolio valuation.
            positions.append(Position(accountKey=self.binding.accountKey, conId=contract['con_id'], symbol=contract['symbol'] or '', currency=contract['currency'], quantity=quantity,
                averageCost=decimal_text(_obj_get(row, 'avgCost')), marketValue=decimal_text(_obj_get(entry, 'marketValue')),
                assetType=_obj_get(broker_contract, 'secType') or None,
                exchange=_obj_get(broker_contract, 'primaryExchange') or _obj_get(broker_contract, 'exchange') or None,
                name=_obj_get(broker_contract, 'localSymbol') or contract['symbol'],
                unrealizedPnl=decimal_text(_obj_get(entry, 'unrealizedPNL'))))
        cash_by_currency = {}
        cash_sources = {}
        cash_priority = {'CashBalance': 1, 'SettledCash': 2, 'TotalCashValue': 3}
        for row in rows:
            currency = base if row['currency'] == 'BASE' else row['currency']
            if row['tag'] in cash_priority and currency and len(currency) == 3 and currency.isalpha():
                value = decimal_text(row['value'])
                if value is not None and cash_priority[row['tag']] >= cash_priority.get(cash_sources.get(currency), 0):
                    cash_by_currency[currency] = CashBalance(currency=currency, amount=value)
                    cash_sources[currency] = row['tag']
        metric_values = {field: metric(tag, field) for field, tag in {'netLiquidation': 'NetLiquidation', 'unrealizedPnl': 'UnrealizedPnL', 'buyingPower': 'BuyingPower', 'maintenanceMargin': 'MaintMarginReq'}.items()}
        if metric_values['unrealizedPnl'] is None and positions and base and all(
                row.currency == base and row.unrealizedPnl is not None for row in positions):
            metric_values['unrealizedPnl'] = decimal_text(sum(Decimal(row.unrealizedPnl) for row in positions))
            provenance['metrics.unrealizedPnl'] = SourceStamp(source='ibkr.portfolio', requestCompletedAt=account_read_at)
        metrics = Metrics(**metric_values)
        for name in ('positions', 'orders', 'executions'):
            provenance[name] = SourceStamp(source=f'ibkr.{name}', requestCompletedAt=self._reconciled_at)
        for row in cash_by_currency.values():
            provenance[f'cash.{row.currency}'] = SourceStamp(source=f'ibkr.accountUpdates.{cash_sources[row.currency]}', requestCompletedAt=account_read_at)
        if base is None:
            missing.append('baseCurrency')
        missing.extend(key for key, value in metrics.model_dump().items() if value is None)
        partial = self.allow_partial and self._reconciled_at is None
        detail = '工程 fake broker 样本' if self._fixture else 'IBKR 只读快照；报价与历史行情需通过独立行情权限查询，账户快照不填充报价。'
        if partial:
            detail = '已连接 IBKR 并读取账户摘要；持仓／挂单／成交核对未完成，交易不可用。'
            if self._read_error:
                detail += f'（{self._read_error}，请核对 Gateway 的 IB API 登录模式及权限。）'
        snapshot = Snapshot(schemaVersion=1, snapshotId=str(uuid4()), accountKey=self.binding.accountKey, mode=self.binding.mode,
            sessionRevision=self.revision, sequence=self.session.snapshot().sequence + 1,
            source='fixture' if self._fixture else 'ibkr', testData=self._fixture, asOf=self._clock().isoformat(),
            connection='connected', state='permission-required' if partial else 'ready' if positions else 'empty', baseCurrency=base,
            metrics=metrics, cash=tuple(cash_by_currency.values()), positions=tuple(positions), orders=self._orders, executions=self._executions, provenance=provenance, quotes=(), capabilities=Capabilities(),
            missing=tuple(missing), detail=detail)
        return self.session.accept(snapshot)

    async def historical_data(self, con_id, period):
        if not self.healthy():
            raise ValueError('readonly broker connection is unavailable')
        current = self.session.snapshot()
        result = await fetch_ibkr_historical(self._ib, current, con_id, period,
            now=self._clock(), test_data=self._fixture,
            resolved_contract=self.market_watch.contracts.get(con_id) if hasattr(self,'market_watch') else None)
        if not self.healthy() or self.session.snapshot().sessionRevision != current.sessionRevision:
            raise ValueError('account snapshot changed during historical request')
        return result

    def close(self, detail='券商连接断开；缓存不能代表当前账户。'):
        if hasattr(self,'market_watch'):
            self.market_watch.close()
        for event, handler in self._handlers:
            event -= handler
        self._handlers.clear()
        self._ib.disconnect()
        self.session.disconnected(detail, expected_revision=self.revision)
