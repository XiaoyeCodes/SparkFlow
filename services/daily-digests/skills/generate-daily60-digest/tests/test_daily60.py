import io, json, unittest
from unittest.mock import patch
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import daily60 as m

class Response(io.BytesIO):
    status=200

class Tests(unittest.TestCase):
    def good(self, count=15):
        return {'date':'2026-10-22','news':[f'事实条目 {i}' for i in range(count)],'link':'https://example.com/article'}
    def test_dynamic_news_count(self):
        self.assertEqual(len(m.validate(self.good(17),'2026-10-22')),17)
    def test_stale_date_rejected(self):
        with self.assertRaises(ValueError): m.validate(self.good(),'2026-10-23')
    def test_bad_news_rejected(self):
        for v in [[], None, 'news', [''], [42]]:
            d=self.good(); d['news']=v
            with self.assertRaises(ValueError):m.validate(d,'2026-10-22')
    def test_fallback_after_stale_primary(self):
        bad=self.good();bad['date']='2026-10-21'
        with patch('urllib.request.urlopen',side_effect=[Response(json.dumps(bad).encode()),Response(json.dumps(self.good()).encode())]):
            d,u,errors,_=m.fetch('2026-10-22')
        self.assertEqual(d['date'],'2026-10-22'); self.assertIn('raw.githubusercontent.com',u); self.assertEqual(len(errors),1)
    def test_fallback_after_failed_primary(self):
        with patch('urllib.request.urlopen',side_effect=[OSError('offline'),Response(json.dumps(self.good()).encode())]):
            d,u,errors,_=m.fetch('2026-10-22')
        self.assertIn('raw.githubusercontent.com',u);self.assertEqual(len(errors),1)
    def test_stop_when_both_fail(self):
        with patch('urllib.request.urlopen',side_effect=OSError('offline')):
            with self.assertRaises(RuntimeError):m.fetch('2026-10-22')
    def test_official_calendar_fields(self):
        raw={'LunarYear':'丙午年，馬','LunarDate':'九月十三'}
        with patch('urllib.request.urlopen',return_value=Response(json.dumps(raw).encode())) as mock:
            c=m.fetch_calendar('2026-10-22')
        self.assertEqual(c['lunar_year']+c['lunar_date'],'丙午年九月十三')
        self.assertEqual(c['weekday'],'星期四')
        self.assertIn('date=2026-10-22',mock.call_args.args[0])
    def test_calendar_changes_each_date(self):
        raw={'LunarYear':'丙午年，馬','LunarDate':'九月十四'}
        with patch('urllib.request.urlopen',return_value=Response(json.dumps(raw).encode())) as mock:
            c=m.fetch_calendar('2026-10-23')
        self.assertEqual(c['lunar_date'],'九月十四')
        self.assertEqual(c['weekday'],'星期五')
        self.assertIn('date=2026-10-23',mock.call_args.args[0])
    def test_missing_calendar_fields_rejected(self):
        with patch('urllib.request.urlopen',return_value=Response(b'{}')):
            with self.assertRaises(ValueError):m.fetch_calendar('2026-10-22')



class PortableTests(unittest.TestCase):
    def setUp(self):
        root=Path(__file__).resolve().parents[1]
        self.data=json.loads((root/'sample/input/news-2026-10-22.json').read_text())
        self.calendar=json.loads((root/'sample/input/calendar-2026-10-22.json').read_text())
    def test_beijing_day_boundary(self):
        import datetime as dt
        self.assertEqual(m.beijing_today(dt.datetime(2026,10,21,15,59,tzinfo=dt.timezone.utc)),'2026-10-21')
        self.assertEqual(m.beijing_today(dt.datetime(2026,10,21,16,0,tzinfo=dt.timezone.utc)),'2026-10-22')
    def test_calendar_record_mismatch(self):
        for key,value in [('gregorian_date','2026-10-21'),('weekday','星期五'),('lunar_date','九月十四'),('source_url','https://example.com')]:
            c=dict(self.calendar);c[key]=value
            with self.assertRaises(ValueError):m.validate_calendar(c,'2026-10-22')
    def test_bad_tip_rejected(self):
        self.data['tip']=123
        with self.assertRaises(ValueError):m.validate(self.data,'2026-10-22')
    def test_empty_tip_not_invented(self):
        self.data.pop('tip',None)
        out=m.render(self.data,'2026-10-22','https://example.com',None,calendar=self.calendar)
        self.assertNotIn('class="daily-tip"',out)
    def test_escaping(self):
        self.data['news'][0]='<script>alert("x")</script>'
        out=m.render(self.data,'2026-10-22','https://example.com',None,calendar=self.calendar)
        self.assertNotIn('<script>',out);self.assertIn('&lt;script&gt;',out)
    def test_approved_layout_and_exact_items(self):
        import re,html
        out=m.render(self.data,'2026-10-22','https://example.com',None,calendar=self.calendar)
        items=[html.unescape(n) for n in re.findall(r'<p class="news-item"[^>]*>(.*?)</p>',out,re.S)]
        self.assertEqual(items,self.data['news'])
        for removed in ['source-button','未独立核验报道','阅读当日原文']:
            self.assertNotIn(removed,out)
        self.assertIn('padding:16px 0',out);self.assertIn('.story{padding:14px 0!important}',out)
        self.assertIn(self.data['tip'],out)
    def test_dynamic_render_count(self):
        self.data['news']+=['补充事实一','补充事实二']
        out=m.render(self.data,'2026-10-22','https://example.com',None,calendar=self.calendar)
        self.assertIn('17 条新闻',out);self.assertIn('data-item="17"',out)
    def test_source_tokens_remain_literal(self):
        self.data['news'][0]='事实 {{LUNAR_DATE}} {{HEADER_ART}} {{NOT_A_TEMPLATE_KEY}}'
        self.data['tip']='寄语 {{DATE}} {{DAILY_TIP}}'
        out=m.render(self.data,'2026-10-22','https://example.com',None,calendar=self.calendar)
        self.assertIn(self.data['news'][0],out)
        self.assertIn(self.data['tip'],out)
        self.assertEqual(out.count('<img '),1)
    def test_offline_main_no_network(self):
        import tempfile,contextlib
        root=Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmp,patch('urllib.request.urlopen',side_effect=AssertionError('Offline must not fetch')),contextlib.redirect_stdout(io.StringIO()):
            code=m.main(['--date','2026-10-22','--input',str(root/'sample/input/news-2026-10-22.json'),'--calendar-input',str(root/'sample/input/calendar-2026-10-22.json'),'--outdir',tmp,'--email-html'])
            self.assertEqual(code,0)
            manifest=json.loads((Path(tmp)/'daily60-2026-10-22.manifest.json').read_text())
            self.assertFalse(manifest['email_sent']);self.assertFalse(manifest['schedule_installed'])
            self.assertEqual(manifest['status'],'success')
            self.assertNotIn('image',json.loads((Path(tmp)/'daily60-2026-10-22.json').read_text()))
            self.assertTrue((Path(tmp)/'daily60-2026-10-22.email.html').exists())
    def test_offline_stale_input_fails_before_output(self):
        import tempfile,contextlib
        root=Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmp,contextlib.redirect_stderr(io.StringIO()):
            out=Path(tmp)/'out'
            code=m.main(['--date','2026-10-23','--input',str(root/'sample/input/news-2026-10-22.json'),'--calendar-input',str(root/'sample/input/calendar-2026-10-22.json'),'--outdir',str(out)])
            self.assertEqual(code,1);self.assertFalse(out.exists())

if __name__=='__main__':unittest.main()
