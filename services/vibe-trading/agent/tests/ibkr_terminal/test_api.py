from fastapi.testclient import TestClient

from src.ibkr_terminal.app import create_app
from src.ibkr_terminal.store import SnapshotStore


def test_local_api_rejects_unknown_host_origin_session_and_all_writes(tmp_path, api_event_loop):
    with SnapshotStore(tmp_path / 'state.sqlite') as store:
        app = create_app(store=store, session_token='offline-test-token')
        with TestClient(app, base_url='http://127.0.0.1:8765', backend_options={'loop_factory': lambda: api_event_loop}) as client:
            assert client.get('/api/ibkr-terminal/snapshot?mode=paper').status_code == 401
            headers = {'Authorization': 'Bearer offline-test-token'}
            assert client.get('/api/ibkr-terminal/snapshot?mode=paper', headers={**headers, 'Origin': 'https://evil.example'}).status_code == 403
            assert client.get('/api/ibkr-terminal/snapshot?mode=paper', headers={**headers, 'Host': 'evil.example'}).status_code == 403
            response = client.get('/api/ibkr-terminal/snapshot?mode=live', headers=headers)
            assert response.status_code == 200
            assert response.json()['connection'] == 'unconfigured'
            assert response.json()['positions'] == []
            assert response.headers['cache-control'] == 'no-store'
            for method in ('post', 'put', 'patch', 'delete'):
                assert getattr(client, method)('/api/ibkr-terminal/orders', headers=headers).status_code == 403
