#!/usr/bin/env python3
"""Verify complete original content, embedded graphics, and optional PDF pages."""
import argparse
import base64
import json
from pathlib import Path
import re
import unicodedata

from aibase_daily import ROOT, Tree, validate


def verify(json_path, html_path, pdf_path=None, render_dir=None):
    document = validate(json.loads(json_path.read_text(encoding="utf-8")))
    source = html_path.read_text(encoding="utf-8")
    nodes = list(Tree(source).root.walk())
    headings = [n.text() for n in nodes if n.has_class("original-heading")]
    bullets = [n.text() for n in nodes if n.has_class("original-bullet")]
    expected_headings = [i["heading"] for i in document["items"]]
    expected_bullets = [b for i in document["items"] for b in i["bullets"]]
    if headings != expected_headings or bullets != expected_bullets:
        raise ValueError("HTML differs from the complete source headings or bullet paragraphs.")
    images = [n for n in nodes if n.tag == "img"]
    if len(images) != 1 or not images[0].attrs.get("src", "").startswith("data:image/png;base64,"):
        raise ValueError("Expected one self-contained PNG header image.")
    png = base64.b64decode(images[0].attrs["src"].split(",", 1)[1], validate=True)
    if png != (ROOT / "assets/header.png").read_bytes():
        raise ValueError("Embedded image differs from the approved V7 robot asset.")
    if "{{" in source or 'src="cid:' in source:
        raise ValueError("Unresolved template or email-only image reference remains.")
    links = [n for n in nodes if n.tag == "a"]
    if len(links) != 1 or links[0].attrs.get("href") != document["source_url"] or links[0].text() != "阅读原文":
        raise ValueError("Original-article footer link differs from the source.")
    info = {"status": "ok", "headings": len(headings), "bullets": len(bullets),
            "html_exact_text": True, "embedded_png_exact": True, "source_button_exact": True}
    if pdf_path:
        try:
            import fitz
        except ImportError as exc:
            raise RuntimeError("PDF QA requires PyMuPDF from requirements-pdf.txt.") from exc
        norm = lambda s: re.sub(r"\s|[\ufe0f\ufe0e]", "", unicodedata.normalize("NFC", s))
        with fitz.open(pdf_path) as pdf:
            all_text = norm("".join(page.get_text() for page in pdf))
            for value in expected_headings + expected_bullets:
                if norm(value) not in all_text:
                    raise ValueError("PDF text missing an original heading or bullet; inspect fonts/rendering.")
            if not pdf.page_count or any(not page.get_text().strip() for page in pdf):
                raise ValueError("Blank PDF page detected.")
            if render_dir:
                render_dir.mkdir(parents=True, exist_ok=True)
                for i, page in enumerate(pdf, 1):
                    page.get_pixmap(matrix=fitz.Matrix(1.25, 1.25), alpha=False).save(render_dir / f"page-{i}.png")
            info.update(pdf_pages=pdf.page_count, pdf_complete_text=True,
                        pdf_visual_review_required=True)
    return info


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("json", type=Path)
    parser.add_argument("html", type=Path)
    parser.add_argument("--pdf", type=Path)
    parser.add_argument("--render-dir", type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.json, args.html, args.pdf, args.render_dir), ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print(json.dumps({"status": "qa_failed", "message": str(exc)}, ensure_ascii=False))
        return 5


if __name__ == "__main__":
    raise SystemExit(main())
