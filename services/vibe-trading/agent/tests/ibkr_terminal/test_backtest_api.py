from fastapi.testclient import TestClient

from src.ibkr_terminal.app import create_app
from src.ibkr_terminal.backtests import BacktestArchive
from src.ibkr_terminal.strategy import StrategyCatalog
from src.ibkr_terminal.store import SnapshotStore
from src.ibkr_terminal.workers import BacktestJobs
from test_backtest_archive import package
from test_backtests import NOW


HEADERS = {'Authorization': 'Bearer offline-test-token'}


def test_backtest_routes_are_disabled_without_server_owned_stores(tmp_path, api_event_loop):
    with SnapshotStore(tmp_path / 'snapshots.sqlite') as snapshots:
        app = create_app(store=snapshots, session_token='offline-test-token')
        with TestClient(app, base_url='http://127.0.0.1:8765', backend_options={'loop_factory': lambda: api_event_loop}) as client:
            assert client.get('/api/ibkr-terminal/strategies', headers=HEADERS).status_code == 403
            session = client.get('/api/ibkr-terminal/session', headers=HEADERS).json()
            assert session['backtestsEnabled'] is False


def test_backtest_read_api_lists_traceable_records_and_does_not_offer_browser_run(tmp_path, api_event_loop):
    item, settings, bars, signals, _ = package(tmp_path)
    with SnapshotStore(tmp_path / 'snapshots.sqlite') as snapshots, \
        StrategyCatalog(tmp_path / 'catalog.sqlite', allow_fixtures=True, clock=lambda: NOW) as catalog, \
        BacktestArchive(tmp_path / 'archive.sqlite') as archive, \
        BacktestJobs(tmp_path / 'jobs.sqlite', archive, clock=lambda: NOW) as jobs:
        catalog.save(item.definition)
        completed = jobs.wait(jobs.submit(item, settings, bars, signals).jobId, timeout=2)
        app = create_app(store=snapshots, session_token='offline-test-token', strategy_catalog=catalog,
            backtest_archive=archive, backtest_jobs=jobs)
        with TestClient(app, base_url='http://127.0.0.1:8765', backend_options={'loop_factory': lambda: api_event_loop}) as client:
            assert client.get('/api/ibkr-terminal/session', headers=HEADERS).json()['backtestsEnabled'] is True
            strategies = client.get('/api/ibkr-terminal/strategies', headers=HEADERS).json()
            assert strategies[0]['strategyHash'] == item.strategyHash and strategies[0]['definition']['origin'] == 'fixture'
            runs = client.get('/api/ibkr-terminal/backtests', headers=HEADERS).json()
            assert runs[0]['runHash'] == completed.runHash and runs[0]['testData'] is True
            job = client.get(f'/api/ibkr-terminal/backtests/jobs/{completed.jobId}', headers=HEADERS).json()
            assert job['state'] == 'COMPLETED'
            assert client.post('/api/ibkr-terminal/backtests', headers=HEADERS, json={'bars': [], 'strategy': 'self-supplied'}).status_code == 403


def test_cancel_endpoint_only_changes_an_existing_server_job(tmp_path, api_event_loop):
    item, settings, bars, signals, _ = package(tmp_path)
    with SnapshotStore(tmp_path / 'snapshots.sqlite') as snapshots, BacktestArchive(tmp_path / 'archive.sqlite') as archive, \
        BacktestJobs(tmp_path / 'jobs.sqlite', archive, clock=lambda: NOW) as jobs:
        completed = jobs.wait(jobs.submit(item, settings, bars, signals).jobId, timeout=2)
        app = create_app(store=snapshots, session_token='offline-test-token', backtest_archive=archive, backtest_jobs=jobs)
        with TestClient(app, base_url='http://127.0.0.1:8765', backend_options={'loop_factory': lambda: api_event_loop}) as client:
            response = client.post(f'/api/ibkr-terminal/backtests/jobs/{completed.jobId}/cancel', headers=HEADERS)
            assert response.status_code == 200 and response.json()['state'] == 'COMPLETED'
            assert client.post('/api/ibkr-terminal/backtests/jobs/unknown/cancel', headers=HEADERS).status_code == 404
