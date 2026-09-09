"""Short-lived cache of successful public-source results, with original fetch times."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import os
import uuid

DIRECTORY = Path(__file__).resolve().parents[1] / '.sparkflow' / 'ibkr-public-cache'


def read(key, seconds=600):
    path = DIRECTORY / (hashlib.sha256(key.encode()).hexdigest() + '.json')
    try:
        if path.stat().st_size > 1_000_000:
            return None
        value = json.loads(path.read_text('utf-8'))
        at = datetime.fromisoformat(value['fetchedAt'])
        age = (datetime.now(timezone.utc) - at).total_seconds()
        if value['key'] != key or not 0 <= age <= seconds or not isinstance(value['data'], dict):
            return None
        return {**value['data'], 'cached': True, 'fetchedAt': value['fetchedAt']}
    except (OSError, ValueError, KeyError, TypeError):
        return None


def write(key, data):
    fetched = datetime.now(timezone.utc).isoformat()
    value = {**data, 'fetchedAt': fetched}
    temporary = None
    try:
        DIRECTORY.mkdir(parents=True, exist_ok=True)
        encoded = json.dumps({'key': key, 'fetchedAt': fetched, 'data': value}, ensure_ascii=False, allow_nan=False)
        if len(encoded.encode('utf-8')) > 1_000_000:
            return value
        path = DIRECTORY / (hashlib.sha256(key.encode()).hexdigest() + '.json')
        temporary = path.with_suffix('.' + uuid.uuid4().hex + '.tmp')
        temporary.write_text(encoded, encoding='utf-8')
        os.replace(temporary, path)
    except (OSError, ValueError, TypeError):
        pass  # Cache failures never discard a successful source response.
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
    return value
