import base64
import copy
from contextlib import redirect_stderr, redirect_stdout
from datetime import date, datetime, timezone
from importlib.util import module_from_spec, spec_from_file_location
import io
import json
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "aibase_daily.py"
SPEC = spec_from_file_location("aibase_daily", SCRIPT)
a = module_from_spec(SPEC)
SPEC.loader.exec_module(a)
URL = "https://news.aibase.cn/daily/31727"
HTML = """<!doctype html><html><head><title>AI日报：原文标题</title>
<script>fake 发布时间 : 2026年10月20号 16:00</script></head><body>
<div><span>发布时间 :</span><span>2026年10月19号 16:13</span></div>
<div class="articleContent"><div class="post-content">
<p>这是正文介绍，不应进入结果</p><p><strong>1、标题 A&amp;B <span>原样</span></strong></p>
<p>说明正文不能成为提要。</p>
<blockquote><p>【AiBase提要:】</p><p>🔍  两个空格 &amp; &lt;tag&gt; “原样”</p>
<p>🛠️ 含 AiBase提要: 的完整正文不得删去。</p></blockquote>
<p><strong>2、第二条:标点</strong></p><blockquote><p>【AiBase提要:】</p>
<p>百分比 50%+50%，不改写</p></blockquote></div></div></body></html>"""
FIXTURES = Path(__file__).resolve().parent / "fixtures"


def frozen_clock(utc_instant):
    """Use real timezone conversion, so tests catch UTC/local-date mistakes."""
    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return utc_instant.astimezone(tz) if tz else utc_instant.replace(tzinfo=None)
    return FrozenDateTime


