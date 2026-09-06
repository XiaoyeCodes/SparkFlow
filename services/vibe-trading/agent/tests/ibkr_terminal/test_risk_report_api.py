from fastapi.testclient import TestClient

from src.ibkr_terminal.app import create_app
from src.ibkr_terminal.reports import LocalReportStore
from test_reports import evidence_bundle
from src.ibkr_terminal.report_jobs import ReportJobs
from src.ibkr_terminal.market_data import MarketDataStore
from test_market_data import sample as market_sample
from src.ibkr_terminal.session import AccountBinding
from src.ibkr_terminal.store import SnapshotStore
from test_analytics import NOW, snapshot


HEADERS = {'Authorization': 'Bearer offline-test-token'}


def configured(tmp_path):
    snapshots = SnapshotStore(tmp_path / 'snapshots.sqlite', allow_fixtures=True)
    reports = LocalReportStore(tmp_path / 'reports', clock=lambda: NOW)
    app = create_app(store=snapshots, session_token='offline-test-token', report_store=reports, clock=lambda: NOW)
    app.state.sessions['paper'].bind(AccountBinding(mode='paper', accountKey='paper:engineering',
        brokerAccount='DU-ENGINEERING', confirmed=True, readonly=True))
    assert app.state.sessions['paper'].accept(snapshot(sessionRevision=1))
    return snapshots, app


def test_historical_market_data_is_hash_verified_account_scoped_and_missing_is_explicit(tmp_path, api_event_loop):
    snapshots = SnapshotStore(tmp_path / 'snapshots.sqlite', allow_fixtures=True)
    market = MarketDataStore(tmp_path / 'market.sqlite', allow_fixtures=True)
    market.save(market_sample(accountKey='paper:engineering', snapshotId='fixture-risk-v1'))
    app = create_app(store=snapshots, session_token='offline-test-token', market_data_store=market, clock=lambda: NOW)
    app.state.sessions['paper'].bind(AccountBinding(mode='paper', accountKey='paper:engineering', brokerAccount='DU-ENGINEERING', confirmed=True))
    assert app.state.sessions['paper'].accept(snapshot(sessionRevision=1))
    with snapshots, market, TestClient(app, base_url='http://127.0.0.1:8765', backend_options={'loop_factory': lambda: api_event_loop}) as client:
        ready = client.get('/api/ibkr-terminal/market-data?mode=paper&accountKey=paper%3Aengineering&conId=12&period=1D', headers=HEADERS)
        assert ready.status_code == 200 and ready.json()['state'] == 'ready' and len(ready.json()['dataHash']) == 64
        missing = client.get('/api/ibkr-terminal/market-data?mode=paper&accountKey=paper%3Aengineering&conId=13&period=1D', headers=HEADERS)
        assert missing.status_code == 200 and missing.json()['state'] == 'permission-required'
        assert missing.json()['bars'] == [] and 'historical-market-data' in missing.json()['missing']
        assert client.get('/api/ibkr-terminal/market-data?mode=paper&accountKey=paper%3Aother&conId=12&period=1D', headers=HEADERS).status_code == 403
        assert client.get('/api/ibkr-terminal/market-data?mode=paper&accountKey=paper%3Aengineering&conId=999&period=1D', headers=HEADERS).status_code == 403


