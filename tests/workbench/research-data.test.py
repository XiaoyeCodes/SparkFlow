import sys
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'services/vibe-trading/agent'))
from src.tools import research_data_tool as data
from src.tools import financial_statements_tool as statements


class ResearchDataTests(unittest.TestCase):
    def setUp(self):
        data._CACHE.clear()
        stub = patch.object(data, 'yahoo_fundamentals', side_effect=ValueError('offline fixture'))
        stub.start(); self.addCleanup(stub.stop)

    def test_symbol_aliases_and_rejection(self):
        for symbol in ['BRK B', 'BRK.B', 'BRK-B', 'BRK-B.US']:
            self.assertEqual(data.symbol_alias(symbol), 'BRK.B')
        for symbol in ['AAPL?token=x', 'https://localhost', 'AAPL/../../', '', 'AAPL,TSM']:
            with self.assertRaises(ValueError): data.symbol_alias(symbol)

    def test_identity_mismatch_and_zero_quote_do_not_become_prices(self):
        response = Mock()
        for symbol, price in [('MSFT', 250), ('AAPL', 0), ('AAPL', None)]:
            response.json.return_value = {'data': {'diff': [{'f12': symbol, 'f13': 105, 'f2': price, 'f124': datetime.now(timezone.utc).timestamp()}]}}
            with patch.object(data, 'get', return_value=response):
                with self.assertRaises(ValueError): data.eastmoney_quote('AAPL')

    def test_fallback_keeps_source_price_and_uses_identity_supplement(self):
        em = {'source': '东方财富', 'url': 'https://quote.eastmoney.com/us/AAPL.html', 'market': {'price': 10, 'asOf': 'first'}}
        qq = {'source': '腾讯财经', 'url': 'https://gu.qq.com/usAAPL', 'name': 'Apple', 'instrumentType': 'EQUITY', 'market': {'price': 20, 'asOf': 'second'}}
        with patch.object(data, 'eastmoney_quote', return_value=em), patch.object(data, 'tencent_profile', return_value=qq):
            value = data.profile('AAPL')
            self.assertEqual(value['market'], {'price': 10, 'asOf': 'first'})
            self.assertEqual(value['name'], 'Apple')
        with patch.object(data, 'eastmoney_quote', side_effect=ValueError()), patch.object(data, 'tencent_profile', return_value=qq):
            self.assertEqual(data.profile('AAPL')['source'], '腾讯财经')

    def test_prices_are_newest_first_and_skip_null_and_future_values(self):
        chart = {'timestamp': [1781481600, 1789344000, 1789430400, 4102444800], 'indicators': {'quote': [{'close': [10, 11, None, 999]}]}}
        with patch.object(data, 'eastmoney_quote', side_effect=ValueError()), patch.object(data, 'yahoo_chart', return_value=chart):
            value = data.prices('AAPL')
            self.assertEqual(value['latestDate'], '2026-09-14')
            self.assertEqual([r['close'] for r in value['rows']], [11, 10])

    def test_domestic_financials_preserve_currency_duration_and_zero_negative(self):
        response = Mock()
        response.json.return_value = {'result': {'data': [
            {'SECURITY_CODE': 'TSM', 'REPORT_DATE': '2026-06-30', 'START_DATE': '2026-01-01', 'CURRENCY_ABBR': 'TWD', 'OPERATE_INCOME': 100, 'PARENT_HOLDER_NETPROFIT': -1},
            {'SECURITY_CODE': 'TSM', 'REPORT_DATE': '2026-06-30', 'START_DATE': '2026-04-01', 'CURRENCY_ABBR': 'TWD', 'OPERATE_INCOME': 50, 'PARENT_HOLDER_NETPROFIT': 0},
            {'SECURITY_CODE': 'OTHER', 'REPORT_DATE': '2026-06-30', 'CURRENCY_ABBR': 'USD', 'OPERATE_INCOME': 999},
        ]}}
        with patch.object(data, 'get', return_value=response): result = data.financials('TSM')
        rows = result['data']['TSM']['periods']
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]['START_DATE'], '2026-04-01')
        self.assertEqual(rows[0]['CURRENCY_ABBR'], 'TWD')
        self.assertEqual(rows[0]['PARENT_HOLDER_NETPROFIT'], 0)

    def test_cache_has_ttl_does_not_cache_failures_or_share_mutable_results(self):
        with patch.object(data, '_research_data', return_value={'rows': [{'close': 5}]}) as fetch:
            first = data.research_data('prices', 'BRK B'); first['rows'][0]['close'] = 99
            second = data.research_data('prices', 'BRK-B')
            self.assertTrue(second['cached']); self.assertEqual(second['rows'][0]['close'], 5)
            self.assertEqual(fetch.call_count, 1)
            with patch.object(data.time, 'monotonic', return_value=data._CACHE[('prices', 'BRK.B')][0]+301):
                data.research_data('prices', 'BRK B')
            self.assertEqual(fetch.call_count, 2)
        with patch.object(data, '_research_data', side_effect=ValueError()):
            with self.assertRaises(ValueError): data.research_data('profile', 'AAPL')
        self.assertNotIn(('profile', 'AAPL'), data._CACHE)

    def test_ifrs_and_quarterly_duration_do_not_mix_ytd(self):
        rows = [dict(start='2026-04-01', end='2026-06-30', val=50, form='6-K', fy=2026, fp='Q2', filed='2026-08-01'),
                dict(start='2026-01-01', end='2026-06-30', val=95, form='6-K', fy=2026, fp='Q2', filed='2026-08-01')]
        facts = {'facts': {'ifrs-full': {'Revenue': {'units': {'TWD': rows}}}}}
        with patch.object(statements, 'cik_for', return_value='1046179'), patch.object(statements, 'get_company_facts', return_value=facts):
            result = statements._fetch_sec_statement('TSM.US', statement='income', period='quarter')
        self.assertEqual(len(result['periods']), 1)
        self.assertEqual(result['periods'][0]['Revenue'], 50)
        self.assertEqual(result['periods'][0]['_units']['Revenue'], 'TWD')
        self.assertEqual(result['periods'][0]['TAXONOMY'], 'ifrs-full')

    def test_fund_weights_remain_fractional_and_partial(self):
        payload = {'topHoldings': {'holdings': [{'symbol': 'AAPL', 'holdingPercent': {'raw': .08}}]}, 'fundProfile': {'categoryName': 'Large Blend'}}
        with patch('backtest.loaders.yahoo_client.get_quote_summary', return_value=payload): result = data.fund('SPY')
        self.assertEqual(result['coverageWeight'], .08)
        self.assertIsNone(result['holdingsAsOf'])
        self.assertIn('not complete', result['note'])


if __name__ == '__main__': unittest.main()
