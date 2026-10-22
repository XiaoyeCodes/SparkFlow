"""Collect one exact public benchmark for Jin10, preserving fresh raw evidence.

Other eight instruments remain unavailable unless a future reviewed collector
can establish their exact contract, session calendar and percentage baseline.
"""
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import URLError, HTTPError
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo
import re
import time
from lxml import html

HOLIDAYS = 'https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/'
TREASURY = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView'


def observations(raw, today):
    """Read named Date/10 Yr columns; never depend on positional maturities."""
    document = html.fromstring(raw)
    result = {}
    for table in document.xpath('//table'):
        rows = table.xpath('.//tr')
        header = next((r for r in rows if r.xpath('./th') and any('10 Yr' == ' '.join(c.itertext()).strip() for c in r.xpath('./th|./td'))), None)
        if header is None:
            continue
        names = [' '.join(' '.join(c.itertext()).split()) for c in header.xpath('./th|./td')]
        if 'Date' not in names or '10 Yr' not in names:
            continue
        for row in rows:
            cells = [' '.join(' '.join(c.itertext()).split()) for c in row.xpath('./td')]
            if len(cells) != len(names):
                continue
            try:
                day = datetime.strptime(cells[names.index('Date')], '%m/%d/%Y').date()
                rate = Decimal(cells[names.index('10 Yr')])
            except (ValueError, ArithmeticError):
                continue
            if day <= today and rate.is_finite() and 0 < rate < 30:
                if day in result and result[day] != rate:
                    raise ValueError('Conflicting Treasury CMT rows')
                result[day] = rate
    return sorted(result.items(), reverse=True)


def holiday_context(raw, years):
    """Require the actual year's official table, not a year in the page footer."""
    document = html.fromstring(raw)
    calendars = {}
    for year in years:
        tables = document.xpath('//table[caption[normalize-space()=$caption]]', caption=f'{year} Holiday Schedule')
        if len(tables) != 1:
            raise ValueError(f'官方假日日历缺少唯一的 {year} 年表格')
        table = tables[0]
        headers = [' '.join(c.text_content().split()) for c in table.xpath('.//thead//th')]
        if headers != ['Date', 'Holiday']:
            raise ValueError('官方假日日历列定义发生变化')
        days = {}
        for row in table.xpath('.//tbody/tr'):
            cells = row.xpath('./td')
            if len(cells) != 2:
                raise ValueError('官方假日日历行结构发生变化')
            text = re.sub(r'\*', '', ' '.join(cells[0].text_content().split())).strip()
            parsed = datetime.strptime(f'{text} {year}', '%A, %B %d %Y').date()
            name = ' '.join(cells[1].text_content().split())
            if not name or parsed.isoformat() in days:
                raise ValueError('官方假日日历有重复日期或缺失名称')
            days[parsed.isoformat()] = name
        if len(days) < 10:
            raise ValueError('官方假日日历不完整')
        calendars[str(year)] = days
    if not re.search(r'holiday falls on a (Saturday|Sunday)', document.text_content(), re.I):
        raise ValueError('未找到官方假日周末补休例外说明')
    return calendars


