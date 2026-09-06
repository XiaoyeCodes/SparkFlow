from types import SimpleNamespace as Item
import pytest
from src.ibkr_terminal.paper_risk import account_risk,PaperRiskSource
from src.ibkr_terminal.risk import RiskDenied
from test_orders import NOW


def rows():
    return [Item(account='TEST',tag=tag,value=value,currency='USD') for tag,value in
        [('NetLiquidation','1000'),('SettledCash','900'),('TotalCashValue','900')]]


def test_real_account_risk_uses_exact_account_and_portfolio_evidence():
    data=account_risk('TEST',rows()+[Item(account='OTHER',tag='SettledCash',value='99999',currency='USD')],[],[],daily_pnl='-12')
    assert data['settledCash']=='900' and data['dailyLoss']=='12' and data['holdings']==()


@pytest.mark.parametrize('problem',['settled','pnl','duplicate','portfolio','short','currency'])
def test_incomplete_or_unsupported_risk_never_becomes_zero(problem):
    values=rows();positions=[];portfolio=[];pnl='0'
    if problem=='settled': values=values[:1]
    if problem=='pnl': pnl=None
    if problem=='duplicate': values+=values[:1]
    if problem in ('portfolio','short','currency'):
        positions=[Item(conId=12,quantity='1',currency='USD')]
    if problem in ('short','currency'):
        portfolio=[Item(account='TEST',contract=Item(conId=12,currency='EUR' if problem=='currency' else 'USD'),
            position=-1 if problem=='short' else 1,marketValue=100)]
    with pytest.raises(RiskDenied): account_risk('TEST',values,portfolio,positions,daily_pnl=pnl)


def test_quote_uses_broker_trade_timestamp_not_delivery_time():
    from datetime import timedelta
    source=PaperRiskSource.__new__(PaperRiskSource)
    source.clock=lambda:NOW
    source.quote=None
    source.ticker=Item(ticks=[Item(tickType=4,price=100)],tickByTicks=[])
    source._ticks([source.ticker])
    assert source.quote is None  # an initial last-price snapshot has no trade-time proof
    broker_time=NOW-timedelta(hours=1)
    source.ticker.tickByTicks=[Item(tickType=1,price=100,time=broker_time)]
    source._ticks([source.ticker])
    assert source.quote==('100',broker_time)


def test_risk_load_uses_latest_daily_loss_and_rejects_changed_cash():
    from datetime import timedelta
    from test_reviews import Source,draft
    source=PaperRiskSource.__new__(PaperRiskSource)
    source.scope=Source().load(draft()).scope
    snapshot=Item(accountKey='paper:engineering',sessionRevision=1,snapshotId='fresh',state='empty',positions=(),orders=(),
        provenance={'positions':Item(requestCompletedAt=NOW.isoformat())})
    source.connection=Item(binding=Item(brokerAccount='TEST'),healthy=lambda:True,reconciliation_blocked=False,_fixture=True,
        session=Item(snapshot=lambda:snapshot))
    values=rows()
    source.ib=Item(accountSummary=lambda _:values)
    source.clock=lambda:NOW
    source.instrument=Item(conId=12,minTick='0.01',symbol='TEST')
    source.details=Item(liquidSessions=lambda:[Item(start=NOW-timedelta(hours=1),end=NOW+timedelta(hours=1))])
    source.quote=('100',NOW);source.pnl_value='-100';source.pnl_at=NOW
    source.prepared=(snapshot,account_risk('TEST',values,[],[],daily_pnl='0'),NOW)
    assert source.load(draft()).context.dailyLoss=='100'
    values[1]=Item(account='TEST',tag='SettledCash',value='10',currency='USD')
    with pytest.raises(ValueError,match='PREVIEW_SOURCE_CHANGED'):
        source.load(draft())


def test_full_paper_source_prepares_broker_evidence_and_cleans_subscriptions(api_event_loop):
    import asyncio
    from datetime import timedelta
    from test_readonly import FakeEvent
    from test_reviews import Source,draft
    from ib_async import Contract
    async def run():
        snapshot=Item(accountKey='paper:engineering',baseCurrency='USD',sessionRevision=1,snapshotId='fresh',state='empty',positions=(),orders=(),
            provenance={'positions':Item(requestCompletedAt=NOW.isoformat())})
        calls=[]
        class Broker:
            pnlEvent=FakeEvent();pendingTickersEvent=FakeEvent()
            def reqPnL(self,account): self.pnlEvent.emit(Item(account=account,modelCode='',dailyPnL=0))
            def cancelPnL(self,account): calls.append('cancel-pnl')
            def isConnected(self): return True
            async def reqContractDetailsAsync(self,contract):
                return [Item(contract=Contract(conId=12,symbol='TEST',secType='STK',currency='USD',primaryExchange='NASDAQ'),
                    minTick=0.01,validExchanges='SMART',marketRuleIds='26',
                    liquidSessions=lambda:[Item(start=NOW-timedelta(hours=1),end=NOW+timedelta(hours=1))])]
            def reqTickByTickData(self,contract,*args):
                ticker=Item(contract=contract,tickByTicks=[Item(tickType=1,price=100,time=NOW)])
                asyncio.get_running_loop().call_soon(lambda:self.pendingTickersEvent.emit([ticker]))
                return ticker
            def cancelTickByTickData(self,*args): calls.append('cancel-ticks')
            async def reqMarketRuleAsync(self,rule): return [Item(lowEdge=0,increment=0.01),Item(lowEdge=100,increment=0.05)]
            async def reqAccountSnapshotAsync(self,account):
                await asyncio.sleep(0)
                return {'portfolio':[],'values':[]}
            async def reqFreshSummaryAsync(self): return rows()
            def accountSummary(self,account): return rows()
        async def reconcile(): return True
        ib=Broker()
        connection=Item(_ib=ib,binding=Item(brokerAccount='TEST'),healthy=lambda:True,reconciliation_blocked=False,_fixture=True,
            session=Item(snapshot=lambda:snapshot),reconcile=reconcile)
        source=PaperRiskSource(connection,Source().load(draft()).scope,clock=lambda:NOW)
        prepared=await source.prepare(draft(quantity='1'))
        assert prepared.context.source=='fixture' and prepared.context.settledCash=='900'
        assert prepared.context.minTick=='0.05' and prepared.context.quoteAt==NOW and prepared.context.regularHours
        source.close()
        assert calls==['cancel-pnl','cancel-ticks']
        assert not ib.pnlEvent.handlers and not ib.pendingTickersEvent.handlers
    api_event_loop.run_until_complete(run())
