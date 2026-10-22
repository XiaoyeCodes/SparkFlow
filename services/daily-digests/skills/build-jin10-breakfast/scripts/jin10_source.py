#!/usr/bin/env python3
"""Verified Jin10 news parser. This module NEVER downloads article images."""
import argparse
import base64
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import hashlib
import html as html_std
import io
import json
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

from lxml import html

ROOT = Path(__file__).resolve().parents[1]
TOPIC = 'https://xnews.jin10.com/topic/343'
BJ = timezone(timedelta(hours=8))
SCHEMA = 'jin10-breakfast/1'
TITLE = re.compile(r'^金十数据全球财经早餐\s*[|｜]\s*(\d{4})年(\d{1,2})月(\d{1,2})日$')
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$')
AUDIO_LABELS = ['男生普通话版', '男声普通话版', '女声普通话版', '粤语版', '西南方言版', '东北话版', '上海话版', '下载mp3']
STYLE = {
    'p': 'margin:0 0 17px;font-size:15px;line-height:1.95;color:#48443e;word-wrap:break-word;overflow-wrap:anywhere;',
    'h2': 'margin:36px 0 23px;padding:23px 0 0;border-top:1px solid #d7cbb8;font-size:23px;line-height:1.5;font-weight:600;letter-spacing:1px;color:#282622;',
    'blockquote': 'margin:0 0 26px;padding:3px 0 1px 21px;border-left:2px solid #a9987d;',
    'strong': 'font-weight:600;color:#282622;',
    'b': 'font-weight:600;color:#282622;',
}

class Failure(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def sha(data):
    return hashlib.sha256(data).hexdigest()


def json_write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def class_nodes(node, name):
    return node.xpath('.//*[contains(concat(" ", normalize-space(@class), " "), " ' + name + ' ")]')


def one(node, name):
    found = class_nodes(node, name)
    if len(found) != 1:
        raise Failure('structure_error', 'Expected exactly one .' + name)
    return found[0]


def title_date(text):
    m = TITLE.fullmatch(text.strip())
    if not m:
        raise Failure('structure_error', 'Unexpected breakfast title: ' + text[:100])
    try:
        return date(*map(int, m.groups())).isoformat()
    except ValueError as exc:
        raise Failure('structure_error', 'Invalid title date') from exc


def safe_url(value, image=False):
    url = urllib.parse.urljoin(TOPIC, value)
    u = urllib.parse.urlsplit(url)
    allowed = {'img.jin10.com'} if image else {'xnews.jin10.com'}
    if (u.scheme != 'https' or u.hostname not in allowed or u.username or u.password
            or u.port not in (None, 443) or u.fragment or u.query
            or any(ord(c) < 32 for c in url)):
        raise Failure('unsafe_url', 'URL is outside the allowed HTTPS origin/path')
    pattern = r'/news/[A-Za-z0-9_./-]+\.(?:jpg|jpeg|png)' if image else r'/(?:topic/343|details/\d+)'
    if not re.fullmatch(pattern, u.path, re.I) or '..' in u.path.split('/'):
        raise Failure('unsafe_url', 'Unexpected source URL path')
    return url


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def __init__(self, image):
        self.image = image
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        safe_url(newurl, self.image)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url, image=False):
    url = safe_url(url, image)
    opener = urllib.request.build_opener(SafeRedirect(image))
    req = urllib.request.Request(url, headers={'User-Agent': 'Jin10BreakfastSkill/1.0 (read-only)', 'Accept': 'image/*' if image else 'text/html'})
    limit = 20_000_000 if image else 4_000_000
    try:
        with opener.open(req, timeout=25) as response:
            safe_url(response.geturl(), image)
            content_type = response.headers.get_content_type()
            if image and content_type not in ('image/jpeg', 'image/png', 'application/octet-stream'):
                raise Failure('access_error', 'Image response is not an image')
            if not image and content_type not in ('text/html', 'application/xhtml+xml'):
                raise Failure('access_error', 'Source response is not HTML')
            data = response.read(limit + 1)
            if len(data) > limit:
                raise Failure('access_error', 'Source exceeds size limit')
            return data
    except urllib.error.HTTPError as exc:
        raise Failure('access_error', 'HTTP %d for %s. Do not treat this as no update.' % (exc.code, url)) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise Failure('access_error', 'Network/TLS/timeout error for ' + url + ': ' + str(exc)) from exc


def parse_dom(data):
    try:
        text = data.decode('utf-8-sig') if isinstance(data, bytes) else data
        if '\ufffd' in text:
            raise ValueError('replacement characters')
        return html.fromstring(text)
    except (ValueError, UnicodeError) as exc:
        raise Failure('structure_error', 'Source is not valid UTF-8 HTML') from exc


