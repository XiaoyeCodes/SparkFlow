"""Public, read-only brief sources. No account or model configuration is required."""
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import math
import re
import xml.etree.ElementTree as ET

import requests
from ibkr_public_reader import download_public
import ibkr_public_cache as cache

FEEDS = {
    'AAPL': 'https://www.apple.com/newsroom/rss-feed.rss',
    'NVDA': 'https://nvidianews.nvidia.com/releases.xml',
    'AMD': 'https://ir.amd.com/news-events/press-releases/rss',
    'LLY': 'https://investor.lilly.com/rss/news-releases.xml',
}
CALENDARS = {
    'AAPL': 'https://investor.apple.com/investor-relations/default.aspx',
    'MSFT': 'https://www.microsoft.com/en-us/Investor/',
    'NVDA': 'https://investor.nvidia.com/events-and-presentations/events-and-presentations/default.aspx',
    'AMZN': 'https://ir.aboutamazon.com/events/default.aspx',
    'AMD': 'https://ir.amd.com/news-events/ir-calendar',
    'GOOG': 'https://abc.xyz/investor/',
    'GOOGL': 'https://abc.xyz/investor/',
    'KO': 'https://investors.coca-colacompany.com/news-events/events',
    'UL': 'https://www.unilever.com/investors/results-presentations-and-webcasts/',
    'LLY': 'https://investor.lilly.com/events-and-presentations',
    'MCD': 'https://corporate.mcdonalds.com/corpmcd/investors/events-and-presentations.html',
    'TSLA': 'https://ir.tesla.com/',
    'QQQ': 'https://www.invesco.com/qqq-etf/en/about.html',
}


def symbol_arg(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Z0-9.\-^]{1,24}', value):
        raise ValueError('TOOL_SYMBOL_INVALID')
    return value


def tradingview_profile(symbol):
    symbol_arg(symbol)
    result = tradingview_profiles([symbol])
    if symbol not in result['profiles']:
        raise ValueError('TOOL_PROFILE_IDENTITY_UNCONFIRMED')
    return result['profiles'][symbol]


def tradingview_profiles(symbols):
    if not isinstance(symbols, list) or not 1 <= len(symbols) <= 100:
        raise ValueError('TOOL_INPUT_INVALID')
    for symbol in symbols:
        symbol_arg(symbol)
    cached = {symbol: cache.read('profile:v2:' + symbol) for symbol in symbols}
    requested = [symbol for symbol in symbols if cached[symbol] is None]
    if not requested:
        return {'profiles': cached}
    symbols = requested
    tickers = [f'{exchange}:{symbol}' for symbol in symbols for exchange in ('NASDAQ', 'NYSE', 'AMEX', 'BATS')]
    columns = ['name', 'description', 'sector', 'industry', 'type', 'typespecs', 'currency',
               'close', 'change', 'change_abs', 'open', 'high', 'low', 'volume', 'update_mode',
               'price_earnings_ttm', 'price_book_fq', 'earnings_per_share_diluted_ttm']
    response = requests.post('https://scanner.tradingview.com/america/scan',
        json={'symbols': {'tickers': tickers, 'query': {'types': []}}, 'columns': columns},
        headers={'User-Agent': 'Mozilla/5.0 SparkFlow'}, timeout=(3, 6))
    response.raise_for_status()
    all_rows = response.json().get('data', [])
    result = {}
    for symbol in symbols:
        try:
            result[symbol] = cache.write('profile:v2:' + symbol, profile_row(symbol, all_rows, columns))
        except ValueError:
            continue
    return {'profiles': {**{symbol: value for symbol, value in cached.items() if value is not None}, **result}}


def profile_row(symbol, all_rows, columns):
    tickers = [f'{exchange}:{symbol}' for exchange in ('NASDAQ', 'NYSE', 'AMEX', 'BATS')]
    rows = [r for r in all_rows if r.get('s') in tickers
            and isinstance(r.get('d'), list) and len(r['d']) == len(columns)
            and r['d'][0] == symbol and r['d'][6] == 'USD']
    if len(rows) != 1:
        raise ValueError('TOOL_PROFILE_IDENTITY_UNCONFIRMED')
    row = rows[0]; data = dict(zip(columns, row['d']))
    if data['type'] not in ('stock', 'dr', 'fund') or not isinstance(data['description'], str):
        raise ValueError('TOOL_PROFILE_IDENTITY_UNCONFIRMED')
    def number(key):
        value = data[key]
        return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None
    return {'source': 'TradingView', 'symbol': symbol,
            'url': 'https://www.tradingview.com/symbols/' + row['s'].replace(':', '-') + '/',
            'name': data['description'], 'sector': data['sector'], 'industry': data['industry'],
            'currency': data['currency'], 'instrumentType': 'ETF' if data['type'] == 'fund' or 'etf' in (data['typespecs'] or []) else 'EQUITY',
            'market': {k: v for k, v in {'price': number('close'), 'changePercent': number('change'),
                'changeAmount': number('change_abs'), 'open': number('open'), 'high': number('high'),
                'low': number('low'), 'volume': number('volume')}.items() if v is not None} | {'updateMode': data['update_mode']},
            'observedAt': datetime.now(timezone.utc).isoformat(),
            'statistics': {k: v for k, v in {'trailingPE': number('price_earnings_ttm'),
                'priceToBook': number('price_book_fq'), 'trailingEps': number('earnings_per_share_diluted_ttm')}.items() if v is not None},
            'financials': {k: v for k, v in {'currentPrice': number('close')}.items() if v is not None}}


