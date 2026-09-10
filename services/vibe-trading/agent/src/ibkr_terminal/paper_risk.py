"""Broker evidence for manual paper orders. No invented account numbers."""
import asyncio
from datetime import datetime, timezone
from decimal import Decimal
from .broker_views import decimal_text
from .risk import RiskContext, RiskDenied, Holding
from .order_codec import ResolvedInstrument
from .reviews import PreviewInput, ReviewBlocked


def account_risk(account, values, portfolio, positions, *, daily_pnl, allow_available_funds=False):
    def metric(tag):
        found = [decimal_text(r.value) for r in values if r.account == account and r.tag == tag and r.currency == 'USD']
        if len(found) != 1 or found[0] is None or Decimal(found[0]) < 0:
            raise RiskDenied('MISSING_ACCOUNT_DATA')
        return found[0]
    pnl = decimal_text(daily_pnl)
    if pnl is None:
        raise RiskDenied('DAILY_PNL_UNAVAILABLE')
    holdings = []
    for row in portfolio:
        if row.account != account:
            continue
        quantity, value = decimal_text(row.position), decimal_text(row.marketValue)
        if quantity is None or value is None or Decimal(quantity) < 0 or Decimal(value) < 0 or row.contract.currency != 'USD':
            raise RiskDenied('INCOMPLETE_HOLDINGS')
        if Decimal(quantity):
            holdings.append(Holding(conId=row.contract.conId, quantity=quantity, marketValue=value, currency='USD'))
    expected = {p.conId: Decimal(p.quantity) for p in positions if Decimal(p.quantity)}
    if len({h.conId for h in holdings}) != len(holdings) or {h.conId:Decimal(h.quantity) for h in holdings} != expected:
        raise RiskDenied('PORTFOLIO_RECONCILIATION_REQUIRED')
    settled_present = any(r.account == account and r.tag == 'SettledCash' and r.currency == 'USD' for r in values)
    funds = {'settledCash':metric('SettledCash')} if settled_present or not allow_available_funds else {
        'settledCash':None, 'availableFunds':metric('AvailableFunds')}
    return dict(**funds,totalCash=metric('TotalCashValue'),netLiquidation=metric('NetLiquidation'),
        dailyLoss=format(max(-Decimal(pnl),Decimal(0)),'f'),holdings=tuple(holdings))


