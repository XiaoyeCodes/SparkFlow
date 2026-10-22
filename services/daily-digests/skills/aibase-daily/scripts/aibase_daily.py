#!/usr/bin/env python3
"""Fetch AIBase's daily article, preserve its abstracts, and render local files.

Python 3.9+ standard library only. No account, mail, scheduler or remote writes.
"""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from html import escape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener


ORIGIN = "https://news.aibase.cn"
LIST_URL = ORIGIN + "/daily"
BEIJING = timezone(timedelta(hours=8), "Asia/Shanghai")
HEADING = re.compile(r"^(\d+)[、.．]\s*\S")
LABEL = re.compile(r"^【\s*AiBase\s*提要\s*[:：]?\s*】$", re.I)
ABS_DATE = re.compile(
    r"(?<!\d)(\d{4})年(\d{1,2})月(\d{1,2})[日号]\s+(\d{1,2}):(\d{2})(?!\d)"
)
VOID = set("area base br col embed hr img input link meta param source track wbr".split())
SKIP = {"script", "style", "noscript", "template"}
ROOT = Path(__file__).resolve().parents[1]


class DigestError(ValueError):
    pass


class NoArticle(DigestError):
    pass


class Node:
    def __init__(self, tag="", attrs=(), parent=None):
        self.tag = tag
        self.attrs = dict(attrs)
        self.parent = parent
        self.children = []

    def walk(self):
        yield self
        for child in self.children:
            if isinstance(child, Node):
                yield from child.walk()

    def text(self):
        if self.tag in SKIP or "hidden" in self.attrs:
            return ""
        if self.tag == "br":
            return "\n"
        return "".join(c.text() if isinstance(c, Node) else c for c in self.children)

    def has_class(self, name):
        return name in self.attrs.get("class", "").split()


class Tree(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]
        self.feed(source)
        self.close()

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.stack[-1])
        self.stack[-1].children.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for pos in range(len(self.stack) - 1, 0, -1):
            if self.stack[pos].tag == tag:
                del self.stack[pos:]
                return

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def safe_url(url, article=True):
    if not isinstance(url, str):
        raise DigestError("Source URL must be a string.")
    parsed = urlparse(url)
    pattern = r"/daily/\d+/?" if article else r"/daily(?:/\d+)?/?"
    if (
        parsed.scheme != "https" or parsed.netloc != "news.aibase.cn"
        or parsed.query or parsed.fragment or not re.fullmatch(pattern, parsed.path)
    ):
        raise DigestError("Only an HTTPS news.aibase.cn/daily article URL is accepted.")
    return url


class SameOriginRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        safe_url(newurl, article=False)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url):
    safe_url(url, article=False)
    opener = build_opener(SameOriginRedirect())
    req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for attempt in range(3):
        try:
            with opener.open(req, timeout=30) as response:
                safe_url(response.geturl(), article=False)
                raw = response.read(8 * 1024 * 1024 + 1)
                if len(raw) > 8 * 1024 * 1024:
                    raise DigestError("Page exceeds the 8 MiB safety limit.")
                return raw.decode(response.headers.get_content_charset() or "utf-8")
        except HTTPError as exc:
            # Retry only transient server failures, never access denials,
            # authentication requirements, or rate limits.
            if exc.code not in {500, 502, 503, 504} or attempt == 2:
                raise DigestError(f"Could not read {url}: HTTP {exc.code}.") from exc
        except (URLError, TimeoutError) as exc:
            if attempt == 2:
                raise DigestError(f"Could not read {url}: {exc}.") from exc
        time.sleep(attempt + 1)


def parse_publication(text):
    if not isinstance(text, str):
        raise DigestError("Missing absolute publication timestamp.")
    matches = list(ABS_DATE.finditer(text))
    if len(matches) != 1:
        raise DigestError("Expected one absolute Chinese publication date and time.")
    try:
        return datetime(*map(int, matches[0].groups()), tzinfo=BEIJING)
    except ValueError as exc:
        raise DigestError("Invalid publication date/time.") from exc


