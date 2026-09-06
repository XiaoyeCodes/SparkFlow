"""Local runtime backup/restore and conservative diagnostic log redaction."""
from __future__ import annotations

from hashlib import sha256
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
from uuid import uuid4


def _hash(path: Path):
    digest = sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def _safe_relative(root: Path, relative: str):
    pure = PurePosixPath(relative)
    if pure.is_absolute() or not pure.parts or '..' in pure.parts or any(part in ('', '.') for part in pure.parts):
        raise ValueError('unsafe backup path')
    root = root.resolve()
    target = (root / Path(*pure.parts)).resolve()
    if target == root or root not in target.parents:
        raise ValueError('unsafe backup path')
    return target


def _remove_created(path: Path, expected_parent: Path):
    resolved, parent = path.resolve(), expected_parent.resolve()
    if resolved.parent != parent or not resolved.name.startswith('.sparkflow-backup-partial-'):
        raise ValueError('refusing unexpected cleanup target')
    if resolved.exists():
        shutil.rmtree(resolved)


def backup_runtime(runtime: Path, destination: Path, *, created_at: str):
    runtime, destination = runtime.resolve(), destination.resolve()
    if not runtime.is_dir():
        raise ValueError('runtime directory missing')
    if destination.exists():
        raise ValueError('backup destination must not exist')
    if runtime == destination or runtime in destination.parents:
        raise ValueError('backup destination must be outside runtime')
    stage = destination.parent / f'.sparkflow-backup-partial-{uuid4().hex}'
    stage.mkdir(parents=True)
    files = []
    try:
        for source in sorted(runtime.glob('*.sqlite')):
            if source.is_symlink() or not source.is_file():
                raise ValueError('unsupported runtime database entry')
            target = stage / source.name
            original = sqlite3.connect(f'file:{source.as_posix()}?mode=ro', uri=True)
            copied = sqlite3.connect(target)
            try:
                original.backup(copied)
                copied.commit()
            finally:
                copied.close()
                original.close()
            files.append({'path': source.name, 'kind': 'sqlite', 'bytes': target.stat().st_size, 'sha256': _hash(target)})
        reports = runtime / 'reports'
        if reports.exists():
            for source in sorted(reports.rglob('*')):
                if source.is_symlink():
                    raise ValueError('report symlinks are not backed up')
                if not source.is_file():
                    continue
                relative = source.relative_to(runtime).as_posix()
                if source.suffix.lower() not in ('.json', '.md', '.html', '.pdf'):
                    continue
                target = _safe_relative(stage, relative)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
                files.append({'path': relative, 'kind': 'report', 'bytes': target.stat().st_size, 'sha256': _hash(target)})
        manifest = {'schemaVersion': 1, 'createdAt': created_at, 'source': 'sparkflow-ibkr-local-runtime', 'files': files,
            'excluded': ['session.token', '*.sqlite-wal', '*.sqlite-shm']}
        (stage / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + '\n', encoding='utf-8')
        os.replace(stage, destination)
        return manifest
    except BaseException:
        _remove_created(stage, destination.parent)
        raise


def validate_backup(backup: Path):
    backup = backup.resolve()
    try:
        manifest = json.loads((backup / 'manifest.json').read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        raise ValueError('backup manifest invalid') from None
    if manifest.get('schemaVersion') != 1 or manifest.get('source') != 'sparkflow-ibkr-local-runtime' or not isinstance(manifest.get('files'), list):
        raise ValueError('backup manifest invalid')
    seen = set()
    for row in manifest['files']:
        if not isinstance(row, dict) or set(row) != {'path', 'kind', 'bytes', 'sha256'} or row['path'] in seen:
            raise ValueError('backup manifest invalid')
        seen.add(row['path'])
        path = _safe_relative(backup, row['path'])
        if not path.is_file() or path.is_symlink() or path.stat().st_size != row['bytes'] or _hash(path) != row['sha256']:
            raise ValueError(f"backup hash mismatch: {row['path']}")
        if row['kind'] == 'sqlite':
            try:
                connection = sqlite3.connect(f'file:{path.as_posix()}?mode=ro', uri=True)
                try:
                    if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                        raise ValueError(f"backup database invalid: {row['path']}")
                finally:
                    connection.close()
            except sqlite3.DatabaseError:
                raise ValueError(f"backup database invalid: {row['path']}") from None
        elif row['kind'] != 'report':
            raise ValueError('backup manifest invalid')
    return manifest


def restore_runtime(backup: Path, destination: Path):
    manifest = validate_backup(backup)
    destination = destination.resolve()
    if destination.exists() and any(destination.iterdir()):
        raise ValueError('restore destination must be empty')
    destination.mkdir(parents=True, exist_ok=True)
    for row in manifest['files']:
        source = _safe_relative(backup.resolve(), row['path'])
        target = _safe_relative(destination, row['path'])
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    (destination / 'restore-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + '\n', encoding='utf-8')
    return manifest


def _alias(prefix: str, value: str):
    return f'{prefix}:{sha256(value.encode()).hexdigest()[:12]}'


def redact_log(text: str, *, account_keys=()):
    result = str(text)
    for account_key in sorted(set(account_keys), key=len, reverse=True):
        result = result.replace(account_key, _alias('account', account_key))
    result = re.sub(r'\b(?:DU|U)\d{4,}\b', lambda match: _alias('broker', match.group(0)), result, flags=re.IGNORECASE)
    result = re.sub(r'(?i)(Authorization\s*:\s*Bearer)\s+\S+', r'\1 [REDACTED]', result)
    result = re.sub(r'(?i)\b(password|passwd|token|secret)\s*[:=]\s*\S+', lambda match: f'{match.group(1)}=[REDACTED]', result)
    return result
