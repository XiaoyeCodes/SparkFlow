#!/usr/bin/env python3
"""Optional native-text PDF export from the same standalone email HTML; offline."""
import argparse,json,re,sys
from pathlib import Path

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--html',required=True);p.add_argument('--out',required=True);p.add_argument('--qa-dir');p.add_argument('--news-json',help='Optional parsed news JSON for complete text-fidelity checks');a=p.parse_args()
 try:
  from weasyprint import HTML,CSS
  from weasyprint.urls import URLFetcher
  import fitz
 except ImportError as e:
  raise SystemExit('PDF dependencies missing. Install requirements-pdf.txt and a CJK font; HTML remains usable. '+str(e))
 src=Path(a.html).resolve();out=Path(a.out).resolve();out.parent.mkdir(parents=True,exist_ok=True)
 content=src.read_text(encoding='utf-8')
 if 'cid:' in content:raise SystemExit('Use standalone HTML, not the CID email variant.')
 offline_fetch=URLFetcher(allowed_protocols={'data'},allow_redirects=False,fail_on_errors=True)
 css='''@page { size:A4; margin:12mm 14mm; @bottom-center { content:counter(page) " / " counter(pages); font-size:8pt; color:#918574; } }
 html,body { margin:0 !important; padding:0 !important; background:#FCFAF6 !important; }
 body { font-family:"Noto Sans CJK SC","Microsoft YaHei","PingFang SC",Arial,sans-serif !important; }
 .outer { padding:0 !important; } body > table { width:100% !important; }
 body > table > tbody > tr > td > table, body > table > tr > td > table { width:640px !important; max-width:100% !important; margin:auto; }
 table,tbody,tr,td { break-inside:auto; } #market-watch { break-inside:avoid; }
 .content { padding:28px 36px !important; }
 h1,h2,h3,h4 { break-after:avoid; }
 h2.section-heading { margin-top:24px !important; margin-bottom:14px !important; padding-top:18px !important; }
 p { orphans:2; widows:2; margin-bottom:14px !important; line-height:1.85 !important; }
 td { text-align:left; } td[align=right] { text-align:right; } td[align=center] { text-align:center; }
 '''
 HTML(string=content,base_url=src.parent.as_uri(),url_fetcher=offline_fetch).write_pdf(str(out),stylesheets=[CSS(string=css)],presentational_hints=True)
 doc=fitz.open(out);text='\n'.join(pg.get_text(clip=fitz.Rect(0,0,pg.rect.width,pg.rect.height-24)) for pg in doc)
 if len(re.findall(r'[\u4e00-\u9fff]',text))<100:raise SystemExit('PDF failed native Chinese text check; verify installed CJK fonts.')
 fonts={f[3] for pg in doc for f in pg.get_fonts()};images=[len(pg.get_images()) for pg in doc]
 if a.news_json:
  record=json.loads(Path(a.news_json).read_text());norm=lambda s:re.sub(r'\s+','',s);flat=norm(text)
  blocks=[record['title'],record['introduction'],record['body_text'],*record['paragraphs'],record['disclaimer']]
  missing=[i for i,b in enumerate(blocks) if norm(b) not in flat]
  if missing:raise SystemExit('PDF lost original text blocks: '+str(missing))
 qa={'pages':len(doc),'native_chinese_characters':len(re.findall(r'[\u4e00-\u9fff]',text)),'fonts':sorted(fonts),'page_image_counts':images,'all_fonts_embedded':all(bool(doc.extract_font(f[0])[3]) for pg in doc for f in pg.get_fonts()),'text_not_screenshot':True,'full_news_text_verified':bool(a.news_json)}
 if a.qa_dir:
  q=Path(a.qa_dir);q.mkdir(parents=True,exist_ok=True)
  for i,pg in enumerate(doc):pg.get_pixmap(matrix=fitz.Matrix(1.25,1.25),alpha=False).save(q/('page-%02d.png'%(i+1)))
  (q/'extracted.txt').write_text(text,encoding='utf-8');(q/'pdf-qa.json').write_text(json.dumps(qa,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(qa,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
