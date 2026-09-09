from fastapi.testclient import TestClient

from src.ibkr_terminal.app import create_app
from src.ibkr_terminal.backtests import BacktestArchive
from src.ibkr_terminal.strategy import StrategyCatalog
from src.ibkr_terminal.store import SnapshotStore
from src.ibkr_terminal.workers import BacktestJobs
from test_backtest_archive import package
from test_backtests import NOW
from test_strategy import definition


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


def user_definition(**changes):
    return definition(strategyId='user:api-sma', origin='user', name='用户规则：SMA 趋势', **changes)


def uploaded_run(**changes):
    value = {
        'strategyId': 'user:api-sma',
        'strategyVersion': '1.0.0',
        'initialCash': '10000',
        'corporateActionsComplete': True,
        'bars': [
            {'timestamp': f'2026-01-0{day}T14:30:00Z', 'open': str(price), 'high': str(price + 1),
             'low': str(price - 1), 'close': str(close), 'volume': '1000', 'splitRatio': None,
             'dividendPerShare': '0'}
            for day, price, close in ((2, 10, 10), (3, 9, 9), (4, 12, 12), (5, 13, 13), (6, 14, 14))
        ],
    }
    value.update(changes)
    return value


def test_user_strategy_save_and_uploaded_backtest_run_are_server_scoped(tmp_path, api_event_loop):
    with SnapshotStore(tmp_path / 'snapshots.sqlite') as snapshots, \
        StrategyCatalog(tmp_path / 'catalog.sqlite', clock=lambda: NOW) as catalog, \
        BacktestArchive(tmp_path / 'archive.sqlite') as archive, \
        BacktestJobs(tmp_path / 'jobs.sqlite', archive, clock=lambda: NOW) as jobs:
        app = create_app(store=snapshots, session_token='offline-test-token', strategy_catalog=catalog,
            backtest_archive=archive, backtest_jobs=jobs)
        with TestClient(app, base_url='http://127.0.0.1:8765', backend_options={'loop_factory': lambda: api_event_loop}) as client:
            saved = client.post('/api/ibkr-terminal/strategies', headers=HEADERS,
                json=user_definition().model_dump(mode='json'))
            assert saved.status_code == 200
            assert saved.json()['definition']['origin'] == 'user'

            response = client.post('/api/ibkr-terminal/backtests/jobs', headers=HEADERS, json=uploaded_run())
            assert response.status_code == 200
            completed = jobs.wait(response.json()['jobId'], timeout=2)
            assert completed.state == 'COMPLETED'
            result = client.get(f'/api/ibkr-terminal/backtests/{completed.runHash}', headers=HEADERS).json()
            assert result['strategyId'] == 'user:api-sma' and result['testData'] is False
            assert result['barCount'] == 5 and result['metrics']['tradeCount'] == 1
            package_value = archive.get(completed.runHash)
            assert {bar.source for bar in package_value.bars} == {'user.upload'}
            assert len({bar.dataVersion for bar in package_value.bars}) == 1
            assert package_value.signals and package_value.signals[0].observedAt < package_value.result.executions[0].executedAt
            downloaded = client.get(f'/api/ibkr-terminal/backtests/{completed.runHash}/package', headers=HEADERS)
            assert downloaded.status_code == 200
            assert downloaded.json()['result']['runHash'] == completed.runHash
            assert downloaded.json()['strategy']['definition']['origin'] == 'user'


def test_backtest_write_api_rejects_fixture_strategy_unstored_version_and_untrusted_fields(tmp_path, api_event_loop):
    with SnapshotStore(tmp_path / 'snapshots.sqlite') as snapshots, \
        StrategyCatalog(tmp_path / 'catalog.sqlite', clock=lambda: NOW) as catalog, \
        BacktestArchive(tmp_path / 'archive.sqlite') as archive, \
        BacktestJobs(tmp_path / 'jobs.sqlite', archive, clock=lambda: NOW) as jobs:
        app = create_app(store=snapshots, session_token='offline-test-token', strategy_catalog=catalog,
            backtest_archive=archive, backtest_jobs=jobs)
        with TestClient(app, base_url='http://127.0.0.1:8765', backend_options={'loop_factory': lambda: api_event_loop}) as client:
            fixture = client.post('/api/ibkr-terminal/strategies', headers=HEADERS,
                json=definition().model_dump(mode='json'))
            assert fixture.status_code == 409 and fixture.json()['detail'] == 'USER_STRATEGY_REQUIRED'
            assert client.post('/api/ibkr-terminal/strategies', headers=HEADERS,
                json=user_definition().model_dump(mode='json')).status_code == 200
            missing = client.post('/api/ibkr-terminal/backtests/jobs', headers=HEADERS,
                json=uploaded_run(strategyVersion='9.9.9'))
            assert missing.status_code == 404 and missing.json()['detail'] == 'STRATEGY_MISSING'
            injected = uploaded_run()
            injected['bars'][0]['source'] = 'ibkr.historicalData'
            assert client.post('/api/ibkr-terminal/backtests/jobs', headers=HEADERS, json=injected).status_code == 422
            assert client.post('/api/ibkr-terminal/backtests/jobs', headers=HEADERS,
                json=uploaded_run(corporateActionsComplete=False)).status_code == 422