def test_historical_cache_miss_uses_only_the_bound_read_source_and_hides_source_errors(tmp_path, api_event_loop):
    class Source:
        calls = []
        async def historical_data(self, con_id, period):
            self.calls.append((con_id, period))
            if con_id == 13:
                return market_sample(accountKey='paper:engineering', snapshotId='fixture-risk-v1', conId=13)
            raise RuntimeError('private broker error ACCOUNT-SECRET')

    snapshots = SnapshotStore(tmp_path / 'snapshots.sqlite', allow_fixtures=True)
    market = MarketDataStore(tmp_path / 'market.sqlite', allow_fixtures=True)
    app = create_app(store=snapshots, session_token='offline-test-token', market_data_store=market, clock=lambda: NOW)
    app.state.sessions['paper'].bind(AccountBinding(mode='paper', accountKey='paper:engineering', brokerAccount='DU-ENGINEERING', confirmed=True))
    assert app.state.sessions['paper'].accept(snapshot(sessionRevision=1))
    source = Source(); app.state.market_sources['paper'] = source
    with snapshots, market, TestClient(app, base_url='http://127.0.0.1:8765', backend_options={'loop_factory': lambda: api_event_loop}) as client:
        fetched = client.get('/api/ibkr-terminal/market-data?mode=paper&accountKey=paper%3Aengineering&conId=13&period=1D', headers=HEADERS)
        assert fetched.status_code == 200 and fetched.json()['state'] == 'ready'
        failed = client.get('/api/ibkr-terminal/market-data?mode=paper&accountKey=paper%3Aengineering&conId=12&period=1D', headers=HEADERS)
        assert failed.status_code == 200 and failed.json()['state'] == 'error'
        assert 'ACCOUNT-SECRET' not in failed.text and source.calls == [(13, '1D'), (12, '1D')]


def test_risk_analysis_and_ai_status_are_read_only_and_default_closed(tmp_path, api_event_loop):
    snapshots, app = configured(tmp_path)
    with snapshots, TestClient(app, base_url='http://127.0.0.1:8765', backend_options={'loop_factory': lambda: api_event_loop}) as client:
        response = client.get('/api/ibkr-terminal/analysis/risk?mode=paper&accountKey=paper%3Aengineering', headers=HEADERS)
        assert response.status_code == 200
        assert response.json()['metrics']['grossExposure']['value'] == '800'
        ai = client.get('/api/ibkr-terminal/ai/status?mode=paper&accountKey=paper%3Aengineering', headers=HEADERS)
        assert ai.status_code == 200 and ai.json() == {'sharingEnabled': False, 'activeGrant': None, 'modelCalls': False}
        assert client.get('/api/ibkr-terminal/analysis/risk?mode=paper&accountKey=paper%3Aother', headers=HEADERS).status_code == 403


def test_local_report_create_list_and_download_remain_scoped_to_current_snapshot(tmp_path, api_event_loop):
    snapshots, app = configured(tmp_path)
    with snapshots, TestClient(app, base_url='http://127.0.0.1:8765', backend_options={'loop_factory': lambda: api_event_loop}) as client:
        created = client.post('/api/ibkr-terminal/reports', headers=HEADERS,
            json={'mode': 'paper', 'accountKey': 'paper:engineering'} )
        assert created.status_code == 200
        metadata = created.json()
        assert metadata['testData'] is True and metadata['snapshotId'] == 'fixture-risk-v1'
        reports = client.get('/api/ibkr-terminal/reports?mode=paper&accountKey=paper%3Aengineering', headers=HEADERS).json()
        assert [row['reportHash'] for row in reports] == [metadata['reportHash']]
        markdown = client.get(f"/api/ibkr-terminal/reports/{metadata['reportHash']}/markdown?mode=paper&accountKey=paper%3Aengineering", headers=HEADERS)
        assert markdown.status_code == 200 and metadata['reportHash'] in markdown.text and '工程测试数据' in markdown.text
        pdf = client.get(f"/api/ibkr-terminal/reports/{metadata['reportHash']}/pdf?mode=paper&accountKey=paper%3Aengineering", headers=HEADERS)
        assert pdf.status_code == 200 and pdf.content.startswith(b'%PDF-')
        assert client.get(f"/api/ibkr-terminal/reports/{metadata['reportHash']}/pdf?mode=paper&accountKey=paper%3Aother", headers=HEADERS).status_code == 403


