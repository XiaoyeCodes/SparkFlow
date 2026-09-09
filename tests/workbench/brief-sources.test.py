"""Source substitutions must preserve identity, dates, units and original provenance."""
import sys
from pathlib import Path
import unittest
from unittest.mock import patch, Mock
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import ibkr_brief_sources as sources
import ibkr_public_reader as reader


class SourceTests(unittest.TestCase):
    def setUp(self):
        self.cache_read = patch.object(sources.cache, 'read', return_value=None)
        self.cache_write = patch.object(sources.cache, 'write', side_effect=lambda _key, data: data)
        self.cache_read.start(); self.cache_write.start()
        self.addCleanup(self.cache_read.stop); self.addCleanup(self.cache_write.stop)

    def response(self, rows):
        value = Mock()
        value.json.return_value = {'data': rows}
        return value

    def row(self, symbol='AAPL', currency='USD'):
        return {'s': f'NASDAQ:{symbol}', 'd': [symbol, 'Apple Inc.', 'Technology', 'Hardware', 'stock', ['common'], currency,
                210.5, -1.25, -2.66, 212.0, 213.0, 209.0, 123456, 'delayed_streaming_900', 30.2, None, 7.0]}

    def test_profile_preserves_observed_values_without_inventing_quote_time(self):
        with patch.object(sources.requests, 'post', return_value=self.response([self.row()])):
            value = sources.tradingview_profile('AAPL')
        self.assertEqual(value['statistics'], {'trailingPE': 30.2, 'trailingEps': 7.0})
        self.assertEqual(value['financials']['currentPrice'], 210.5)
        self.assertEqual(value['market']['changePercent'], -1.25)
        self.assertEqual(value['market']['low'], 209.0)
        self.assertEqual(value['url'], 'https://www.tradingview.com/symbols/NASDAQ-AAPL/')
        self.assertNotIn('regularMarketTime', value)
        self.assertNotIn('forwardPE', value['statistics'])

    def test_profile_rejects_wrong_security_currency_and_ambiguous_listing(self):
        for rows in ([self.row('AMD')], [self.row(currency='EUR')], [self.row(), self.row()]):
            with patch.object(sources.requests, 'post', return_value=self.response(rows)):
                with self.assertRaisesRegex(ValueError, 'IDENTITY_UNCONFIRMED'):
                    sources.tradingview_profile('AAPL')

    def test_profiles_are_batched_and_partial_rows_remain_individually_verified(self):
        with patch.object(sources.requests, 'post', return_value=self.response([self.row(), self.row('MSFT', 'EUR')])) as post:
            value = sources.tradingview_profiles(['AAPL', 'MSFT'])
        self.assertEqual(list(value['profiles']), ['AAPL'])
        self.assertEqual(post.call_count, 1)
        self.assertEqual(len(post.call_args.kwargs['json']['symbols']['tickers']), 8)

    def test_etf_does_not_get_fabricated_corporate_valuation(self):
        row = self.row('QQQ'); row['d'][1] = 'Invesco QQQ'; row['d'][4:6] = ['fund', ['etf']]; row['d'][15:18] = [None, None, None]
        with patch.object(sources.requests, 'post', return_value=self.response([row])):
            value = sources.tradingview_profile('QQQ')
        self.assertEqual(value['instrumentType'], 'ETF')
        self.assertEqual(value['statistics'], {})

    def test_market_snapshot_returns_spy_qqq_and_vix_with_daily_moves(self):
        rows = []
        for ticker, symbol, value in [('AMEX:SPY', 'SPY', 765.96), ('NASDAQ:QQQ', 'QQQ', 718.36), ('CBOE:VIX', 'VIX', 15.72)]:
            rows.append({'s': ticker, 'd': [symbol, symbol + ' name', None if symbol == 'VIX' else 'USD', value, 1.25, .5, value - 1, value + 2, value - 2, None, 'delayed_streaming_900']})
        with patch.object(sources.requests, 'post', return_value=self.response(rows)):
            value = sources.tradingview_market_snapshot()['markets']
        self.assertEqual(list(value), ['SPY', 'QQQ', 'VIX'])
        self.assertEqual(value['VIX']['price'], 15.72)
        self.assertEqual(value['SPY']['changePercent'], 1.25)

    def test_atom_update_is_not_publication_and_enclosure_is_not_article(self):
        raw = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Apple update</title><updated>2026-09-08T12:00:00Z</updated><link rel="enclosure" href="https://apple.com/image.jpg"/><link href="https://apple.com/newsroom/story/"/><content>UNREAD_FEED_SUMMARY</content></entry></feed>'
        rows = sources.parse_feed(raw, sources.FEEDS['AAPL'])
        self.assertEqual(rows[0]['url'], 'https://apple.com/newsroom/story/')
        self.assertIsNone(rows[0]['publishedAt'])
        self.assertNotIn('UNREAD_FEED_SUMMARY', str(rows))

    def test_discovery_excludes_future_and_old_feed_articles(self):
        rows = [{'url': 'https://example.com/' + name, 'title': name, 'publishedAt': date,
                 'updatedAt': None, 'sourceUrl': 'https://example.com/feed'} for name, date in [
                     ('recent', '2026-09-08T10:00:00+00:00'), ('future', '2026-09-10T10:00:00+00:00'), ('old', '2026-07-01T00:00:00+00:00')]]
        with patch.object(sources, 'download_public', return_value=('https://example.com/feed', 'xml', 'xml')), patch.object(sources, 'parse_feed', return_value=rows):
            result = sources.discover('AAPL', 'news', '2026-09-09T10:00:00Z')
        self.assertEqual([row['title'] for row in result['results']], ['recent'])

    def test_fred_fallback_preserves_observation_periods_and_source(self):
        raw = 'observation_date,UNRATE\n2026-06-01,4.1\n2026-07-01,.\n2026-08-01,4.2\n'
        url = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=UNRATE'
        with patch.object(reader, 'bls_series', side_effect=ValueError('PUBLIC_BLS_NO_SERIES')), patch.object(reader, 'download_public', return_value=(url, 'text/csv', raw)):
            value = reader.macro_series('LNS14000000')
        import json
        content = json.loads(value['content'])
        self.assertEqual(content['data'], [{'date': '2026-06-01', 'value': '4.1'}, {'date': '2026-08-01', 'value': '4.2'}])
        self.assertEqual(value['url'], url)
        self.assertIsNone(value['publishedAt'])
        self.assertIn('FRED', value['sourceSubstitution'])

    def test_failed_bls_and_fred_remain_errors(self):
        with patch.object(reader, 'bls_series', side_effect=ValueError('PUBLIC_BLS_NO_SERIES')), patch.object(reader, 'download_public', side_effect=requests.Timeout()):
            value = reader.read_public_url('https://api.bls.gov/publicAPI/v2/timeseries/data/LNS14000000')
        self.assertEqual(value['status'], 'error')

    def test_fred_direct_route_uses_client_identity_and_validates_its_redirect(self):
        response = Mock(status_code=302, headers={'Location': 'https://127.0.0.1/private'})
        session = Mock()
        session.get.return_value = response
        manager = Mock()
        manager.__enter__ = Mock(return_value=session)
        manager.__exit__ = Mock(return_value=False)
        def resolve(host, *_args, **_kwargs):
            return [(2, 1, 6, '', ('127.0.0.1' if host == '127.0.0.1' else '1.1.1.1', 443))]
        with patch.object(reader.requests, 'Session', return_value=manager), patch.object(reader.socket, 'getaddrinfo', side_effect=resolve):
            with self.assertRaisesRegex(ValueError, 'PUBLIC_URL_REQUIRED'):
                reader.download_public('https://fred.stlouisfed.org/graph/fredgraph.csv?id=UNRATE')
        self.assertFalse(session.trust_env)
        self.assertNotIn('headers', session.get.call_args.kwargs)
        self.assertFalse(session.get.call_args.kwargs['allow_redirects'])
        response.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