class ExtractionTests(unittest.TestCase):
    def test_exact_heading_and_bullets(self):
        d = a.extract_article(HTML, URL)
        self.assertEqual(d["items"][0]["heading"], "1、标题 A&B 原样")
        self.assertEqual(d["items"][0]["bullets"], [
            "🔍  两个空格 & <tag> “原样”",
            "🛠️ 含 AiBase提要: 的完整正文不得删去。",
        ])
        self.assertEqual(d["publication_text"], "2026年10月19号 16:13")

    def test_only_label_paragraph_is_removed(self):
        d = a.extract_article(HTML, URL)
        rendered = a.render_html(d)
        self.assertNotIn("【AiBase提要:】", rendered)
        self.assertIn("含 AiBase提要: 的完整正文不得删去。", rendered)
        self.assertNotIn("说明正文", rendered)
        self.assertEqual(d["items"][0]["raw_abstract"],
                         "\n\n".join([d["items"][0]["summary_label"]] + d["items"][0]["bullets"]))

    def test_html_escaping(self):
        d = a.extract_article(HTML, URL)
        d["items"][0]["bullets"][0] = '<script>alert("x")</script> & \'<img src=x>\''
        d["items"][0]["raw_abstract"] = "\n\n".join(
            [d["items"][0]["summary_label"]] + d["items"][0]["bullets"])
        rendered = a.render_html(a.validate(d))
        self.assertNotIn("<script>", rendered)
        self.assertNotIn("<img src=x>", rendered)
        self.assertIn("&lt;script&gt;", rendered)
        self.assertIn("&#x27;", rendered)
        self.assertEqual(rendered.count("<a "), 1)

    def test_multiple_spaces_and_breaks_remain_visible(self):
        d = a.extract_article(HTML, URL)
        self.assertIn("white-space:pre-wrap;", a.render_html(d))
        source = HTML.replace("百分比 50%", "百分比<br>50%")
        d = a.extract_article(source, URL)
        self.assertEqual(d["items"][1]["bullets"][0], "百分比\n50%+50%，不改写")
        self.assertIn("white-space:pre-wrap;", a.render_html(d))

    def test_url_is_restricted(self):
        for url in ["javascript:alert(1)", "https://evil.test/daily/123",
                    "https://news.aibase.cn@evil.test/daily/123",
                    'https://news.aibase.cn/daily/123?x="onload=1']:
            with self.subTest(url=url), self.assertRaises(a.DigestError):
                a.safe_url(url)

    def test_date_guard(self):
        d = a.extract_article(HTML, URL)
        a.validate(d, date(2026, 10, 19))
        with self.assertRaises(a.NoArticle):
            a.validate(d, date(2026, 10, 20))

    def test_missing_date_and_relative_time_rejected(self):
        for replacement in ["", "3 小时前"]:
            with self.subTest(replacement=replacement), self.assertRaises(a.DigestError):
                a.extract_article(HTML.replace("2026年10月19号 16:13", replacement), URL)

    def test_mismatches_rejected(self):
        bad = [
            HTML.replace("<p><strong>2、第二条:标点</strong></p>", ""),
            HTML.replace("<p>【AiBase提要:】</p>", "", 1),
            HTML.replace("<p>百分比 50%+50%，不改写</p>", ""),
            HTML.replace("2、第二条", "3、第二条"),
            HTML.replace("</blockquote>", "</blockquote><p>3、无对应提要</p>", 1),
        ]
        for source in bad:
            with self.subTest(source=source[-150:]), self.assertRaises(a.DigestError):
                a.extract_article(source, URL)

    def test_import_rejects_lost_bullet(self):
        d = a.extract_article(HTML, URL)
        d["items"][0]["bullets"].pop()
        with self.assertRaises(a.DigestError):
            a.validate(d)

    def test_selects_latest_absolute_same_day(self):
        listing = '<a href="/daily/31727">1 小时前</a><a href="/daily/31728">昨天</a>'
        pages = {
            a.LIST_URL: listing,
            URL: HTML,
            "https://news.aibase.cn/daily/31728": HTML.replace("16:13", "18:30"),
        }
        with patch.object(a, "fetch", side_effect=pages.__getitem__):
            d = a.select_article(date(2026, 10, 19))
        self.assertEqual(d["source_url"], "https://news.aibase.cn/daily/31728")

    def test_no_old_fallback(self):
        listing = '<a href="/daily/31727">刚刚</a>'
        with patch.object(a, "fetch", side_effect=lambda url: listing if url == a.LIST_URL else HTML):
            with self.assertRaises(a.NoArticle):
                a.select_article(date(2026, 10, 20))

    def test_no_outputs_on_date_error(self):
        d = a.extract_article(HTML, URL)
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "output"
            with self.assertRaises(a.NoArticle):
                a.write_outputs(d, date(2026, 10, 20), out, False)
            self.assertFalse(out.exists())

    def test_dynamic_output_and_template(self):
        d = a.extract_article(HTML, URL)
        with tempfile.TemporaryDirectory() as directory:
            paths = a.write_outputs(d, date(2026, 10, 19), Path(directory), True)
            self.assertEqual(set(paths), {"html", "txt", "json"})
            rendered = Path(paths["html"]).read_text(encoding="utf-8")
            self.assertIn('<meta name="aibase-edition" content="historical">', rendered)
            self.assertNotIn("历史版", rendered)
            self.assertEqual(json.loads(Path(paths["json"]).read_text(encoding="utf-8"))["edition"], "historical")
            self.assertNotIn("测试版", rendered)
            self.assertEqual(rendered.count('class="original-heading"'), 2)
            self.assertEqual(rendered.count('class="original-bullet"'), 3)
            for color in ["#F1E8D8", "#FCFAF6", "#282622"]:
                self.assertIn(color, rendered)
            self.assertIn("max-width:640px", rendered)

    def test_historical_fixture_exact_text_and_non_three_bullet_counts(self):
        expected = json.loads((FIXTURES / "article-2026-10-21.json").read_text(encoding="utf-8"))
        source = (FIXTURES / "article-2026-10-21.html").read_text(encoding="utf-8")
        d = a.extract_article(source, expected["source_url"])
        for field in ("source_url", "article_title", "publication_text", "items"):
            self.assertEqual(d[field], expected[field], field)
        counts = [len(item["bullets"]) for item in expected["items"]]
        self.assertIn(4, counts)
        self.assertTrue(any(bullet.startswith("详情链接:") for item in d["items"] for bullet in item["bullets"]))
        with tempfile.TemporaryDirectory() as directory:
            target = a.parse_publication(expected["publication_text"]).date()
            paths = a.write_outputs(d, target, Path(directory), True)
            output = json.loads(Path(paths["json"]).read_text(encoding="utf-8"))
            rendered = Path(paths["html"]).read_text(encoding="utf-8")
            self.assertEqual(output["item_count"], len(expected["items"]))
            self.assertEqual(output["bullet_count"], sum(counts))
            self.assertNotEqual(output["bullet_count"], 3 * output["item_count"])
            self.assertEqual(rendered.count('class="original-heading"'), len(expected["items"]))
            self.assertEqual(rendered.count('class="original-bullet"'), sum(counts))

    def test_inline_png_roundtrip_and_v7_dimensions(self):
        rendered = a.render_html(a.extract_article(HTML, URL))
        images = [node for node in a.Tree(rendered).root.walk() if node.tag == "img"]
        self.assertEqual(len(images), 1)
        image = images[0]
        prefix = "data:image/png;base64,"
        self.assertTrue(image.attrs["src"].startswith(prefix))
        decoded = base64.b64decode(image.attrs["src"][len(prefix):], validate=True)
        self.assertTrue(decoded.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertEqual(decoded, (SCRIPT.parents[1] / "assets" / "header.png").read_bytes())
        self.assertEqual(image.attrs["width"], "156")
        self.assertEqual(image.attrs["height"], "98")
        self.assertIn("width:156px;height:98px;", image.attrs["style"])
        self.assertIn(".geometry{width:124px!important;height:78px!important}", rendered)
        self.assertIn(".geometry-cell{width:124px!important}", rendered)
        self.assertIn("@media only screen and (max-width:480px)", rendered)
        self.assertNotIn("{{", rendered)

    def test_v7_original_article_button_is_preserved(self):
        rendered = a.render_html(a.extract_article(HTML, URL))
        links = [node for node in a.Tree(rendered).root.walk() if node.tag == "a"]
        self.assertEqual(len(links), 1)
        self.assertEqual(links[0].attrs["href"], URL)
        self.assertEqual(links[0].text(), "阅读原文")
        self.assertIn("min-width:82px;padding:11px 24px;", links[0].attrs["style"])
        self.assertIn("border-radius:6px;", links[0].attrs["style"])
        self.assertIn("background-color:#F1E8D8;border:1px solid #C8BCAA;", rendered)
        self.assertIn('<v:roundrect ', rendered)
        self.assertIn('style="height:44px;v-text-anchor:middle;width:132px;"', rendered)


class CommandLineTests(unittest.TestCase):
    def run_main(self, arguments, utc_instant):
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch.object(a, "datetime", frozen_clock(utc_instant)), redirect_stdout(stdout), redirect_stderr(stderr):
            status = a.main(arguments)
        return status, stdout.getvalue(), stderr.getvalue()

    def test_default_beijing_weekend_skips_before_fetch_or_output(self):
        # Still Friday in UTC, already Saturday in Asia/Shanghai.
        instant = datetime(2026, 10, 23, 16, 1, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as directory, patch.object(a, "fetch") as fetch, patch.object(a, "select_article") as select:
            out = Path(directory) / "must-not-exist"
            status, stdout, stderr = self.run_main(["--out-dir", str(out)], instant)
            self.assertEqual(status, 0)
            result = json.loads(stdout)
            self.assertEqual(result["status"], "skipped_weekend")
            self.assertEqual(result["date"], "2026-10-24")
            self.assertEqual(stderr, "")
            fetch.assert_not_called()
            select.assert_not_called()
            self.assertFalse(out.exists())

    def test_default_weekday_rejects_stale_listing_without_output(self):
        instant = datetime(2026, 10, 21, 16, 1, tzinfo=timezone.utc)
        listing = '<a href="/daily/31727">刚刚</a>'
        with tempfile.TemporaryDirectory() as directory, patch.object(a, "fetch", side_effect=lambda url: listing if url == a.LIST_URL else HTML):
            out = Path(directory) / "must-not-exist"
            status, stdout, stderr = self.run_main(["--out-dir", str(out)], instant)
            self.assertEqual(status, 3)
            self.assertEqual(stdout, "")
            result = json.loads(stderr)
            self.assertEqual(result["status"], "no_article_for_date")
            self.assertEqual(result["date"], "2026-10-22")
            self.assertFalse(out.exists())

    def test_default_offline_fixture_rejects_stale_without_output(self):
        expected = json.loads((FIXTURES / "article-2026-10-21.json").read_text(encoding="utf-8"))
        instant = datetime(2026, 10, 22, 0, 0, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as directory, patch.object(a, "fetch") as fetch:
            for mode in ("html", "json"):
                with self.subTest(mode=mode):
                    out = Path(directory) / mode
                    args = ["--input-" + mode, str(FIXTURES / ("article-2026-10-21." + mode)), "--out-dir", str(out)]
                    if mode == "html":
                        args += ["--article-url", expected["source_url"]]
                    status, stdout, stderr = self.run_main(args, instant)
                    self.assertEqual(status, 3)
                    self.assertEqual(stdout, "")
                    self.assertEqual(json.loads(stderr)["status"], "no_article_for_date")
                    self.assertFalse(out.exists())
            fetch.assert_not_called()

    def test_explicit_historical_fixture_succeeds_even_on_current_weekend(self):
        expected = json.loads((FIXTURES / "article-2026-10-21.json").read_text(encoding="utf-8"))
        target = a.parse_publication(expected["publication_text"]).date().isoformat()
        instant = datetime(2026, 10, 24, 0, 0, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as directory, patch.object(a, "fetch") as fetch:
            out = Path(directory) / "historical"
            status, stdout, stderr = self.run_main([
                "--date", target, "--input-html", str(FIXTURES / "article-2026-10-21.html"),
                "--article-url", expected["source_url"], "--out-dir", str(out),
            ], instant)
            self.assertEqual(status, 0)
            self.assertEqual(stderr, "")
            result = json.loads(stdout)
            self.assertEqual(result["status"], "ok")
            self.assertEqual(set(result["outputs"]), {"html", "txt", "json"})
            output = json.loads(Path(result["outputs"]["json"]).read_text(encoding="utf-8"))
            self.assertEqual(output["edition"], "historical")
            self.assertEqual(output["requested_date"], target)
            self.assertEqual(output["items"], expected["items"])
            self.assertEqual(output["bullet_count"], sum(len(item["bullets"]) for item in expected["items"]))
            fetch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
