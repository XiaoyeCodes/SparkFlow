import json
import hashlib

import pytest

from src.ibkr_terminal.analytics import analyze_snapshot
from src.ibkr_terminal.reports import LocalReportStore, ReportEvidence, ReportEvidenceBundle, ReportError, build_account_report
from test_analytics import NOW, snapshot


def test_account_report_exports_same_traceable_numbers_to_json_markdown_html_and_pdf(tmp_path):
    report = build_account_report(snapshot(), tmp_path, now=NOW)
    assert report.testData and len(report.reportHash) == len(report.snapshotHash) == 64
    assert set(report.files) == {'json', 'markdown', 'html', 'pdf'}
    assert all(path.exists() and path.parent.name == report.reportHash for path in report.files.values())
    payload = json.loads(report.files['json'].read_text(encoding='utf-8'))
    markdown = report.files['markdown'].read_text(encoding='utf-8')
    html = report.files['html'].read_text(encoding='utf-8')
    assert payload['reportSchemaVersion'] == 2
    assert payload['analysis']['metrics']['grossExposure']['value'] == '800'
    for value in (report.reportHash, report.snapshotHash, 'fixture-risk-v1', 'fixture.accountSummary', '800', '0.6', '0.2'):
        assert value in markdown and value in html
    for heading in ('摘要', '账户概况', '收益归因', '建议', '来源与限制'):
        assert heading in markdown and heading in html
    missing_attribution = '数据缺失：当前快照不含期初权益、净现金流及分段收益'
    assert missing_attribution in markdown and missing_attribution in html
    pdf = report.files['pdf'].read_bytes()
    assert pdf.startswith(b'%PDF-') and len(pdf) > 3000


def test_missing_metrics_are_written_as_missing_not_zero_and_no_ai_consent_is_implied(tmp_path):
    value = snapshot(metrics=dict(netLiquidation=None, unrealizedPnl=None, buyingPower=None, maintenanceMargin=None),
        positions=[], missing=['netLiquidation'])
    report = build_account_report(value, tmp_path, now=NOW)
    markdown = report.files['markdown'].read_text(encoding='utf-8')
    assert '| 最大仓位权重 | 数据缺失 |' in markdown
    assert '| 保证金使用率 | 数据缺失 |' in markdown
    assert 'AI 账户分享：关闭' in markdown
    assert '工程测试数据' in markdown


def test_untrusted_source_text_is_escaped_in_html_report(tmp_path):
    malicious = '<img src=x onerror=alert(1)>'
    value = snapshot(provenance={'metrics.netLiquidation': dict(source=malicious, observedAt=NOW.isoformat(), brokerAsOf=None, requestCompletedAt=None),
        'metrics.maintenanceMargin': dict(source='fixture.safe', observedAt=NOW.isoformat(), brokerAsOf=None, requestCompletedAt=None)})
    report = build_account_report(value, tmp_path, now=NOW)
    html = report.files['html'].read_text(encoding='utf-8')
    markdown = report.files['markdown'].read_text(encoding='utf-8')
    assert malicious not in html
    assert '&lt;img src=x onerror=alert(1)&gt;' in html
    assert malicious not in markdown
    assert '&lt;img src=x onerror=alert(1)&gt;' in markdown


def evidence_bundle(**changes):
    value = dict(generatedAt=NOW, gaps=['MICRO_PERMISSION_REQUIRED'], items=[dict(
        evidenceId='news:one', kind='news', title='TEST holding catalyst', summary='Source-backed context.',
        source='Fixture News', url='https://example.test/news/one', publishedAt=NOW, fetchedAt=NOW,
        linkedConIds=[12], relation='SYMBOL_MENTION', testData=True)])
    value.update(changes)
    return ReportEvidenceBundle.model_validate(value)


def test_report_exports_scoped_news_macro_evidence_links_and_micro_gap(tmp_path):
    bundle = evidence_bundle(items=[*evidence_bundle().items, ReportEvidence(
        evidenceId='macro:rates', kind='macro', title='US rates', summary='4.25%', source='Fixture Macro',
        url='https://example.test/macro/rates', publishedAt=None, fetchedAt=NOW, linkedConIds=[],
        relation='ACCOUNT_CONTEXT_NOT_CAUSAL', testData=True)])
    report = build_account_report(snapshot(), tmp_path, now=NOW, evidence=bundle)
    payload = json.loads(report.files['json'].read_text(encoding='utf-8'))
    markdown = report.files['markdown'].read_text(encoding='utf-8')
    html = report.files['html'].read_text(encoding='utf-8')
    assert payload['evidence']['items'][0]['linkedConIds'] == [12]
    for value in ('https://example.test/news/one', 'ACCOUNT_CONTEXT_NOT_CAUSAL', 'MICRO_PERMISSION_REQUIRED'):
        assert value in markdown and value in html


def test_report_rejects_cross_provenance_or_unknown_holding_evidence(tmp_path):
    with pytest.raises(ReportError, match='EVIDENCE_PROVENANCE_MISMATCH'):
        build_account_report(snapshot(), tmp_path, now=NOW, evidence=evidence_bundle(items=[
            evidence_bundle().items[0].model_copy(update={'testData': False})]))
    with pytest.raises(ReportError, match='EVIDENCE_SCOPE_MISMATCH'):
        build_account_report(snapshot(), tmp_path, now=NOW, evidence=evidence_bundle(items=[
            evidence_bundle().items[0].model_copy(update={'linkedConIds': (999,)})]))


def test_pre_evidence_report_hash_remains_readable_without_rewriting_it(tmp_path):
    source = snapshot()
    analysis = analyze_snapshot(source, now=NOW).model_dump(mode='json')
    snapshot_payload = source.model_dump(mode='json')
    digest = lambda value: hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    snapshot_hash = digest(snapshot_payload)
    report_hash = digest({'snapshotHash': snapshot_hash, 'analysis': analysis})
    directory = tmp_path / report_hash
    directory.mkdir()
    (directory / 'account-risk.json').write_text(json.dumps({
        'reportHash': report_hash, 'snapshotHash': snapshot_hash, 'snapshot': snapshot_payload, 'analysis': analysis,
    }, ensure_ascii=False), encoding='utf-8')
    store = LocalReportStore(tmp_path, clock=lambda: NOW)
    assert store.list(source.mode, source.accountKey)[0].reportHash == report_hash
