import unittest,json,sys,copy
from hashlib import sha256
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import market_module as m
import jin10_breakfast as j
import jin10_source as s
ROOT=Path(__file__).resolve().parents[1]
class MarketTests(unittest.TestCase):
 def setUp(self):
  self.data=json.loads((ROOT/'examples/historical-2026-10-22/quotes.json').read_text())
 def norm(self): return m.normalize(self.data,ROOT/'examples/historical-2026-10-22')
 def test_all_verified_and_calculations(self):
  out=self.norm(); self.assertEqual(out['verified_count'],9)
  by={r['id']:r for r in out['quotes']}
  self.assertEqual(m.signed(by['COMP']['change_pct']),'+1.05%')
  self.assertEqual(m.signed(by['US10Y']['change_bp'],' bp'),'+1.00 bp')
 def test_no_quotes_is_failure(self):
  self.data['quotes']=[]; self.assertEqual(self.norm()['status'],'market_data_error')
 def test_stale_quote_unavailable(self):
  r=next(r for r in self.data['quotes'] if r['id']=='BTCUSD');r['quote_at']='2026-10-22T02:00:00Z'
  self.assertEqual(self.norm()['verified_count'],8)
 def test_future_quote_unavailable(self):
  r=next(r for r in self.data['quotes'] if r['id']=='BTCUSD');r['quote_at']='2026-10-22T05:00:00Z'
  self.assertEqual(self.norm()['verified_count'],8)
 def test_bad_baseline_not_displayed(self):
  self.data['quotes'][0]['baseline']='rolling_24h';self.assertEqual(self.norm()['verified_count'],8)
 def test_incomplete_session_not_used(self):
  self.data['quotes'][0]['asof_date']='2026-10-22';self.assertEqual(self.norm()['verified_count'],8)
 def test_duplicate_fails(self):
  self.data['quotes'].append(copy.deepcopy(self.data['quotes'][0]));self.assertRaises(ValueError,self.norm)
 def test_nan_missing(self):
  self.data['quotes'][0]['value']='NaN';self.assertEqual(self.norm()['verified_count'],8)
 def test_source_mismatch_missing(self):
  self.data['quotes'][0]['evidence_sha256']='x';self.assertEqual(self.norm()['verified_count'],8)
 def test_pct_disagreement_missing(self):
  self.data['quotes'][0]['provider_change_pct']=99;self.assertEqual(self.norm()['verified_count'],8)
 def test_simple_display_metadata_retained(self):
  verified=self.norm(); out,text=m.render(verified)
  self.assertNotIn('中间价',out);self.assertNotIn('1分钟收盘',out);self.assertNotIn('24小时',out);self.assertNotIn('CMT',out);self.assertNotIn('期货',out)
  self.assertEqual(next(r for r in verified['quotes'] if r['id']=='BTCUSD')['baseline'],'rolling_24h')
 def test_remove_only_target_and_keep_news(self):
  raw=(ROOT/'tests/fixtures/article-2026-10-22.html').read_bytes()
  old=s.parse_article(raw,'https://xnews.jin10.com/details/233030','2026-10-22')
  new=j.remove_table(old)
  self.assertEqual(new['paragraphs'],old['paragraphs']);self.assertEqual(new['bold_spans'],old['bold_spans'])
  out,text=j.build(new,self.norm(),(ROOT/'assets/masthead.png').read_bytes())
  d=s.parse_dom(out);self.assertEqual(len(d.xpath('//img')),1);self.assertFalse(d.xpath('//figure[@id="closing-table"]'))
  self.assertEqual(len(d.xpath('//section[@id="market-watch"]')),1)
  self.assertLess(out.index('id="market-watch"'),out.index('>今日优选</h2>'))
  self.assertEqual(len(d.xpath('//section[@id="market-watch"]//tbody/tr')),9)
 def test_negative_zero_neutral(self): self.assertEqual(m.signed('-.0001'),'0.00%')
 def pause_row(self):
  self.data['collected_at']='2026-10-22T04:10:00Z'
  r=next(r for r in self.data['quotes'] if r['id']=='SSE')
  evidence='evidence/schedule_and_treasury_web.json'
  r.update(fetched_at='2026-10-22T04:09:00Z',quote_at='2026-10-22T03:29:59Z',
   market_state='break',break_start_at='2026-10-22T11:30:00+08:00',break_end_at='2026-10-22T13:00:00+08:00',
   market_schedule_source_url='https://english.sse.com.cn/start/trading/schedule/',
   break_schedule_evidence_file=evidence,break_schedule_evidence_sha256=sha256((ROOT/'examples/historical-2026-10-22'/evidence).read_bytes()).hexdigest())
  return r
 def pause_status(self):return next(r for r in self.norm()['quotes'] if r['id']=='SSE')['status']
 def test_lunch_keeps_actual_morning_timestamp(self):
  self.pause_row();self.assertEqual(self.pause_status(),'verified')
 def test_lunch_stale_morning_quote_rejected(self):
  r=self.pause_row();r['quote_at']='2026-10-22T03:00:00Z';self.assertEqual(self.pause_status(),'unavailable')
 def test_lunch_unverified_schedule_rejected(self):
  r=self.pause_row();r.pop('break_schedule_evidence_file');self.assertEqual(self.pause_status(),'unavailable')
 def test_lunch_fabricated_window_rejected(self):
  r=self.pause_row();r['break_end_at']='2026-10-22T15:00:00+08:00';self.assertEqual(self.pause_status(),'unavailable')
 def test_lunch_post_pause_quote_rejected(self):
  r=self.pause_row();r['quote_at']='2026-10-22T04:00:00Z';self.assertEqual(self.pause_status(),'unavailable')
 def test_lunch_reopen_requires_fresh_quote(self):
  r=self.pause_row();self.data['collected_at']='2026-10-22T05:01:00Z';r['fetched_at']='2026-10-22T05:00:30Z';self.assertEqual(self.pause_status(),'unavailable')
 def test_sse_lunch_unspecified_delay_is_truthful(self):
  r=self.pause_row();r.update(quote_kind='delayed',delay_seconds=None,source_delay_status='declared_unspecified',delay_disclosure='Source declares delay without specifying its duration')
  self.assertEqual(self.pause_status(),'verified')
 def test_sse_lunch_undeclared_delay_rejected(self):
  r=self.pause_row();r.update(quote_kind='delayed',delay_seconds=None);r.pop('source_delay_status',None)
  self.assertEqual(self.pause_status(),'unavailable')
if __name__=='__main__':unittest.main()
