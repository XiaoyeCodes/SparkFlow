"""SQLite snapshot checkpoint store. Order tables arrive in P3, not here."""
import sqlite3
import threading
from hashlib import sha256
from pathlib import Path

from .schemas import Snapshot


class SnapshotStore:
    def __init__(self, path: Path, *, allow_fixtures: bool = False):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.allow_fixtures = allow_fixtures
        self._lock = threading.RLock()
        self._db = sqlite3.connect(path, check_same_thread=False)
        with self._db:
            self._db.execute('PRAGMA journal_mode=WAL')
            version = self._db.execute('PRAGMA user_version').fetchone()[0]
            if version not in (0, 1, 2):
                self._db.close()
                raise ValueError('unsupported terminal database version')
            self._db.execute('CREATE TABLE IF NOT EXISTS snapshots (mode TEXT NOT NULL, account_key TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(mode, account_key))')
            self._db.execute('CREATE TABLE IF NOT EXISTS bindings (mode TEXT NOT NULL, account_key TEXT NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY(mode, account_key))')
            self._db.execute('PRAGMA user_version=2')

    def ensure_binding(self, mode: str, account_key: str, broker_account: str) -> bool:
        fingerprint = sha256(f'{mode}:{broker_account}'.encode('utf-8')).hexdigest()
        with self._lock, self._db:
            inserted = self._db.execute('INSERT OR IGNORE INTO bindings VALUES (?, ?, ?)', (mode, account_key, fingerprint)).rowcount
            stored = self._db.execute('SELECT fingerprint FROM bindings WHERE mode=? AND account_key=?', (mode, account_key)).fetchone()[0]
            if stored != fingerprint:
                raise ValueError('account binding identity changed; use a new accountKey')
        # Legacy cached snapshots without recorded binding provenance are not restored.
        return not bool(inserted)

    def save(self, snapshot: Snapshot):
        if snapshot.testData and not self.allow_fixtures:
            raise ValueError('fixture rejected by production store')
        with self._lock, self._db:
            self._db.execute('INSERT INTO snapshots VALUES (?, ?, ?) ON CONFLICT(mode, account_key) DO UPDATE SET payload=excluded.payload', (snapshot.mode, snapshot.accountKey, snapshot.model_dump_json()))

    def load(self, mode: str, account_key: str) -> Snapshot | None:
        with self._lock:
            row = self._db.execute('SELECT payload FROM snapshots WHERE mode=? AND account_key=?', (mode, account_key)).fetchone()
        if row is None:
            return None
        snapshot = Snapshot.model_validate_json(row[0])
        if snapshot.testData and not self.allow_fixtures:
            raise ValueError('fixture rejected by production store')
        return snapshot

    def close(self):
        with self._lock:
            self._db.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
