"""Bounded, read-only market browsing, independent of positions and trading grants."""
import asyncio
import re
from collections import OrderedDict
from datetime import datetime, timezone
from decimal import Decimal
from .broker_views import decimal_text


class MarketWatch:
    def __init__(self, sdk, *, clock=None):
        self.ib=sdk
        self.clock=clock or (lambda:datetime.now(timezone.utc))
        self.contracts=OrderedDict()
        self.ticker=None
        self.market_request_id=None
        self.observed_at=None
        self.error=None
        self.feed=3
        self.lock=asyncio.Lock()
        sdk.pendingTickersEvent+=self.on_ticks
        sdk.errorEvent+=self.on_error

    async def search(self,symbol):
        from ib_async import Contract
        if not re.fullmatch(r'[A-Za-z][A-Za-z0-9. -]{0,15}',symbol):
            raise ValueError('INVALID_SYMBOL')
        async with self.lock:
            rows=await asyncio.wait_for(self.ib.reqContractDetailsAsync(Contract(symbol=symbol.upper(),secType='STK',exchange='SMART',currency='USD')),4)
            result=[]
            for row in rows[:20]:
                c=row.contract
                if c.secType!='STK' or c.currency!='USD' or c.conId<=0:
                    continue
                self.contracts[c.conId]=c
                self.contracts.move_to_end(c.conId)
                result.append(dict(conId=c.conId,symbol=c.symbol,currency=c.currency,exchange=c.primaryExchange,name=row.longName))
            while len(self.contracts)>100:
                self.contracts.popitem(last=False)
            return result

    def on_ticks(self,tickers):
        if self.ticker is not None and any(t is self.ticker for t in tickers):
            self.observed_at=self.clock()

    def on_error(self,req_id,code,message,contract=None,*args):
        if self.ticker is None or code not in (354,10167,10168,10089,10090,10091,10197):
            return
        ticker_request_id = getattr(self.ticker, 'reqId', None)
        same_contract = contract is not None and contract.conId == self.ticker.contract.conId
        same_request = ((ticker_request_id is not None and req_id == ticker_request_id)
            or (self.market_request_id is not None and req_id == self.market_request_id))
        if same_contract or same_request:
            self.error=f'IBKR_{code}'

    def quote(self,con_id,feed=3):
        if con_id not in self.contracts:
            raise ValueError('CONTRACT_NOT_RESOLVED')
        if feed not in (1,2,3,4):
            raise ValueError('INVALID_FEED')
        if self.ticker is None or self.ticker.contract.conId!=con_id or self.feed!=feed:
            if self.ticker is not None:
                self.ib.cancelMktData(self.ticker.contract)
            self.ticker=None;self.market_request_id=None;self.observed_at=None;self.error=None;self.feed=feed
            self.ib.reqMarketDataType(feed)
            # Streaming only: never regulatory snapshots or purchased data.
            self.market_request_id = getattr(getattr(self.ib, 'client', None), '_reqIdSeq', None)
            self.ticker=self.ib.reqMktData(self.contracts[con_id],'',False,False)
        def price(name):
            value=decimal_text(getattr(self.ticker,name,None))
            return value if value is not None and Decimal(value)>0 else None
        prices={name:price(name) for name in ('last','bid','ask','close')}
        state={1:'realtime',2:'frozen',3:'delayed',4:'delayed-frozen'}.get(self.ticker.marketDataType,'missing')
        if not self.ib.isConnected(): state='disconnected'
        elif self.error and self.observed_at is None: state='permission-required'
        elif not any(prices.values()): state='permission-required' if self.error else 'missing'
        elif self.observed_at is None or (self.clock()-self.observed_at).total_seconds()>30: state='stale'
        broker_time=getattr(self.ticker,'rtTime',None)
        return dict(conId=con_id,state=state,**prices,observedAt=self.observed_at,
            brokerAsOf=broker_time if isinstance(broker_time,datetime) and broker_time.tzinfo else None,
            source='ibkr.reqMktData',detail=self.error,requestedFeed=feed)

    def close(self):
        self.ib.pendingTickersEvent-=self.on_ticks
        self.ib.errorEvent-=self.on_error
        if self.ticker is not None and self.ib.isConnected(): self.ib.cancelMktData(self.ticker.contract)
        self.ticker=None
        self.market_request_id=None
