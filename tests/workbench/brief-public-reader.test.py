"""Offline checks for the direct public-source reader; never calls providers/models."""
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

MODULE_PATH = Path(__file__).resolve().parents[2] / 'scripts' / 'ibkr_public_reader.py'
sys.path.insert(0, str(MODULE_PATH.parent))
spec = importlib.util.spec_from_file_location('brief_public_reader', MODULE_PATH)
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class PublicReaderTests(unittest.TestCase):
    def setUp(self):
        self.cache_read = patch.object(reader.public_cache, 'read', return_value=None)
        self.cache_write = patch.object(reader.public_cache, 'write', side_effect=lambda _key, data: data)
        self.cache_read.start(); self.cache_write.start()
        self.addCleanup(self.cache_read.stop); self.addCleanup(self.cache_write.stop)

    def test_url_rejects_credentials_tokens_and_private_dns(self):
        with patch.object(reader.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('127.0.0.1', 443))]):
            for url in ('https://example.com/private', 'https://user:pass@example.com/', 'https://foo.internal/'):
                with self.assertRaises(ValueError):
                    reader.safe_public_url(url)
        with patch.object(reader.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('1.1.1.1', 443))]):
            with self.assertRaises(ValueError):
                reader.safe_public_url('https://example.com/?access_token=private')
            self.assertEqual(reader.safe_public_url('https://example.com/report#footer'), 'https://example.com/report')

    def test_redirect_is_validated_before_following(self):
        class Response:
            status_code = 302
            headers = {'Location': 'https://127.0.0.1/private'}
            def close(self):
                pass
        def resolve(host, *_args, **_kwargs):
            return [(2, 1, 6, '', ('127.0.0.1' if host == '127.0.0.1' else '1.1.1.1', 443))]
        with patch.object(reader.socket, 'getaddrinfo', side_effect=resolve), patch.object(reader.requests, 'get', return_value=Response()) as get:
            with self.assertRaisesRegex(ValueError, 'PUBLIC_URL_REQUIRED'):
                reader.download_public('https://example.com/start')
            self.assertEqual(get.call_count, 1)

    def test_html_preserves_article_text_and_publication_metadata_without_navigation(self):
        original = 'The company announced quarterly earnings and revenue guidance. ' * 8
        html = f'<html><head><title>Issuer results</title><meta property="article:published_time" content="2026-09-07T12:00:00Z"></head><body><nav>IGNORE NAVIGATION</nav><main><h1>Issuer results</h1><p>{original}</p><a href="/release">Financial release</a></main><footer>IGNORE FOOTER</footer></body></html>'
        result = reader.extract_html(html, 'https://example.com/results')
        self.assertEqual(result['publishedAt'], '2026-09-07T12:00:00Z')
        self.assertIn(original.strip(), result['content'])
        self.assertNotIn('IGNORE', result['content'])
        self.assertEqual(result['links'][0]['url'], 'https://example.com/release')

    def test_block_page_is_never_original_evidence(self):
        with self.assertRaisesRegex(ValueError, 'PUBLIC_NO_ARTICLE'):
            reader.extract_html('<html><title>Access denied</title><body>Access denied. Verify you are human.</body></html>', 'https://example.com/')

    def test_bls_keeps_original_values_periods_and_revision_footnotes(self):
        rows = [{'year': '2026', 'period': f'M{8-i:02}', 'periodName': 'source month', 'value': str(159075-i), 'footnotes': [{'code': 'P', 'text': 'preliminary'}]} for i in range(7)]
        raw = json.dumps({'status': 'REQUEST_SUCCEEDED', 'Results': {'series': [{'seriesID': 'CES0000000001', 'data': rows}]}})
        with patch.object(reader, 'download_public', return_value=('https://api.bls.gov/publicAPI/v2/timeseries/data/CES0000000001', 'application/json', raw)):
            result = reader.bls_series('CES0000000001', 2026)
        content = json.loads(result['content'])
        self.assertEqual(content['data'], rows[:6])
        self.assertIsNone(result['publishedAt'])
        self.assertIn('not jobs added', content['valueMeaning'])
        self.assertNotIn('change', content['data'][0])

    def test_fed_publication_uses_article_date_and_explicit_release_timezone(self):
        html = '<html><title>FOMC Statement</title><main><div><p class="article__time">July 29, 2026</p><h1>Federal Reserve issues FOMC statement</h1><p>For release at 2:00 p.m. EDT</p></div><p>' + 'The Committee seeks maximum employment and stable inflation. ' * 5 + '</p><div id="lastUpdate">Last Update: August 1, 2026</div></main></html>'
        result = reader.extract_html(html, 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm')
        self.assertEqual(result['publishedAt'], '2026-07-29T18:00:00+00:00')

    def test_release_dateline_is_not_confused_with_fiscal_period_or_event_date(self):
        paragraph = 'REDMOND, Wash. — July 29, 2026 — Microsoft Corp. today announced the following results for the quarter ended June 30, 2026. '
        html = f'<html><title>Microsoft results</title><main><p>{paragraph}</p><p>{"Quarterly financial results. " * 8}</p></main></html>'
        result = reader.extract_html(html, 'https://www.microsoft.com/en-us/Investor/earnings/FY-2026-Q4/press-release-webcast')
        self.assertEqual(result['publishedAt'], '2026-07-29')
        calendar = '<html><title>Upcoming Events</title><main>' + 'Upcoming investor conference Sep 9, 2026 11:15 am ET. ' * 5 + '</main></html>'
        self.assertNotIn('publishedAt', reader.extract_html(calendar, 'https://example.com/calendar'))

    def test_yahoo_article_byline_and_amd_dateline_preserve_explicit_publication(self):
        html = '<html><title>Company earnings</title><main><time class="byline-attr-meta-time" datetime="2026-09-08T21:45:08+00:00">Tuesday</time><p>' + 'Company quarterly revenue and earnings release. ' * 8 + '</p></main></html>'
        self.assertEqual(reader.extract_html(html, 'https://finance.yahoo.com/markets/stocks/articles/story.html')['publishedAt'], '2026-09-08T21:45:08+00:00')
        html = html.replace('<time class="byline-attr-meta-time" datetime="2026-09-08T21:45:08+00:00">Tuesday</time>', '<time class="date" datetime="2026-08-31T07:15:00">August 31, 2026 7:15 am EDT</time>')
        self.assertEqual(reader.extract_html(html, 'https://ir.amd.com/news-events/press-releases/detail/1298/story')['publishedAt'], '2026-08-31T11:15:00+00:00')


if __name__ == '__main__':
    unittest.main()