def tradingview_market_snapshot():
    """One read-only scan for broad US market context used in the compact brief."""
    columns = ['name', 'description', 'currency', 'close', 'change', 'change_abs', 'open', 'high', 'low', 'volume', 'update_mode']
    tickers = ['AMEX:SPY', 'NASDAQ:QQQ', 'CBOE:VIX']
    response = requests.post('https://scanner.tradingview.com/america/scan',
        json={'symbols': {'tickers': tickers, 'query': {'types': []}}, 'columns': columns},
        headers={'User-Agent': 'Mozilla/5.0 SparkFlow'}, timeout=(3, 6))
    response.raise_for_status()
    observed_at = datetime.now(timezone.utc).isoformat()
    result = {}
    for row in response.json().get('data', []):
        if row.get('s') not in tickers or not isinstance(row.get('d'), list) or len(row['d']) != len(columns):
            continue
        data = dict(zip(columns, row['d']))
        symbol = data['name']
        if symbol not in ('SPY', 'QQQ', 'VIX'):
            continue
        def number(key):
            value = data[key]
            return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None
        result[symbol] = {'source': 'TradingView', 'symbol': symbol,
            'url': 'https://www.tradingview.com/symbols/' + row['s'].replace(':', '-') + '/',
            'name': data['description'], 'currency': data['currency'], 'observedAt': observed_at,
            'price': number('close'), 'changePercent': number('change'), 'changeAmount': number('change_abs'),
            'open': number('open'), 'high': number('high'), 'low': number('low'), 'volume': number('volume'),
            'updateMode': data['update_mode']}
    if len(result) < 3:
        raise ValueError('TOOL_MARKET_SNAPSHOT_INCOMPLETE')
    return {'markets': result}


def feed_date(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        try:
            parsed = parsedate_to_datetime(value)
        except (ValueError, TypeError):
            return None
    return parsed.astimezone(timezone.utc).isoformat() if parsed.tzinfo else None


def parse_feed(raw, source_url):
    # Feed metadata is for discovery only. Consumers must read the linked original.
    root = ET.fromstring(raw)
    atom = '{http://www.w3.org/2005/Atom}'
    items = root.findall('.//item') or root.findall(atom + 'entry')
    results = []
    for item in items[:60]:
        link = item.findtext('link')
        if not link:
            link = next((node.get('href') for node in item.findall(atom + 'link')
                         if node.get('rel', 'alternate') == 'alternate'), None)
        if not link or not link.startswith('https://'):
            continue
        published = feed_date(item.findtext('pubDate') or item.findtext(atom + 'published'))
        # Atom updated is NOT an original publication date.
        results.append({'url': link, 'title': item.findtext('title') or item.findtext(atom + 'title') or '',
                        'publishedAt': published, 'updatedAt': feed_date(item.findtext(atom + 'updated')),
                        'sourceUrl': source_url})
    if not items:
        raise ValueError('TOOL_FEED_EMPTY')
    return results


def discover(symbol, area, as_of):
    symbol_arg(symbol)
    cutoff = datetime.fromisoformat(as_of.replace('Z', '+00:00'))
    if cutoff.tzinfo is None:
        raise ValueError('TOOL_INPUT_INVALID')
    if area == 'calendar':
        return {'results': [{'url': CALENDARS[symbol]}] if symbol in CALENDARS else []}
    if area != 'news':
        raise ValueError('TOOL_INPUT_INVALID')
    urls = ([FEEDS[symbol]] if symbol in FEEDS else []) + [
        f'https://feeds.finance.yahoo.com/rss/2.0/headline?s={symbol}&region=US&lang=en-US']
    results = []
    for url in urls:
        try:
            final, _, raw = download_public(url)
            rows = parse_feed(raw, final)
            # Drop known future/old entries before spending any article-read budget.
            for row in rows:
                date = row['publishedAt']
                if date and not 0 <= (cutoff - datetime.fromisoformat(date)).total_seconds() <= 7 * 86400:
                    continue
                results.append(row)
            if results:
                break
        except (requests.RequestException, ValueError, ET.ParseError):
            continue
    return {'results': sorted(results, key=lambda row: row['publishedAt'] or row['updatedAt'] or '', reverse=True)[:5]}
