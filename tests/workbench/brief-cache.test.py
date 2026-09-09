import hashlib
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import ibkr_public_cache as cache


class PublicCacheTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory(prefix='sparkflow-public-cache-test-')
        self.location = patch.object(cache, 'DIRECTORY', Path(self.directory.name))
        self.location.start()
        self.addCleanup(self.directory.cleanup)
        self.addCleanup(self.location.stop)

    def test_reuse_preserves_original_time_and_publication(self):
        data = cache.write('article:test', {'status': 'ok', 'publishedAt': '2026-09-01', 'content': 'original'})
        result = cache.read('article:test')
        self.assertTrue(result['cached'])
        self.assertEqual(result['fetchedAt'], data['fetchedAt'])
        self.assertEqual(result['publishedAt'], '2026-09-01')
        self.assertEqual(result['content'], 'original')

    def test_expired_future_and_mismatched_records_are_rejected(self):
        key = 'article:test'
        path = cache.DIRECTORY / (hashlib.sha256(key.encode()).hexdigest() + '.json')
        for at in ['2000-01-01T00:00:00+00:00', '2099-01-01T00:00:00+00:00', 'invalid']:
            path.write_text(json.dumps({'key': key, 'fetchedAt': at, 'data': {}}), encoding='utf-8')
            self.assertIsNone(cache.read(key))
        cache.write(key, {'status': 'ok'})
        value = json.loads(path.read_text('utf-8')); value['key'] = 'different-source'
        path.write_text(json.dumps(value), encoding='utf-8')
        self.assertIsNone(cache.read(key))


if __name__ == '__main__':
    unittest.main()