def test_report_api_accepts_only_valid_scoped_evidence_and_exports_it(tmp_path, api_event_loop):
    snapshots, app = configured(tmp_path)
    with snapshots, TestClient(app, base_url='http://127.0.0.1:8765', backend_options={'loop_factory': lambda: api_event_loop}) as client:
        created = client.post('/api/ibkr-terminal/reports', headers=HEADERS, json={
            'mode': 'paper', 'accountKey': 'paper:engineering', 'evidence': evidence_bundle().model_dump(mode='json')})
        assert created.status_code == 200
        markdown = client.get(f"/api/ibkr-terminal/reports/{created.json()['reportHash']}/markdown?mode=paper&accountKey=paper%3Aengineering", headers=HEADERS)
        assert 'https://example.test/news/one' in markdown.text and 'MICRO_PERMISSION_REQUIRED' in markdown.text
        bad = evidence_bundle().model_dump(mode='json'); bad['items'][0]['url'] = 'javascript:alert(1)'
        assert client.post('/api/ibkr-terminal/reports', headers=HEADERS,
            json={'mode': 'paper', 'accountKey': 'paper:engineering', 'evidence': bad}).status_code == 422


def test_report_creation_is_disabled_without_a_server_owned_output_store(tmp_path, api_event_loop):
    with SnapshotStore(tmp_path / 'snapshots.sqlite') as snapshots:
        app = create_app(store=snapshots, session_token='offline-test-token')
        with TestClient(app, base_url='http://127.0.0.1:8765', backend_options={'loop_factory': lambda: api_event_loop}) as client:
            response = client.post('/api/ibkr-terminal/reports', headers=HEADERS, json={'mode': 'paper', 'accountKey': 'paper:unbound'})
            assert response.status_code == 403


def test_report_jobs_are_durable_scoped_and_only_explicitly_cancellable(tmp_path, api_event_loop):
    snapshots = SnapshotStore(tmp_path / 'snapshots.sqlite', allow_fixtures=True)
    reports = LocalReportStore(tmp_path / 'reports', clock=lambda: NOW)
    with ReportJobs(tmp_path / 'report-jobs.sqlite', reports, clock=lambda: NOW) as jobs:
        app = create_app(store=snapshots, session_token='offline-test-token', report_store=reports,
            report_jobs=jobs, clock=lambda: NOW)
        app.state.sessions['paper'].bind(AccountBinding(mode='paper', accountKey='paper:engineering',
            brokerAccount='DU-ENGINEERING', confirmed=True, readonly=True))
        assert app.state.sessions['paper'].accept(snapshot(sessionRevision=1))
        with snapshots, TestClient(app, base_url='http://127.0.0.1:8765', backend_options={'loop_factory': lambda: api_event_loop}) as client:
            created = client.post('/api/ibkr-terminal/reports/jobs', headers=HEADERS,
                json={'mode': 'paper', 'accountKey': 'paper:engineering'})
            assert created.status_code == 200 and created.json()['jobId'].startswith('report-job:')
            job_id = created.json()['jobId']
            done = jobs.wait(job_id, timeout=5)
            fetched = client.get(f'/api/ibkr-terminal/reports/jobs/{job_id}?mode=paper&accountKey=paper%3Aengineering', headers=HEADERS)
            assert fetched.status_code == 200 and fetched.json()['state'] == 'COMPLETED'
            assert fetched.json()['reportHash'] == done.reportHash
            assert client.get(f'/api/ibkr-terminal/reports/jobs/{job_id}?mode=paper&accountKey=paper%3Aother', headers=HEADERS).status_code == 403
            cancelled = client.post(f'/api/ibkr-terminal/reports/jobs/{job_id}/cancel', headers=HEADERS,
                json={'mode': 'paper', 'accountKey': 'paper:engineering'})
            assert cancelled.status_code == 200 and cancelled.json()['state'] == 'COMPLETED'
            assert client.post(f'/api/ibkr-terminal/reports/jobs/{job_id}/retry', headers=HEADERS,
                json={'mode': 'paper', 'accountKey': 'paper:engineering'}).status_code == 403
