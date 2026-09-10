"""Local user-configured manual paper execution. Live and strategy writes excluded."""
import asyncio
from datetime import datetime,timedelta,timezone
import hashlib
from typing import Literal
from uuid import uuid4
from pydantic import AwareDatetime,Field,model_validator
from fastapi.responses import JSONResponse
from .audit import append_event
from .schemas import Contract
from .risk import RiskLimits,RiskDenied,canonical
from .reviews import DraftOrder,PreviewScope,ReviewBlocked
from .paper_risk import PaperRiskSource
from .paper_flow import PaperOrderFlow
from .native_dispatch import NativeDispatcher,binding_hash
from .managed_events import ManagedOrderObserver
from .reconcile import OrderReconciler

PREFIX='/api/ibkr-terminal/paper/'
READ_PATHS={PREFIX+'status',PREFIX+'contract',PREFIX+'quote',PREFIX+'reconcile'}
WRITE_PATHS={PREFIX+p for p in ('configure','preview','confirm','cancel','stop')}


class PaperPolicyRequest(Contract):
    accountKey:str
    mode:Literal['paper']
    conIds:tuple[int,...]=Field(min_length=1,max_length=20)
    expiresAt:AwareDatetime
    limits:RiskLimits
    explicit:Literal[True]

    @model_validator(mode='after')
    def technical_limits(self):
        if not self.accountKey.startswith('paper:') or any(c<=0 for c in self.conIds):
            raise ValueError('paper scope required')
        if self.limits.maxQuoteAgeSeconds>10 or self.limits.maxAccountAgeSeconds>30:
            raise ValueError('fresh broker evidence required')
        return self


class PaperConfirmation(Contract):
    previewId:str
    bodyHash:str=Field(pattern=r'^[a-f0-9]{64}$')
    explicit:Literal[True]


class PaperCancellation(Contract):
    intentId:str
    bodyHash:str=Field(pattern=r'^[a-f0-9]{64}$')
    explicit:Literal[True]


