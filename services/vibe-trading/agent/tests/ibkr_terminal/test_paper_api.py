from starlette.testclient import TestClient
from src.ibkr_terminal.app import create_app
from src.ibkr_terminal.store import SnapshotStore
from src.ibkr_terminal.orders import OrderLedger
from src.ibkr_terminal.session import AccountBinding
from types import SimpleNamespace
from datetime import datetime,timezone,timedelta


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
