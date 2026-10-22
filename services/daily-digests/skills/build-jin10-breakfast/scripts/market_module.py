"""Strict, evidence-backed quote normalization and email-safe market rendering."""
from datetime import datetime, timezone, timedelta, date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from hashlib import sha256
from html import escape
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo
import json

BJ = timezone(timedelta(hours=8))
ASSETS = [
    ('COMP', '纳斯达克综合', '点', 'regular_close'),
    ('SPX', '标普500', '点', 'regular_close'),
    ('MAGS', 'MAGS', '美元', 'regular_close'),
    ('SSE', '上证指数', '点', 'regular_close'),
    ('HSI', '恒生指数', '点', 'regular_close'),
    ('BTCUSD', '比特币现货', '美元/枚', 'rolling_24h'),
    ('XAUUSD', '现货黄金', '美元/盎司', 'previous_close'),
    ('BRENT', '布伦特原油', '美元/桶', 'provider_daily_close'),
    ('US10Y', '10年期美债收益率', '%', 'yield_previous_observation'),
]
BASELINES = {
    'regular_close': '较前收盘', 'rolling_24h': '24小时',
    'previous_close': '较前收盘', 'previous_settlement': '较前结算',
    'provider_daily_close': '较源日K前收',
    'yield_previous_observation': '较前次公布',
}

def dt(value):
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('Timestamp lacks timezone')
    return parsed

def dec(value):
    if isinstance(value, bool):
        raise ValueError('Boolean is not a quote')
    result = Decimal(str(value))
    if not result.is_finite():
        raise ValueError('Nonfinite quote')
    return result

def safe_link(value):
    u = urlsplit(value)
    if u.scheme != 'https' or not u.hostname or u.username or u.password:
        raise ValueError('Source must be a public HTTPS link')
    return value

