"""One bounded, public-data-only job. Host owns schedules and durable snapshots."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stdout
from datetime import date, datetime, timezone, timedelta
from io import StringIO
import json
from pathlib import Path
import sys
from types import SimpleNamespace
from network import install_routes

ROOT = Path(__file__).resolve().parent
BJ = timezone(timedelta(hours=8))


def generate(kind, target, out):
    common = {'id': kind, 'editionDate': target, 'sourceDate': target, 'quality': 'ready', 'warnings': []}
    if kind == 'aibase':
        sys.path.insert(0, str(ROOT/'skills/aibase-daily/scripts'))
        import aibase_daily as skill
        document = skill.select_article(date.fromisoformat(target))
        skill.validate(document, date.fromisoformat(target))
        paths = skill.write_outputs(document, date.fromisoformat(target), out/'source', target != datetime.now(BJ).date().isoformat())
        common.update(sourceUrl=document['source_url'], html=Path(paths['html']).read_text(encoding='utf-8'),
                      text=Path(paths['txt']).read_text(encoding='utf-8'), data=document, itemCount=len(document['items']))
    elif kind == 'daily60':
        sys.path.insert(0, str(ROOT/'skills/generate-daily60-digest/scripts'))
        import daily60 as skill
        with ThreadPoolExecutor(max_workers=2) as pool:
            news = pool.submit(skill.fetch, target)
            calendar = pool.submit(skill.fetch_calendar, target)
            document, url, failures, checksum = news.result()
            calendar = calendar.result()
        skill.validate(document, target)
        skill.validate_calendar(calendar, target)
        common.update(sourceUrl=url, html=skill.render(document, target, url, None, 'embedded', calendar),
            text=skill.text_version(document, calendar), itemCount=len(document['news']),
            data={'news': {k: document[k] for k in ('date', 'news', 'tip', 'link', 'created', 'updated') if k in document},
                  'calendar': calendar, 'source_url': url, 'input_sha256': checksum, 'fallback_attempts': failures})
    else:
        sys.path.insert(0, str(ROOT/'skills/build-jin10-breakfast/scripts'))
        import jin10_breakfast as skill
        news_out = out/'source'
        result = skill.prepare(SimpleNamespace(date=target, out=str(news_out), source_url=None, topic_html=None, article_html=None))
        status = json.loads((news_out/'status.json').read_text(encoding='utf-8'))
        if result:
            raise skill.source.Failure(status['status'], status['reason'])
        document = json.loads((news_out/'news.json').read_text(encoding='utf-8'))
        # The host collects public-market references once alongside this job,
        # then commits news and quotes as one immutable daily edition.
        from html import escape
        markup = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>'+escape(document['title'])+'</title></head><body><h1>'+escape(document['title'])+'</h1><p>'+escape(document['introduction'])+'</p>'+document['article_html']+'<p>'+escape(document['disclaimer'])+'</p></body></html>'
        common.update(sourceUrl=document['source_url'], html=markup,
            text='\n\n'.join([document['title'], document['introduction'], skill.body_plain_text(skill.source.parse_dom(document['article_html'])), document['disclaimer'], document['source_url']]),
            itemCount=len(document['paragraphs']), data={'news': document})
    common['generatedAt'] = datetime.now(timezone.utc).isoformat()
    return common


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--id', choices=['jin10', 'aibase', 'daily60'], required=True)
    parser.add_argument('--date', required=True, type=date.fromisoformat)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    install_routes()
    try:
        with redirect_stdout(StringIO()):
            result = generate(args.id, args.date.isoformat(), args.out)
        temporary = args.out/'bundle.tmp'
        temporary.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
        temporary.replace(args.out/'bundle.json')
        print(json.dumps({'ready': True, 'id': args.id, 'date': args.date.isoformat()}, ensure_ascii=False))
        return 0
    except Exception as error:
        waiting = type(error).__name__ == 'NoArticle' or getattr(error, 'status', None) == 'no_update'
        message = ('来源尚未发布目标日期内容：' if waiting else '来源抓取或校验失败：') + str(error)
        (args.out/'failure.json').write_text(json.dumps({'waiting': waiting, 'error': message}, ensure_ascii=False), encoding='utf-8')
        print(message, file=sys.stderr)
        return 10 if waiting else 20


if __name__ == '__main__':
    sys.exit(main())
