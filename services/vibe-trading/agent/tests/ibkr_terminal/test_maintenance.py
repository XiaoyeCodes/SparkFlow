import json
from pathlib import Path

import pytest

from src.ibkr_terminal.maintenance import backup_runtime, redact_log, restore_runtime, validate_backup
from src.ibkr_terminal.store import SnapshotStore
from test_analytics import snapshot


def test_runtime_backup_is_atomic_hash_verified_and_excludes_ephemeral_tokens(tmp_path):
    runtime = tmp_path / 'runtime'; runtime.mkdir()
    (runtime / 'session.token').write_text('SUPER-SECRET-TOKEN', encoding='utf-8')
    with SnapshotStore(runtime / 'terminal.sqlite', allow_fixtures=True) as store:
        store.save(snapshot())
    report = runtime / 'reports' / ('a' * 64); report.mkdir(parents=True)
    (report / 'account-risk.md').write_text('engineering report', encoding='utf-8')
    destination = tmp_path / 'backup'
    manifest = backup_runtime(runtime, destination, created_at='2026-09-05T12:00:00Z')
    assert manifest['schemaVersion'] == 1 and validate_backup(destination) == manifest
    paths = {row['path'] for row in manifest['files']}
    assert 'terminal.sqlite' in paths and f"reports/{'a' * 64}/account-risk.md" in paths
    assert all('session.token' not in path and not path.endswith(('-wal', '-shm')) for path in paths)
    assert 'SUPER-SECRET-TOKEN' not in (destination / 'manifest.json').read_text(encoding='utf-8')


def test_tamper_is_rejected_and_restore_requires_an_empty_destination(tmp_path):
    runtime = tmp_path / 'runtime'; runtime.mkdir()
    with SnapshotStore(runtime / 'terminal.sqlite'):
        pass
    backup = tmp_path / 'backup'; backup_runtime(runtime, backup, created_at='2026-09-05T12:00:00Z')
    restored = tmp_path / 'restored'
    restore_runtime(backup, restored)
    assert (restored / 'terminal.sqlite').is_file()
    with pytest.raises(ValueError, match='empty'):
        restore_runtime(backup, restored)
    (backup / 'terminal.sqlite').write_bytes(b'tampered')
    with pytest.raises(ValueError, match='hash mismatch'):
        validate_backup(backup)


def test_log_redaction_removes_broker_accounts_tokens_passwords_and_known_account_keys():
    raw = 'account=DU1234567 paper:private-account Authorization: Bearer abc.def password=hunter2 token=xyz'
    clean = redact_log(raw, account_keys=('paper:private-account',))
    assert 'DU1234567' not in clean and 'paper:private-account' not in clean
    assert 'abc.def' not in clean and 'hunter2' not in clean and 'xyz' not in clean
    assert 'broker:' in clean and 'account:' in clean and '[REDACTED]' in clean