def normalize(snapshot, evidence_root):
    """Bad/stale rows become explicitly unavailable; never reuse yesterday's data."""
    collected = dt(snapshot['collected_at'])
    rows = snapshot.get('quotes', [])
    ids = [r['id'] for r in rows]
    if len(ids) != len(set(ids)) or any(k not in {a[0] for a in ASSETS} for k in ids):
        raise ValueError('Duplicate or unexpected asset')
    byid = {r['id']: r for r in rows}
    normalized = []
    for key, name, unit, expected_baseline in ASSETS:
        raw = byid.get(key, {})
        result = {'id': key, 'name': name, 'unit': unit, 'status': 'unavailable',
                  'reason': raw.get('reason', '未取得可核验的最新报价')}
        try:
            if raw.get('status') != 'verified':
                normalized.append(result)
                continue
            if raw['baseline'] != expected_baseline:
                raise ValueError('Wrong percentage-change baseline')
            value, previous = dec(raw['value']), dec(raw['previous_value'])
            if min(value, previous) <= 0:
                raise ValueError('Nonpositive value/reference')
            fetched = dt(raw['fetched_at'])
            if fetched > collected + timedelta(seconds=5) or collected - fetched > timedelta(minutes=20):
                raise ValueError('This run needs fresh source retrieval')
            safe_link(raw['source_url'])
            if not raw.get('source_name') or not raw.get('instrument') or not raw.get('unit') == unit:
                raise ValueError('Missing provider, definition, or wrong unit')
            # Bind the snapshot to a source payload retained in this run.
            ep = (Path(evidence_root) / raw['evidence_file']).resolve()
            if not ep.is_relative_to(Path(evidence_root).resolve()):
                raise ValueError('Evidence path escapes the run')
            if sha256(ep.read_bytes()).hexdigest() != raw['evidence_sha256']:
                raise ValueError('Quote evidence hash mismatch')
            if raw.get('baseline_evidence_file'):
                bp = (Path(evidence_root)/raw['baseline_evidence_file']).resolve()
                if not bp.is_relative_to(Path(evidence_root).resolve()) or sha256(bp.read_bytes()).hexdigest() != raw.get('baseline_evidence_sha256'):
                    raise ValueError('Baseline evidence hash mismatch')
            kind = raw['quote_kind']
            if kind in ('regular_close', 'official_daily', 'session_close'):
                observed = date.fromisoformat(raw['asof_date'])
                prior = date.fromisoformat(raw['previous_date'])
                if observed != date.fromisoformat(raw['expected_session_date']):
                    raise ValueError('Not the latest completed/published session')
                if prior >= observed or observed > collected.astimezone(BJ).date():
                    raise ValueError('Invalid session sequence')
                if not raw.get('calendar_verified') or not raw.get('session_timezone'):
                    raise ValueError('Completed-session calendar/timezone not verified')
                if expected_baseline == 'regular_close' and kind != 'regular_close':
                    raise ValueError('Stock/index must use regular-session close')
                time_label = observed.strftime('%m-%d') + (' 收盘' if kind == 'regular_close' else (' 最近日K收盘' if kind == 'session_close' else ' 公布值'))
            elif kind in ('live', 'delayed', 'bar_close'):
                quoted = dt(raw['quote_at'])
                max_age = timedelta(minutes=5 if key == 'BTCUSD' else 25)
                equity = key in ('COMP', 'SPX', 'MAGS', 'SSE', 'HSI')
                paused = equity and raw.get('market_state') == 'break'
                if paused:
                    # A lunch pause is not an overnight close. Keep the latest
                    # timestamped morning quote; do not relabel it as current.
                    schedules = {'SSE': ('Asia/Shanghai', '11:30', '13:00', 'sse.com.cn'),
                                 'HSI': ('Asia/Hong_Kong', '12:00', '13:00', 'hkex.com.hk')}
                    if key not in schedules:
                        raise ValueError('Unsupported intraday pause')
                    tzname, start_hm, end_hm, host = schedules[key]
                    start, end = dt(raw['break_start_at']), dt(raw['break_end_at'])
                    tz = ZoneInfo(tzname)
                    if raw.get('session_timezone') != tzname or not raw.get('calendar_verified'):
                        raise ValueError('Lunch-session calendar/timezone not verified')
                    if (start.astimezone(tz).strftime('%H:%M') != start_hm or
                        end.astimezone(tz).strftime('%H:%M') != end_hm or
                        start.astimezone(tz).date() != collected.astimezone(tz).date() or
                        end.astimezone(tz).date() != collected.astimezone(tz).date() or
                        not start <= fetched <= collected < end):
                        raise ValueError('Retrieval is outside the verified lunch pause')
                    schedule_host = urlsplit(safe_link(raw['market_schedule_source_url'])).hostname
                    if schedule_host != host and not schedule_host.endswith('.' + host):
                        raise ValueError('Lunch schedule source is not the exchange')
                    sp = (Path(evidence_root) / raw['break_schedule_evidence_file']).resolve()
                    if (not sp.is_relative_to(Path(evidence_root).resolve()) or
                        sha256(sp.read_bytes()).hexdigest() != raw['break_schedule_evidence_sha256']):
                        raise ValueError('Lunch schedule evidence hash mismatch')
                    if quoted > start + timedelta(seconds=5) or start - quoted > max_age:
                        raise ValueError('Quote does not represent the latest morning session')
                elif quoted > fetched + timedelta(seconds=5) or fetched - quoted > max_age or collected - quoted > max_age:
                    raise ValueError('Quote is stale or future-dated')
                if equity and (raw.get('market_state') not in ('open', 'break') or not raw.get('calendar_verified') or not raw.get('session_timezone')):
                    raise ValueError('Intraday stocks/indexes require verified open regular session, never overnight substitution')
                if raw.get('previous_at'):
                    if dt(raw['previous_at']) >= quoted:
                        raise ValueError('Baseline timestamp invalid')
                elif key != 'BTCUSD' and raw.get('previous_date'):
                    if date.fromisoformat(raw['previous_date']) >= quoted.astimezone(BJ).date():
                        raise ValueError('Previous source daily-close date invalid')
                else:
                    raise ValueError('Baseline timestamp/date missing')
                if key == 'BTCUSD' and abs((quoted-dt(raw['previous_at'])).total_seconds()-86400) > 300:
                    raise ValueError('BTC reference is not rolling 24h')
                unspecified_delay = (key == 'SSE' and paused and
                    raw.get('source_delay_status') == 'declared_unspecified' and
                    bool(raw.get('delay_disclosure')))
                if kind == 'delayed' and not raw.get('delay_seconds') and not unspecified_delay:
                    raise ValueError('Delay not disclosed')
                if kind == 'bar_close' and (raw.get('quote_time_precision') != 'minute_bar_end' or not raw.get('quote_basis')):
                    raise ValueError('Bar time/quote basis not disclosed')
                delay_label = (' 延迟'+str(raw['delay_seconds']//60)+'分' if raw.get('delay_seconds') else ' 延迟（源未注明时长）')
                time_label = quoted.astimezone(BJ).strftime('%m-%d %H:%M') + (delay_label if kind == 'delayed' else '')
            else:
                raise ValueError('Unrecognized quote type')
            if key == 'BRENT' and not all(raw.get(x) for x in ('contract_code', 'contract_expiry', 'contract_confirmed')):
                raise ValueError('Brent futures contract/roll definition unconfirmed')
            pct = (value / previous - 1) * 100
            if raw.get('provider_change_pct') is not None and abs(pct-dec(raw['provider_change_pct'])) > Decimal('.02'):
                raise ValueError('Source percentage and values disagree')
            result.update(raw)
            result.update(status='verified', name=name, value=str(value), previous_value=str(previous),
                          change_pct=str(pct), time_label=time_label, baseline_label=BASELINES[expected_baseline])
            if key == 'US10Y':
                result['change_bp'] = str((value-previous)*100)
            if key == 'BRENT':
                result['name'] = '布伦特原油期货'
        except (KeyError, ValueError, OSError, InvalidOperation) as exc:
            result.update(status='unavailable', reason=str(exc))
        normalized.append(result)
    good = sum(r['status'] == 'verified' for r in normalized)
    return {'schema': 'jin10-market/1', 'collected_at': collected.isoformat(), 'quotes': normalized,
            'verified_count': good, 'status': 'ready' if good == 9 else ('ready_degraded' if good else 'market_data_error')}

def number(value, places=2):
    return f'{dec(value):,.{places}f}'

def signed(value, suffix='%'):
    v = dec(value).quantize(Decimal('.01'), rounding=ROUND_HALF_UP)
    if v == 0:
        return '0.00' + suffix
    return f'{v:+.2f}' + suffix

def render(data):
    """Minimal presentation requested on 2026-10-22; all provenance stays in JSON."""
    collected = dt(data['collected_at']).astimezone(BJ)
    names = {key: name for key,name,unit,baseline in ASSETS}
    out = ['<section id="market-watch" aria-label="市场行情" style="margin:32px 0 0;padding:0;">',
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>',
        '<td style="font-size:25px;line-height:1.5;letter-spacing:2px;font-family:Georgia,Songti SC,SimSun,serif;color:#48443e;">市场行情</td>',
        '<td align="right" style="font-size:10px;letter-spacing:1.4px;color:#b57d69;">MARKET WATCH</td></tr></table>',
        '<div style="margin:5px 0 12px;font-size:10px;line-height:1.7;letter-spacing:.7px;color:#918574;">采集 '+collected.strftime('%m-%d %H:%M')+' · 北京时间</div>',
        '<table class="market-table" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;border-collapse:collapse;">',
        '<thead><tr><th width="44%" align="left" style="padding:0 0 7px;border-bottom:1px solid #8b7b65;font-size:10px;line-height:1.6;font-weight:400;color:#918574;">资产 / 报价口径</th>',
        '<th width="32%" align="center" style="padding:0 0 7px;border-bottom:1px solid #8b7b65;font-size:10px;line-height:1.6;font-weight:400;color:#918574;">最新值</th>',
        '<th width="24%" align="right" style="padding:0 0 7px;border-bottom:1px solid #8b7b65;font-size:10px;line-height:1.6;font-weight:400;color:#918574;">日内变动</th></tr></thead><tbody>']
    plain = ['市场行情', '采集 '+collected.strftime('%Y-%m-%d %H:%M')+' 北京时间']
    for row in data['quotes']:
        good = row['status'] == 'verified'
        name = names[row['id']]
        if good:
            value = number(row['value'], int(row.get('display_decimals', 2)))
            value = value+'%' if row['id']=='US10Y' else ('$'+value if row['unit'].startswith('美元') else value)
            change = signed(row['change_pct'])
            rounded = dec(row['change_pct']).quantize(Decimal('.01'),rounding=ROUND_HALF_UP)
            color = '#ba735f' if rounded > 0 else ('#557e6c' if rounded < 0 else '#918574')
        else:
            value, change, color = '暂无可信报价', '—', '#918574'
        cell = 'padding:9px 0;border-bottom:1px solid #ded6c8;vertical-align:middle;'
        out += ['<tr><td style="'+cell+'font-size:12px;line-height:1.6;color:#655d51;">'+escape(name)+'</td>',
            '<td align="center" class="market-value" style="'+cell+'font-size:'+('18' if good else '11')+'px;font-family:Arial,Helvetica,sans-serif;font-weight:400;font-variant-numeric:tabular-nums lining-nums;font-feature-settings:&quot;tnum&quot; 1,&quot;lnum&quot; 1;letter-spacing:0;color:#48443e;">'+escape(value)+'</td>',
            '<td align="right" style="'+cell+'font-size:13px;font-family:Arial,Helvetica,sans-serif;font-weight:400;font-variant-numeric:tabular-nums lining-nums;font-feature-settings:&quot;tnum&quot; 1,&quot;lnum&quot; 1;letter-spacing:0;color:'+color+';">'+escape(change)+'</td></tr>']
        plain.append(name+' | '+value+' | '+change)
    out.append('</tbody></table></section>')
    return '\n'.join(out), '\n'.join(plain)