def publication_from_tree(root):
    found = set()
    for node in root.walk():
        if node.tag in SKIP:
            continue
        # Use the actual visible 发布时间 field, never list relative times or
        # timestamps embedded in hydration scripts.
        if re.fullmatch(r"\s*发布时间\s*[:：]?\s*", node.text()):
            if node.parent:
                found.update(m.group(0) for m in ABS_DATE.finditer(node.parent.text()))
    if len(found) != 1:
        raise DigestError("Missing or ambiguous 发布时间; use the rendered-browser fallback.")
    result = found.pop()
    parse_publication(result)
    return result


def listing_urls(source):
    urls = []
    for node in Tree(source).root.walk():
        if node.tag != "a":
            continue
        try:
            url = safe_url(urljoin(LIST_URL, node.attrs.get("href", "")))
        except DigestError:
            continue
        if url not in urls:
            urls.append(url)
    if not urls:
        raise DigestError("No daily article links in HTML; use the rendered-browser fallback.")
    return urls


def extract_article(source, source_url):
    safe_url(source_url)
    root = Tree(source).root
    publication = publication_from_tree(root)
    containers = [n for n in root.walk() if n.has_class("articleContent")]
    if len(containers) != 1:
        raise DigestError("Expected one .articleContent container; browser fallback required.")
    container = containers[0]
    inner = [n for n in container.walk() if n.has_class("post-content")]
    if len(inner) > 1:
        raise DigestError("Ambiguous article content containers.")
    container = inner[0] if inner else container
    titles = [n.text().strip() for n in root.walk() if n.tag == "h1"]
    if not titles:
        titles = [n.text().strip() for n in root.walk() if n.tag == "title"]
    if len(titles) != 1 or not titles[0]:
        raise DigestError("Missing or ambiguous article title.")

    items, pending, quotes = [], None, 0
    for node in container.children:
        if not isinstance(node, Node):
            continue
        text = node.text().strip()
        if node.tag in {"p", "h2", "h3", "h4"} and HEADING.match(text):
            if pending is not None:
                raise DigestError("Heading has no matching summary blockquote.")
            pending = text
        elif node.tag == "blockquote":
            quotes += 1
            if pending is None:
                raise DigestError("Summary blockquote has no corresponding heading.")
            paras = [n for n in node.children if isinstance(n, Node) and n.tag == "p"]
            # Fail closed if a new structure might hide/drop content.
            other = [n for n in node.children if isinstance(n, Node) and n.tag != "p"]
            stray = [n for n in node.children if isinstance(n, str) and n.strip()]
            if other or stray:
                raise DigestError("Unrecognized blockquote structure; use browser fallback.")
            parts = [n.text().strip() for n in paras if n.text().strip()]
            labels = [p for p in parts if LABEL.fullmatch(p)]
            if len(labels) != 1 or not parts or not LABEL.fullmatch(parts[0]):
                raise DigestError("Each blockquote must begin with exactly one AiBase提要 label.")
            if len(parts) < 2:
                raise DigestError("Summary has no bullet paragraphs.")
            items.append({
                "heading": pending,
                "summary_label": parts[0],
                "bullets": parts[1:],
                "raw_abstract": "\n\n".join(parts),
            })
            pending = None
    all_quotes = sum(n.tag == "blockquote" for n in container.walk())
    all_numbered = sum(
        n.tag in {"p", "h2", "h3", "h4"} and bool(HEADING.match(n.text().strip()))
        for n in container.walk()
        if not any_ancestor(n, "blockquote")
    )
    if pending is not None or all_quotes != quotes or all_numbered != len(items):
        raise DigestError("Heading/summary count or structure mismatch; nothing rendered.")
    document = {
        "source_url": source_url,
        "article_title": titles[0],
        "publication_text": publication,
        "extraction_method": "Static HTML: numbered headings paired with following blockquotes; scripts ignored.",
        "items": items,
    }
    return validate(document)


def any_ancestor(node, tag):
    current = node.parent
    while current:
        if current.tag == tag:
            return True
        current = current.parent
    return False