def collect(root):
    import quote_contract as qc
    root = Path(root)
    request = qc.init_run(root)
    manifest = qc.read_json(root/'evidence/manifest.json')
    quotes = qc.read_json(root/'quotes.json')
    calendar = qc.read_json(root/'calendar.json')
    for row in quotes['quotes']:
        row.update(status='unavailable', reason='未配置能核验精确合约、交易日历和前值的自动行情源')

    class Redirect(HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, url):
            if urlsplit(url).scheme != 'https' or urlsplit(url).hostname not in ('home.treasury.gov', 'www.opm.gov'):
                raise ValueError('Unexpected official-source redirect')
            return super().redirect_request(req, fp, code, msg, headers, url)

    def fetch(key, url):
        started = qc.utc_now()
        for attempt in range(3):
            try:
                req = Request(url, headers={'User-Agent': 'SparkFlowDailyDigests/1.0 (read-only)', 'Accept': 'text/html'})
                with build_opener(Redirect()).open(req, timeout=20) as response:
                    raw = response.read(4_000_001)
                    if response.status != 200 or len(raw) > 4_000_000:
                        raise ValueError('Invalid official response')
                break
            except HTTPError:
                raise # No retry / route switch after access refusal or rate limiting.
            except (URLError, TimeoutError):
                if attempt == 2:
                    raise
                time.sleep(attempt + 1)
        finished = qc.utc_now()
        file = 'evidence/' + key + '.html'
        (root/file).write_bytes(raw)
        reference = {'evidence_file': file, 'evidence_sha256': qc.file_hash(root/file)}
        manifest['queries'].append({'run_id': request['run_id'], 'key': key, 'tool': 'urllib.request.urlopen',
            'args': {'url': url, 'method': 'GET'}, 'source_urls': [url],
            'requested_at': qc.stamp(started), 'fetched_at': qc.stamp(finished), **reference})
        return raw, reference, finished

    today = qc.utc_now().astimezone(ZoneInfo('America/New_York')).date()
    url = TREASURY + '?type=daily_treasury_yield_curve&field_tdr_date_value_month=' + today.strftime('%Y%m')
    raw, ref, fetched = fetch('treasury', url)
    rows = observations(raw, today)
    original_count = len(rows)
    if original_count < 2:
        previous_month = today.replace(day=1)-timedelta(days=1)
        older_url = TREASURY + '?type=daily_treasury_yield_curve&field_tdr_date_value_month=' + previous_month.strftime('%Y%m')
        older, older_ref, older_fetched = fetch('previous-month', older_url)
        rows = sorted(dict(rows + observations(older, today)).items(), reverse=True)
    else:
        older_ref = ref
    if len(rows) < 2 or (today-rows[0][0]).days > 7:
        raise ValueError('财政部没有可核验的近期两次 CMT 公布值')
    # Read the publication definition from Treasury and current-year holidays /
    # observed-day exceptions independently from OPM. Never infer a trading
    # calendar or an exact release clock time from a missing table row.
    table_text = ' '.join(html.fromstring(raw).text_content().split()).lower()
    if not ('constant maturity' in table_text and 'daily' in table_text and 'each trading day' in table_text):
        raise ValueError('财政部页面未能核验 CMT 日度公布定义')
    holiday_raw, holiday_ref, _ = fetch('holidays', HOLIDAYS)
    latest, previous = rows[:2]
    years = sorted({today.year, latest[0].year, previous[0].year})
    official_holidays = holiday_context(holiday_raw, years)
    if any(day.weekday() >= 5 or day.isoformat() in official_holidays[str(day.year)] for day in [latest[0], previous[0]]):
        raise ValueError('财政部公布日期与官方假日上下文冲突，需要人工核查')
    quote_url, quote_ref, quote_fetched = (older_url, older_ref, older_fetched) if original_count == 0 else (url, ref, fetched)
    finished = qc.utc_now()
    calendar.update(evaluated_at=qc.stamp(finished), calendars=[{
        'calendar_id': 'US_TREASURY', 'timezone': 'America/New_York', 'mode': 'publication',
        'years': years, 'verified_holiday_context': official_holidays,
        'latest_publication_verified': True, 'latest_published_date': latest[0].isoformat(), 'previous_published_date': previous[0].isoformat(),
        'sources': [{'url': url, 'roles': ['publication'], **ref}, {'url': HOLIDAYS, 'roles': ['holidays', 'exceptions'], **holiday_ref}]}])
    row = next(r for r in quotes['quotes'] if r['id'] == 'US10Y')
    row.update(status='verified', value=str(latest[1]), previous_value=str(previous[1]),
        instrument='U.S. Treasury 10-Year Constant Maturity Rate (CMT)', source_name='U.S. Treasury', source_url=quote_url,
        fetched_at=qc.stamp(quote_fetched), quote_kind='official_daily', asof_date=latest[0].isoformat(),
        previous_date=previous[0].isoformat(), expected_session_date=latest[0].isoformat(),
        calendar_verified=True, session_timezone='America/New_York', session_complete=True,
        market_state='official_daily', source_delay_status='official_daily_not_live',
        yield_definition='CMT', data_route='public_web', **quote_ref,
        baseline_evidence_file=older_ref['evidence_file'], baseline_evidence_sha256=older_ref['evidence_sha256'])
    quotes['collected_at'] = qc.stamp(finished)
    manifest['collection_finished_at'] = qc.stamp(finished)
    qc.write_json(root/'quotes.json', quotes)
    qc.write_json(root/'calendar.json', calendar)
    qc.write_json(root/'evidence/manifest.json', manifest)
    return qc.validate_run(root)
