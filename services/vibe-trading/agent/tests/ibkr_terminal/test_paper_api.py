from starlette.testclient import TestClient
from src.ibkr_terminal.app import create_app
from src.ibkr_terminal.store import SnapshotStore
from src.ibkr_terminal.orders import OrderLedger
from src.ibkr_terminal.session import AccountBinding
from types import SimpleNamespace
from datetime import datetime,timezone,timedelta
import pytest


def test_status_automatically_reconciles_filled_order_and_retries_late_commission(tmp_path,api_event_loop):
    import time
    from test_orders import NOW,ledger
    from test_order_events import setup,event,fill,fee
    from test_paper_account import connection
    from src.ibkr_terminal.paper_account import PaperAccountReconciliation
    with SnapshotStore(tmp_path/'snapshot',allow_fixtures=True) as store,ledger(tmp_path/'orders') as orders:
        rec=setup(orders)
        rec.apply(fill('fill','EX-1','6','99'))
        rec.apply(event('filled',status='FILLED',filled='6',remaining='0'))
        orders.clock=lambda:NOW+timedelta(seconds=2)
        app=create_app(store=store,session_token='test',paper_ledger=orders,clock=orders.clock)
        source=connection(rec,cash='405',quantity='6')
        source.binding.readonly=False
        snapshot=source.session.snapshot();snapshot.connection='connected';snapshot.detail='';snapshot.snapshotId='fresh-read'
        scope=SimpleNamespace(sessionRevision=1,expiresAt=NOW+timedelta(hours=1))
        account=PaperAccountReconciliation(source,rec,clock=orders.clock)
        calls=[]
        async def run():
            calls.append(True)
            return await account.run()
        app.state.market_sources['paper']=source
        app.state.paper_flow=SimpleNamespace(enabled=True,source=SimpleNamespace(connection=source,scope=scope),
            account_reconciliation=SimpleNamespace(run=run))
        with TestClient(app,base_url='http://127.0.0.1:8765',backend_options={'loop_factory':lambda:api_event_loop}) as client:
            headers={'Authorization':'Bearer test'}
            first=client.get('/api/ibkr-terminal/paper/status',headers=headers).json()
            assert first['orders'][0]['execution']=='FILLED'
            assert first['syncError']=='COMMISSION_PENDING' and first['orders'][0]['reconciliationRequired']
            assert first['snapshot']['positions'][0]['quantity']=='6'
            client.get('/api/ibkr-terminal/paper/status',headers=headers)
            assert len(calls)==1  # multiple tabs cannot flood IBKR
            rec.apply(fee('fee','EX-1','1'))
            time.sleep(2.05)
            final=client.get('/api/ibkr-terminal/paper/status',headers=headers).json()
            assert final['syncError'] is None and not final['orders'][0]['reconciliationRequired']
            assert final['orders'][0]['reservedCash']=='0'
            client.get('/api/ibkr-terminal/paper/status',headers=headers)
            assert len(calls)==2  # already reconciled fills need no further proof
            assert len(final['orders'])==1


@pytest.mark.parametrize('change', ['replacement', 'revision', 'disconnected'])
def test_stale_paper_flow_is_not_reported_enabled_or_used_by_preview(tmp_path,api_event_loop,change):
    with SnapshotStore(tmp_path/'snapshot') as store,OrderLedger(tmp_path/'orders') as orders:
        app=create_app(store=store,session_token='test',paper_ledger=orders)
        binding=AccountBinding(mode='paper',accountKey='paper:engineering',brokerAccount='DU-TEST',confirmed=True,readonly=False)
        session=app.state.sessions['paper'];session.bind(binding)
        old=SimpleNamespace(binding=binding,session=session,healthy=lambda:change!='disconnected')
        active=old if change!='replacement' else SimpleNamespace(binding=binding,session=session,healthy=lambda:True)
        closed=[]
        app.state.market_sources['paper']=active
        app.state.paper_flow=SimpleNamespace(enabled=True,source=SimpleNamespace(connection=old,scope=SimpleNamespace(
            sessionRevision=session.revision,expiresAt=datetime.now(timezone.utc)+timedelta(hours=1))),close=lambda:closed.append(True))
        if change=='revision':session.bind(binding)
        with TestClient(app,base_url='http://127.0.0.1:8765',backend_options={'loop_factory':lambda:api_event_loop}) as client:
            headers={'Authorization':'Bearer test'}
            assert client.get('/api/ibkr-terminal/session',headers=headers).json()['paperOrdersEnabled'] is False
            response=client.post('/api/ibkr-terminal/paper/preview',headers=headers,json=dict(accountKey=binding.accountKey,mode='paper',conId=12,side='BUY',quantity='1',orderType='MKT',tif='DAY'))
            assert response.status_code==409 and response.json()['detail']=='PAPER_SESSION_CHANGED'
            state=client.get('/api/ibkr-terminal/paper/status',headers=headers).json()
            assert state['enabled'] is False and state['policy'] is None
            assert closed==[True] and app.state.paper_flow is None
            assert orders._db.execute('SELECT count(*) FROM order_intents').fetchone()[0]==0


