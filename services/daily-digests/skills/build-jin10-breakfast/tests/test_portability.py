import json,re,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import jin10_source as s
import jin10_breakfast as j
from types import SimpleNamespace
ROOT=Path(__file__).resolve().parents[1]
class PortabilityTests(unittest.TestCase):
 def test_nuxt_dollar_identifier(self):
  d=s.parse_dom('<html><script>window.__NUXT__=(function(a){var $={};$.id=233030;$.title=a;$.display_datetime="2026-10-22 06:59:36";return $;}("Title"));</script></html>')
  self.assertEqual(s.nuxt_metadata(d,'233030')['title'],'Title')
 def test_plaintext_keeps_all_nested_text_without_duplicates(self):
  d=s.parse_dom('<div>直接文字<h3>子标题</h3><ul><li><p>列表<strong>粗体</strong>尾字</p></li></ul>末尾</div>')
  result=j.body_plain_text(d)
  norm=lambda x:re.sub(r'\s+','',x)
  self.assertEqual(norm(result),norm(d.text_content()))
  self.assertEqual(result.count('列表'),1)
 def test_news_matches_confirmed_fulltext(self):
  raw=(ROOT/'tests/fixtures/article-2026-10-22.html').read_bytes()
  rec=j.remove_table(s.parse_article(raw,'https://xnews.jin10.com/details/233030','2026-10-22'))
  self.assertEqual(len(rec['paragraphs']),38);self.assertEqual(len(rec['bold_spans']),17)
  self.assertEqual(rec['headings'],['今日优选','市场盘点','国际要闻','国内要闻','风险预警'])
  self.assertIn('风险提示及免责条款',rec['disclaimer'])
 def test_wrong_date_rejected(self):
  with self.assertRaises(s.Failure):s.parse_article((ROOT/'tests/fixtures/article-2026-10-22.html').read_bytes(),'https://xnews.jin10.com/details/233030','2026-10-23')
 def test_no_active_or_audio_content(self):
  rec=j.remove_table(s.parse_article((ROOT/'tests/fixtures/article-2026-10-22.html').read_bytes(),'https://xnews.jin10.com/details/233030','2026-10-22'))
  d=s.parse_dom(rec['article_html']);self.assertFalse(d.xpath('.//img|.//audio|.//script|.//iframe'))
  self.assertNotIn('.mp3',rec['article_html'])
 def test_non_table_caption_prose_survives(self):
  raw=(ROOT/'tests/fixtures/article-2026-10-22.html').read_text()
  dom=s.parse_dom(raw);article=s.one(dom,'jin10-news-cdetails-article')
  fragment=s.html.fragment_fromstring('<figure><img src="https://img.jin10.com/news/test.png"><figcaption>不可丢失的补充正文</figcaption></figure>')
  article.append(fragment);body,_=s.clean_body(article)
  self.assertIn('不可丢失的补充正文',body.text_content())
 def test_source_url_restriction(self):
  for url in ['http://xnews.jin10.com/details/1','https://evil.example/details/1','https://xnews.jin10.com/details/1?secret=x']:
   with self.assertRaises(s.Failure):s.safe_url(url)
if __name__=='__main__':unittest.main()