def validate(document, target=None):
    if not isinstance(document, dict):
        raise DigestError("Extraction JSON must be an object.")
    safe_url(document.get("source_url"))
    published = parse_publication(document.get("publication_text"))
    title = document.get("article_title")
    if not isinstance(title, str) or not title.strip():
        raise DigestError("Missing article title.")
    items = document.get("items")
    if not isinstance(items, list) or not items:
        raise DigestError("Extraction has no items.")
    for index, item in enumerate(items, 1):
        if not isinstance(item, dict):
            raise DigestError("Each item must be an object.")
        heading = item.get("heading")
        match = HEADING.match(heading) if isinstance(heading, str) else None
        if not match or int(match[1]) != index:
            raise DigestError("Headings must retain contiguous original numbering starting at 1.")
        bullets = item.get("bullets")
        if not isinstance(bullets, list) or not bullets or not all(
            isinstance(b, str) and b.strip() and not LABEL.fullmatch(b) for b in bullets
        ):
            raise DigestError("Missing/invalid bullets or a label-only paragraph remains.")
        label = item.get("summary_label")
        if not isinstance(label, str) or not LABEL.fullmatch(label):
            raise DigestError("Missing original standalone AiBase提要 label in extraction evidence.")
        raw = item.get("raw_abstract")
        if raw != "\n\n".join([label] + bullets):
            raise DigestError("Raw abstract differs from label plus exact bullet paragraphs.")
    if target is not None and published.date() != target:
        raise NoArticle(
            f"Requested Beijing date {target}; article was published {published.isoformat()}. "
            "Older content will not be substituted."
        )
    return document


def select_article(target):
    urls = listing_urls(fetch(LIST_URL))
    # Check every article visible on the listing, not just the first entry or
    # its potentially inaccurate relative time. A failed check is inconclusive.
    def inspect(url):
        source = fetch(url)
        stamp = parse_publication(publication_from_tree(Tree(source).root))
        return stamp, url, source

    with ThreadPoolExecutor(max_workers=4) as pool:
        checked = list(pool.map(inspect, urls))
    matches = [item for item in checked if item[0].date() == target]
    if not matches:
        latest = max(checked, key=lambda item: item[0])
        raise NoArticle(
            f"No article for Beijing date {target} among {len(checked)} listed articles. "
            f"Latest verified publication: {latest[0].isoformat()} {latest[1]}. "
            "No digest generated. For an older archive date use --date with --article-url."
        )
    stamp, url, source = max(matches, key=lambda item: item[0])
    return validate(extract_article(source, url), target)


def render_html(document, historical=False):
    published = parse_publication(document["publication_text"])
    cn = f"{published.year}年{published.month}月{published.day}日"
    rows = []
    for i, item in enumerate(document["items"], 1):
        border = "border-top:1px solid #ded6c8;" if i > 1 else ""
        bullets = []
        for j, bullet in enumerate(item["bullets"], 1):
            margin = 0 if j == len(item["bullets"]) else 11
            preserve_space = "white-space:pre-wrap;" if re.search(r"\s{2,}|[\r\n\t]", bullet) else ""
            bullets.append(
                f'<p class="original-bullet" data-item="{i}" data-bullet="{j}" '
                f'style="margin:0 0 {margin}px;font-size:16px;line-height:1.9;color:#48443e;'
                f'word-wrap:break-word;overflow-wrap:anywhere;{preserve_space}">'
                f'{escape(bullet)}</p>'
            )
        preserve_space = "white-space:pre-wrap;" if re.search(r"\s{2,}|[\r\n\t]", item["heading"]) else ""
        rows.append(
            f'<tr><td class="story" style="padding:27px 0;{border}">\n'
            f'<h2 class="original-heading" data-item="{i}" style="margin:0 0 16px;font-size:18px;'
            f'line-height:1.6;font-weight:600;color:#282622;word-wrap:break-word;overflow-wrap:anywhere;{preserve_space}">'
            f'{escape(item["heading"])}</h2>\n'
            + "".join(bullets) + "\n</td></tr>"
        )
    values = {
        "DATE_ZH": escape(cn),
        "PUBLISH_TIME": published.strftime("%H:%M"),
        "ARTICLE_URL": escape(safe_url(document["source_url"]), quote=True),
        "STORY_TABLE": '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + "".join(rows) + '</table>',
        "HEADER_DATA_URI": "data:image/png;base64," + base64.b64encode((ROOT / "assets/header.png").read_bytes()).decode("ascii"),
        "EDITION_METADATA": "historical" if historical else "daily",
    }
    template = (ROOT / "assets" / "template.html").read_text(encoding="utf-8")
    return re.sub(r"\{\{([A-Z_]+)\}\}", lambda match: values[match[1]], template)