class PaperRiskSource:
    """One selected contract and bounded subscriptions on the account owner loop."""
    def __init__(self, connection, scope, *, clock=None):
        self.connection, self.scope = connection, scope
        self.ib = connection._ib
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.instrument = self.details = self.ticker = self.prepared = None
        self.quote = None
        self.reference = None
        self.quote_error = None
        self._market_changed = asyncio.Event()
        self.pnl_value = self.pnl_at = None
        self.ib.pnlEvent += self._pnl
        self.ib.pendingTickersEvent += self._ticks
        self.ib.errorEvent += self._quote_error
        self._pnl_subscribed = False
        try:
            self.ib.reqPnL(connection.binding.brokerAccount)
            self._pnl_subscribed = True
        except BaseException:
            self.close()
            raise

    def _pnl(self, row):
        if row.account == self.connection.binding.brokerAccount and not row.modelCode:
            self.pnl_value, self.pnl_at = decimal_text(row.dailyPnL), self.clock()
            self._market_changed.set()

    def _quote_error(self, req_id, code, *args):
        if self.ticker is None or self.ib.wrapper.reqId2Ticker.get(req_id) is not self.ticker:
            return
        if code in (354,10089,10090,10167,10186,10189,10190,10197):
            self.quote_error=f'IBKR_{code}'
            self._market_changed.set()

    def _ticks(self, tickers):
        if self.ticker is None or self.ticker not in tickers:
            return
        # Ordinary initial last-price snapshots carry receipt time, not trade
        # time. Tick-by-tick Last includes IBKR's actual tick timestamp.
        trades = [t for t in self.ticker.tickByTicks if getattr(t,'tickType',None) == 1]
        if trades:
            tick = trades[-1]
            price = decimal_text(tick.price)
            self.quote = (price, tick.time) if (price is not None and Decimal(price)>0
                and isinstance(tick.time,datetime) and tick.time.tzinfo is not None) else None
            if self.quote is not None:
                self.quote_error=None
            if hasattr(self,'_market_changed'):
                self._market_changed.set()

    async def resolve(self, symbol=None, con_id=None):
        from ib_async import Contract
        contract = Contract(conId=con_id or 0, symbol=symbol or '', secType='STK', exchange='SMART', currency='USD')
        rows = await asyncio.wait_for(self.ib.reqContractDetailsAsync(contract), 4)
        if len(rows) != 1:
            raise RiskDenied('AMBIGUOUS_CONTRACT')
        detail = rows[0]
        native = detail.contract
        if (native.secType != 'STK' or native.currency != 'USD'
            or native.primaryExchange not in ('NASDAQ','NYSE','ARCA','AMEX','BATS','ISLAND','IEX','NYSEARCA')
            or native.multiplier not in ('','1')):
            raise RiskDenied('UNSUPPORTED_CONTRACT')
        instrument = ResolvedInstrument(conId=native.conId,symbol=native.symbol,secType='STK',currency='USD',
            exchange='SMART',primaryExchange=native.primaryExchange,multiplier='1',minTick=decimal_text(detail.minTick),minQuantity='1')
        if self.instrument is None or self.instrument.conId != instrument.conId:
            if self.ticker is not None:
                self.ib.cancelTickByTickData(self.ticker.contract, 'Last')
            self.quote = None
            self.reference = None
            self.quote_error = None
            self.ticker = self.ib.reqTickByTickData(native, 'Last', 0, False)
        self.instrument, self.details = instrument, detail
        return instrument

    def _fresh_trade(self):
        return self.quote is not None and 0 <= (self.clock()-self.quote[1]).total_seconds() <= self.scope.limits.maxQuoteAgeSeconds

    async def _prepare_reference(self, draft, portfolio, observed_at):
        self.reference = None
        if self._fresh_trade():
            return
        # Portfolio marketPrice is an IBKR valuation, not a realtime quote.
        # It is obtained from this completed account read, never averageCost.
        matches = [r for r in portfolio if r.account == self.connection.binding.brokerAccount
            and r.contract.conId == draft.conId and r.contract.currency == 'USD' and r.position > 0]
        if len(matches) == 1:
            price = decimal_text(getattr(matches[0], 'marketPrice', None))
            if price is not None and Decimal(price) > 0:
                self.reference = (price, observed_at, 'portfolio', 'snapshot')
                return
        # Request subscription-free delayed data for a new holding. IBKR returns
        # realtime automatically when entitled. Snapshot receipt is labelled as
        # such; it is never passed off as a tick-by-tick trade timestamp.
        self.ib.reqMarketDataType(3)
        ticker = self.ib.reqMktData(self.details.contract, '', False, False)
        try:
            for _ in range(25):
                if self._fresh_trade():
                    return
                price = decimal_text(getattr(ticker, 'last', None))
                if price is not None and Decimal(price) > 0:
                    state = 'delayed' if getattr(ticker, 'marketDataType', 3) in (3, 4) else 'snapshot'
                    self.reference = (price, self.clock(), 'broker-snapshot', state)
                    return
                await asyncio.sleep(.1)
        finally:
            self.ib.cancelMktData(self.details.contract)
        raise ReviewBlocked('PAPER_REFERENCE_UNAVAILABLE')

    async def prepare(self, draft):
        if not self.connection.healthy() or self.connection.reconciliation_blocked:
            raise RiskDenied('RECONCILIATION_REQUIRED')
        if draft.conId not in self.scope.conIds:
            raise RiskDenied('CONTRACT_SCOPE')
        if self.instrument is None or self.instrument.conId != draft.conId:
            await self.resolve(con_id=draft.conId)
        try:
            regular = any(s.start <= self.clock() < s.end for s in self.details.liquidSessions())
        except Exception as exc:
            raise ReviewBlocked('TRADING_HOURS_UNAVAILABLE') from exc
        if not regular:
            raise ReviewBlocked('OUTSIDE_RTH')
        if draft.orderType == 'LMT':
            exchanges = self.details.validExchanges.split(',')
            rules = self.details.marketRuleIds.split(',')
            if 'SMART' not in exchanges or len(exchanges) != len(rules):
                raise RiskDenied('CONTRACT_MARKET_RULE_UNAVAILABLE')
            rule_id = rules[exchanges.index('SMART')]
            if not rule_id.isdigit():
                raise RiskDenied('CONTRACT_MARKET_RULE_UNAVAILABLE')
            ladder = await self.ib.reqMarketRuleAsync(int(rule_id))
            applicable = [r for r in ladder or [] if decimal_text(r.lowEdge) is not None and Decimal(str(r.lowEdge)) <= Decimal(draft.limitPrice)]
            if not applicable:
                raise RiskDenied('CONTRACT_MARKET_RULE_UNAVAILABLE')
            tick = decimal_text(max(applicable, key=lambda r:Decimal(str(r.lowEdge))).increment)
            if tick is None or Decimal(tick) <= 0:
                raise RiskDenied('CONTRACT_MARKET_RULE_UNAVAILABLE')
            self.instrument = self.instrument.model_copy(update={'minTick':tick})
        if not await self.connection.reconcile():
            raise RiskDenied('RECONCILIATION_REQUIRED')
        # Account summary and portfolio are separate completed broker reads.
        raw = await asyncio.wait_for(self.ib.reqAccountSnapshotAsync(self.connection.binding.brokerAccount), 4)
        values = await asyncio.wait_for(self.ib.reqFreshSummaryAsync(), 4)
        snapshot = self.connection.session.snapshot()
        if snapshot.baseCurrency != 'USD' or snapshot.state not in ('ready','empty'):
            raise RiskDenied('RECONCILIATION_REQUIRED')
        if snapshot.orders:
            # Unknown external remaining risk is never silently excluded.
            raise RiskDenied('EXTERNAL_ORDER_RISK_UNKNOWN')
        account_at = self.clock()
        # Market-data entitlement is not trading permission. Use a labelled
        # broker valuation/snapshot when the realtime subscription is absent.
        await self._prepare_reference(draft, raw['portfolio'], account_at)
        async def wait_for_evidence():
            while self.pnl_at is None:
                self._market_changed.clear()
                await self._market_changed.wait()
        try:
            await asyncio.wait_for(wait_for_evidence(),3)
        except TimeoutError:
            raise ReviewBlocked('DAILY_PNL_UNAVAILABLE') from None
        risk = account_risk(self.connection.binding.brokerAccount,values,raw['portfolio'],snapshot.positions,
            daily_pnl=self.pnl_value,allow_available_funds=self.scope.mode == 'paper')
        self.prepared = (snapshot, risk, account_at)
        return self.load(draft)

    def load(self, draft):
        reference = (*self.quote, 'trade', 'realtime') if self._fresh_trade() else getattr(self, 'reference', None)
        if self.prepared is None or self.instrument is None or reference is None or self.pnl_at is None:
            raise ReviewBlocked('MISSING_QUOTE_AND_RISK_PROFILE')
        if draft.conId != self.instrument.conId or not self.connection.healthy() or self.connection.reconciliation_blocked:
            raise ReviewBlocked('RECONCILIATION_REQUIRED')
        snapshot, risk, account_at = self.prepared
        current = self.connection.session.snapshot()
        if current.sessionRevision != self.scope.sessionRevision or current.state not in ('ready','empty'):
            raise ReviewBlocked('RECONCILIATION_REQUIRED')
        quantities = lambda positions: sorted((p.conId, Decimal(p.quantity)) for p in positions)
        if quantities(current.positions) != quantities(snapshot.positions) or current.orders != snapshot.orders:
            raise ReviewBlocked('PREVIEW_SOURCE_CHANGED')
        values = self.ib.cachedAccountSummary(self.connection.binding.brokerAccount)
        funding_tag = ('SettledCash','settledCash') if risk['settledCash'] is not None else ('AvailableFunds','availableFunds')
        for tag, key in (funding_tag,('TotalCashValue','totalCash'),('NetLiquidation','netLiquidation')):
            latest = [decimal_text(r.value) for r in values if r.account == self.connection.binding.brokerAccount and r.tag == tag and r.currency == 'USD']
            if len(latest) != 1 or latest[0] != risk[key]:
                raise ReviewBlocked('PREVIEW_SOURCE_CHANGED')
        if self.pnl_value is None:
            raise ReviewBlocked('DAILY_PNL_UNAVAILABLE')
        risk = {**risk, 'dailyLoss':format(max(-Decimal(self.pnl_value),Decimal(0)),'f')}
        now = self.clock()
        try:
            regular = any(s.start <= now < s.end for s in self.details.liquidSessions())
        except Exception as error:
            raise ReviewBlocked('TRADING_HOURS_UNAVAILABLE') from error
        context = RiskContext(accountKey=snapshot.accountKey,mode='paper',sessionRevision=snapshot.sessionRevision,
            snapshotId=snapshot.snapshotId,source='fixture' if self.connection._fixture else 'ibkr',connected=True,reconciled=True,
            asOf=min(account_at,self.pnl_at,datetime.fromisoformat(snapshot.provenance['positions'].requestCompletedAt)),
            quoteAt=reference[1],quoteState=reference[3],referenceKind=reference[2],conId=draft.conId,referencePrice=reference[0],
            currency='USD',baseCurrency='USD',market='US',secType='STK',multiplier='1',minTick=self.instrument.minTick,
            minQuantity='1',regularHours=regular,halted=False,openOrdersComplete=True,**risk)
        return PreviewInput(context=context,scope=self.scope,symbol=self.instrument.symbol,currency='USD')

    def close(self):
        self.ib.pnlEvent -= self._pnl
        self.ib.pendingTickersEvent -= self._ticks
        self.ib.errorEvent -= self._quote_error
        if self.ib.isConnected():
            if self._pnl_subscribed:
                self.ib.cancelPnL(self.connection.binding.brokerAccount)
            if self.ticker is not None:
                self.ib.cancelTickByTickData(self.ticker.contract, 'Last')