def install_paper_routes(app,ledger,clock=lambda:datetime.now(timezone.utc)):
    app.state.paper_flow=None
    lock=asyncio.Lock()
    next_auto_sync=0.0
    sync_detail=None
    sync_owner=None
    def current_flow():
        current=app.state.paper_flow
        source=app.state.market_sources.get('paper')
        if current is not None and (source is not current.source.connection or not source.healthy()
            or source.session.revision!=current.source.scope.sessionRevision):
            app.state.paper_flow=None
            current.close()
            return None
        return current
    def connection():
        source=app.state.market_sources.get('paper')
        if source is None or not source.healthy() or source.binding.mode!='paper':
            raise RiskDenied('PAPER_ACCOUNT_UNAVAILABLE')
        if source.binding.readonly:
            raise RiskDenied('PAPER_GATEWAY_READONLY')
        return source
    def flow():
        previous=app.state.paper_flow
        current=current_flow()
        if previous is not None and current is None:
            raise RiskDenied('PAPER_SESSION_CHANGED')
        if current is None:
            raise RiskDenied('PAPER_EXECUTION_DISABLED')
        return current
    def error(exc):
        code=exc.code if isinstance(exc,(RiskDenied,ReviewBlocked)) else 'BROKER_READ_TIMEOUT' if isinstance(exc,TimeoutError) else 'PAPER_OPERATION_FAILED'
        return JSONResponse({'detail':code},status_code=409)

    @app.get(PREFIX+'status')
    async def status():
        nonlocal next_auto_sync,sync_detail,sync_owner
        current=current_flow()
        if current is not sync_owner:
            sync_owner=current
            sync_detail=None
            next_auto_sync=0.0
        source=app.state.market_sources.get('paper')
        binding=source.binding if source else None
        # Polling reads reconcile outstanding broker evidence automatically.
        # The route lock avoids racing previews/confirmations; the cooldown
        # bounds requests from multiple browser tabs and retries late fees.
        with ledger._lock:
            pending=bool(binding and any(row.reconciliationRequired or row.submission in ('SUBMITTING','UNKNOWN','RECONCILING')
                for row in ledger._records(binding.accountKey,'paper')))
        if current is not None and pending and not lock.locked() and asyncio.get_running_loop().time()>=next_auto_sync:
            async with lock:
                if current_flow() is current:
                    try:
                        await current.account_reconciliation.run()
                        sync_detail=None
                    except Exception as exc:
                        code=exc.code if isinstance(exc,(RiskDenied,ReviewBlocked)) else 'BROKER_READ_TIMEOUT' if isinstance(exc,TimeoutError) else 'PAPER_SYNC_FAILED'
                        sync_detail=code
                    finally:
                        next_auto_sync=asyncio.get_running_loop().time()+2
        state=source.session.snapshot() if source else None
        policy=current.source.scope if current else None
        with ledger._lock:
            orders=ledger._records(binding.accountKey,'paper')[-100:] if binding else []
            from .paper_views import order_display
            fills=OrderReconciler(ledger,binding.accountKey,'paper',source.session.revision).executions() if binding else []
            orders=[order_display(record,fills,ledger) for record in orders]
        writable=bool(binding and binding.mode=='paper' and binding.readonly is False)
        return {'enabled':bool(current and current.enabled and policy.expiresAt>clock()),'available':writable,
            'supportedOrderTypes':['LMT','MKT'],
            'account':(binding.brokerAccount[:2]+'***'+binding.brokerAccount[-3:]) if binding else None,
            'accountKey':binding.accountKey if binding else None,'policy':policy,'orders':orders,
            'connection':state.connection if state else 'unconfigured','state':state.state if state else 'permission-required',
            'snapshot':state,'syncError':sync_detail if pending else None,
            'detail':state.detail if state else '等待指定模拟账户连接。'}

    @app.get(PREFIX+'contract')
    async def contract(symbol:str='',conId:int=0):
        from ib_async import Contract as IbContract
        import re
        if not (conId > 0 and not symbol) and not (conId == 0 and re.fullmatch(r'[A-Za-z][A-Za-z0-9. -]{0,15}',symbol)):
            return JSONResponse({'detail':'INVALID_SYMBOL'},status_code=422)
        try:
            async with lock:
                source=connection()
                rows=await asyncio.wait_for(source._ib.reqContractDetailsAsync(IbContract(conId=conId,symbol=symbol.upper(),secType='STK',exchange='SMART',currency='USD')),4)
                return [{'conId':r.contract.conId,'symbol':r.contract.symbol,'currency':r.contract.currency,
                    'exchange':r.contract.primaryExchange,'name':r.longName} for r in rows[:20] if r.contract.secType=='STK']
        except Exception as exc:
            return error(exc)

    @app.get(PREFIX+'quote')
    async def quote(conId:int):
        if conId <= 0:
            return JSONResponse({'detail':'INVALID_CONTRACT'},status_code=422)
        try:
            async with lock:
                from .paper_quote import read_quote
                return await read_quote(connection(),conId,clock)
        except Exception as exc:
            return error(exc)

    @app.post(PREFIX+'configure')
    async def configure(request:PaperPolicyRequest):
        try:
            async with lock:
                source=connection()
                current=current_flow()
                if current is not None and current.enabled and current.source.scope.expiresAt>clock():
                    raise RiskDenied('PAPER_POLICY_ALREADY_CONFIGURED')
                if current is not None:
                    app.state.paper_flow=None
                    current.close()
                if source.binding.accountKey!=request.accountKey or source._fixture:
                    raise RiskDenied('PAPER_ACCOUNT_SCOPE')
                now=clock()
                if not now<request.expiresAt<=now+timedelta(hours=8):
                    raise RiskDenied('PAPER_POLICY_EXPIRY')
                scope=PreviewScope(source='user',accountKey=request.accountKey,mode='paper',sessionRevision=source.session.revision,
                    strategyVersion='manual-paper-v1',conIds=request.conIds,issuedAt=now,expiresAt=request.expiresAt,
                    consentReference='paper-policy:'+uuid4().hex,limits=request.limits)
                channel='paper-gateway:'+binding_hash(source.binding)
                observer=ManagedOrderObserver(OrderReconciler(ledger,request.accountKey,'paper',source.session.revision),
                    source.binding,channel_key=channel,source='ibkr',current_revision=lambda:source.session.revision,clock=clock)
                risk_source=PaperRiskSource(source,scope,clock=clock)
                source._ib.wrapper.managed_observer=observer
                dispatcher=NativeDispatcher(ledger,source._ib,source.binding,channel_key=channel,enabled=True,
                    current_revision=lambda:source.session.revision,clock=clock)
                with ledger.transaction():
                    append_event(ledger._db,request.accountKey,'USER_PAPER_POLICY_CONFIRMED',now.isoformat(),
                        {'scope':scope.model_dump(mode='json'),'scopeHash':hashlib.sha256(canonical(scope).encode()).hexdigest()})
                app.state.paper_flow=PaperOrderFlow(dispatcher,risk_source,enabled=True,clock=clock)
                from .paper_account import PaperAccountReconciliation
                app.state.paper_flow.account_reconciliation=PaperAccountReconciliation(source,observer.rec,clock=clock)
                return await status()
        except Exception as exc:
            return error(exc)

    @app.post(PREFIX+'preview')
    async def preview(draft:DraftOrder):
        try:
            async with lock:
                return await flow().preview(draft)
        except Exception as exc:
            return error(exc)

    @app.get(PREFIX+'reconcile')
    async def reconcile_account():
        try:
            async with lock:
                current=flow()
                result=await current.account_reconciliation.run()
                return {**result,'status':await status()}
        except Exception as exc:
            return error(exc)

    @app.post(PREFIX+'confirm')
    async def confirm(request:PaperConfirmation):
        try:
            async with lock:
                record=flow().confirm(request.previewId,request.bodyHash,explicit=request.explicit)
                from .paper_views import order_display
                with ledger._lock:
                    fills=OrderReconciler(ledger,record.intent.accountKey,'paper',record.intent.sessionRevision).executions()
                    return order_display(record,fills,ledger)
        except Exception as exc:
            return error(exc)

    @app.post(PREFIX+'cancel')
    async def cancel(request:PaperCancellation):
        try:
            async with lock:
                return flow().cancel(request.intentId,request.bodyHash,explicit=request.explicit)
        except Exception as exc:
            return error(exc)

    @app.post(PREFIX+'stop')
    async def stop():
        try:
            # Stop is visible immediately even while a preview is awaiting
            # broker data. Confirmation rechecks this flag before any claim.
            current=flow()
            current.enabled=False
            async with lock:
                with ledger.transaction():
                    append_event(ledger._db,current.dispatcher.binding.accountKey,'USER_PAPER_STOP',clock().isoformat(),{})
                return {'enabled':False,'detail':'新增订单已停止；已有订单继续跟踪，撤单需单独确认。'}
        except Exception as exc:
            return error(exc)
