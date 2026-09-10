"""Bounded, display-only broker quotes for the manual paper order ticket."""
import asyncio
from datetime import datetime, timezone
from decimal import Decimal
from .broker_views import decimal_text
from .risk import RiskDenied


def price(value):
    text = decimal_text(value)
    return text if text is not None and 0 < Decimal(text) < Decimal('1e100') else None


async def read_quote(source, con_id, clock=lambda: datetime.now(timezone.utc)):
    from ib_async import Contract
    rows = await asyncio.wait_for(source._ib.reqContractDetailsAsync(
        Contract(conId=con_id, secType='STK', exchange='SMART', currency='USD')), 4)
    if len(rows) != 1 or rows[0].contract.secType != 'STK' or rows[0].contract.currency != 'USD':
        raise RiskDenied('UNSUPPORTED_CONTRACT')
    detail = rows[0]
    ticker = source._ib.reqMktData(detail.contract, '', True, False)
    try:
        for _ in range(20):
            if price(ticker.bid) is not None and price(ticker.ask) is not None:
                break
            await asyncio.sleep(0.1)
        now = clock()
        try:
            sessions = detail.liquidSessions()
            regular = any(s.start <= now < s.end for s in sessions)
            next_open = min((s.start for s in sessions if s.start > now), default=None)
        except Exception:
            regular, next_open = None, None
        values = {key: price(getattr(ticker, key, None)) for key in ('bid', 'ask', 'last', 'close', 'high', 'low')}
        kind = {1: 'realtime', 2: 'frozen', 3: 'delayed', 4: 'delayed-frozen'}.get(ticker.marketDataType, 'missing')
        return dict(conId=detail.contract.conId, symbol=detail.contract.symbol,
            name=detail.longName, currency='USD', exchange=detail.contract.primaryExchange,
            minTick=price(detail.minTick), **values,
            state=kind if any(values.values()) else 'missing', regularHours=regular,
            nextOpen=next_open.isoformat() if next_open else None, fetchedAt=now.isoformat(),
            source='IBKR Gateway', detail='行情仅供填写参考；发送订单前将单独校验最新券商行情。')
    finally:
        source._ib.cancelMktData(detail.contract)
