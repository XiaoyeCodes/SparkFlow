"""Read-only, bounded public research data. No broker credentials or model calls."""
from datetime import datetime, timezone, timedelta
import csv
import io
import json
import math
import re
from urllib.parse import urlencode
import time
import copy
import requests
from concurrent.futures import ThreadPoolExecutor

from backtest.loaders._http import throttled_get
from src.agent.tools import BaseTool


def symbol_alias(value):
    if not isinstance(value, str):
        raise ValueError('TOOL_SYMBOL_INVALID')
    value = value.strip().upper()
    if value.endswith('.US'):
        value = value[:-3]
    # Broker share-class separators are not different securities.
    if re.fullmatch(r'[A-Z]{1,8}[ .-][A-Z]', value):
        value = re.sub(r'[ .-]', '.', value)
    if not re.fullmatch(r'[A-Z0-9][A-Z0-9.\-]{0,23}', value):
        raise ValueError('TOOL_SYMBOL_INVALID')
    return value


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (ValueError, TypeError):
        return None


def get(url, params=None, bucket='eastmoney'):
    response = throttled_get(url, params=params, host_key=bucket,
                             min_interval=1 if bucket == 'eastmoney' else .3, timeout=8,
                             headers={'User-Agent': requests.utils.default_user_agent() if bucket == 'fred' else 'Mozilla/5.0'})
    response.raise_for_status()
    if len(response.content) > 4_000_000:
        raise ValueError('TOOL_RESPONSE_TOO_LARGE')
    return response


def eastmoney_quote(symbol):
    url = 'https://push2.eastmoney.com/api/qt/ulist.np/get'
    params = {'secids': ','.join(f'{m}.{symbol}' for m in (105, 106, 107)),
              'fltt': '2', 'fields': 'f12,f13,f14,f2,f3,f124,f115,f23'}
    payload = get(url, params).json()
    rows = [r for r in (payload.get('data') or {}).get('diff', [])
            if r.get('f12') == symbol and r.get('f13') in (105, 106, 107)
            and (number(r.get('f2')) or 0) > 0]
    if len(rows) != 1:
        raise ValueError('TOOL_QUOTE_IDENTITY_UNCONFIRMED')
    r = rows[0]
    stamp = number(r.get('f124'))
    if not stamp or not 0 < stamp <= datetime.now(timezone.utc).timestamp() + 60:
        raise ValueError('TOOL_QUOTE_DATE_INVALID')
    return {'source': '东方财富', 'symbol': symbol, 'name': r.get('f14'), 'currency': 'USD',
            'url': f'https://quote.eastmoney.com/us/{symbol}.html', 'secid': f"{r['f13']}.{symbol}",
            'market': {'price': number(r['f2']), 'changePercent': number(r.get('f3')),
                       'asOf': datetime.fromtimestamp(stamp, timezone.utc).isoformat(), 'updateMode': '可能延迟'},
            'statistics': {k: v for k, v in {'trailingPE': number(r.get('f115')), 'priceToBook': number(r.get('f23'))}.items() if v is not None}}


def tencent_profile(symbol):
    response = get('https://qt.gtimg.cn/', {'q': 'us' + symbol}, 'tencent')
    raw = response.content.decode('gb18030', errors='replace')
    match = re.search(r'="([^"]+)"', raw)
    parts = match[1].split('~') if match else []
    if len(parts) < 48 or symbol_alias(re.sub(r'\.(?:OQ|O|N|AM)$', '', parts[2])) != symbol or parts[35] != 'USD' or (number(parts[3]) or 0) <= 0:
        raise ValueError('TOOL_PROFILE_IDENTITY_UNCONFIRMED')
    if not re.fullmatch(r'20\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}', parts[30]):
        raise ValueError('TOOL_QUOTE_DATE_INVALID')
    return {'source': '腾讯财经', 'symbol': symbol, 'name': parts[47] or parts[1], 'currency': 'USD',
            'url': f'https://gu.qq.com/us{symbol}',
            'instrumentType': 'ETF' if any('ETF' in p.upper() for p in parts[47:]) else 'EQUITY',
            'market': {'price': number(parts[3]), 'changePercent': number(parts[32]),
                       'asOf': parts[30], 'timeZone': 'America/New_York', 'updateMode': '可能延迟'},
            'statistics': {}}


def yahoo_chart(symbol):
    yahoo = symbol.replace('.', '-')
    last = None
    for host in ('query1.finance.yahoo.com', 'query2.finance.yahoo.com'):
        try:
            payload = get(f'https://{host}/v8/finance/chart/{yahoo}', {'range': '3mo', 'interval': '1d'}, 'yahoo').json()
            result = payload['chart']['result'][0]
            if symbol_alias(result['meta']['symbol']) != symbol or result['meta']['currency'] != 'USD':
                raise ValueError('TOOL_PRICE_IDENTITY_UNCONFIRMED')
            return result
        except Exception as exc:
            last = exc
    raise ValueError('TOOL_PRICE_UNAVAILABLE') from last