def discover(topic_data, target, historical=False):
    dom = parse_dom(topic_data)
    rows = class_nodes(dom, 'jin10-news-list-item-title')
    if not rows:
        raise Failure('structure_error', 'Topic list is absent; possible access challenge or changed page')
    result = []
    dates = []
    for row in rows:
        text = row.text_content().strip()
        if not TITLE.fullmatch(text):
            continue
        d = title_date(text)
        dates.append(d)
        anchors = row.xpath('ancestor::a[@href][1]')
        if len(anchors) != 1:
            raise Failure('structure_error', 'Topic title is not attached to one article URL')
        url = safe_url(anchors[0].get('href'))
        if d == target and url not in result:
            result.append(url)
    if not dates:
        raise Failure('structure_error', 'No valid breakfast entries in topic list')
    if not result:
        if historical:
            raise Failure('date_not_found', 'Requested historical date is not in the loaded topic page. Supply its verified article URL; do not use a different date.')
        if max(dates) > target:
            raise Failure('date_mismatch', 'Topic contains a breakfast newer than the current Beijing date; verify host clock')
        raise Failure('no_update', 'No breakfast for today in the successfully loaded topic page')
    if len(result) > 5:
        raise Failure('structure_error', 'Too many same-date candidates')
    return result


def nuxt_metadata(dom, article_id):
    """Read only JSON literals and scalar assignments. Never execute page JavaScript."""
    scripts = [n.text for n in dom.xpath('//script') if n.text and n.text.startswith('window.__NUXT__=')]
    for script in scripts:
        m = re.fullmatch(r'window\.__NUXT__=\(function\(([^)]*)\)\{(.*)\}\((.*)\)\);?', script, re.S)
        if not m:
            continue
        try:
            args = json.loads('[' + m[3] + ']')
        except json.JSONDecodeError:
            continue
        names = m[1].split(',')
        if len(names) != len(args):
            continue
        bindings = dict(zip(names, args))
        objects = {}
        assignment = r'(?<![\w$])([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)=("(?:[^"\\]|\\.)*"|[A-Za-z_$][\w$]*|-?\d+(?:\.\d+)?);'
        for var, prop, value in re.findall(assignment, m[2]):
            try:
                decoded = json.loads(value)
            except json.JSONDecodeError:
                decoded = bindings.get(value)
            objects.setdefault(var, {})[prop] = decoded
        matches = [v for v in objects.values() if str(v.get('id')) == article_id and v.get('title')]
        if len(matches) == 1:
            return matches[0]
    raise Failure('structure_error', 'Cannot independently resolve article publication metadata from Nuxt; review changed structure')


