"""A real v1 file shape is upgraded without dropping the unresolved intent."""
import json
import sqlite3

import pytest

from src.ibkr_terminal.risk import canonical, intent_hash, RiskDenied
from test_orders import NOW, authorization, context, intent, ledger


def test_v1_order_checkpoint_migrates_with_identity_and_reservation_intact(tmp_path):
    path = tmp_path / 'old-orders.db'
    old_intent = intent()
    old_record = dict(intent=old_intent.model_dump(), bodyHash=intent_hash(old_intent), source='fixture',
        submission='UNKNOWN', execution='PENDING', reservedCash='601', reservedNotional='600', reservedQuantity='0',
        orderId=None, clientId=None, permId=None, lastError='TimeoutError')
    with sqlite3.connect(path) as old:
        old.execute('CREATE TABLE order_authorizations (id TEXT PRIMARY KEY, account_key TEXT NOT NULL, payload TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)')
        old.execute('''CREATE TABLE order_intents (mode TEXT NOT NULL, account_key TEXT NOT NULL, intent_id TEXT NOT NULL,
            payload TEXT NOT NULL, context TEXT NOT NULL, trading_day TEXT NOT NULL, created_epoch REAL NOT NULL,
            PRIMARY KEY(mode,account_key,intent_id))''')
        old.execute('INSERT INTO order_authorizations VALUES(?,?,?,0)', ('fixture-auth', 'paper:engineering', canonical(authorization())))
        old.execute('INSERT INTO order_intents VALUES(?,?,?,?,?,?,?)', ('paper', 'paper:engineering', 'intent-1', json.dumps(old_record), canonical(context()), '2026-09-04', NOW.timestamp()))
        old.execute('PRAGMA user_version=1')
    with ledger(path) as db:
        restored = db.get('paper:engineering', 'paper', 'intent-1')
        assert restored.submission == 'UNKNOWN' and restored.bodyHash == intent_hash(old_intent)
        assert db.reserve(old_intent, context()) == restored
        assert db.reservations('paper:engineering', 'paper')['cash'] == '601'
        assert db.recover_inflight() == 0
        with pytest.raises(RiskDenied, match='UNRESOLVED_ORDER'):
            db.reserve(intent('next', quantity='1'), context())
    with sqlite3.connect(path) as migrated:
        assert migrated.execute('PRAGMA user_version').fetchone()[0] == 6
        assert migrated.execute('SELECT COUNT(*) FROM sdk_dispatch_permits').fetchone()[0] == 0
        assert migrated.execute('SELECT COUNT(*) FROM sdk_dispatch_attempts').fetchone()[0] == 0
        assert migrated.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='order_previews'").fetchone() == ('order_previews',)
        assert migrated.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert migrated.execute('SELECT COUNT(*) FROM order_intents').fetchone()[0] == 1
