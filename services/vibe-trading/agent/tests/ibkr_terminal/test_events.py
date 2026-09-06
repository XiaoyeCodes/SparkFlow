import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from src.ibkr_terminal.app import create_app
from src.ibkr_terminal.schemas import Snapshot
from src.ibkr_terminal.session import AccountBinding
from src.ibkr_terminal.store import SnapshotStore


def test_authenticated_stream_is_account_scoped_and_unsubscribes(tmp_path, api_event_loop):
    payload = json.loads((Path(__file__).resolve().parents[5] / 'tests/ibkr/fixtures/snapshots.json').read_text(encoding='utf-8'))['multiCurrency']
    with SnapshotStore(tmp_path / 'db', allow_fixtures=True) as store:
        app = create_app(store=store, session_token='offline-token', heartbeat_seconds=0.05)
        session = app.state.sessions['paper']
        session.bind(AccountBinding(mode='paper', accountKey=payload['accountKey'], brokerAccount='TEST', confirmed=True))
        url = f"ws://127.0.0.1:8765/api/ibkr-terminal/events?mode=paper&accountKey={payload['accountKey']}"
        headers = {'Authorization': 'Bearer offline-token'}
        with TestClient(app, base_url='http://127.0.0.1:8765', backend_options={'loop_factory': lambda: api_event_loop}) as client:
            for bad_headers in ({}, {**headers, 'Origin': 'https://evil.example'}, {**headers, 'Host': 'evil.example'}):
                with pytest.raises(WebSocketDisconnect):
                    with client.websocket_connect(url, headers=bad_headers):
                        pytest.fail('unauthorized websocket accepted')
            with pytest.raises(WebSocketDisconnect):
                with client.websocket_connect(url.replace(payload['accountKey'], 'live:other'), headers=headers):
                    pytest.fail('wrong account accepted')
            with client.websocket_connect(url, headers=headers) as ws:
                hello = ws.receive_json()
                assert hello['kind'] == 'heartbeat'
                assert hello['accountKey'] == payload['accountKey']
                assert session.subscriber_count == 1
                snapshot = Snapshot.model_validate({**payload, 'sessionRevision': session.revision})
                assert session.accept(snapshot)
                event = ws.receive_json()
                while event['kind'] == 'heartbeat':
                    event = ws.receive_json()
                assert event['kind'] == 'snapshot.patch'
                assert event['previousSequence'] == 0
                assert event['sequence'] == 1
                assert event['payload']['positions'][0]['symbol'] == 'TEST-ETF'
                # Rebinding cannot send the new account's data through the old stream.
                session.bind(AccountBinding(mode='paper', accountKey='paper:other', brokerAccount='OTHER', confirmed=True))
                with pytest.raises(WebSocketDisconnect):
                    ws.receive_json()
            # Context exit waits for ASGI cleanup; no leaked subscriber.
        assert session.subscriber_count == 0


def test_overflow_requires_resnapshot_and_late_disconnect_cannot_mutate_new_binding(tmp_path, api_event_loop):
    from src.ibkr_terminal.session import AccountSession
    with SnapshotStore(tmp_path / 'db') as store:
        session = AccountSession('paper', store)
        first = AccountBinding(mode='paper', accountKey='paper:first', brokerAccount='FIRST', confirmed=True)
        session.bind(first)
        old_revision = session.revision
        async def exercise():
            subscription = session.subscribe(max_pending=1)
            session.disconnected(expected_revision=old_revision)
            session.bind(first.model_copy(update={'accountKey': 'paper:second', 'brokerAccount': 'SECOND'}))
            await __import__('asyncio').sleep(0)
            event = await subscription.queue.get()
            assert event['kind'] == 'resync-required'
            session.unsubscribe(subscription)
        api_event_loop.run_until_complete(exercise())
        before = session.snapshot()
        assert not session.disconnected(expected_revision=old_revision)
        assert session.snapshot() == before
