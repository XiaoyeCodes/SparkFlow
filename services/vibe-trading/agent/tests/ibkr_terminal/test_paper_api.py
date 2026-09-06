from starlette.testclient import TestClient
from src.ibkr_terminal.app import create_app
from src.ibkr_terminal.store import SnapshotStore
from src.ibkr_terminal.orders import OrderLedger


def test_paper_routes_require_session_and_never_enable_live_or_unbound(tmp_path,api_event_loop):
    with SnapshotStore(tmp_path/'snapshot') as store,OrderLedger(tmp_path/'orders') as orders:
        app=create_app(store=store,session_token='test',paper_ledger=orders)
        with TestClient(app,base_url='http://127.0.0.1:8765',backend_options={'loop_factory':lambda:api_event_loop}) as client:
            assert client.get('/api/ibkr-terminal/paper/status').status_code==401
            headers={'Authorization':'Bearer test'}
            state=client.get('/api/ibkr-terminal/paper/status',headers=headers).json()
            assert state['enabled'] is False and state['account'] is None
            assert client.post('/api/ibkr-terminal/paper/confirm',headers={**headers,'Origin':'https://evil.example'},json={}).status_code==403
            result=client.post('/api/ibkr-terminal/paper/preview',headers=headers,json=dict(accountKey='live:test',mode='live',conId=12,side='BUY',quantity='1',orderType='LMT',limitPrice='100',tif='DAY'))
            assert result.status_code==409 and result.json()['detail']=='PAPER_EXECUTION_DISABLED'
            assert orders._db.execute('SELECT count(*) FROM order_intents').fetchone()[0]==0