def clean_body(source):
    body = deepcopy(source)
    # Find table semantically, not by image index or dated URL.
    candidates = []
    for image in body.xpath('.//img'):
        before = image.xpath('preceding::h2[1]')
        after = image.xpath('following::h2[1]')
        if before and after and before[0].text_content().strip() == '市场盘点' and after[0].text_content().strip() == '国际要闻':
            candidates.append(image)
    if len(candidates) != 1:
        raise Failure('structure_error', 'Cannot uniquely locate closing table between 市场盘点 and 国际要闻')
    selected = candidates[0]
    table_url = safe_url(selected.get('src', ''), image=True)
    figures = selected.xpath('ancestor::figure[1]')
    if len(figures) != 1 or len(figures[0].xpath('.//img')) != 1:
        raise Failure('structure_error', 'Closing table figure structure changed')
    keep = figures[0]
    if keep.text_content().strip():
        raise Failure('structure_error', 'Closing-table figure contains prose; review instead of silently removing it')
    for node in list(body.xpath('.//*[contains(concat(" ",normalize-space(@class)," ")," insert-audio ")]')):
        # Known audio row only. Unexpected accompanying prose requires review.
        text = node.text_content().strip()
        residual = text
        for label in AUDIO_LABELS:
            residual = residual.replace(label, '')
        if residual.strip():
            raise Failure('structure_error', 'Audio row contains unrecognized prose; do not delete blindly')
        node.drop_tree()
    # Remove graphic nodes only. Captions/prose in non-table figures remain.
    # Silently dropping whole figures would lose future article text.
    for node in list(body.xpath('.//figure')):
        if node is not keep:
            if node.text_content().strip():
                node.tag = 'div'
            else:
                node.drop_tree()
    for node in list(keep):
        keep.remove(node)
    keep.text = None
    keep.attrib.clear()
    keep.set('id', 'closing-table')
    keep.set('style', 'margin:25px 0 27px;padding:0;')
    image = html.Element('img', src='__CLOSING_TABLE_IMAGE__', alt='', width='550')
    image.set('style', 'display:block;width:100%;max-width:550px;height:auto;border:0;outline:none;text-decoration:none;')
    keep.append(image)
    # Images outside figures are excluded too, without deleting neighboring prose.
    for node in list(body.xpath('.//img')):
        if node is not image:
            node.drop_tree()
    for node in list(body.xpath('.//figcaption')):
        if node.text_content().strip():
            node.tag = 'p'
        else:
            node.drop_tree()
    forbidden = body.xpath('.//audio|.//video|.//iframe|.//script|.//object|.//embed|.//form')
    if forbidden:
        raise Failure('structure_error', 'Unexpected active/media element outside recognized removable audio rows')
    serialized = html.tostring(body, encoding='unicode')
    if re.search(r'\.mp3(?:[?"\s<]|$)', serialized, re.I) or any(x in body.text_content() for x in AUDIO_LABELS):
        raise Failure('structure_error', 'Unrecognized audio link or label remains')
    expected_text = body.text_content()
    expected_paragraphs = [n.text_content() for n in body.xpath('.//p')]
    expected_bold = [n.text_content() for n in body.xpath('.//strong|.//b')]
    allowed = {'div','p','h2','h3','h4','blockquote','strong','b','em','i','u','span','br','a','ol','ul','li','figure','img','sup','sub'}
    for node in body.iter():
        if not isinstance(node.tag, str) or node.tag not in allowed:
            raise Failure('structure_error', 'Unexpected article markup requires review: ' + str(node.tag))
        if node.tag in ('img','figure'):
            continue
        href = node.get('href') if node.tag == 'a' else None
        list_attrs = {k: node.get(k) for k in ('start','value','type') if node.get(k) is not None and node.tag in ('ol','ul','li')}
        node.attrib.clear()
        for k,v in list_attrs.items():
            node.set(k,v)
        if href:
            parsed = urllib.parse.urlsplit(urllib.parse.urljoin(TOPIC, href))
            if parsed.scheme == 'https' and not parsed.username and not parsed.password:
                node.set('href', urllib.parse.urlunsplit(parsed))
                node.set('rel', 'noopener noreferrer')
        if node.tag in STYLE:
            style = STYLE[node.tag]
            if node.tag == 'p' and re.match(r'^\s*[②③④⑤⑥⑦⑧⑨⑩]', node.text_content()):
                style += 'padding-left:18px;'
            node.set('style', style)
        if node.tag == 'h2':
            node.set('class','section-heading')
    if body.text_content() != expected_text or [n.text_content() for n in body.xpath('.//p')] != expected_paragraphs or [n.text_content() for n in body.xpath('.//strong|.//b')] != expected_bold:
        raise Failure('validation_error', 'Text or emphasis changed during sanitization')
    return body, table_url


def parse_article(data, source_url, target):
    source_url = safe_url(source_url)
    article_id = urllib.parse.urlsplit(source_url).path.rsplit('/',1)[-1]
    dom = parse_dom(data)
    title_node = one(dom, 'jin10-news-cdetails-title')
    intro = one(dom, 'jin10-cnews-introduction').text_content()
    article = one(dom, 'jin10-news-cdetails-article')
    disclaimer = one(dom, 'new-decale').text_content()
    title = title_node.text_content().strip()
    if title_date(title) != target:
        raise Failure('date_mismatch', 'Article title is not the requested Beijing date')
    meta = nuxt_metadata(dom, article_id)
    publication = meta.get('display_datetime', '')
    if not DATE_RE.fullmatch(publication):
        raise Failure('structure_error', 'Missing strict publication timestamp')
    try:
        pub = datetime.strptime(publication,'%Y-%m-%d %H:%M:%S').replace(tzinfo=BJ)
    except ValueError as exc:
        raise Failure('structure_error', 'Invalid publication timestamp') from exc
    if pub.date().isoformat() != target or meta.get('title') != title or meta.get('introduction','').strip() != intro.strip():
        raise Failure('date_mismatch', 'SSR title/introduction and publication metadata do not agree')
    if not intro.strip() or not disclaimer.strip():
        raise Failure('structure_error', 'Missing introduction or disclaimer')
    body, table_url = clean_body(article)
    headings = [n.text_content() for n in body.xpath('.//h2')]
    if headings != ['今日优选','市场盘点','国际要闻','国内要闻','风险预警']:
        raise Failure('structure_error', 'Section structure changed; inspect before accepting')
    paragraphs = [n.text_content() for n in body.xpath('.//p')]
    if len(paragraphs) < 15:
        raise Failure('structure_error', 'Body appears truncated')
    source_html = html.tostring(body, encoding='unicode')
    return {'schema':SCHEMA,'date':target,'title':title,'introduction':intro,'publication_beijing':publication,
            'source_url':source_url,'table_source_url':table_url,'disclaimer':disclaimer,
            'article_html':source_html,'headings':headings,'paragraphs':paragraphs,
            'bold_spans':[n.text_content() for n in body.xpath('.//strong|.//b')],
            'body_text':body.text_content(),'source_html_sha256':sha(data if isinstance(data,bytes) else data.encode())}

