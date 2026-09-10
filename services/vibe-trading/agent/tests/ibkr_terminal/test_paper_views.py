from types import SimpleNamespace
from src.ibkr_terminal.paper_views import order_display
import pytest


def test_average_price_uses_matching_execution_quantities_only():
    record = SimpleNamespace(permId=100, clientId=5, orderId=2, filledQuantity='10', model_dump=lambda **_: {'filledQuantity':'10'})
    fills = [SimpleNamespace(permId=100, clientId=5, orderId=2, quantity='4', price='250'),
        SimpleNamespace(permId=100, clientId=5, orderId=2, quantity='6', price='251'),
        SimpleNamespace(permId=999, clientId=5, orderId=2, quantity='5', price='1')]
    assert order_display(record, fills)['averageFillPrice'] == '250.6'
    assert order_display(record, fills[:1])['averageFillPrice'] is None
    record.permId = None
    assert order_display(record, fills)['averageFillPrice'] is None


@pytest.mark.parametrize('dispatch_state', ['WRITING', 'SENT', 'UNKNOWN', 'DENIED'])
def test_receipt_dispatch_status_comes_from_the_exact_persisted_command(tmp_path, dispatch_state):
    from src.ibkr_terminal.identity import SubmissionCommand
    from src.ibkr_terminal.native_dispatch import command_hash
    from test_orders import ledger, NOW
    from test_order_events import setup
    with ledger(tmp_path / 'orders') as db:
        setup(db)
        record = db.get('paper:engineering', 'paper', 'intent-1')
        digest = command_hash(SubmissionCommand(intent=record.intent, identity=record.identity))
        assert order_display(record, [], db)['dispatchState'] is None
        db._db.execute('INSERT INTO sdk_dispatch_attempts VALUES(?,?,?,?,?,?,?)',
            (digest, 'fixture-permit', record.intent.accountKey, 'paper', dispatch_state, None, NOW.isoformat()))
        assert order_display(record, [], db)['dispatchState'] == dispatch_state
        db._db.execute("UPDATE sdk_dispatch_attempts SET account_key='paper:other'")
        assert order_display(record, [], db)['dispatchState'] is None


def test_confirmation_response_contains_the_same_execution_fields_as_order_status(tmp_path, api_event_loop):
    from datetime import timedelta
    from starlette.testclient import TestClient
    from src.ibkr_terminal.app import create_app
    from src.ibkr_terminal.session import AccountBinding
    from src.ibkr_terminal.store import SnapshotStore
    from test_orders import ledger, NOW
    from test_order_events import setup, fill
    with SnapshotStore(tmp_path / 'snapshot') as store, ledger(tmp_path / 'orders') as db:
        rec = setup(db)
        rec.apply(fill('execution', 'EX-1', '6', '99'))
        record = db.get('paper:engineering', 'paper', 'intent-1')
        app = create_app(store=store, session_token='test', paper_ledger=db, clock=lambda: NOW)
        session = app.state.sessions['paper']
        session.bind(AccountBinding(mode='paper', accountKey=record.intent.accountKey, brokerAccount='DU-TEST', confirmed=True))
        source = SimpleNamespace(session=session, binding=session.binding, healthy=lambda: True)
        app.state.market_sources['paper'] = source
        calls = []
        def confirm(*args, **kwargs):
            calls.append(args)
            return record
        app.state.paper_flow = SimpleNamespace(source=SimpleNamespace(connection=source,
            scope=SimpleNamespace(sessionRevision=session.revision, expiresAt=NOW + timedelta(hours=1))), confirm=confirm)
        with TestClient(app, base_url='http://127.0.0.1:8765', backend_options={'loop_factory': lambda: api_event_loop}) as client:
            response = client.post('/api/ibkr-terminal/paper/confirm', headers={'Authorization': 'Bearer test'},
                json={'previewId': 'fixture-preview', 'bodyHash': 'a' * 64, 'explicit': True})
            assert response.status_code == 200
            value = response.json()
            assert value['filledQuantity'] == '6' and value['averageFillPrice'] == '99'
            assert value['intent']['clientIntentId'] == record.intent.clientIntentId
            assert 'dispatchState' in value and len(calls) == 1
