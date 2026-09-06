"""Append-only hash chain inside the same SQLite transaction as each mutation."""
import hashlib
import json


def append_event(db, account_key, kind, at, details):
    previous = db.execute('SELECT digest FROM order_audit ORDER BY id DESC LIMIT 1').fetchone()
    previous = previous[0] if previous else ''
    payload = json.dumps(dict(accountKey=account_key, kind=kind, at=at, details=details), sort_keys=True, separators=(',', ':'))
    digest = hashlib.sha256((previous + payload).encode()).hexdigest()
    db.execute('INSERT INTO order_audit(account_key,payload,previous,digest) VALUES(?,?,?,?)', (account_key, payload, previous, digest))


def read_events(db, account_key):
    previous, result = '', []
    for row in db.execute('SELECT account_key,payload,previous,digest FROM order_audit ORDER BY id'):
        account, payload, recorded_previous, digest = row
        if recorded_previous != previous or hashlib.sha256((previous + payload).encode()).hexdigest() != digest:
            raise ValueError('order audit integrity failure')
        previous = digest
        if account == account_key:
            result.append(json.loads(payload))
    return result