def test_paper_routes_require_session_and_never_enable_live_or_unbound(tmp_path,api_event_loop):
    with SnapshotStore(tmp_path/'snapshot') as store,OrderLedger(tmp_path/'orders') as orders:
        now=datetime(2026,9,9,10,tzinfo=timezone.utc)
        app=create_app(store=store,session_token='test',paper_ledger=orders,clock=lambda:now)
        with TestClient(app,base_url='http://127.0.0.1:8765',backend_options={'loop_factory':lambda:api_event_loop}) as client:
            assert client.get('/api/ibkr-terminal/paper/status').status_code==401
            headers={'Authorization':'Bearer test'}
            state=client.get('/api/ibkr-terminal/paper/status',headers=headers).json()
            assert state['enabled'] is False and state['account'] is None
            assert client.post('/api/ibkr-terminal/paper/confirm',headers={**headers,'Origin':'https://evil.example'},json={}).status_code==403
            result=client.post('/api/ibkr-terminal/paper/preview',headers=headers,json=dict(accountKey='live:test',mode='live',conId=12,side='BUY',quantity='1',orderType='LMT',limitPrice='100',tif='DAY'))
            assert result.status_code==409 and result.json()['detail']=='PAPER_EXECUTION_DISABLED'
            assert orders._db.execute('SELECT count(*) FROM order_intents').fetchone()[0]==0


def test_paper_policy_rejects_a_readonly_gateway_binding(tmp_path,api_event_loop):
    with SnapshotStore(tmp_path/'snapshot') as store,OrderLedger(tmp_path/'orders') as orders:
        now=datetime(2026,9,9,10,tzinfo=timezone.utc)
        app=create_app(store=store,session_token='test',paper_ledger=orders,clock=lambda:now)
        binding=AccountBinding(mode='paper',accountKey='paper:engineering',brokerAccount='DU-TEST',confirmed=True,readonly=True)
        app.state.sessions['paper'].bind(binding)
        app.state.market_sources['paper']=SimpleNamespace(binding=binding,session=app.state.sessions['paper'],healthy=lambda:True,_fixture=False)
        body={'accountKey':'paper:engineering','mode':'paper','conIds':[12],
            'expiresAt':(now+timedelta(hours=2)).isoformat(),'explicit':True,'limits':{
                'maxOrderNotional':'100','maxTotalExposure':'1000','maxSymbolWeight':'0.5','maxDailyLoss':'50',
                'maxDailyOrders':5,'maxOrdersPerMinute':1,'maxQuoteAgeSeconds':5,'maxAccountAgeSeconds':20,
                'maxPriceDeviation':'0.05','feeReserve':'1'}}
        with TestClient(app,base_url='http://127.0.0.1:8765',backend_options={'loop_factory':lambda:api_event_loop}) as client:
            response=client.post('/api/ibkr-terminal/paper/configure',headers={'Authorization':'Bearer test'},json=body)
            assert response.status_code==409 and response.json()['detail']=='PAPER_GATEWAY_READONLY'
            session=client.get('/api/ibkr-terminal/session',headers={'Authorization':'Bearer test'}).json()
            assert session['paperOrdersAvailable'] is False and session['paperOrdersEnabled'] is False
