"""Loopback account service. Order reviews never invoke a broker transport."""
import secrets
import asyncio
import re
from datetime import datetime, timezone
from typing import Literal

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse

from .store import SnapshotStore
from .session import AccountSession
from .reviews import DraftOrder, OrderReviewService, PreviewConfirmation, ReviewBlocked
from .strategy import StrategyCatalog
from .backtests import BacktestArchive, BacktestError
from .workers import BacktestJobs, JobError
from .analytics import analyze_snapshot
from .intelligence import AiConsentStore
from .reports import LocalReportStore, ReportError, ReportEvidenceBundle
from .report_jobs import ReportJobs, ReportJobError
from .schemas import Contract
from .market_data import MarketDataStore, dataset, bind_snapshot
from .strategy_runtime import StrategyRuntime


class ReportRequest(Contract):
    mode: Literal['paper', 'live']
    accountKey: str
    evidence: ReportEvidenceBundle | None = None


class AccountScopeRequest(Contract):
    mode: Literal['paper', 'live']
    accountKey: str


def create_app(*, store: SnapshotStore, session_token: str, port: int = 8765, heartbeat_seconds: float = 5,
    order_reviews: OrderReviewService | None = None, strategy_catalog: StrategyCatalog | None = None,
    backtest_archive: BacktestArchive | None = None, backtest_jobs: BacktestJobs | None = None,
    ai_consents: AiConsentStore | None = None, report_store: LocalReportStore | None = None, report_jobs: ReportJobs | None = None,
    market_data_store: MarketDataStore | None = None, strategy_runtime: StrategyRuntime | None = None, paper_ledger=None,
    clock=lambda: datetime.now(timezone.utc)) -> FastAPI:
    if not session_token:
        raise ValueError('a local session token is required')
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.state.sessions = {mode: AccountSession(mode, store) for mode in ('paper', 'live')}
    app.state.market_sources = {}
    app.state.market_locks = {}
    from .paper_api import WRITE_PATHS, install_paper_routes
    if paper_ledger is not None:
        install_paper_routes(app, paper_ledger, clock=clock)
    allowed_hosts = {f'127.0.0.1:{port}'}
    allowed_origins = {f'http://127.0.0.1:{port}', 'http://127.0.0.1:5180', 'http://127.0.0.1:5173'}

    def boundary(headers):
        origin = headers.get('origin')
        if headers.get('host') not in allowed_hosts or (origin is not None and origin not in allowed_origins) or headers.get('sec-fetch-site') == 'cross-site':
            return 403
        token = headers.get('authorization', '').removeprefix('Bearer ')
        return 0 if secrets.compare_digest(token, session_token) else 401

    @app.middleware('http')
    async def local_boundary(request: Request, call_next):
        denied = boundary(request.headers)
        if denied:
            return JSONResponse({'detail': 'local session or origin rejected'}, status_code=denied)
        review_write = (request.method == 'POST' and order_reviews is not None
            and (request.url.path == '/api/ibkr-terminal/orders/preview'
                or (request.url.path.startswith('/api/ibkr-terminal/orders/previews/') and request.url.path.endswith('/confirm'))))
        cancel_write = (request.method == 'POST' and backtest_jobs is not None
            and request.url.path.startswith('/api/ibkr-terminal/backtests/jobs/') and request.url.path.endswith('/cancel'))
        report_write = request.method == 'POST' and report_store is not None and (request.url.path == '/api/ibkr-terminal/reports'
            or (report_jobs is not None and (request.url.path == '/api/ibkr-terminal/reports/jobs'
                or re.fullmatch(r'/api/ibkr-terminal/reports/jobs/report-job:[0-9a-f]{32}/cancel', request.url.path) is not None)))
        runtime_stop = request.method == 'POST' and strategy_runtime is not None and re.fullmatch(
            r'/api/ibkr-terminal/strategy-runtime/activation:[0-9a-f]{32}/stop', request.url.path) is not None
        paper_write = paper_ledger is not None and request.method == 'POST' and request.url.path in WRITE_PATHS
        if request.method not in ('GET', 'HEAD') and not review_write and not cancel_write and not report_write and not runtime_stop and not paper_write:
            return JSONResponse({'detail': 'terminal writes are disabled'}, status_code=403)
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        return response

    @app.get('/api/ibkr-terminal/session')
    def session():
        return {'readonly': True, 'accounts': [{'mode': mode, 'accountKey': value.binding.accountKey} for mode, value in app.state.sessions.items() if value.binding],
            'orderReviewEnabled': order_reviews is not None,
            'backtestsEnabled': strategy_catalog is not None and backtest_archive is not None,
            'reportsEnabled': report_store is not None,
            'reportJobsEnabled': report_jobs is not None,
            'aiSharingConfigured': ai_consents is not None,
            'marketDataEnabled': market_data_store is not None,
            'strategyRuntimeEnabled': strategy_runtime is not None,
            'writesEnabled': False}

    @app.get('/api/ibkr-terminal/snapshot')
    def snapshot(mode: Literal['paper', 'live'], accountKey: str | None = None):
        state = app.state.sessions[mode].snapshot()
        if accountKey is not None and accountKey != state.accountKey:
            return JSONResponse({'detail': 'account binding mismatch'}, status_code=403)
        return state

    def scoped_snapshot(mode, account_key):
        state = app.state.sessions[mode].snapshot()
        if state.accountKey != account_key:
            return None
        return state

    @app.get('/api/ibkr-terminal/analysis/risk')
    def risk_analysis(mode: Literal['paper', 'live'], accountKey: str):
        state = scoped_snapshot(mode, accountKey)
        if state is None:
            return JSONResponse({'detail': 'account binding mismatch'}, status_code=403)
        return analyze_snapshot(state, now=clock())

    @app.get('/api/ibkr-terminal/market-data')
    async def historical_market_data(mode: Literal['paper', 'live'], accountKey: str, conId: int,
        period: Literal['1D', '5D', '1M', '6M', '1Y']):
        state = scoped_snapshot(mode, accountKey)
        if state is None:
            return JSONResponse({'detail': 'account binding mismatch'}, status_code=403)
        source = app.state.market_sources.get(mode)
        watch=getattr(source,'market_watch',None)
        if conId not in {position.conId for position in state.positions} and (watch is None or conId not in watch.contracts):
            return JSONResponse({'detail': 'contract is not in the current account snapshot'}, status_code=403)
        value = market_data_store.get(mode, accountKey, conId, period, now=clock()) if market_data_store is not None else None
        if value is not None and value.state != 'stale':
            return bind_snapshot(value,state)
        source = app.state.market_sources.get(mode)
        if source is not None and market_data_store is not None:
            key = (mode, accountKey, conId, period)
            lock = app.state.market_locks.setdefault(key, asyncio.Lock())
            async with lock:
                checked = market_data_store.get(mode, accountKey, conId, period, now=clock())
                if checked is not None and checked.state != 'stale':
                    return bind_snapshot(checked,state)
                try:
                    fetched = await source.historical_data(conId, period)
                    if fetched.accountKey != accountKey or app.state.sessions[mode].revision != state.sessionRevision:
                        return JSONResponse({'detail': 'historical data identity changed'}, status_code=409)
                    return bind_snapshot(market_data_store.save(fetched),state)
                except Exception as exc:
                    if checked is not None:
                        return bind_snapshot(checked,state)
                    return dataset(accountKey=accountKey, mode=mode, snapshotId=state.snapshotId, conId=conId,
                        period=period, barSize={'1D': '1 min', '5D': '15 mins', '1M': '1 hour', '6M': '1 day', '1Y': '1 day'}[period],
                        timezone='UTC', source='fixture.ibkr.historicalData' if state.testData else 'ibkr.historicalData',
                        testData=state.testData, asOf=clock(), state='error',
                        missing=('historical-market-data',)+(('IBKR_'+str(exc.code),) if isinstance(getattr(exc,'code',None),int) else ()), bars=())
        if value is not None:
            return bind_snapshot(value,state)
        bar_size = {'1D': '1 min', '5D': '15 mins', '1M': '1 hour', '6M': '1 day', '1Y': '1 day'}[period]
        return dataset(accountKey=accountKey, mode=mode, snapshotId=state.snapshotId, conId=conId,
            period=period, barSize=bar_size, timezone='UTC', source='fixture.unavailable' if state.testData else 'ibkr',
            testData=state.testData, asOf=clock(), state='permission-required', missing=('historical-market-data',), bars=())

    def market_source(mode,account_key):
        source=app.state.market_sources.get(mode)
        if source is None or source.binding.accountKey!=account_key or not source.healthy():
            raise ValueError('ACCOUNT_MARKET_SOURCE_UNAVAILABLE')
        if not hasattr(source,'market_watch'):
            from .market_watch import MarketWatch
            source.market_watch=MarketWatch(source._ib,clock=clock)
        return source

    @app.get('/api/ibkr-terminal/market/contracts')
    async def market_contracts(mode:Literal['paper','live'],accountKey:str,symbol:str):
        try:
            source=market_source(mode,accountKey)
            revision=source.session.revision
            rows=await source.market_watch.search(symbol)
            if not source.healthy() or source.session.revision!=revision:
                raise ValueError('ACCOUNT_MARKET_SOURCE_CHANGED')
            return {'accountKey':accountKey,'mode':mode,'sessionRevision':revision,'contracts':rows}
        except Exception:
            return JSONResponse({'detail':'合约查询不可用，请核对账户连接和代码。'},status_code=409)

    @app.get('/api/ibkr-terminal/market/quote')
    async def market_quote(mode:Literal['paper','live'],accountKey:str,conId:int,feed:int=3):
        try:
            if feed not in (1,2,3,4):
                raise ValueError('INVALID_FEED')
            source=market_source(mode,accountKey)
            value=source.market_watch.quote(conId,feed)
            return {**value,'accountKey':accountKey,'mode':mode,'sessionRevision':source.session.revision,
                'testData':source._fixture,'source':'fixture.reqMktData' if source._fixture else value['source']}
        except Exception:
            return JSONResponse({'detail':'行情不可用，请先查询并选择合约。'},status_code=409)

    @app.get('/api/ibkr-terminal/ai/status')
    def ai_status(mode: Literal['paper', 'live'], accountKey: str):
        if scoped_snapshot(mode, accountKey) is None:
            return JSONResponse({'detail': 'account binding mismatch'}, status_code=403)
        grant = ai_consents.active(mode, accountKey, now=clock()) if ai_consents is not None else None
        active = None if grant is None else {'grantId': grant.grantId, 'provider': grant.provider, 'model': grant.model,
            'fields': grant.fields, 'expiresAt': grant.expiresAt, 'requestsRemaining': grant.maxRequests - grant.requestsUsed}
        return {'sharingEnabled': grant is not None, 'activeGrant': active, 'modelCalls': False}

    @app.get('/api/ibkr-terminal/strategy-runtime')
    def runtime_list(mode: Literal['paper', 'live'], accountKey: str):
        if strategy_runtime is None:
            return JSONResponse({'detail': 'STRATEGY_RUNTIME_DISABLED'}, status_code=403)
        if scoped_snapshot(mode, accountKey) is None:
            return JSONResponse({'detail': 'account binding mismatch'}, status_code=403)
        return strategy_runtime.list(accountKey)

    @app.get('/api/ibkr-terminal/strategy-runtime/{activation_id}/decisions')
    def runtime_decisions(activation_id: str, mode: Literal['paper', 'live'], accountKey: str):
        if strategy_runtime is None:
            return JSONResponse({'detail': 'STRATEGY_RUNTIME_DISABLED'}, status_code=403)
        if scoped_snapshot(mode, accountKey) is None:
            return JSONResponse({'detail': 'account binding mismatch'}, status_code=403)
        try:
            activation = strategy_runtime.get(activation_id)
        except ValueError:
            return JSONResponse({'detail': 'ACTIVATION_MISSING'}, status_code=404)
        if activation.mode != mode or activation.accountKey != accountKey:
            return JSONResponse({'detail': 'ACTIVATION_SCOPE_MISMATCH'}, status_code=403)
        return strategy_runtime.decisions(activation_id)

    @app.post('/api/ibkr-terminal/strategy-runtime/{activation_id}/stop')
    def runtime_stop(activation_id: str, request: AccountScopeRequest):
        if strategy_runtime is None:
            return JSONResponse({'detail': 'STRATEGY_RUNTIME_DISABLED'}, status_code=403)
        if scoped_snapshot(request.mode, request.accountKey) is None:
            return JSONResponse({'detail': 'account binding mismatch'}, status_code=403)
        try:
            activation = strategy_runtime.get(activation_id)
        except ValueError:
            return JSONResponse({'detail': 'ACTIVATION_MISSING'}, status_code=404)
        if activation.mode != request.mode or activation.accountKey != request.accountKey:
            return JSONResponse({'detail': 'ACTIVATION_SCOPE_MISMATCH'}, status_code=403)
        return strategy_runtime.stop(activation_id)

    @app.post('/api/ibkr-terminal/reports')
    def create_report(request: ReportRequest):
        if report_store is None:
            return JSONResponse({'detail': 'REPORTS_DISABLED'}, status_code=403)
        state = scoped_snapshot(request.mode, request.accountKey)
        if state is None:
            return JSONResponse({'detail': 'account binding mismatch'}, status_code=403)
        if state.connection != 'connected' or state.state not in ('ready', 'empty'):
            return JSONResponse({'detail': 'SNAPSHOT_UNAVAILABLE'}, status_code=409)
        return report_store.create(state, evidence=request.evidence)

    @app.get('/api/ibkr-terminal/reports')
    def reports(mode: Literal['paper', 'live'], accountKey: str):
        if report_store is None:
            return JSONResponse({'detail': 'REPORTS_DISABLED'}, status_code=403)
        if scoped_snapshot(mode, accountKey) is None:
            return JSONResponse({'detail': 'account binding mismatch'}, status_code=403)
        return report_store.list(mode, accountKey)

    @app.post('/api/ibkr-terminal/reports/jobs')
    def create_report_job(request: ReportRequest):
        if report_jobs is None:
            return JSONResponse({'detail': 'REPORT_JOBS_DISABLED'}, status_code=403)
        state = scoped_snapshot(request.mode, request.accountKey)
        if state is None:
            return JSONResponse({'detail': 'account binding mismatch'}, status_code=403)
        if state.connection != 'connected' or state.state not in ('ready', 'empty'):
            return JSONResponse({'detail': 'SNAPSHOT_UNAVAILABLE'}, status_code=409)
        return report_jobs.submit(state, request.evidence)

    @app.get('/api/ibkr-terminal/reports/jobs')
    def report_job_list(mode: Literal['paper', 'live'], accountKey: str):
        if report_jobs is None or scoped_snapshot(mode, accountKey) is None:
            return JSONResponse({'detail': 'REPORT_JOBS_DISABLED_OR_SCOPE_MISMATCH'}, status_code=403)
        return report_jobs.list(mode, accountKey)

    @app.get('/api/ibkr-terminal/reports/jobs/{job_id}')
    def report_job(job_id: str, mode: Literal['paper', 'live'], accountKey: str):
        if report_jobs is None or scoped_snapshot(mode, accountKey) is None:
            return JSONResponse({'detail': 'REPORT_JOBS_DISABLED_OR_SCOPE_MISMATCH'}, status_code=403)
        try:
            return report_jobs.get(job_id, mode=mode, account_key=accountKey)
        except ReportJobError as error:
            return JSONResponse({'detail': error.code}, status_code=403 if error.code == 'JOB_SCOPE_MISMATCH' else 404)

    @app.post('/api/ibkr-terminal/reports/jobs/{job_id}/cancel')
    def cancel_report_job(job_id: str, request: AccountScopeRequest):
        if report_jobs is None or scoped_snapshot(request.mode, request.accountKey) is None:
            return JSONResponse({'detail': 'REPORT_JOBS_DISABLED_OR_SCOPE_MISMATCH'}, status_code=403)
        try:
            return report_jobs.cancel(job_id, mode=request.mode, account_key=request.accountKey)
        except ReportJobError as error:
            return JSONResponse({'detail': error.code}, status_code=403 if error.code == 'JOB_SCOPE_MISMATCH' else 404)

    @app.get('/api/ibkr-terminal/reports/{report_hash}/{kind}')
    def report_file(report_hash: str, kind: Literal['json', 'markdown', 'html', 'pdf'], mode: Literal['paper', 'live'], accountKey: str):
        if report_store is None:
            return JSONResponse({'detail': 'REPORTS_DISABLED'}, status_code=403)
        if scoped_snapshot(mode, accountKey) is None:
            return JSONResponse({'detail': 'account binding mismatch'}, status_code=403)
        try:
            path = report_store.file(report_hash, kind, mode, accountKey)
        except ReportError as error:
            status = 403 if error.code == 'REPORT_SCOPE_MISMATCH' else 404
            return JSONResponse({'detail': error.code}, status_code=status)
        media = {'json': 'application/json', 'markdown': 'text/markdown; charset=utf-8',
            'html': 'text/html; charset=utf-8', 'pdf': 'application/pdf'}[kind]
        return FileResponse(path, media_type=media, filename=path.name)

    @app.post('/api/ibkr-terminal/orders/preview')
    def preview_order(draft: DraftOrder):
        if order_reviews is None:
            return JSONResponse({'detail': 'ORDER_REVIEW_DISABLED'}, status_code=403)
        try:
            return order_reviews.preview(draft)
        except ReviewBlocked as error:
            return JSONResponse({'detail': error.code}, status_code=409)

    @app.post('/api/ibkr-terminal/orders/previews/{preview_id}/confirm')
    def confirm_order(preview_id: str, confirmation: PreviewConfirmation):
        if order_reviews is None:
            return JSONResponse({'detail': 'ORDER_REVIEW_DISABLED'}, status_code=403)
        try:
            return order_reviews.confirm(preview_id, confirmation.bodyHash, explicit=confirmation.explicit)
        except ReviewBlocked as error:
            return JSONResponse({'detail': error.code}, status_code=409)

    @app.get('/api/ibkr-terminal/strategies')
    def strategies():
        if strategy_catalog is None:
            return JSONResponse({'detail': 'BACKTESTS_DISABLED'}, status_code=403)
        return strategy_catalog.list()

    @app.get('/api/ibkr-terminal/backtests')
    def backtests():
        if backtest_archive is None:
            return JSONResponse({'detail': 'BACKTESTS_DISABLED'}, status_code=403)
        return [package.result for package in backtest_archive.list()]

    @app.get('/api/ibkr-terminal/backtests/jobs')
    def backtest_job_list():
        if backtest_jobs is None:
            return JSONResponse({'detail': 'BACKTESTS_DISABLED'}, status_code=403)
        return backtest_jobs.list()

    @app.get('/api/ibkr-terminal/backtests/jobs/{job_id}')
    def backtest_job(job_id: str):
        if backtest_jobs is None:
            return JSONResponse({'detail': 'BACKTESTS_DISABLED'}, status_code=403)
        try:
            return backtest_jobs.get(job_id)
        except JobError as error:
            return JSONResponse({'detail': error.code}, status_code=404 if error.code == 'JOB_MISSING' else 409)

    @app.post('/api/ibkr-terminal/backtests/jobs/{job_id}/cancel')
    def cancel_backtest_job(job_id: str):
        if backtest_jobs is None:
            return JSONResponse({'detail': 'BACKTESTS_DISABLED'}, status_code=403)
        try:
            return backtest_jobs.cancel(job_id)
        except JobError as error:
            return JSONResponse({'detail': error.code}, status_code=404 if error.code == 'JOB_MISSING' else 409)

    @app.get('/api/ibkr-terminal/backtests/{run_hash}')
    def backtest(run_hash: str):
        if backtest_archive is None:
            return JSONResponse({'detail': 'BACKTESTS_DISABLED'}, status_code=403)
        try:
            return backtest_archive.get(run_hash).result
        except BacktestError as error:
            return JSONResponse({'detail': error.code}, status_code=404 if error.code == 'RUN_MISSING' else 409)

    @app.websocket('/api/ibkr-terminal/events')
    async def events(ws: WebSocket):
        denied = boundary(ws.headers)
        mode, account_key = ws.query_params.get('mode'), ws.query_params.get('accountKey')
        session = app.state.sessions.get(mode)
        if denied or session is None or session.snapshot().accountKey != account_key:
            await ws.close(code=4403 if denied == 403 else 4401 if denied else 4409)
            return
        try:
            subscription = session.subscribe()
        except ValueError:
            await ws.close(code=4429)
            return
        receiver = queued = None
        try:
            await ws.accept()
            initial = session.snapshot()
            await ws.send_json({**{key: getattr(initial, key) for key in ('mode', 'accountKey', 'sessionRevision', 'sequence')}, 'kind': 'heartbeat'})
            receiver = asyncio.create_task(ws.receive())
            while True:
                queued = asyncio.create_task(subscription.queue.get())
                done, _ = await asyncio.wait({receiver, queued}, timeout=heartbeat_seconds, return_when=asyncio.FIRST_COMPLETED)
                if receiver in done:
                    message = receiver.result()
                    if message['type'] != 'websocket.disconnect':
                        await ws.close(code=1008, reason='read-only event stream')
                    break
                current = session.snapshot()
                if current.accountKey != account_key:
                    await ws.close(code=4409, reason='account binding changed')
                    break
                if queued in done:
                    event = queued.result()
                    if event['accountKey'] != account_key:
                        await ws.close(code=4409)
                        break
                else:
                    queued.cancel()
                    await asyncio.gather(queued, return_exceptions=True)
                    event = {**{key: getattr(current, key) for key in ('mode', 'accountKey', 'sessionRevision', 'sequence')}, 'kind': 'heartbeat'}
                await ws.send_json(event)
        except WebSocketDisconnect:
            pass
        finally:
            session.unsubscribe(subscription)
            tasks = [task for task in (receiver, queued) if task is not None]
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    return app
