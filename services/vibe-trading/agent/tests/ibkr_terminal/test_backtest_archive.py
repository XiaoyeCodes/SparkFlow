import json

import pytest

from src.ibkr_terminal.backtests import BacktestArchive, BacktestError, run_backtest
from test_backtests import NOW, bar, config, signal, strategy


def package(tmp_path):
    item = strategy(tmp_path)
    settings = config(commissionPerOrder='1')
    bars = [bar(2, 90), bar(3, 100), bar(4, 110)]
    signals = [signal(2, 2), signal(3, 0)]
    result = run_backtest(item, settings, bars, signals, clock=lambda: NOW)
    return item, settings, bars, signals, result


def test_archive_replays_before_immutable_save_and_survives_restart(tmp_path):
    item, settings, bars, signals, result = package(tmp_path)
    path = tmp_path / 'runs.sqlite'
    with BacktestArchive(path) as archive:
        stored = archive.save(result, item, settings, bars, signals)
        assert stored.result.runHash == result.runHash
        assert archive.save(result, item, settings, bars, signals) == stored
        assert len(archive.list()) == 1
    with BacktestArchive(path) as reopened:
        restored = reopened.get(result.runHash)
        assert restored == stored
        assert restored.bars[0].dataVersion == 'fixture-v1'
        assert restored.result.testData is True


def test_archive_rejects_tampered_result_or_same_hash_with_other_payload(tmp_path):
    item, settings, bars, signals, result = package(tmp_path)
    with BacktestArchive(tmp_path / 'runs.sqlite') as archive:
        with pytest.raises(BacktestError, match='RUN_REPLAY_MISMATCH'):
            archive.save(result.model_copy(update={'metrics': result.metrics.model_copy(update={'finalEquity': '999999'})}),
                item, settings, bars, signals)
        archive.save(result, item, settings, bars, signals)
        archive._db.execute("UPDATE terminal_backtests SET payload='{}' WHERE run_hash=?", (result.runHash,))
        with pytest.raises(BacktestError, match='ARCHIVE_INVALID'):
            archive.get(result.runHash)


def test_archive_exports_traceable_json_and_markdown_with_fixture_warning(tmp_path):
    item, settings, bars, signals, result = package(tmp_path)
    with BacktestArchive(tmp_path / 'runs.sqlite') as archive:
        archive.save(result, item, settings, bars, signals)
        files = archive.export(result.runHash, tmp_path / 'exports')
    payload = json.loads(files['json'].read_text(encoding='utf-8'))
    report = files['markdown'].read_text(encoding='utf-8')
    assert payload['result']['runHash'] == result.runHash
    assert payload['bars'][0]['source'] == 'fixture.bars'
    assert payload['strategy']['definition']['origin'] == 'fixture'
    for value in (result.runHash, result.datasetHash, result.strategyHash, result.configHash):
        assert value in report
    assert '工程测试数据' in report and '不是用户策略验收' in report
