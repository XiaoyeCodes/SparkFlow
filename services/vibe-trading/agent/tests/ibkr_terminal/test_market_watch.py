from datetime import datetime, timezone, timedelta
from types import SimpleNamespace as NS
import asyncio
import pytest
from eventkit import Event
from src.ibkr_terminal.market_watch import MarketWatch

NOW=datetime(2026,9,6,tzinfo=timezone.utc)

class SDK:
    def __init__(self):
        self.pendingTickersEvent=Event();self.errorEvent=Event()
        self.sent=[];self.cancelled=[];self.mode=None
        self.contract=NS(conId=12,symbol='TEST',secType='STK',currency='USD',primaryExchange='NASDAQ')
    async def reqContractDetailsAsync(self,c):
        return [NS(contract=self.contract,longName='Engineering contract')]
    def reqMarketDataType(self,m): self.mode=m
    def reqMktData(self,c,*args):
        assert args==('',False,False)
        self.sent.append(c.conId)
        return NS(reqId=13,contract=c,last=float('nan'),bid=float('nan'),ask=float('nan'),close=float('nan'),time=None,rtTime=None,marketDataType=1)
    def cancelMktData(self,c): self.cancelled.append(c.conId)
    def isConnected(self): return True

def test_search_empty_account_then_quote_never_fabricates_realtime_or_prices(api_event_loop):
    async def run():
        sdk=SDK();watch=MarketWatch(sdk,clock=lambda:NOW)
        rows=await watch.search('TEST')
        assert rows[0]['conId']==12 and 'quantity' not in rows[0]
        assert not sdk.sent
        first=watch.quote(12)
        assert first['state']=='missing' and first['last'] is None
        assert sdk.mode==3 and sdk.sent==[12]
        ticker=watch.ticker
        ticker.last=100;ticker.marketDataType=3;ticker.time=NOW
        watch.on_ticks([ticker])
        delayed=watch.quote(12)
        assert delayed['state']=='delayed' and delayed['last']=='100'
        assert delayed['brokerAsOf'] is None
        assert sdk.sent==[12]  # polling shares one subscription
        watch.close();assert sdk.cancelled==[12]
    api_event_loop.run_until_complete(run())

def test_unknown_contract_and_expired_quote_are_not_trade_evidence(api_event_loop):
    async def run():
        sdk=SDK();clock=[NOW];watch=MarketWatch(sdk,clock=lambda:clock[0])
        with pytest.raises(ValueError,match='CONTRACT_NOT_RESOLVED'): watch.quote(99)
        await watch.search('TEST');watch.quote(12)
        watch.ticker.last=100;watch.on_ticks([watch.ticker])
        clock[0]+=timedelta(seconds=31)
        assert watch.quote(12)['state']=='stale'
        watch.close()
    api_event_loop.run_until_complete(run())


def test_competing_broker_session_is_diagnostic_not_endless_loading(api_event_loop):
    async def run():
        sdk=SDK();watch=MarketWatch(sdk,clock=lambda:NOW)
        await watch.search('TEST');watch.quote(12)
        sdk.errorEvent.emit(1,10197,'private account text',sdk.contract)
        result=watch.quote(12)
        assert result['state']=='permission-required' and result['detail']=='IBKR_10197'
        assert 'private' not in str(result)
        watch.close()
    api_event_loop.run_until_complete(run())


def test_market_permission_error_without_contract_is_scoped_to_active_request(api_event_loop):
    async def run():
        sdk=SDK();watch=MarketWatch(sdk,clock=lambda:NOW)
        await watch.search('TEST');watch.quote(12)
        sdk.errorEvent.emit(13,10089,'subscription required',None)
        result=watch.quote(12)
        assert result['state']=='permission-required' and result['detail']=='IBKR_10089'
        watch.close()
    api_event_loop.run_until_complete(run())

def test_search_rejects_unsupported_contracts_and_bounds_registry(api_event_loop):
    async def run():
        sdk=SDK();watch=MarketWatch(sdk,clock=lambda:NOW)
        sdk.contract.secType='OPT'
        assert await watch.search('TEST')==[]
        with pytest.raises(ValueError): await watch.search('../../secret')
        watch.close()
    api_event_loop.run_until_complete(run())


def test_market_api_requires_exact_account_and_never_grants_order_permission(tmp_path,api_event_loop):
    from fastapi.testclient import TestClient
    from test_risk_report_api import configured, HEADERS
    store,app=configured(tmp_path)
    session=app.state.sessions['paper']
    sdk=SDK()
    source=NS(binding=session.binding,session=session,_ib=sdk,_fixture=True,healthy=lambda:True)
    app.state.market_sources['paper']=source
    with store,TestClient(app,base_url='http://127.0.0.1:8765',backend_options={'loop_factory':lambda:api_event_loop}) as client:
        url='/api/ibkr-terminal/market/contracts?mode=paper&accountKey=paper:engineering&symbol=TEST'
        assert client.get(url).status_code==401
        assert client.get(url.replace('paper:engineering','paper:other'),headers=HEADERS).status_code==409
        assert client.get(url,headers=HEADERS).json()['contracts'][0]['conId']==12
        result=client.get('/api/ibkr-terminal/market/quote?mode=paper&accountKey=paper:engineering&conId=12&feed=3',headers=HEADERS)
        assert result.status_code==200
        assert result.json()['testData'] is True and result.json()['last'] is None
        assert client.post('/api/ibkr-terminal/market/quote',headers=HEADERS,json={}).status_code==403
        assert client.get('/api/ibkr-terminal/session',headers=HEADERS).json()['writesEnabled'] is False
        source.market_watch.close()
