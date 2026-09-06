from fastapi.testclient import TestClient

from src.ibkr_terminal.app import create_app
from src.ibkr_terminal.orders import OrderLedger
from src.ibkr_terminal.reviews import OrderReviewService
from src.ibkr_terminal.store import SnapshotStore
from test_reviews import NOW, Source, draft


HEADERS = {'Authorization': 'Bearer offline-test-token'}


def client_app(tmp_path, *, reviews=None):
    store = SnapshotStore(tmp_path / 'state.sqlite')
    app = create_app(store=store, session_token='offline-test-token', order_reviews=reviews)
    return store, app


def test_review_routes_are_absent_without_a_server_owned_review_source(tmp_path, api_event_loop):
    store, app = client_app(tmp_path)
    with store, TestClient(app, base_url='http://127.0.0.1:8765', backend_options={'loop_factory': lambda: api_event_loop}) as client:
        assert client.post('/api/ibkr-terminal/orders/preview', headers=HEADERS, json=draft().model_dump()).status_code == 403
        assert client.get('/api/ibkr-terminal/session', headers=HEADERS).json()['orderReviewEnabled'] is False


def test_preview_and_confirmation_api_persist_but_never_claim_broker_submission(tmp_path, api_event_loop):
    with OrderLedger(tmp_path / 'orders.sqlite', allow_fixtures=True, clock=lambda: NOW) as orders:
        reviews = OrderReviewService(orders, Source(), clock=lambda: NOW)
        store, app = client_app(tmp_path, reviews=reviews)
        with store, TestClient(app, base_url='http://127.0.0.1:8765', backend_options={'loop_factory': lambda: api_event_loop}) as client:
            session = client.get('/api/ibkr-terminal/session', headers=HEADERS).json()
            assert session['orderReviewEnabled'] is True and session['writesEnabled'] is False
            response = client.post('/api/ibkr-terminal/orders/preview', headers=HEADERS, json=draft().model_dump())
            assert response.status_code == 200
            preview = response.json()
            assert preview['testData'] is True and preview['reservedCash'] == '601'
            assert orders.audit('paper:engineering') == []
            changed = client.post(f"/api/ibkr-terminal/orders/previews/{preview['previewId']}/confirm", headers=HEADERS,
                json={'bodyHash': '0' * 64, 'explicit': True})
            assert changed.status_code == 409 and changed.json()['detail'] == 'PREVIEW_BODY_CHANGED'
            confirmed = client.post(f"/api/ibkr-terminal/orders/previews/{preview['previewId']}/confirm", headers=HEADERS,
                json={'bodyHash': preview['bodyHash'], 'explicit': True})
            assert confirmed.status_code == 200
            assert confirmed.json()['submission'] == 'PERSISTED'
            assert confirmed.json()['orderId'] is None and confirmed.json()['permId'] is None


def test_review_api_rejects_browser_supplied_trust_fields_and_other_mutations(tmp_path, api_event_loop):
    with OrderLedger(tmp_path / 'orders.sqlite', allow_fixtures=True, clock=lambda: NOW) as orders:
        store, app = client_app(tmp_path, reviews=OrderReviewService(orders, Source(), clock=lambda: NOW))
        with store, TestClient(app, base_url='http://127.0.0.1:8765', backend_options={'loop_factory': lambda: api_event_loop}) as client:
            body = {**draft().model_dump(), 'settledCash': '999999', 'authorizationId': 'self-approved'}
            assert client.post('/api/ibkr-terminal/orders/preview', headers=HEADERS, json=body).status_code == 422
            assert client.put('/api/ibkr-terminal/orders/preview', headers=HEADERS, json=draft().model_dump()).status_code == 403
            assert client.post('/api/ibkr-terminal/orders/preview', headers={**HEADERS, 'Origin': 'https://evil.example'}, json=draft().model_dump()).status_code == 403
