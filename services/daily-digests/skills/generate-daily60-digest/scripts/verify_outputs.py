#!/usr/bin/env python3
"""Check source fidelity and render desktop/mobile previews; never send or fetch news."""
import argparse
import html
import json
import re
from pathlib import Path


def verify(html_path, news_path, calendar_path, outdir, pdf_path=None):
    from weasyprint import HTML, CSS
    import fitz
    source = Path(html_path).read_text(encoding='utf-8')
    data = json.loads(Path(news_path).read_text(encoding='utf-8'))
    calendar = json.loads(Path(calendar_path).read_text(encoding='utf-8'))
    items = [html.unescape(n) for n in re.findall(r'<p class="news-item"[^>]*>(.*?)</p>',source,re.S)]
    assert items == data['news'], 'News text or order changed'
    assert re.findall(r'data-item="(\d+)"',source) == [str(i) for i in range(1,len(items)+1)]
    assert data['date'] in source and calendar['gregorian_date'] == data['date']
    assert calendar['weekday'] in source and calendar['lunar_year']+calendar['lunar_date'] in source
    tips = re.findall(r'<p class="daily-tip"[^>]*>(.*?)</p>',source,re.S)
    assert ([html.unescape(t) for t in tips] == ([data['tip']] if data.get('tip','').strip() else []))
    assert 'source-button' not in source and '阅读当日原文' not in source
    assert '未独立核验报道' not in source and '据当日 JSON 文字排版' not in source
    assert '来源：60s 每日新闻 · '+data['date'] in source
    assert 'padding:16px 0' in source and '.story{padding:14px 0!important}' in source
    assert 'font-size:16px;line-height:1.8' in source
    assert len(re.findall(r'<img\s',source)) == 1 and 'src="data:image/png;base64,' in source
    outdir = Path(outdir);outdir.mkdir(parents=True,exist_ok=True)
    report = {'date':data['date'],'news_count':len(items),'exact_text_and_order':True,'tip_and_dates_exact':True,
              'source_button_absent':True,'grey_note_absent':True,'renderer':'WeasyPrint (not a mail-client test)','viewports':{}}
    for name,width in [('desktop',800),('mobile',390),('small-mobile',320)]:
        css = f'@page{{size:{width}px 30000px;margin:0}}html,body{{margin:0;padding:0}}'
        if width < 480:
            css += re.search(r'@media only screen and \(max-width:480px\)\{(.*?)\}\s*</style>',source,re.S).group(1)
        css += 'td{text-align:left}td[align=right]{text-align:right}td[align=center]{text-align:center}.masthead,.content,.footer{text-align:left}'
        css += f'.paper{{width:{min(640,width-20 if width<480 else width-40)}px!important;margin-left:auto;margin-right:auto}}'
        doc = HTML(string=source,media_type='screen').render(stylesheets=[CSS(string=css)],presentational_hints=True)
        assert len(doc.pages)==1,'Preview too tall'
        boxes = list(doc.pages[0]._page_box.descendants())
        height = int(max(b.position_y+b.height for b in boxes if b.element_tag=='table')+1)
        overflow=[b.text for b in boxes if b.__class__.__name__=='TextBox' and (b.position_x<-.5 or b.position_x+b.width>width+.5)]
        assert not overflow,f'{name} horizontal overflow: {overflow}'
        pdf=fitz.open(stream=doc.write_pdf(),filetype='pdf')
        pdf[0].get_pixmap(matrix=fitz.Matrix(4/3,4/3),clip=fitz.Rect(0,0,width*.75,height*.75),alpha=False).save(str(outdir/(name+'.png')))
        report['viewports'][name]={'width_px':width,'height_px':height,'horizontal_overflow':False}
    if pdf_path:
        pdf = fitz.open(pdf_path)
        text=''.join(p.get_text() for p in pdf)
        normalize=lambda x:re.sub(r'\s+','',x)
        normalized=normalize(text)
        for n in data['news']:
            assert normalize(n) in normalized,'PDF missing news item: '+n[:30]
        for s in [data['date'],calendar['weekday'],calendar['lunar_year']+calendar['lunar_date']]+([data['tip']] if data.get('tip','').strip() else []):
            assert normalize(s) in normalized,'PDF missing date/tip: '+s
        for i,page in enumerate(pdf,1):
            page.get_pixmap(matrix=fitz.Matrix(1,1),alpha=False).save(str(outdir/f'pdf-page-{i}.png'))
        report['pdf']={'pages':len(pdf),'all_news_and_tip_dates_extractable':True,'rendered_pages':len(pdf)}
    (outdir/'qa-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('html',type=Path);parser.add_argument('--news',type=Path,required=True)
    parser.add_argument('--calendar',type=Path,required=True);parser.add_argument('--outdir',type=Path,required=True)
    parser.add_argument('--pdf',type=Path)
    args=parser.parse_args()
    print(json.dumps(verify(args.html,args.news,args.calendar,args.outdir,args.pdf),ensure_ascii=False,indent=2))


if __name__=='__main__':main()
