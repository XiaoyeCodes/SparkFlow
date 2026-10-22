#!/usr/bin/env python3
"""Export the generated AIBase standalone HTML to a paginated A4 PDF.

Optional dependencies: requirements-pdf.txt plus Pango/Fontconfig and Chinese fonts.
No network access is used. The HTML file remains the primary original-layout artifact.
"""
import argparse
from html import escape
import json
from pathlib import Path
import sys

from aibase_daily import Node, Tree, VOID


def serialize(node):
    if isinstance(node, str):
        return escape(node)
    if node.tag in {"script", "style", "noscript", "template"}:
        return ""
    attrs = "".join(f' {escape(k)}="{escape(v or "", quote=True)}"' for k, v in node.attrs.items())
    start = f"<{node.tag}{attrs}>"
    if node.tag in VOID:
        return start
    return start + "".join(serialize(c) for c in node.children) + f"</{node.tag}>"


def print_document(source):
    root = Tree(source).root
    nodes = list(root.walk())
    mastheads = [n for n in nodes if n.has_class("masthead")]
    contents = [n for n in nodes if n.has_class("content")]
    stories = [n for n in nodes if n.has_class("story")]
    if len(mastheads) != 1 or len(contents) != 1 or not stories:
        raise ValueError("Expected a generated AIBase V7 HTML document.")
    for n in nodes:
        if n.tag == "img" and not n.attrs.get("src", "").startswith("data:image/png;base64,"):
            raise ValueError("PDF export accepts only embedded PNG images; external resources are not fetched.")
    title = next((n.text() for n in nodes if n.tag == "title"), "AI 日报")
    content_tables = [n for n in contents[0].children if isinstance(n, Node) and n.tag == "table"]
    if len(content_tables) != 2:
        raise ValueError("Expected story table and original-article footer table.")
    masthead = mastheads[0]
    header = '<header class="masthead" style="' + escape(masthead.attrs.get("style", ""), quote=True) + '">' + "".join(serialize(c) for c in masthead.children) + '</header>'
    sections = "".join('<section class="story" style="' + escape(n.attrs.get("style", ""), quote=True) + '">' + "".join(serialize(c) for c in n.children) + '</section>' for n in stories)
    footer = '<footer>' + serialize(content_tables[-1]) + '</footer>'
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + escape(title) + '</title></head><body><article>' + header + '<main>' + sections + footer + '</main></article></body></html>'


PRINT_CSS = """
@page { size: A4; margin: 12mm 12mm 15mm; @bottom-center {
  content: counter(page) " / " counter(pages); color:#918574; font-size:8pt;
  font-family:Arial,sans-serif; } }
html,body { margin:0; padding:0; }
body { color:#282622; background:#FCFAF6;
  font-family:'Noto Sans CJK SC','PingFang SC','Microsoft YaHei',Arial,sans-serif; }
article { width:640px; max-width:100%; margin:0 auto; background:#FCFAF6; border:1px solid #ded6c8; }
table { border-collapse:collapse; } td { text-align:left; } td[align=right] {text-align:right;} td[align=center] {text-align:center;}
.masthead { break-inside:avoid; background:#F1E8D8; }
main {padding:6px 44px 36px;}
.story {padding:23px 0 !important;break-inside:avoid;}
.original-bullet {font-size:15px !important;line-height:1.75 !important;break-inside:avoid;}
.original-heading {break-after:avoid;}
p {orphans:3;widows:3;}
footer {break-inside:avoid;}
a {color:#282622;}
"""


def export_pdf(html_path, pdf_path):
    try:
        from weasyprint import HTML, CSS, URLFetcher
        import weasyprint
        import fitz
    except (ImportError, OSError) as exc:
        raise RuntimeError("PDF dependencies unavailable. Install requirements-pdf.txt and the Pango/Chinese-font prerequisites in README.md. HTML/TXT/JSON remain usable.") from exc
    source = html_path.read_text(encoding="utf-8")
    printable = print_document(source)
    embedded_only = URLFetcher(allowed_protocols={"data"}, allow_redirects=False, fail_on_errors=True)
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = pdf_path.with_suffix(".pdf.tmp")
    HTML(string=printable, url_fetcher=embedded_only).write_pdf(
        temporary, stylesheets=[CSS(string=PRINT_CSS)], presentational_hints=True)
    with fitz.open(temporary, filetype="pdf") as document:
        if not document.page_count or any(not p.get_text().strip() for p in document):
            raise RuntimeError("Generated PDF has no readable content or a blank page.")
        width, height = document[0].rect.width, document[0].rect.height
        if abs(width - 595.28) > 2 or abs(height - 841.89) > 2:
            raise RuntimeError("PDF page size differs from A4.")
        info = {"pages": document.page_count, "page_size": "A4", "renderer": "WeasyPrint " + weasyprint.__version__,
                "visual_review_required": True}
    temporary.replace(pdf_path)
    return info


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("html", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        target = args.output or args.html.with_suffix(".pdf")
        info = export_pdf(args.html, target)
        print(json.dumps({"status": "ok", "output": str(target.resolve()), **info}, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"status": "pdf_export_failed", "message": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 4


if __name__ == "__main__":
    sys.exit(main())