def yahoo_fundamentals(symbol):
    from backtest.loaders.yahoo_client import get_quote_summary
    value = get_quote_summary(symbol.replace('.', '-'), ['defaultKeyStatistics', 'financialData', 'assetProfile'])
    def selected(data, keys):
        result = {}
        for key in keys:
            v = data.get(key)
            if isinstance(v, dict): v = v.get('raw')
            if isinstance(v, str) or (isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)):
                result[key] = v
        return result
    return {'source': 'Yahoo Finance', 'url': f"https://finance.yahoo.com/quote/{symbol.replace('.', '-')}/key-statistics/",
            'statistics': selected(value.get('defaultKeyStatistics', {}), ['trailingPE', 'forwardPE', 'trailingEps', 'priceToBook', 'enterpriseToEbitda', 'mostRecentQuarter', 'lastFiscalYearEnd']),
            'financials': selected(value.get('financialData', {}), ['financialCurrency', 'totalCash', 'totalDebt', 'operatingCashflow', 'freeCashflow', 'totalRevenue', 'revenueGrowth', 'earningsGrowth', 'grossMargins', 'operatingMargins', 'profitMargins']),
            'sector': value.get('assetProfile', {}).get('sector'), 'industry': value.get('assetProfile', {}).get('industry'),
            'note': 'Yahoo financialData is a current/TTM snapshot; source does not give per-field statement dates. Growth/margins are fractions; do not relabel cashflow as a single quarter.'}


def profile(symbol):
    results = []
    for provider in (eastmoney_quote, tencent_profile):
        try:
            results.append(provider(symbol))
        except Exception:
            continue
    if results:
        selected = results[0]
        # Keep the price and its timestamp from one source. Identity/type may be supplemented.
        for item in results[1:]:
            selected.update({k: item[k] for k in ('name', 'instrumentType') if item.get(k)})
        selected['sources'] = [{'source': r['source'], 'url': r['url']} for r in results]
        if selected.get('instrumentType') != 'ETF':
            try:
                supplement = yahoo_fundamentals(symbol)
                selected['fundamentals'] = supplement
                selected['sector'], selected['industry'] = supplement['sector'], supplement['industry']
            except Exception:
                pass  # A valuation outage does not discard a valid domestic quote.
        return selected
    meta = yahoo_chart(symbol)['meta']
    return {'source': 'Yahoo Finance', 'symbol': symbol, 'name': meta.get('longName') or meta.get('shortName'),
            'url': f"https://finance.yahoo.com/quote/{symbol.replace('.', '-')}/", 'currency': 'USD',
            'instrumentType': meta.get('instrumentType'), 'statistics': {},
            'market': {'price': meta.get('regularMarketPrice'), 'asOf': meta.get('regularMarketTime'), 'updateMode': '可能延迟'}}


def prices(symbol):
    try:
        quote = eastmoney_quote(symbol)
        data = get('https://push2his.eastmoney.com/api/qt/stock/kline/get', {
            'secid': quote['secid'], 'klt': '101', 'fqt': '0', 'end': '20500101', 'lmt': '65',
            'fields1': 'f1,f2,f3,f4,f5,f6', 'fields2': 'f51,f52,f53'}).json()['data']
        if data['code'] != symbol:
            raise ValueError('TOOL_PRICE_IDENTITY_UNCONFIRMED')
        rows = [{'date': p[0], 'close': number(p[2])} for p in (line.split(',') for line in data.get('klines', [])) if len(p) >= 3]
        source, url, adjustment = '东方财富', quote['url'], 'unadjusted'
    except Exception:
        data = yahoo_chart(symbol)
        closes = data['indicators']['quote'][0]['close']
        rows = [{'date': datetime.fromtimestamp(t, timezone.utc).date().isoformat(), 'close': number(closes[i])}
                for i, t in enumerate(data['timestamp']) if i < len(closes)]
        source, url, adjustment = 'Yahoo Finance', f"https://finance.yahoo.com/quote/{symbol.replace('.', '-')}/history/", 'split-adjusted; not total return'
    today = datetime.now(timezone.utc).date().isoformat()
    rows = sorted([r for r in rows if re.fullmatch(r'20\d{2}-\d{2}-\d{2}', r['date']) and r['date'] <= today and (r['close'] or 0) > 0], key=lambda r: r['date'], reverse=True)[:65]
    if not rows:
        raise ValueError('TOOL_PRICE_EMPTY')
    return {'source': source, 'symbol': symbol, 'url': url, 'currency': 'USD', 'adjustment': adjustment,
            'order': 'newest first', 'latestDate': rows[0]['date'], 'rows': rows,
            'note': 'Latest daily bar may be intraday; prices are not a dividend-adjusted return series.'}


