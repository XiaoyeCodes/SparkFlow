#!/usr/bin/env python3
"""Read daily60 JSON and render text HTML. Does not send email or change schedules."""
import argparse, base64, datetime as dt, hashlib, html, json, re, urllib.request
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]

def validate(data, expected_date):
    if not isinstance(data, dict) or data.get('date') != expected_date:
        raise ValueError(f"Source date mismatch; require {expected_date}, got {data.get('date') if isinstance(data, dict) else 'non-object'}")
    news = data.get('news')
    if not isinstance(news, list) or not news or not all(isinstance(n, str) and n.strip() for n in news):
        raise ValueError('news must be a non-empty array of non-empty strings')
    # No count cap or fixed 15-item expectation: preserve every source item.
    link = data.get('link', '')
    if link and (not isinstance(link, str) or urlparse(link).scheme != 'https'):
        raise ValueError('Source link must use HTTPS')
    tip = data.get('tip', '')
    if not isinstance(tip, str):
        raise ValueError('tip must be a string when present')
    return news

def fetch(date):
    urls = [f'https://60s-static.viki.moe/60s/{date}.json',
            f'https://raw.githubusercontent.com/vikiboss/60s-static-host/main/static/60s/{date}.json']
    failures = []
    for url in urls:
        try:
            req = urllib.request.Request(url, headers={'Accept':'application/json','User-Agent':'daily60-text-template/1.0'})
            with urllib.request.urlopen(req, timeout=25) as response:
                if response.status != 200:
                    raise ValueError(f'HTTP {response.status}')
                raw = response.read(1_000_001)
                if len(raw) > 1_000_000:
                    raise ValueError('JSON exceeded size limit')
            data = json.loads(raw)
            validate(data, date)
            return data, url, failures, hashlib.sha256(raw).hexdigest()
        except Exception as error:
            failures.append({'url':url,'reason':f'{type(error).__name__}: {error}'})
    raise RuntimeError('No fresh, valid JSON; do not send stale news. ' + json.dumps(failures, ensure_ascii=False))

def fetch_calendar(date):
    """Convert this Gregorian date with the official Hong Kong Observatory API."""
    d = dt.date.fromisoformat(date)
    url = f'https://data.weather.gov.hk/weatherAPI/opendata/lunardate.php?date={date}'
    with urllib.request.urlopen(url, timeout=25) as response:
        if response.status != 200:
            raise ValueError(f'Calendar HTTP {response.status}')
        raw = json.loads(response.read(10001))
    if not isinstance(raw, dict) or not all(isinstance(raw.get(k),str) and raw[k].strip() for k in ('LunarYear','LunarDate')):
        raise ValueError('Official calendar response is incomplete; do not invent or reuse another date')
    year = re.split('[，,]',raw['LunarYear'])[0]
    if not re.fullmatch('[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]年',year):
        raise ValueError('Unexpected LunarYear format')
    if not re.fullmatch('[閏闰]?[正一二三四五六七八九十冬腊臘]+月[初一二三四五六七八九十廿卅]+',raw['LunarDate']):
        raise ValueError('Unexpected LunarDate format')
    return {'gregorian_date':date,'timezone':'Asia/Shanghai','weekday':'星期'+'一二三四五六日'[d.weekday()],
            'lunar_year':year,'lunar_date':raw['LunarDate'].replace('閏','闰').replace('臘','腊'),
            'provider':'Hong Kong Observatory','source_url':url,'raw_response':raw,
            'checked_at_utc':dt.datetime.now(dt.timezone.utc).isoformat()}

