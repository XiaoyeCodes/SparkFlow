"""Read-only public-source fallback prototype. No model/config/account dependencies.

Intended bridge usage after review:
  value = read_public_url(url)
  if value['status'] != 'ok': value = json.loads(read_url(url, no_cache=True))
All returned text is extracted from a fetched source; search snippets are never used.
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
import ipaddress
import csv
import io
import json
import re
import socket
from urllib.parse import parse_qs, urljoin, urlsplit

import requests
from bs4 import BeautifulSoup
import ibkr_public_cache as public_cache

MAX_BYTES = 2_000_000
MAX_TEXT = 28_000
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36'


def safe_public_url(url: str) -> str:
    parsed = urlsplit(url)
    host = (parsed.hostname or '').rstrip('.').lower()
    if parsed.scheme != 'https' or not host or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError('PUBLIC_URL_REQUIRED')
    if host == 'localhost' or host.endswith(('.localhost', '.local', '.internal')):
        raise ValueError('PUBLIC_URL_REQUIRED')
    try:
        addresses = {row[4][0] for row in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)}
    except socket.gaierror as exc:
        raise ValueError('PUBLIC_DNS_UNAVAILABLE') from exc
    if not addresses or any(not ipaddress.ip_address(address.split('%')[0]).is_global for address in addresses):
        raise ValueError('PUBLIC_URL_REQUIRED')
    if re.search(r'(?:^|&)(?:access_token|token|api_?key|password|signature|authorization)=', parsed.query, re.I):
        raise ValueError('PUBLIC_URL_REQUIRED')
    return parsed._replace(fragment='').geturl()


def download_public(url: str) -> tuple[str, str, str]:
    """Validate every redirect before following it; never send cookies or authorization."""
    for _ in range(4):
        url = safe_public_url(url)
        options = {'headers': {'User-Agent': USER_AGENT, 'Accept': 'text/html,application/json,application/xhtml+xml,application/rss+xml,text/csv'}, 'timeout': (3, 7), 'allow_redirects': False, 'stream': True}
        if urlsplit(url).hostname == 'fred.stlouisfed.org':
            # FRED is reachable directly here even when the proxy's TLS route stalls.
            # This exception is restricted to the fixed public source, never arbitrary URLs.
            # Use the HTTP client's own identity; the browser impersonation header
            # used for article sites stalls on this CSV endpoint in live checks.
            options.pop('headers')
            options['timeout'] = (2, 4)
            with requests.Session() as direct:
                direct.trust_env = False
                try:
                    response = direct.get(url, **options)
                    response.raise_for_status()
                except requests.RequestException:
                    response = requests.get(url, **options)
        else:
            response = requests.get(url, **options)
        try:
            if response.status_code in (301, 302, 303, 307, 308):
                url = urljoin(url, response.headers.get('Location', ''))
                continue
            response.raise_for_status()
            chunks, length = [], 0
            for chunk in response.iter_content(32768):
                length += len(chunk)
                if length > MAX_BYTES:
                    raise ValueError('PUBLIC_PAGE_TOO_LARGE')
                chunks.append(chunk)
            content = b''.join(chunks).decode(response.encoding if response.encoding and response.encoding.lower() != 'iso-8859-1' else 'utf-8', errors='replace')
            return url, response.headers.get('Content-Type', '').lower(), content
        finally:
            response.close()
    raise ValueError('PUBLIC_REDIRECT_LIMIT')


def explicit_publication_date(soup: BeautifulSoup, url: str) -> str | None:
    """Only article publication markers/datelines, never arbitrary body dates or Last Update."""
    for selector in ('meta[property="article:published_time"]', 'meta[name="datePublished"]', 'meta[name="pubdate"]', 'meta[itemprop="datePublished"]', 'time[itemprop="datePublished"]', 'meta[property="og:article:published_time"]', 'time.byline-attr-meta-time'):
        node = soup.select_one(selector)
        if node:
            value = node.get('content') or node.get('datetime')
            if value:
                return value.strip().removesuffix('Z') if re.fullmatch(r'\d{4}-\d{2}-\d{2}Z', value.strip()) else value.strip()
    def find_json_date(value):
        if isinstance(value, dict):
            if isinstance(value.get('datePublished'), str):
                return value['datePublished']
            for nested in value.values():
                date = find_json_date(nested)
                if date:
                    return date
        elif isinstance(value, list):
            for nested in value:
                date = find_json_date(nested)
                if date:
                    return date
        return None
    for node in soup.find_all('script', type='application/ld+json'):
        try:
            date = find_json_date(json.loads(node.string or node.get_text()))
            if date:
                return date
        except (ValueError, TypeError, RecursionError):
            continue
    month_date = r'(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}'
    host = (urlsplit(url).hostname or '').lower()
    if host == 'ir.amd.com' and '/press-releases/detail/' in urlsplit(url).path:
        node = soup.select_one('time.date')
        if node:
            text = node.get_text(' ', strip=True)
            marked = re.search(month_date + r'\s+(\d{1,2}):(\d{2})\s*([ap])m\s+(EDT|EST)', text, re.I)
            if marked:
                day = datetime.strptime(re.search(month_date, text, re.I).group(0), '%B %d, %Y')
                hour = int(marked[2]) % 12 + (12 if marked[4].lower() == 'p' else 0)
                return day.replace(hour=hour, minute=int(marked[3]), tzinfo=timezone(timedelta(hours=-4 if marked[5].upper() == 'EDT' else -5))).astimezone(timezone.utc).isoformat()
    # Apple marks its article publication date on the newsroom dateline.
    if host == 'www.apple.com' and '/newsroom/' in urlsplit(url).path:
        for node in soup.select('.hero-eyebrow, .article-header .date, time'):
            marked = re.search(month_date, node.get_text(' ', strip=True), re.I)
            if marked:
                return datetime.strptime(marked.group(0), '%B %d, %Y').date().isoformat()
    if host == 'www.federalreserve.gov' and '/newsevents/pressreleases/' in urlsplit(url).path:
        node = soup.select_one('.article__time')
        if node:
            marked = re.search(month_date, node.get_text(' ', strip=True))
            if marked:
                day = datetime.strptime(marked.group(0), '%B %d, %Y')
                context = node.parent.get_text(' ', strip=True)
                release = re.search(r'For release at\s+(\d{1,2}):(\d{2})\s*([ap])\.?m\.?\s+(EDT|EST)', context, re.I)
                if release:
                    hour, minute = int(release[1]) % 12 + (12 if release[3].lower() == 'p' else 0), int(release[2])
                    offset = -4 if release[4].upper() == 'EDT' else -5
                    return day.replace(hour=hour, minute=minute, tzinfo=timezone(timedelta(hours=offset))).astimezone(timezone.utc).isoformat()
                return day.date().isoformat()
    # A paired-dash dateline in an actual release paragraph distinguishes publication from a fiscal period.
    for paragraph in soup.find_all('p')[:100]:
        text = paragraph.get_text(' ', strip=True)
        dateline = re.search(r'^.{2,90}?\s+[—–]\s+(' + month_date + r')\s+[—–]', text)
        if dateline and re.search(r'today|announced|reported|reports', text[:450], re.I):
            return datetime.strptime(dateline[1], '%B %d, %Y').date().isoformat()
    return None


def extract_html(html: str, url: str) -> dict:
    soup = BeautifulSoup(html, 'html.parser')
    title = soup.title.get_text(' ', strip=True) if soup.title else ''
    published = explicit_publication_date(soup, url)
    for node in soup.select('script,style,nav,footer,form,noscript,svg,[role="navigation"],#globalnav,#globalfooter,.ac-gf-footer'):
        node.decompose()
    main = soup.select_one('main') or soup.select_one('#content') or soup.select_one('#MainContent') or soup.select_one('article') or soup.body or soup
    if len(main.get_text(' ', strip=True)) < 150:
        main = soup.body or soup
    # Retain explicit public links for discovery of actual issuer releases, independent of search.
    links, seen = [], set()
    for node in main.find_all('a', href=True):
        href = urljoin(url, node['href'])
        text = node.get_text(' ', strip=True)
        parsed = urlsplit(href)
        if parsed.scheme == 'https' and text and href not in seen:
            seen.add(href)
            links.append({'title': text[:180], 'url': href})
    # FOMC lists future years first; keep current/past statement links ahead of
    # navigation so the bounded list does not silently discard the latest statement.
    if urlsplit(url).hostname == 'www.federalreserve.gov' and 'fomccalendars' in url:
        today = datetime.now(timezone.utc).strftime('%Y%m%d')
        def statement_key(link):
            match = re.search(r'/monetary(\d{8})a\.htm$', link['url'])
            return (1, match[1]) if match and match[1] <= today else (0, '')
        links.sort(key=statement_key, reverse=True)
    text = main.get_text('\n', strip=True)
    text = re.sub(r'\n[ \t]*\n+', '\n\n', text)
    if len(text) < 150 or re.search(r'access denied|verify you are human|captcha verification', text[:500], re.I):
        raise ValueError('PUBLIC_NO_ARTICLE')
    result = {'status': 'ok', 'url': url, 'title': title, 'content': f'Title: {title}\n' + (f'Published Time: {published}\n' if published else '') + f'URL Source: {url}\nMarkdown Content:\n{text[:MAX_TEXT]}', 'length': len(text), 'transport': 'direct_https', 'links': links[:80]}
    if published:
        result['publishedAt'] = published
    if len(text) > MAX_TEXT:
        result['truncated'] = True
    return result


BLS_SERIES = {
    'CUSR0000SA0': {'label': 'US consumer price inflation: CPI all urban consumers, all items, seasonally adjusted index LEVEL', 'valueMeaning': 'CPI index level; not a monthly or annual percentage change'},
    'CES0000000001': {'label': 'US employment: total nonfarm payroll employment LEVEL', 'valueMeaning': 'Employment level in thousands; not jobs added in the month'},
    'LNS14000000': {'label': 'US employment: civilian unemployment RATE', 'valueMeaning': 'Unemployment rate percent; not a percentage-point change'},
}

FRED_SERIES = {'CUSR0000SA0': ('CPIAUCSL', 'US consumer price inflation: CPI index LEVEL, seasonally adjusted; not a percentage change'),
               'CES0000000001': ('PAYEMS', 'US employment: total nonfarm payroll LEVEL in thousands; not jobs added'),
               'LNS14000000': ('UNRATE', 'US civilian unemployment RATE in percent')}


def fred_series(series_id):
    fred_id, label = FRED_SERIES[series_id]
    url = f'https://fred.stlouisfed.org/graph/fredgraph.csv?id={fred_id}'
    final, _, raw = download_public(url)
    rows = list(csv.DictReader(io.StringIO(raw)))
    data = [{'date': row.get('observation_date') or row.get('DATE'), 'value': row.get(fred_id)} for row in rows]
    data = [row for row in data if re.fullmatch(r'20\d{2}-\d{2}-\d{2}', row['date'] or '')
            and re.fullmatch(r'-?\d+(?:\.\d+)?', row['value'] or '')][-6:]
    if not data:
        raise ValueError('PUBLIC_FRED_NO_PERIODS')
    content = {'source': 'Federal Reserve Bank of St. Louis FRED; underlying source BLS', 'seriesID': fred_id,
               'valueMeaning': label, 'data': data, 'publishedAt': None,
               'limitations': 'Observation periods are not publication dates. Current revised series; no release surprise or growth rate computed.'}
    return {'status': 'ok', 'url': final, 'title': label, 'content': json.dumps(content), 'publishedAt': None,
            'transport': 'official_fred_csv', 'sourceSubstitution': 'BLS API unavailable; FRED distributes the BLS source series'}


def macro_series(series_id, year=None):
    try:
        return bls_series(series_id, year)
    except (requests.RequestException, ValueError):
        return fred_series(series_id)


def bls_series(series_id: str, year: int | None = None) -> dict:
    if series_id not in BLS_SERIES:
        return {'status': 'error', 'error': 'PUBLIC_SERIES_UNSUPPORTED'}
    year = year or datetime.now(timezone.utc).year
    url = f'https://api.bls.gov/publicAPI/v2/timeseries/data/{series_id}?startyear={year-1}&endyear={year}'
    final_url, _, raw = download_public(url)
    payload = json.loads(raw)
    series = payload.get('Results', {}).get('series', [])
    if payload.get('status') != 'REQUEST_SUCCEEDED' or len(series) != 1 or series[0].get('seriesID') != series_id:
        raise ValueError('PUBLIC_BLS_NO_SERIES')
    rows = [row for row in series[0].get('data', []) if row.get('period', '').startswith('M') and row.get('period') != 'M13'][:6]
    if not rows:
        raise ValueError('PUBLIC_BLS_NO_PERIODS')
    content = {'source': 'US Bureau of Labor Statistics public API', 'seriesID': series_id, **BLS_SERIES[series_id], 'publishedAt': None, 'retrievedAt': datetime.now(timezone.utc).isoformat(), 'data': rows, 'limitations': 'Original release publication time and market expectations are not supplied; data may include revisions. All source footnotes are retained. Differences, growth rates and surprises have not been computed.'}
    return {'status': 'ok', 'url': final_url, 'title': BLS_SERIES[series_id]['label'], 'content': json.dumps(content, ensure_ascii=False, separators=(',', ':')), 'publishedAt': None, 'transport': 'official_bls_api', 'length': len(raw)}


def _read_public_url(url: str) -> dict:
    try:
        host = (urlsplit(url).hostname or '').lower()
        path = urlsplit(url).path
        if host == 'api.bls.gov' and path.rsplit('/', 1)[-1] in BLS_SERIES:
            year_text = parse_qs(urlsplit(url).query).get('endyear', [''])[0]
            return macro_series(path.rsplit('/', 1)[-1], int(year_text) if re.fullmatch(r'20\d{2}', year_text) else None)
        # The website is currently 403 from this network; equivalent official raw series are explicitly identified.
        if host in ('bls.gov', 'www.bls.gov') and path == '/news.release/cpi.nr0.htm':
            result = macro_series('CUSR0000SA0')
            result['requestedUrl'] = url
            result.setdefault('sourceSubstitution', 'BLS news-release page unavailable; official CPI source series, not the release narrative')
            return result
        if host in ('bls.gov', 'www.bls.gov') and path == '/news.release/empsit.nr0.htm':
            result = macro_series('CES0000000001')
            result['requestedUrl'] = url
            result.setdefault('sourceSubstitution', 'BLS news-release page unavailable; official payroll source series, not the release narrative')
            return result
        final_url, content_type, content = download_public(url)
        if 'application/json' in content_type:
            value = json.loads(content)
            return {'status': 'ok', 'url': final_url, 'title': 'Public source structured data', 'content': json.dumps(value, ensure_ascii=False), 'transport': 'direct_https'}
        if 'html' not in content_type:
            raise ValueError('PUBLIC_CONTENT_UNSUPPORTED')
        return extract_html(content, final_url)
    except Exception as exc:
        status = getattr(getattr(exc, 'response', None), 'status_code', None)
        return {'status': 'error', 'error': f'PUBLIC_HTTP_{status}' if status else str(exc) if re.fullmatch('[A-Z_]+', str(exc)) else 'PUBLIC_SOURCE_UNAVAILABLE'}


def read_public_url(url: str) -> dict:
    # Only successful parsed public documents are cached, never provider errors.
    # Version the key whenever parsing rules change; original fetch times survive reuse.
    key = 'article:v1:' + str(url)
    cached = public_cache.read(key)
    if cached is not None:
        return cached
    result = _read_public_url(url)
    return public_cache.write(key, result) if result.get('status') == 'ok' else result


if __name__ == '__main__':
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
    args = json.loads(sys.stdin.read(10000))
    print(json.dumps(bls_series(args['series']) if args.get('series') else read_public_url(args['url']), ensure_ascii=False))