FINANCIAL_FIELDS = ('SECUCODE', 'SECURITY_CODE', 'REPORT_DATE', 'START_DATE', 'NOTICE_DATE', 'REPORT_TYPE',
                    'DATE_TYPE', 'ACCOUNTING_STANDARDS', 'CURRENCY_ABBR', 'OPERATE_INCOME', 'OPERATE_INCOME_YOY',
                    'GROSS_PROFIT', 'GROSS_PROFIT_RATIO', 'PARENT_HOLDER_NETPROFIT', 'PARENT_HOLDER_NETPROFIT_YOY',
                    'DILUTED_EPS', 'NET_PROFIT_RATIO', 'ROE_AVG', 'DEBT_ASSET_RATIO', 'CURRENT_RATIO', 'OCF_LIQDEBT')


def financials(symbol):
    url = 'https://datacenter.eastmoney.com/securities/api/data/v1/get'
    try:
        params = {'reportName': 'RPT_USF10_FN_GMAININDICATOR', 'columns': 'ALL',
                  'filter': f'(SECURITY_CODE="{symbol}")', 'sortColumns': 'REPORT_DATE', 'sortTypes': '-1', 'pageSize': '16'}
        payload = get(url, params).json()
        periods = [{k: r[k] for k in FINANCIAL_FIELDS if r.get(k) is not None}
                   for r in (payload.get('result') or {}).get('data', [])
                   if r.get('SECURITY_CODE') == symbol and r.get('REPORT_DATE') and r.get('CURRENCY_ABBR')
                   and any(number(r.get(k)) is not None for k in ('OPERATE_INCOME', 'PARENT_HOLDER_NETPROFIT'))]
        if not periods:
            raise ValueError('TOOL_FINANCIALS_EMPTY')
        # Prefer true single-quarter rows; retain start/date/type so YTD is never relabelled quarterly.
        periods.sort(key=lambda r: (r['REPORT_DATE'], r.get('START_DATE', '')), reverse=True)
        return {'source': '东方财富', 'symbol': symbol, 'url': url + '?' + urlencode(params),
                'data': {symbol: {'periods': periods[:8]}},
                'definitions': {'OPERATE_INCOME': 'revenue, not operating profit', 'CURRENCY_ABBR': 'reported currency, not necessarily USD',
                                'YOY': 'provider supplied year-over-year percent; same report basis', 'RATIO': 'percent unless the provider explicitly names a liquidity ratio'},
                'note': 'Selected financial indicators, not full statements. Monetary values in stated currency units; do not convert ADR EPS without the depositary ratio.'}
    except Exception:
        from src.tools.financial_statements_tool import _fetch_sec_statement, cik_for
        code = symbol.replace('.', '-') + '.US'
        result = _fetch_sec_statement(code, statement='indicators', period='quarter')
        rows = result.get('periods', [])
        if not rows:
            rows = _fetch_sec_statement(code, statement='indicators', period='annual').get('periods', [])
        if not rows:
            raise ValueError('TOOL_FINANCIALS_UNAVAILABLE')
        cik = cik_for(symbol.replace('.', '-'))
        return {'source': 'SEC EDGAR', 'symbol': symbol,
                'url': f'https://data.sec.gov/api/xbrl/companyfacts/CIK{int(cik):010d}.json',
                'data': {symbol: {'periods': rows[:12]}}, 'note': 'Original XBRL units, start/end dates and filing form retained.'}


def fund(symbol):
    from backtest.loaders.yahoo_client import get_quote_summary
    data = get_quote_summary(symbol.replace('.', '-'), ['topHoldings', 'fundProfile', 'defaultKeyStatistics'])
    def raw(v):
        if isinstance(v, dict):
            if 'raw' in v: return v['raw']
            return {k: raw(x) for k, x in v.items()}
        if isinstance(v, list): return [raw(x) for x in v]
        return v
    top = raw(data.get('topHoldings', {}))
    info = raw(data.get('fundProfile', {}))
    stats = raw(data.get('defaultKeyStatistics', {}))
    if not top and not info:
        raise ValueError('TOOL_FUND_UNAVAILABLE')
    holdings = [r for r in top.get('holdings', []) if isinstance(r.get('symbol'), str)
                and number(r.get('holdingPercent')) is not None and 0 <= r['holdingPercent'] <= 1][:10]
    return {'source': 'Yahoo Finance fund data', 'symbol': symbol,
            'url': f"https://finance.yahoo.com/quote/{symbol.replace('.', '-')}/holdings/", 'instrumentType': 'ETF',
            'category': info.get('categoryName'), 'family': info.get('family'),
            'expenseRatio': info.get('feesExpensesInvestment', {}).get('annualReportExpenseRatio'), 'yield': stats.get('yield'),
            'topHoldings': holdings, 'sectorWeightings': top.get('sectorWeightings', []),
            'holdingsAsOf': None, 'coverageWeight': sum(r['holdingPercent'] for r in holdings),
            'note': 'Weights/fees/yield are fractions, not percent. Top holdings only, not complete or live look-through. Provider has not supplied the holdings observation date. Do not infer missing constituents or use ambiguous fund PE fields.'}


