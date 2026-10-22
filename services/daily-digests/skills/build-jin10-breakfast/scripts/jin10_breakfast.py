#!/usr/bin/env python3
"""Jin10 V3 beige layout + evidence-verified Market Watch. No email or scheduling."""
import argparse
import base64
from copy import deepcopy
from datetime import datetime, date, timezone
from html import escape
import json
from pathlib import Path
import re
import sys
import uuid
from lxml import html
import jin10_source as source
import market_module
import quote_contract

ROOT = Path(__file__).resolve().parents[1]

def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

def body_plain_text(node):
    """Keep all text nodes, including direct div text and nested list contents."""
    blocks={'div','p','h2','h3','h4','li','blockquote','ol','ul'}
    out=[]
    def walk(n):
        if n.text:
            out.append(n.text)
        for child in n:
            if child.tag in blocks and out and not out[-1].endswith('\n'):
                out.append('\n\n')
            if child.tag=='br':
                out.append('\n')
            else:
                walk(child)
            if child.tag in blocks:
                out.append('\n\n')
            if child.tail:
                out.append(child.tail)
    walk(node)
    return re.sub(r'\n[ \t]*\n(?:[ \t]*\n)+','\n\n',''.join(out)).strip()

def remove_table(record):
    record = deepcopy(record)
    body = source.parse_dom(record['article_html'])
    tables = body.xpath('.//figure[@id="closing-table"]')
    if len(tables) != 1:
        raise source.Failure('structure_error', 'Expected exactly the identified closing-table figure')
    if tables[0].text_content().strip():
        raise source.Failure('structure_error', 'Closing table contains unexpected prose; do not delete it')
    tables[0].drop_tree()
    if body.xpath('.//img'):
        raise source.Failure('structure_error', 'Unexpected source image remains')
    if [n.text_content() for n in body.xpath('.//p')] != record['paragraphs'] or [n.text_content() for n in body.xpath('.//strong|.//b')] != record['bold_spans']:
        raise source.Failure('validation_error', 'News changed while removing image')
    record['article_html'] = html.tostring(body, encoding='unicode')
    record['body_text'] = body.text_content()
    record['removed_source_graphic'] = 'figure#closing-table'
    record.pop('table_source_url', None)
    return record

def prepare(args):
    target = args.date or datetime.now(source.BJ).date().isoformat()
    date.fromisoformat(target)
    out = Path(args.out)
    if out.exists() and any(out.iterdir()):
        raise source.Failure('output_exists', 'Use a new output directory')
    out.mkdir(parents=True, exist_ok=True)
    status = {'schema':'jin10-market-breakfast/1','target_date':target,'ready':False,
              'mode':'historical' if args.date else 'today','created_at':datetime.now(timezone.utc).isoformat()}
    try:
        urls = [source.safe_url(args.source_url)] if args.source_url else source.discover(
            Path(args.topic_html).read_bytes() if args.topic_html else source.fetch(source.TOPIC), target, bool(args.date))
        if args.article_html and (len(urls)!=1 or not args.source_url):
            raise source.Failure('input_error','Saved HTML needs its verified source URL')
        records = []
        for url in urls:
            raw = Path(args.article_html).read_bytes() if args.article_html else source.fetch(url)
            records.append(remove_table(source.parse_article(raw,url,target)))
        record = max(records, key=lambda x:x['publication_beijing'])
        write_json(out/'news.json', record)
        status.update(status='awaiting_market_data', source_url=record['source_url'],
            reason='News verified without downloading any article image. Obtain fresh evidence-backed market quotes next.',
            news_sha256=source.sha((out/'news.json').read_bytes()), article_image_fetches=0)
    except source.Failure as exc:
        status.update(status=exc.status,reason=str(exc))
    write_json(out/'status.json',status)
    print(json.dumps(status,ensure_ascii=False,indent=2))
    return 0 if status['status']=='awaiting_market_data' else (10 if status['status']=='no_update' else 20)