def render(data, date, source_url, output, art_mode='embedded', calendar=None):
    news = validate(data, date)
    if not isinstance(calendar,dict) or calendar.get('gregorian_date') != date:
        raise ValueError('A separately verified calendar record for this date is required')
    d = dt.date.fromisoformat(date)
    rows = []
    for i, item in enumerate(news, 1):
        rule = 'border-top:1px solid #e1d8ca;' if i > 1 else ''
        rows.append(f'<tr><td class="story" style="padding:16px 0;{rule}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="number" width="40" valign="top" aria-hidden="true" style="width:40px;padding-top:2px;color:#9a896f;font-size:13px;line-height:28.8px;font-family:Georgia,serif;">{i:02d}</td><td valign="top"><p class="news-item" data-item="{i}" style="margin:0;color:#282622;font-size:16px;line-height:1.8;font-weight:400;word-wrap:break-word;overflow-wrap:anywhere;">{html.escape(item)}</p></td></tr></table></td></tr>')
    art = ''
    if art_mode != 'none':
        src = 'cid:daily60-header' if art_mode == 'cid' else 'data:image/png;base64,' + base64.b64encode((ROOT/'assets'/'header-art.png').read_bytes()).decode()
        art = f'<td class="geometry-cell" width="140" align="right" valign="middle" style="width:140px;"><img class="geometry" src="{src}" width="140" height="103" alt="" role="presentation" style="display:block;width:140px;height:103px;border:0;outline:none;text-decoration:none;"></td>'
    tip = data.get('tip','')
    if not isinstance(tip,str):
        raise ValueError('tip must be a string when present')
    tip_html = ''
    if tip.strip():
        tip_html = '<tr><td class="content" style="padding:20px 44px 0;background-color:#FCFAF6;"><div style="padding:22px 24px;background-color:#F1E8D8;border-left:2px solid #C8BCAA;"><p style="margin:0 0 9px;font-size:11px;line-height:1.8;letter-spacing:2px;color:#827563;">每日寄语</p><p class="daily-tip" style="margin:0;font-size:16px;line-height:1.8;color:#534a3c;font-style:italic;">'+html.escape(tip)+'</p></div></td></tr>'
    replacements = {'DATE':date,'DATE_CN':f'{d.year}年{d.month}月{d.day}日','WEEKDAY':'星期'+'一二三四五六日'[d.weekday()],
                    'COUNT':str(len(news)),'NEWS_ROWS':''.join(rows),'HEADER_ART':art,
                    'LUNAR_DATE':html.escape(calendar['lunar_year']+calendar['lunar_date']),'DAILY_TIP':tip_html,
}
    content = (ROOT/'templates'/'daily60.html').read_text(encoding='utf-8')
    token = re.compile(r'\{\{([A-Z_]+)\}\}')
    if set(token.findall(content)) - replacements.keys():
        raise ValueError('Unfilled template token')
    # Substitute only tokens belonging to the template, never token-like source text.
    content = token.sub(lambda match: replacements[match.group(1)], content)
    if output is not None:
        output.write_text(content, encoding='utf-8')
    return content

def beijing_today(now=None):
    """Beijing civil date; fixed UTC+08 avoids an OS tzdata dependency."""
    now = now or dt.datetime.now(dt.timezone.utc)
    if now.tzinfo is None:
        raise ValueError('now must be timezone-aware')
    return now.astimezone(dt.timezone(dt.timedelta(hours=8))).date().isoformat()


def validate_calendar(record, date):
    if not isinstance(record, dict) or record.get('gregorian_date') != date:
        raise ValueError('Calendar date mismatch')
    raw = record.get('raw_response', {})
    year = re.split('[，,]', raw.get('LunarYear', ''))[0]
    lunar = raw.get('LunarDate', '').replace('閏', '闰').replace('臘', '腊')
    if not re.fullmatch('[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]年', year):
        raise ValueError('Invalid calendar year')
    if not re.fullmatch('[闰]?[正一二三四五六七八九十冬腊]+月[初一二三四五六七八九十廿卅]+', lunar):
        raise ValueError('Invalid calendar lunar date')
    weekday = '星期' + '一二三四五六日'[dt.date.fromisoformat(date).weekday()]
    expected_url = f'https://data.weather.gov.hk/weatherAPI/opendata/lunardate.php?date={date}'
    if any((record.get('lunar_year') != year, record.get('lunar_date') != lunar,
            record.get('weekday') != weekday, record.get('source_url') != expected_url)):
        raise ValueError('Calendar record fields disagree with the saved official response/date')
    return record


def text_version(data, calendar):
    lines = ['每日60秒', f"{data['date']} · {calendar['weekday']} · {len(data['news'])} 条新闻",
             '农历 · ' + calendar['lunar_year'] + calendar['lunar_date'], '']
    lines += [f'{i:02d}. {n}' for i, n in enumerate(data['news'], 1)]
    if data.get('tip', '').strip():
        lines += ['', '每日寄语', data['tip']]
    lines += ['', '来源：60s 每日新闻 · ' + data['date'], '']
    return '\n'.join(lines)


def write_atomic(path, content):
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(content, encoding='utf-8')
    temporary.replace(path)