MACRO_SERIES = {'CPIAUCSL': 'CPI seasonally adjusted index, not percent', 'PCEPI': 'PCE price index, not percent',
                'UNRATE': 'Unemployment rate percent', 'A191RL1Q225SBEA': 'Real GDP growth annualized quarter-on-quarter percent',
                'DFF': 'Effective federal funds rate percent', 'DTWEXBGS': 'Broad trade-weighted dollar index; NOT DXY',
                'DGS10': 'US Treasury 10-year yield percent'}


def macro():
    observations, unavailable = [], []
    start = (datetime.now(timezone.utc) - timedelta(days=500)).date().isoformat()
    def fetch(item):
        series, meaning = item
        try:
            params = {'id': series, 'cosd': start}
            response = get('https://fred.stlouisfed.org/graph/fredgraph.csv', params, 'fred')
            rows = [{'date': r.get('observation_date') or r.get('DATE'), 'value': number(r.get(series))}
                    for r in csv.DictReader(io.StringIO(response.text))]
            rows = [r for r in rows if r['date'] and r['value'] is not None][-14:]
            if not rows:
                raise ValueError('TOOL_MACRO_EMPTY')
            return {'series': series, 'meaning': meaning, 'rows': rows,
                    'url': f'https://fred.stlouisfed.org/series/{series}'}
        except Exception:
            return {'unavailable': series}
    with ThreadPoolExecutor(max_workers=3) as pool:
        for result in pool.map(fetch, MACRO_SERIES.items()):
            if 'unavailable' in result: unavailable.append(result['unavailable'])
            else: observations.append(result)
    if not observations:
        raise ValueError('TOOL_MACRO_UNAVAILABLE')
    return {'source': 'Federal Reserve Bank of St. Louis FRED', 'url': 'https://fred.stlouisfed.org/',
            'series': observations, 'unavailable': unavailable,
            'note': 'Observation dates are not release dates; revised data, not historical vintages or market expectations. Different series have different observation dates.'}


def _research_data(capability, symbol=''):
    if capability == 'macro':
        return macro()
    symbol = symbol_alias(symbol)
    routes = {'profile': profile, 'prices': prices, 'financials': financials, 'fund': fund}
    if capability not in routes:
        raise ValueError('TOOL_CAPABILITY_INVALID')
    return routes[capability](symbol)


_CACHE = {}
TTLS = {'profile': 60, 'prices': 300, 'financials': 21600, 'macro': 1800, 'fund': 21600}


def research_data(capability, symbol=''):
    if capability not in TTLS: raise ValueError('TOOL_CAPABILITY_INVALID')
    symbol = symbol_alias(symbol) if capability != 'macro' else ''
    key = (capability, symbol)
    cached = _CACHE.get(key)
    if cached and time.monotonic() - cached[0] < TTLS[capability]:
        return {**copy.deepcopy(cached[1]), 'cached': True}
    result = {**_research_data(capability, symbol), 'fetchedAt': datetime.now(timezone.utc).isoformat()}
    if len(_CACHE) >= 200: _CACHE.pop(next(iter(_CACHE)))
    _CACHE[key] = (time.monotonic(), copy.deepcopy(result))
    return result


class ResearchDataTool(BaseTool):
    name = 'get_research_data'
    description = ('Read-only US stock/ETF research data with domestic-provider fallback. Use profile for quotes/type/valuation, '
                   'prices for newest-first daily closes, financials for report periods/currencies/YOY, fund for ETF constituents/fees, macro for dated official FRED observations. '
                   'Accepts broker BRK B, BRK.B or BRK-B. ETFs do not have company earnings: do not call financials for an ETF. '
                   'Check source timestamps and units before analysis. No trading, arbitrary URLs or credentials.')
    parameters = {'type': 'object', 'properties': {
        'capability': {'type': 'string', 'enum': ['profile', 'prices', 'financials', 'fund', 'macro']},
        'symbol': {'type': 'string', 'description': 'US ticker; optional for macro'}}, 'required': ['capability']}

    def execute(self, **kwargs):
        try:
            return json.dumps({'ok': True, **research_data(kwargs.get('capability'), kwargs.get('symbol', ''))}, ensure_ascii=False, allow_nan=False)
        except Exception:
            return json.dumps({'ok': False, 'error': 'TOOL_PUBLIC_RESEARCH_UNAVAILABLE'})