def build(record, market, masthead):
    body = source.parse_dom(record['article_html'])
    fragment, market_text = market_module.render(market)
    headings = body.xpath('.//h2')
    if not headings or headings[0].text_content() != '今日优选':
        raise source.Failure('structure_error','Missing insertion anchor 今日优选')
    headings[0].addprevious(html.fragment_fromstring(fragment))
    body_html = (body.text or '')+''.join(html.tostring(c,encoding='unicode',with_tail=True) for c in body)
    content = '<div id="original-content"><h1 class="original-title" style="margin:0 0 17px;font-size:23px;line-height:1.65;font-weight:600;letter-spacing:.1px;color:#282622;">'+escape(record['title'])+'</h1>\n'
    content += '<div class="source-introduction" style="margin:0 0 27px;font-size:15px;line-height:1.95;color:#827563;">'+escape(record['introduction'])+'</div>\n'+body_html
    content += '<div class="source-disclaimer" style="margin:30px 0 0;padding:21px 0 0;border-top:1px solid #e3d9c9;font-size:11px;line-height:1.95;color:#918574;">'+escape(record['disclaimer'])+'</div></div>'
    d = date.fromisoformat(record['date'])
    cn = '%d年%d月%d日' % (d.year,d.month,d.day)
    template = (ROOT/'assets/template-v3.html').read_text(encoding='utf-8')
    values = {'{{DATE}}':cn,'{{ORIGINAL_CONTENT}}':content,'{{MASTHEAD}}':'data:image/png;base64,'+base64.b64encode(masthead).decode(),
              '{{SOURCE_URL}}':escape(record['source_url'],quote=True),'{{PUBLICATION}}':cn+' '+record['publication_beijing'].split(' ')[1]}
    for k,v in values.items():
        template=template.replace(k,v)
    template = template.replace('</style>','@media only screen and (max-width:480px){.market-value{font-size:15px!important}}\n</style>')
    dom = source.parse_dom(template)
    original = dom.get_element_by_id('original-content')
    if [n.text_content() for n in original.xpath('.//p')] != record['paragraphs'] or [n.text_content() for n in original.xpath('.//strong|.//b')] != record['bold_spans']:
        raise source.Failure('validation_error','News paragraphs/emphasis changed')
    if original.xpath('.//img') or len(dom.xpath('//img')) != 1:
        raise source.Failure('validation_error','Only approved masthead art may remain')
    if len(original.xpath('.//section[@id="market-watch"]'))!=1:
        raise source.Failure('validation_error','Missing/duplicate Market Watch')
    # Compare all original news text, independently of the new market section.
    source_body = source.parse_dom(record['article_html'])
    check_body = deepcopy(body)
    check_body.get_element_by_id('market-watch').drop_tree()
    if source_body.text_content() != check_body.text_content():
        raise source.Failure('validation_error','Original body text changed')
    if re.search(r'\{\{[A-Z_]+\}\}',template):
        raise source.Failure('validation_error','Unresolved template token')
    text = [record['title'],record['introduction'].strip(),market_text]
    text += [body_plain_text(source_body)]
    text += [record['disclaimer'].strip(),'来源：金十数据',record['source_url'],'原文发布于 '+values['{{PUBLICATION}}']]
    return template,'\n\n'.join(text)+'\n'

