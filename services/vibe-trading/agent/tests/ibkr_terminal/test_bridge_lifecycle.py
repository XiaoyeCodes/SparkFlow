import asyncio
import hashlib
from types import SimpleNamespace
from fastapi.testclient import TestClient
from src.ibkr_terminal.app import create_app
from src.ibkr_terminal.store import SnapshotStore
from src.ibkr_terminal.bridge_lifecycle import code_revision, install_lifecycle


def test_revision_matches_sorted_source_bytes(tmp_path):
    (tmp_path/'nested').mkdir()
    (tmp_path/'a.py').write_bytes(b'a=1\n')
    (tmp_path/'nested'/'b.py').write_bytes(b'b=2\n')
    assert code_revision(tmp_path)==hashlib.sha256(b'a.py\0a=1\n\0nested/b.py\0b=2\n\0').hexdigest()


def test_shutdown_requires_local_token_and_exact_instance(tmp_path,api_event_loop):
    with SnapshotStore(tmp_path/'snapshot.db') as store:
        app=create_app(store=store,session_token='test-only')
        server=SimpleNamespace(should_exit=False)
        install_lifecycle(app,server)
        with TestClient(app,base_url='http://127.0.0.1:8765',backend_options={'loop_factory':lambda:api_event_loop}) as client:
            url='/api/ibkr-terminal/bridge/shutdown'
            headers={'Authorization':'Bearer test-only'}
            instance=client.get('/api/ibkr-terminal/session',headers=headers).json()['bridge']['instanceId']
            assert client.post(url,json={'instanceId':instance}).status_code==401
            assert client.post(url,headers={**headers,'Origin':'https://evil.example'},json={'instanceId':instance}).status_code==403
            assert client.post(url,headers=headers,json={'instanceId':'another'}).status_code==409
            assert not server.should_exit
            assert client.post(url,headers=headers,json={'instanceId':instance}).status_code==200
            assert app.state.bridge_stopping
            assert client.post('/api/ibkr-terminal/paper/preview',headers=headers,json={}).status_code==503
            client.portal.call(asyncio.sleep,.15)
            assert server.should_exit
