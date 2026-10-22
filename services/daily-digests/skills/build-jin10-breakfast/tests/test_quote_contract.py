"""Synthetic contract tests. Fixtures are generated at runtime, never report data."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import quote_contract as qc


class QuoteContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.root = Path(self.tmp.name) / 'run'
        # A recent Tuesday, after US market close. No production fixture is reused.
        today = datetime.now(timezone.utc).date()
        tuesday = today-timedelta(days=(today.weekday()-1) % 7)
        self.cutoff = datetime.combine(tuesday, datetime.min.time(), timezone.utc).replace(hour=22)
        self.started = self.cutoff-timedelta(minutes=2)
        self.request = qc.init_run(self.root, now=self.started)
        self.run_id = self.request['run_id']
        self.quotes = qc.read_json(self.root/'quotes.json')
        self.manifest = qc.read_json(self.root/'evidence/manifest.json')
        self.calendar = qc.read_json(self.root/'calendar.json')
        self.quotes['collected_at'] = qc.stamp(self.cutoff)
        self.manifest['collection_finished_at'] = qc.stamp(self.cutoff)
        self.calendar['evaluated_at'] = qc.stamp(self.cutoff)
        for row in self.quotes['quotes']:
            row.update(status='unavailable', reason='Synthetic test does not collect this asset')
        evidence = self.add_evidence('quote', ['https://indexes.nasdaqomx.com/Index/Overview/comp'])
        calendar_evidence = self.add_evidence('calendar', ['https://www.nasdaq.com/market-activity/stock-market-holiday-schedule'])
        cal = self.session_calendar('NASDAQ', 'America/New_York', calendar_evidence)
        self.calendar['calendars'].append(cal)
        latest = self.cutoff.astimezone(ZoneInfo('America/New_York')).date()
        previous = latest-timedelta(days=1)
        row = self.quotes['quotes'][0]
        row.update(status='verified', value=101, previous_value=100,
                   instrument='Synthetic Nasdaq Composite index for validator tests',
                   source_url='https://indexes.nasdaqomx.com/Index/Overview/comp', source_name='IBKR',
                   fetched_at=qc.stamp(self.cutoff-timedelta(seconds=10)), quote_kind='regular_close',
                   asof_date=latest.isoformat(), previous_date=previous.isoformat(), expected_session_date=latest.isoformat(),
                   calendar_verified=True, session_timezone='America/New_York', session_complete=True, market_state='closed',
                   source_delay_status='not_declared', data_route='ibkr',
                   provider_contract={'contract_id':18342287, 'exchange':'NASDAQ', 'security_type':'IND'},
                   **evidence)
        self.save()

    def tearDown(self):
        self.tmp.cleanup()

    def add_evidence(self, key, urls, tool='mcp__test__interactive_brokers__get_price_history'):
        name = 'evidence/'+key+'.json'
        payload = {'synthetic_test_only': True, 'key':key}
        qc.write_json(self.root/name, payload)
        digest = qc.file_hash(self.root/name)
        self.manifest['queries'].append({
            'run_id':self.run_id, 'key':key, 'tool':tool, 'args':{'contract_id':18342287,'exchange':'NASDAQ','synthetic_test_only':True},
            'source_urls':urls, 'requested_at':qc.stamp(self.started+timedelta(seconds=1)),
            'fetched_at':qc.stamp(self.cutoff-timedelta(seconds=10)),
            'evidence_file':name, 'evidence_sha256':digest})
        return {'evidence_file':name, 'evidence_sha256':digest}

    def session_calendar(self, cid, tzname, evidence):
        tz = ZoneInfo(tzname)
        today = self.cutoff.astimezone(tz).date()
        start = today-timedelta(days=14)
        days = []
        for offset in range(15):
            d = start+timedelta(days=offset)
            intervals = []
            if d.weekday() < 5:
                opened = datetime.combine(d, datetime.min.time(), tz).replace(hour=9, minute=30)
                closed = datetime.combine(d, datetime.min.time(), tz).replace(hour=16)
                intervals = [{'open_at':opened.isoformat(), 'close_at':closed.isoformat()}]
            days.append({'date':d.isoformat(), 'intervals':intervals, 'early_close':False, 'closure_reason':'Synthetic fixture weekend' if not intervals else ''})
        return {'calendar_id':cid, 'timezone':tzname, 'mode':'sessions',
                'years':list({start.year,today.year}), 'coverage_start':start.isoformat(), 'coverage_end':today.isoformat(),
                'sources':[{'url':'https://www.nasdaq.com/market-activity/stock-market-holiday-schedule',
                            'roles':['hours','holidays','exceptions'], **evidence}], 'days':days}

    def save(self):
        qc.write_json(self.root/'quotes.json', self.quotes)
        qc.write_json(self.root/'calendar.json', self.calendar)
        qc.write_json(self.root/'evidence/manifest.json', self.manifest)

    def validate(self):
        self.save()
        return qc.validate_run(self.root, now=self.cutoff+timedelta(seconds=5))

    def row(self, key='COMP'):
        return next(row for row in self.quotes['quotes'] if row['id']==key)

    def test_init_is_empty_current_unique_and_no_overwrite(self):
        fresh = Path(self.tmp.name)/'fresh'
        before = datetime.now(timezone.utc)
        req = qc.init_run(fresh)
        after = datetime.now(timezone.utc)
        self.assertLessEqual(before, qc.timestamp(req['run_started_at']))
        self.assertLessEqual(qc.timestamp(req['run_started_at']), after)
        self.assertNotEqual(self.run_id, req['run_id'])
        empty = qc.read_json(fresh/'quotes.json')
        self.assertEqual(9, len(empty['quotes']))
        self.assertTrue(all(row['status']=='pending' and 'value' not in row for row in empty['quotes']))
        with self.assertRaises(qc.ContractError):
            qc.init_run(fresh)

    def test_valid_partial(self):
        result = self.validate()
        self.assertEqual(result['verified_count'], 1)
        self.assertEqual(result['status'], 'ready_degraded')
        self.assertEqual(result['quotes'][0]['change_pct'], '1.00')

    def test_all_missing_hard_fails(self):
        self.row().update(status='unavailable')
        for field in ['value','previous_value','asof_date']:
            self.row().pop(field, None)
        with self.assertRaisesRegex(qc.ContractError, 'All nine'):
            self.validate()

    def test_pending_hard_fails_when_no_verified_rows(self):
        self.row()['status'] = 'pending'
        with self.assertRaisesRegex(qc.ContractError, 'Pending row'):
            self.validate()

    def test_stale_run_hard_fails_even_closed_quote(self):
        self.save()
        with self.assertRaisesRegex(qc.ContractError, 'Stale snapshot'):
            qc.validate_run(self.root, now=self.cutoff+timedelta(minutes=21))

    def test_old_manifest_cannot_be_retimestamped(self):
        self.manifest['queries'][0]['requested_at'] = qc.stamp(self.started-timedelta(days=1))
        with self.assertRaisesRegex(qc.ContractError, 'not retrieved during'):
            self.validate()

    def test_wrong_run_id(self):
        self.quotes['run_id'] = 'another-run'
        with self.assertRaisesRegex(qc.ContractError, 'another run'):
            self.validate()

    def test_wrong_evidence_run_id(self):
        self.manifest['queries'][0]['run_id'] = 'another-run'
        with self.assertRaisesRegex(qc.ContractError, 'current run binding'):
            self.validate()

    def test_request_hash_binding(self):
        self.quotes['request_sha256'] = '0'*64
        with self.assertRaisesRegex(qc.ContractError, 'hash mismatch'):
            self.validate()

    def test_raw_evidence_hash_mismatch(self):
        (self.root/'evidence/quote.json').write_text('{}')
        with self.assertRaisesRegex(qc.ContractError, 'Raw evidence hash'):
            self.validate()

    def test_traversal_rejected(self):
        self.manifest['queries'][0]['evidence_file'] = '../outside.json'
        (self.root.parent/'outside.json').write_text('{}')
        with self.assertRaisesRegex(qc.ContractError, 'escapes'):
            self.validate()

    def test_missing_asset_hard_fails(self):
        self.quotes['quotes'].pop()
        with self.assertRaisesRegex(qc.ContractError, 'exactly one row'):
            self.validate()

    def test_duplicate_asset_hard_fails(self):
        self.quotes['quotes'][-1]['id'] = 'COMP'
        with self.assertRaisesRegex(qc.ContractError, 'exactly one row'):
            self.validate()

    def test_wrong_identity_not_accepted(self):
        self.row()['instrument_id'] = 'NASDAQ:QQQ:ETF'
        with self.assertRaisesRegex(qc.ContractError, 'Wrong benchmark'):
            self.validate()

    def test_wrong_contract_not_accepted(self):
        self.row()['provider_contract']['contract_id'] = 1
        with self.assertRaisesRegex(qc.ContractError, 'not this benchmark'):
            self.validate()

    def test_calendar_missing_day_not_guessed(self):
        self.calendar['calendars'][0]['days'].pop(0)
        with self.assertRaisesRegex(qc.ContractError, 'missing dates'):
            self.validate()

    def test_current_year_required(self):
        self.calendar['calendars'][0]['years'] = [1900]
        with self.assertRaisesRegex(qc.ContractError, 'current local year'):
            self.validate()

    def test_official_calendar_source_required(self):
        self.calendar['calendars'][0]['sources'][0]['url'] = 'https://example.org/calendar'
        with self.assertRaisesRegex(qc.ContractError, 'official authority'):
            self.validate()

    def test_incorrect_expected_close_not_self_certifying(self):
        self.row()['asof_date'] = self.row()['previous_date']
        self.row()['expected_session_date'] = self.row()['previous_date']
        with self.assertRaisesRegex(qc.ContractError, 'independently expected'):
            self.validate()

    def test_holiday_moves_completed_session(self):
        self.calendar['calendars'][0]['days'][-1].update(intervals=[], closure_reason='Synthetic test holiday')
        with self.assertRaisesRegex(qc.ContractError, 'independently expected'):
            self.validate()

    def test_early_close_state_is_derived(self):
        cal = self.calendar['calendars'][0]
        tz = ZoneInfo('America/New_York')
        d = self.cutoff.astimezone(tz).date()
        end = datetime.combine(d, datetime.min.time(), tz).replace(hour=13)
        cal['days'][-1]['intervals'][0]['close_at'] = end.isoformat()
        cal['days'][-1]['early_close'] = True
        facts = qc.calendar_facts(cal, self.root, {e['evidence_file']:e for e in self.manifest['queries']}, end+timedelta(minutes=1))
        self.assertEqual(facts['state'], 'closed')
        self.assertEqual(facts['latest'], d)

    def test_lunch_is_not_close(self):
        cal = deepcopy(self.calendar['calendars'][0])
        cal.update(calendar_id='SSE', timezone='Asia/Shanghai')
        url = 'https://english.sse.com.cn/start/trading/schedule/'
        evidence = self.add_evidence('sse_schedule', [url], tool='web.open')
        cal['sources'] = [{'url':url, 'roles':['hours','holidays','exceptions'], **evidence}]
        tz = ZoneInfo('Asia/Shanghai')
        # Rebuild session timestamps to match Chinese days and lunch break.
        d = self.cutoff.astimezone(tz).date()
        while d.weekday()>4:
            d -= timedelta(days=1)
        cal['coverage_start'] = (d-timedelta(days=14)).isoformat()
        cal['coverage_end'] = d.isoformat()
        cal['days'] = []
        for i in range(15):
            dd = d-timedelta(days=14-i)
            interval = []
            if dd.weekday()<5:
                base = datetime.combine(dd, datetime.min.time(), tz)
                interval = [{'open_at':base.replace(hour=9,minute=30).isoformat(), 'close_at':base.replace(hour=11,minute=30).isoformat()},
                            {'open_at':base.replace(hour=13).isoformat(), 'close_at':base.replace(hour=15).isoformat()}]
            cal['days'].append({'date':dd.isoformat(), 'intervals':interval, 'early_close':False, 'closure_reason':'fixture weekend'})
        lunch = datetime.combine(d,datetime.min.time(),tz).replace(hour=12)
        facts = qc.calendar_facts(cal,self.root,{e['evidence_file']:e for e in self.manifest['queries']},lunch)
        self.assertEqual(facts['state'],'break')
        self.assertLess(facts['latest'],d)
        self.assertEqual(facts['break_start'].hour,11)

    def add_bitcoin(self):
        url = 'https://www.interactivebrokers.com/docs/tws-api/contracts/cryptocurrency'
        evidence = self.add_evidence('btc',[url])
        self.manifest['queries'][-1]['args'].update(contract_id=479624278,exchange='PAXOS')
        cal_evidence = self.add_evidence('paxos_calendar',['https://www.paxos.com/'],tool='web.open')
        self.calendar['calendars'].append({'calendar_id':'PAXOS','timezone':'Etc/UTC','mode':'continuous',
            'years':[self.cutoff.year],'continuous_24h_verified':True,'active_exception':False,
            'sources':[{'url':'https://www.paxos.com/','roles':['hours','exceptions'],**cal_evidence}]})
        quote_time = self.cutoff-timedelta(minutes=1)
        previous = quote_time-timedelta(days=1)
        self.row('BTCUSD').update(status='verified',value=101,previous_value=100,quote_kind='bar_close',
            instrument='Synthetic Paxos BTC spot fixture',source_name='IBKR',source_url=url,
            fetched_at=qc.stamp(self.cutoff-timedelta(seconds=10)),calendar_verified=True,session_timezone='Etc/UTC',
            market_state='open',data_route='ibkr',provider_contract={'contract_id':479624278,'exchange':'PAXOS','security_type':'CRYPTO'},
            source_delay_status='not_declared',source_type='AggLast',quote_at=qc.stamp(quote_time),
            source_bar_time=qc.stamp(quote_time-timedelta(minutes=1)),quote_time_precision='minute_bar_end',quote_basis='1分钟收盘',
            previous_at=qc.stamp(previous),previous_source_bar_time=qc.stamp(previous-timedelta(minutes=1)),**evidence)

    def test_exact_btc_24h_and_completed_minute(self):
        self.add_bitcoin()
        self.assertEqual(self.validate()['verified_count'],2)
        self.row('BTCUSD')['previous_at'] = qc.stamp(self.cutoff-timedelta(days=1,minutes=2))
        result = self.validate()
        self.assertEqual(result['verified_count'],1)
        self.assertIn('exact matching minute', result['validation_errors']['BTCUSD'])

    def test_btc_bar_start_cannot_be_quote_time(self):
        self.add_bitcoin()
        self.row('BTCUSD')['source_bar_time'] = self.row('BTCUSD')['quote_at']
        result = self.validate()
        self.assertIn('bar start plus 60',result['validation_errors']['BTCUSD'])

    def test_unavailable_rows_cannot_keep_old_values(self):
        self.row('HSI')['value'] = 123
        result = self.validate()
        self.assertIn('must not retain stale',result['validation_errors']['HSI'])

    def test_partial_keeps_failures_explicit(self):
        self.row('HSI')['status'] = 'pending'
        result = self.validate()
        self.assertEqual(result['quotes'][4]['status'],'unavailable')
        self.assertIn('Pending', result['validation_errors']['HSI'])

    def test_vendor_math_mismatch_becomes_unavailable(self):
        self.add_bitcoin()
        self.row()['provider_change_pct'] = 10
        result = self.validate()
        self.assertEqual(result['verified_count'],1)
        self.assertIn('disagree',result['validation_errors']['COMP'])

    def add_brent(self):
        url = 'https://www.ice.com/products/219/Brent-Crude-Futures'
        current = self.add_evidence('brent', [url])
        self.manifest['queries'][-1]['args'].update(contract_id=123456, exchange='IPE')
        baseline = self.add_evidence('brent_baseline', [url])
        self.manifest['queries'][-1]['args'].update(contract_id=123456, exchange='IPE')
        ladder = self.add_evidence('brent_ladder', [url], tool='mcp__test__ibkr__search_futures')
        self.manifest['queries'][-1]['args'] = {'underlying_contract_id':30865593}
        expiry = self.add_evidence('brent_expiry', [url], tool='web.open')
        cal = self.session_calendar('ICE_BRENT','Europe/London',expiry)
        cal['sources'][0]['url'] = url
        self.calendar['calendars'].append(cal)
        facts = qc.calendar_facts(cal,self.root,{e['evidence_file']:e for e in self.manifest['queries']},self.cutoff)
        last_trade = self.cutoff+timedelta(days=30)
        row = self.row('BRENT')
        row.update(status='verified',value=81,previous_value=80,quote_kind='session_close',
            instrument='Synthetic ICE Brent front future for contract tests',source_name='IBKR',source_url=url,
            fetched_at=qc.stamp(self.cutoff-timedelta(seconds=10)),data_route='ibkr',
            provider_contract={'contract_id':123456,'exchange':'IPE','security_type':'FUT'},
            calendar_verified=True,session_timezone='Europe/London',market_state='closed',session_complete=True,
            asof_date=facts['latest'].isoformat(),previous_date=facts['previous'].isoformat(),expected_session_date=facts['latest'].isoformat(),
            source_delay_status='not_declared',contract_id=123456,baseline_contract_id=123456,
            contract_code='Synthetic Brent contract',contract_month=(last_trade+timedelta(days=30)).strftime('%Y%m'),
            contract_expiry=last_trade.astimezone(ZoneInfo('Europe/London')).date().isoformat(),
            contract_last_trade_at=qc.stamp(last_trade),contract_confirmed=True,front_month_verified=True,
            expiry_source_url=url,**current)
        for prefix,evidence in [('contract_',ladder),('baseline_',baseline),('expiry_',expiry)]:
            row.update({prefix+k:v for k,v in evidence.items()})

    def test_brent_valid_closed_session_and_same_contract(self):
        self.add_brent()
        self.assertEqual(self.validate()['verified_count'],2)
        self.row('BRENT')['baseline_contract_id'] = 999
        result = self.validate()
        self.assertIn('different Brent delivery',result['validation_errors']['BRENT'])

    def test_brent_query_baseline_mismatch(self):
        self.add_brent()
        next(e for e in self.manifest['queries'] if e['key']=='brent_baseline')['args']['contract_id'] = 999
        self.assertIn('baseline evidence uses a different',self.validate()['validation_errors']['BRENT'])

    def test_brent_expiry_boundary(self):
        self.add_brent()
        self.row('BRENT')['contract_last_trade_at'] = qc.stamp(self.cutoff)
        self.row('BRENT')['contract_expiry'] = self.cutoff.astimezone(ZoneInfo('Europe/London')).date().isoformat()
        self.assertIn('last trading cutoff',self.validate()['validation_errors']['BRENT'])

    def test_brent_requires_official_expiry_evidence(self):
        self.add_brent()
        self.row('BRENT')['expiry_source_url'] = 'https://example.org/expiry'
        self.assertIn('official ICE',self.validate()['validation_errors']['BRENT'])

    def add_treasury(self):
        url = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve'
        evidence = self.add_evidence('treasury',[url],tool='web.open')
        calendar_evidence = self.add_evidence('treasury_calendar',[url],tool='web.open')
        latest = self.cutoff.astimezone(ZoneInfo('America/New_York')).date()
        previous = latest-timedelta(days=1)
        self.calendar['calendars'].append({'calendar_id':'US_TREASURY','timezone':'America/New_York','mode':'publication',
            'years':list({latest.year,previous.year}),'latest_publication_verified':True,
            'latest_published_date':latest.isoformat(),'previous_published_date':previous.isoformat(),
            'sources':[{'url':url,'roles':['publication','holidays','exceptions'],**calendar_evidence}]})
        self.row('US10Y').update(status='verified',value='5.13',previous_value='5.12',
            instrument='Synthetic official Treasury nominal par CMT fixture',source_name='Treasury',source_url=url,
            data_route='public_web',fetched_at=qc.stamp(self.cutoff-timedelta(seconds=10)),
            calendar_verified=True,session_timezone='America/New_York',market_state='official_daily',session_complete=True,
            quote_kind='official_daily',yield_definition='CMT',source_delay_status='official_daily_not_live',
            asof_date=latest.isoformat(),previous_date=previous.isoformat(),expected_session_date=latest.isoformat(),**evidence)

    def test_treasury_official_publication_and_bp(self):
        self.add_treasury()
        result = self.validate()
        self.assertEqual(result['verified_count'],2)
        self.assertEqual(result['quotes'][-1]['change_bp'],'1.00')

    def test_treasury_not_live_proxy(self):
        self.add_treasury()
        self.row('US10Y')['yield_definition'] = 'TNX'
        self.assertIn('not TNX/live proxy',self.validate()['validation_errors']['US10Y'])

    def test_provider_query_identity_is_checked(self):
        self.manifest['queries'][0]['args']['contract_id'] = 1
        with self.assertRaisesRegex(qc.ContractError,'different provider contract'):
            self.validate()

    def test_manifest_malformed_shape_hard_fails(self):
        self.manifest['queries'][0] = 'not an object'
        with self.assertRaisesRegex(qc.ContractError,'query must be an object'):
            self.validate()

    def test_unbounded_declared_delay_is_not_accepted(self):
        self.row().update(source_delay_status='declared',source_delay_seconds=float('inf'))
        with self.assertRaisesRegex(qc.ContractError,'finite nonnegative'):
            self.validate()


if __name__ == '__main__':
    unittest.main()
