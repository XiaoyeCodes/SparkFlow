"""Read-only public-source fallback prototype. No model/config/account dependencies.

Intended bridge usage after review:
  value = read_public_url(url)
  if value['status'] != 'ok': value = json.loads(read_url(url, no_cache=True))
All returned text is extracted from a fetched source; search snippets are never used.
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
import ipaddress
import json
import re
import socket
from urllib.parse import parse_qs, urljoin, urlsplit

import requests
from bs4 import BeautifulSoup

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
        response = requests.get(url, headers={'User-Agent': USER_AGENT, 'Accept': 'text/html,application/json,application/xhtml+xml'}, timeout=(5, 16), allow_redirects=False, stream=True)
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
    for selector in ('meta[property="article:published_time"]', 'meta[name="datePublished"]', 'meta[name="pubdate"]', 'meta[itemprop="datePublished"]', 'time[itemprop="datePublished"]'):
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


def read_public_url(url: str) -> dict:
    try:
        host = (urlsplit(url).hostname or '').lower()
        path = urlsplit(url).path
        if host == 'api.bls.gov' and path.rsplit('/', 1)[-1] in BLS_SERIES:
            year_text = parse_qs(urlsplit(url).query).get('endyear', [''])[0]
            return bls_series(path.rsplit('/', 1)[-1], int(year_text) if re.fullmatch(r'20\d{2}', year_text) else None)
        # The website is currently 403 from this network; equivalent official raw series are explicitly identified.
        if host in ('bls.gov', 'www.bls.gov') and path == '/news.release/cpi.nr0.htm':
            result = bls_series('CUSR0000SA0')
            result['requestedUrl'] = url
            result['sourceSubstitution'] = 'BLS news-release page unavailable; official CPI source series, not the release narrative'
            return result
        if host in ('bls.gov', 'www.bls.gov') and path == '/news.release/empsit.nr0.htm':
            result = bls_series('CES0000000001')
            result['requestedUrl'] = url
            result['sourceSubstitution'] = 'BLS news-release page unavailable; official payroll source series, not the release narrative'
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


if __name__ == '__main__':
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
    args = json.loads(sys.stdin.read(10000))
    print(json.dumps(bls_series(args['series']) if args.get('series') else read_public_url(args['url']), ensure_ascii=False))