def main(argv=None):
    import sys
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--date', default=None, help='YYYY-MM-DD; defaults to today in Beijing (UTC+08).')
    parser.add_argument('--input', type=Path, help='Explicit saved news JSON; never used as an automatic fallback.')
    parser.add_argument('--calendar-input', type=Path, help='Explicit matching saved HKO record; requires --input and --date.')
    parser.add_argument('--outdir', type=Path, default=Path('output'))
    parser.add_argument('--email-html', action='store_true', help='Also create CID HTML + header PNG; does not send email.')
    parser.add_argument('--pdf', action='store_true', help='Also export a scrollable PDF; requires requirements-pdf.txt.')
    parser.add_argument('--pdf-layout', choices=['continuous', 'a4'], default='continuous')
    args = parser.parse_args(argv)
    date = args.date or beijing_today()
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date):
        parser.error('--date must be YYYY-MM-DD')
    dt.date.fromisoformat(date)
    if args.calendar_input and (not args.input or not args.date):
        parser.error('--calendar-input requires explicit --input and --date')
    try:
        if args.input:
            raw = args.input.read_bytes()
            if len(raw) > 1_000_000:
                raise ValueError('Input JSON exceeded size limit')
            data = json.loads(raw)
            validate(data, date)
            source = f'https://60s-static.viki.moe/60s/{date}.json'
            failures = []
            checksum = hashlib.sha256(raw).hexdigest()
            source_mode = 'explicit_saved_input'
        else:
            data, source, failures, checksum = fetch(date)
            source_mode = 'fresh_network'
        calendar = (json.loads(args.calendar_input.read_text(encoding='utf-8'))
                    if args.calendar_input else fetch_calendar(date))
        validate_calendar(calendar, date)
        markup = render(data, date, source, None, 'embedded', calendar)
        extracted = {k:data[k] for k in ('date', 'news', 'tip', 'link', 'created', 'created_at', 'updated', 'updated_at') if k in data}
        # Validate before writing. No previous output is treated as a successful new run.
        args.outdir.mkdir(parents=True, exist_ok=True)
        stem = 'daily60-' + date
        outputs = {stem + '.html': markup, stem + '.txt': text_version(data, calendar),
                   stem + '.json': json.dumps(extracted, ensure_ascii=False, indent=2),
                   'calendar-' + date + '.json': json.dumps(calendar, ensure_ascii=False, indent=2)}
        if args.email_html:
            outputs[stem + '.email.html'] = render(data, date, source, None, 'cid', calendar)
            (args.outdir/'header-art.png').write_bytes((ROOT/'assets'/'header-art.png').read_bytes())
        for name, content in outputs.items():
            write_atomic(args.outdir/name, content)
        manifest = {'schema_version':1, 'status':'success', 'date':date, 'timezone':'Asia/Shanghai',
                    'source_mode':source_mode, 'source_url':source, 'input_sha256':checksum,
                    'created_at_utc':dt.datetime.now(dt.timezone.utc).isoformat(),
                    'item_count':len(data['news']), 'text_and_order_exact':True,
                    'source_images_fetched':False, 'ocr_used':False, 'lunar_from_news_json':False,
                    'calendar_mode':'explicit_saved_record' if args.calendar_input else 'live_hko_api',
                    'calendar_source':calendar['source_url'], 'fallback_attempts':failures,
                    'outputs':list(outputs), 'email_sent':False, 'schedule_installed':False,
                    'layout':{'version':'1.4','font_px':16,'line_height':1.8,'row_padding_desktop_px':16,
                              'row_padding_mobile_px':14,'source_button':False,'grey_disclaimer':False}}
        if args.email_html:
            manifest['outputs'].append('header-art.png')
            manifest['email_asset'] = {'file':'header-art.png','content_id':'daily60-header','disposition':'inline'}
        if args.pdf:
            try:
                from export_pdf import export_pdf
                result = export_pdf(args.outdir/(stem+'.html'), args.outdir/(stem+'.pdf'), args.pdf_layout)
                manifest['pdf'] = result
                manifest['outputs'].append(stem+'.pdf')
            except Exception as error:
                manifest['status'] = 'partial_pdf_failed'
                manifest['pdf_error'] = f'{type(error).__name__}: {error}'
                write_atomic(args.outdir/(stem+'.manifest.json'),json.dumps(manifest,ensure_ascii=False,indent=2))
                print('HTML/TXT/JSON saved; PDF export failed: '+str(error),file=sys.stderr)
                return 2
        write_atomic(args.outdir/(stem+'.manifest.json'),json.dumps(manifest,ensure_ascii=False,indent=2))
        print(json.dumps(manifest, ensure_ascii=False, indent=2))
        return 0
    except Exception as error:
        print(f'FAILED: {type(error).__name__}: {error}. No successful new edition was produced; do not reuse old output.',file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