def render(args):
    out = Path(args.out)
    status = json.loads((out/'status.json').read_text(encoding='utf-8'))
    record = json.loads((out/'news.json').read_text(encoding='utf-8'))
    if status.get('news_sha256') != source.sha((out/'news.json').read_bytes()):
        raise source.Failure('validation_error','News input changed after verification')
    if status['mode']=='today' and record['date'] != datetime.now(source.BJ).date().isoformat():
        raise source.Failure('date_mismatch','Midnight crossed; refetch today news')
    if args.preview_only:
        if not args.quotes or not args.evidence_root:
            raise source.Failure('input_error','Historical/layout preview needs explicit --quotes and --evidence-root')
        quote_path = Path(args.quotes)
        snapshot = json.loads(quote_path.read_text(encoding='utf-8'))
        market = market_module.normalize(snapshot, Path(args.evidence_root))
    else:
        if not args.market_run or args.quotes or args.evidence_root:
            raise source.Failure('market_data_error','Current generation requires --market-run with fresh request, calendar and evidence; raw snapshot bypass is forbidden')
        quote_path = Path(args.market_run)/'quotes.json'
        snapshot = json.loads(quote_path.read_text(encoding='utf-8'))
        try:
            market = quote_contract.validate_run(Path(args.market_run))
        except (ValueError, KeyError, OSError, TypeError) as exc:
            raise source.Failure('market_data_error',str(exc)) from exc
    standalone, text = build(record,market,(ROOT/'assets/masthead.png').read_bytes())
    preview = args.preview_only or market['verified_count']==0
    stem = 'layout-preview' if preview else 'breakfast'
    (out/(stem+'.html')).write_text(standalone, encoding='utf-8')
    (out/(stem+'.txt')).write_text(text, encoding='utf-8')
    email = re.sub(r'src="data:image/png;base64,[^"]+"','src="cid:jin10-masthead-art"',standalone)
    (out/(stem+'-email.html')).write_text(email, encoding='utf-8')
    (out/'jin10-masthead-art.png').write_bytes((ROOT/'assets/masthead.png').read_bytes())
    write_json(out/'market-verified.json',market)
    write_json(out/'inline-attachments.json',[{'path':'jin10-masthead-art.png','path_base':'manifest_directory','filename':'jin10-masthead-art.png','content_id':'jin10-masthead-art','mime_type':'image/png','disposition':'inline'}])
    status.update(status='preview_only' if args.preview_only else market['status'],ready=not preview,
        reason='Original news verified; each displayed quote is tied to this run’s retained evidence, date, and change baseline.',
        original_news_text_exact=True,news_paragraphs=len(record['paragraphs']),bold_spans=len(record['bold_spans']),
        image_count=1,closing_table_removed=True,market_before_today_picks=True,verified_quote_count=market['verified_count'],
        missing_quotes=[{'id':r['id'],'reason':r['reason']} for r in market['quotes'] if r['status']!='verified'],
        market_snapshot_sha256=source.sha(quote_path.read_bytes()),
        rendered_at=datetime.now(timezone.utc).isoformat(),files=[stem+'.html',stem+'.txt',stem+'-email.html','market-verified.json','inline-attachments.json'])
    write_json(out/'status.json',status)
    print(json.dumps(status,ensure_ascii=False,indent=2))
    return 20 if not market['verified_count'] else 0

def main():
    parser=argparse.ArgumentParser()
    sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('prepare')
    p.add_argument('--out',required=True)
    p.add_argument('--date')
    p.add_argument('--source-url')
    p.add_argument('--topic-html')
    p.add_argument('--article-html')
    p=sub.add_parser('render')
    p.add_argument('--out',required=True)
    p.add_argument('--market-run',help='Current-run directory created by quote_contract.py init')
    p.add_argument('--quotes',help='Historical/layout preview input only')
    p.add_argument('--evidence-root',help='Historical/layout preview evidence root only')
    p.add_argument('--preview-only',action='store_true')
    args=parser.parse_args()
    try:
        return prepare(args) if args.command=='prepare' else render(args)
    except (source.Failure,ValueError,OSError,KeyError) as exc:
        failure={'ready':False,'status':getattr(exc,'status','input_error'),'reason':str(exc)}
        if args.command=='render' and Path(args.out).exists():
            # A rejected new attempt must never leave an old ready=true behind.
            previous=json.loads((Path(args.out)/'status.json').read_text(encoding='utf-8')) if (Path(args.out)/'status.json').exists() else {}
            previous.update(failure)
            write_json(Path(args.out)/'status.json',previous)
        print(json.dumps(failure,ensure_ascii=False))
        return 20

if __name__=='__main__':
    sys.exit(main())