def render_text(document, historical=False):
    published = parse_publication(document["publication_text"])
    edition = " · 历史版" if historical else ""
    parts = [f"AI 日报 · {published:%Y-%m-%d}{edition}", ""]
    for item in document["items"]:
        parts.extend([item["heading"], *item["bullets"], ""])
    parts.extend([
        f"原文发布于 {published:%Y年%m月%d日 %H:%M}（北京时间）",
        f"AIBase 原文：{document['source_url']}", "",
    ])
    return "\n".join(parts)


def write_outputs(document, target, out_dir, historical):
    validate(document, target)
    out_dir.mkdir(parents=True, exist_ok=True)
    base = f"aibase-{target.isoformat()}"
    output = dict(document)
    output["requested_date"] = target.isoformat()
    output["timezone"] = "Asia/Shanghai"
    output["edition"] = "historical" if historical else "daily"
    output["item_count"] = len(document["items"])
    output["bullet_count"] = sum(len(item["bullets"]) for item in document["items"])
    artifacts = {
        "html": render_html(document, historical),
        "txt": render_text(document, historical),
        "json": json.dumps(output, ensure_ascii=False, indent=2) + "\n",
    }
    paths = {}
    for extension, content in artifacts.items():
        path = out_dir / f"{base}.{extension}"
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(content, encoding="utf-8")
        temporary.replace(path)
        paths[extension] = str(path.resolve())
    return paths


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", type=date.fromisoformat, help="Explicit archive date YYYY-MM-DD; default Beijing today.")
    parser.add_argument("--pdf", action="store_true", help="Also export an A4 PDF; requires the optional PDF dependencies.")
    parser.add_argument("--out-dir", type=Path, default=Path("output"))
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--input-json", type=Path, help="Render validated browser extraction JSON.")
    modes.add_argument("--input-html", type=Path, help="Extract saved page HTML; requires --article-url.")
    parser.add_argument("--article-url", help="Known article; still subject to the requested-date guard.")
    args = parser.parse_args(argv)
    today = datetime.now(BEIJING).date()
    target = args.date or today
    if args.date is None and today.weekday() >= 5:
        print(json.dumps({"status": "skipped_weekend", "date": today.isoformat(),
                          "message": "Default runs are Beijing weekdays only. No source fetched or digest generated."}))
        return 0
    paths = {}
    try:
        if args.input_json:
            if args.article_url:
                raise DigestError("--article-url cannot be combined with --input-json.")
            document = json.loads(args.input_json.read_text(encoding="utf-8"))
        elif args.input_html:
            if not args.article_url:
                raise DigestError("--input-html requires --article-url.")
            document = extract_article(args.input_html.read_text(encoding="utf-8"), args.article_url)
        elif args.article_url:
            document = extract_article(fetch(safe_url(args.article_url)), args.article_url)
        else:
            document = select_article(target)
        validate(document, target)
        paths = write_outputs(document, target, args.out_dir, target != today)
        if args.pdf:
            try:
                from export_pdf import export_pdf
                pdf_path = Path(paths["html"]).with_suffix(".pdf")
                pdf_info = export_pdf(Path(paths["html"]), pdf_path)
                paths["pdf"] = str(pdf_path.resolve())
                paths["pdf_qa"] = pdf_info
            except Exception as exc:
                print(json.dumps({"status": "pdf_export_failed", "date": target.isoformat(),
                                  "message": str(exc), "outputs": paths}, ensure_ascii=False), file=sys.stderr)
                return 4
        print(json.dumps({
            "status": "ok", "date": target.isoformat(), "source_url": document["source_url"],
            "item_count": len(document["items"]), "outputs": paths,
        }, ensure_ascii=False, indent=2))
        return 0
    except NoArticle as exc:
        print(json.dumps({"status": "no_article_for_date", "date": target.isoformat(), "message": str(exc)},
                         ensure_ascii=False), file=sys.stderr)
        return 3
    except (DigestError, OSError, ValueError, KeyError) as exc:
        print(json.dumps({"status": "error", "message": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
