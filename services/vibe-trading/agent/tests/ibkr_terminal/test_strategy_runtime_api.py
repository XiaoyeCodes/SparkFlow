from datetime import timedelta

from fastapi.testclient import TestClient

from src.ibkr_terminal.app import create_app
from src.ibkr_terminal.orders import OrderLedger
from src.ibkr_terminal.session import AccountBinding
from src.ibkr_terminal.store import SnapshotStore
from src.ibkr_terminal.strategy import StrategyCatalog
from src.ibkr_terminal.strategy_runtime import StrategyRuntime
from test_analytics import snapshot
from test_orders import NOW
from test_strategy import definition


HEADERS = {'Authorization': 'Bearer offline-test-token'}


def test_runtime_api_is_read_only_except_explicit_stop_and_has_no_browser_activation(tmp_path, api_event_loop):
    with SnapshotStore(tmp_path / 'snapshots.sqlite', allow_fixtures=True) as snapshots, \
        StrategyCatalog(tmp_path / 'strategies.sqlite', allow_fixtures=True, clock=lambda: NOW) as catalog, \
        OrderLedger(tmp_path / 'orders.sqlite', allow_fixtures=True, clock=lambda: NOW) as orders, \
        StrategyRuntime(tmp_path / 'runtime.sqlite', orders, allow_fixtures=True, clock=lambda: NOW) as runtime:
        strategy = catalog.save(definition())
        active = runtime.activate(strategy, account_key='paper:engineering', mode='paper', session_revision=1,
            authorization_id='fixture-auth', expires_at=NOW + timedelta(hours=1), explicit=True)
        app = create_app(store=snapshots, session_token='offline-test-token', strategy_runtime=runtime, clock=lambda: NOW)
        app.state.sessions['paper'].bind(AccountBinding(mode='paper', accountKey='paper:engineering', brokerAccount='DU-ENGINEERING', confirmed=True))
        assert app.state.sessions['paper'].accept(snapshot(sessionRevision=1))
        with TestClient(app, base_url='http://127.0.0.1:8765', backend_options={'loop_factory': lambda: api_event_loop}) as client:
            listed = client.get('/api/ibkr-terminal/strategy-runtime?mode=paper&accountKey=paper%3Aengineering', headers=HEADERS)
            assert listed.status_code == 200 and listed.json()[0]['activationId'] == active.activationId
            assert client.get('/api/ibkr-terminal/strategy-runtime?mode=paper&accountKey=paper%3Aother', headers=HEADERS).status_code == 403
            assert client.post('/api/ibkr-terminal/strategy-runtime/activate', headers=HEADERS, json={}).status_code == 403
            stopped = client.post(f'/api/ibkr-terminal/strategy-runtime/{active.activationId}/stop', headers=HEADERS,
                json={'mode': 'paper', 'accountKey': 'paper:engineering'})
            assert stopped.status_code == 200 and stopped.json()['state'] == 'STOPPED'
            assert stopped.json()['reason'] == 'USER_STOPPED_NEW_SIGNALS'
