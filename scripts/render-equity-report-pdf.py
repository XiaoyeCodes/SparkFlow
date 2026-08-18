"""Render an archived SparkFlow equity-research Markdown file as a PDF.

This script performs no network requests. It adapts the ReportLab layout from
the user's standalone Coze report generator and only handles PDF rendering.
"""

from __future__ import annotations

import argparse
import html
import os
import re
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch, mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Flowable,
    KeepTogether,
    ListFlowable,
    ListItem,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

NAVY = colors.HexColor("#0E365B")
NAVY_DEEP = colors.HexColor("#082744")
BLUE_LIGHT = colors.HexColor("#E8F0F7")
ACCENT_GOLD = colors.HexColor("#C5A065")
TEXT_MAIN = colors.HexColor("#262626")
TEXT_GREY = colors.HexColor("#646B73")
DIVIDER = colors.HexColor("#D9DEE3")
TABLE_ALT = colors.HexColor("#F5F7F9")


class HorizontalRule(Flowable):
    def __init__(self, thickness: float = 1, color: colors.Color = DIVIDER, before: float = 1, after: float = 1):
        super().__init__()
        self.thickness = thickness
        self.color = color
        self.before = before
        self.after = after

    def wrap(self, available_width: float, _available_height: float) -> tuple[float, float]:
        self.width = available_width
        return self.width, self.thickness + self.before + self.after

    def draw(self) -> None:
        self.canv.setStrokeColor(self.color)
        self.canv.setLineWidth(self.thickness)
        self.canv.line(0, self.after, self.width, self.after)


def register_chinese_fonts() -> tuple[str, str]:
    candidates = [
        (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\msyhbd.ttc"),
        (r"C:\Windows\Fonts\simhei.ttf", r"C:\Windows\Fonts\simhei.ttf"),
        ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"),
        ("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"),
        ("/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/PingFang.ttc"),
    ]
    for regular_path, bold_path in candidates:
        if not os.path.exists(regular_path):
            continue
        try:
            pdfmetrics.registerFont(TTFont("SparkFlowCN", regular_path))
            chosen_bold = bold_path if os.path.exists(bold_path) else regular_path
            pdfmetrics.registerFont(TTFont("SparkFlowCN-Bold", chosen_bold))
            pdfmetrics.registerFontFamily(
                "SparkFlowCN",
                normal="SparkFlowCN",
                bold="SparkFlowCN-Bold",
                italic="SparkFlowCN",
                boldItalic="SparkFlowCN-Bold",
            )
            return "SparkFlowCN", "SparkFlowCN-Bold"
        except Exception:
            continue

    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    pdfmetrics.registerFontFamily(
        "STSong-Light",
        normal="STSong-Light",
        bold="STSong-Light",
        italic="STSong-Light",
        boldItalic="STSong-Light",
    )
    return "STSong-Light", "STSong-Light"


FONT_REGULAR, FONT_BOLD = register_chinese_fonts()


def inline_markdown(value: str) -> str:
    escaped = html.escape(value.strip())
    escaped = re.sub(r"`([^`]+)`", r'<font name="Courier">\1</font>', escaped)
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"__([^_]+)__", r"<b>\1</b>", escaped)
    escaped = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", escaped)
    escaped = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r'<link href="\2" color="#287D91">\1</link>', escaped)
    return escaped


def split_table_row(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def is_table_separator(line: str) -> bool:
    cells = split_table_row(line)
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) for cell in cells)


def parse_markdown(markdown: str) -> tuple[str, list[dict[str, Any]]]:
    normalized = markdown.replace("\r\n", "\n").replace("\r", "\n").strip()
    fence = re.fullmatch(r"\s*```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```\s*", normalized, re.IGNORECASE)
    if fence:
        normalized = fence.group(1)
    lines = normalized.splitlines()
    title = "个股投资研究报告"
    blocks: list[dict[str, Any]] = []
    paragraph: list[str] = []

    def flush_paragraph() -> None:
        if not paragraph:
            return
        text = " ".join(part.strip() for part in paragraph if part.strip()).strip()
        if text:
            blocks.append({"type": "paragraph", "text": text})
        paragraph.clear()

    index = 0
    while index < len(lines):
        raw = lines[index].rstrip()
        stripped = raw.strip()
        if not stripped:
            flush_paragraph()
            index += 1
            continue
        heading = re.match(r"^(#{1,4})\s+(.+)$", stripped)
        if heading:
            flush_paragraph()
            level = len(heading.group(1))
            text = heading.group(2).strip()
            if level == 1 and title == "个股投资研究报告":
                title = re.sub(r"\*\*", "", text)
            else:
                blocks.append({"type": "heading", "level": level, "text": text})
            index += 1
            continue
        if stripped.startswith("|") and index + 1 < len(lines) and is_table_separator(lines[index + 1].strip()):
            flush_paragraph()
            rows = [split_table_row(stripped)]
            index += 2
            while index < len(lines) and lines[index].strip().startswith("|"):
                rows.append(split_table_row(lines[index]))
                index += 1
            width = max(len(row) for row in rows)
            rows = [row + [""] * (width - len(row)) for row in rows]
            blocks.append({"type": "table", "rows": rows})
            continue
        list_match = re.match(r"^(?:[-*+]\s+|\d+[.)、]\s+)(.+)$", stripped)
        if list_match:
            flush_paragraph()
            items: list[str] = []
            while index < len(lines):
                match = re.match(r"^(?:[-*+]\s+|\d+[.)、]\s+)(.+)$", lines[index].strip())
                if not match:
                    break
                items.append(match.group(1).strip())
                index += 1
            blocks.append({"type": "list", "items": items})
            continue
        if stripped.startswith(">"):
            flush_paragraph()
            quote_lines: list[str] = []
            while index < len(lines) and lines[index].strip().startswith(">"):
                quote_lines.append(lines[index].strip().lstrip(">").strip())
                index += 1
            blocks.append({"type": "quote", "text": " ".join(quote_lines)})
            continue
        if re.fullmatch(r"[-*_]{3,}", stripped):
            flush_paragraph()
            blocks.append({"type": "rule"})
            index += 1
            continue
        paragraph.append(stripped)
        index += 1
    flush_paragraph()
    return title, blocks


def build_pdf(markdown_path: Path, output_path: Path, fallback_title: str) -> None:
    markdown = markdown_path.read_text(encoding="utf-8")
    parsed_title, blocks = parse_markdown(markdown)
    title = parsed_title or fallback_title or "个股投资研究报告"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=A4,
        rightMargin=16 * mm,
        leftMargin=16 * mm,
        topMargin=24 * mm,
        bottomMargin=18 * mm,
        title=title,
        author="SparkFlow AI Research",
        subject="AI-generated equity research based on public information",
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "ReportTitle", parent=styles["Title"], fontName=FONT_BOLD, fontSize=23,
        leading=30, textColor=NAVY, alignment=TA_LEFT, spaceAfter=5,
    )
    subtitle_style = ParagraphStyle(
        "ReportSubtitle", parent=styles["Normal"], fontName=FONT_REGULAR, fontSize=8,
        leading=12, textColor=TEXT_GREY, alignment=TA_LEFT, spaceAfter=11,
    )
    section_style = ParagraphStyle(
        "Section", parent=styles["Heading2"], fontName=FONT_BOLD, fontSize=12,
        leading=15, textColor=colors.white, alignment=TA_LEFT,
    )
    subsection_style = ParagraphStyle(
        "Subsection", parent=styles["Heading3"], fontName=FONT_BOLD, fontSize=11,
        leading=15, textColor=NAVY, alignment=TA_LEFT, spaceBefore=8, spaceAfter=4,
    )
    body_style = ParagraphStyle(
        "Body", parent=styles["BodyText"], fontName=FONT_REGULAR, fontSize=9.2,
        leading=14.5, textColor=TEXT_MAIN, alignment=TA_LEFT, spaceAfter=5,
        wordWrap="CJK",
    )
    quote_style = ParagraphStyle(
        "Quote", parent=body_style, leftIndent=9, rightIndent=5, borderColor=ACCENT_GOLD,
        borderWidth=0, borderPadding=(5, 8, 5, 10), backColor=colors.HexColor("#F7F3EA"),
        textColor=colors.HexColor("#4A4A45"), spaceBefore=3, spaceAfter=8,
    )
    list_style = ParagraphStyle(
        "List", parent=body_style, leftIndent=4, firstLineIndent=0, spaceAfter=2,
    )

    story: list[Flowable] = [
        Paragraph(inline_markdown(title), title_style),
        HorizontalRule(2, ACCENT_GOLD, 3, 7),
        Paragraph("GLOBAL INVESTMENT RESEARCH · AI GENERATED FROM ARCHIVED SOURCE", subtitle_style),
    ]

    def section_header(text: str) -> Table:
        paragraph = Paragraph(f"<b>{inline_markdown(text)}</b>", section_style)
        table = Table([[paragraph]], colWidths=[A4[0] - 32 * mm], rowHeights=[9 * mm], hAlign="LEFT")
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), NAVY),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ]))
        table.keepWithNext = True
        return table

    for block in blocks:
        kind = block["type"]
        if kind == "heading":
            if block["level"] <= 2:
                leading_space = Spacer(1, 5)
                trailing_space = Spacer(1, 5)
                trailing_space.keepWithNext = True
                story.extend([leading_space, section_header(block["text"]), trailing_space])
            else:
                story.append(Paragraph(inline_markdown(block["text"]), subsection_style))
        elif kind == "paragraph":
            story.append(Paragraph(inline_markdown(block["text"]), body_style))
        elif kind == "quote":
            story.append(Paragraph(inline_markdown(block["text"]), quote_style))
        elif kind == "list":
            items = [ListItem(Paragraph(inline_markdown(item), list_style), leftIndent=8) for item in block["items"]]
            story.append(ListFlowable(items, bulletType="bullet", start="circle", leftIndent=14, bulletFontName=FONT_REGULAR, bulletFontSize=5))
            story.append(Spacer(1, 4))
        elif kind == "rule":
            story.append(HorizontalRule(0.6, DIVIDER, 5, 5))
        elif kind == "table":
            rows: list[list[str]] = block["rows"]
            column_count = max(1, len(rows[0]))
            font_size = 7.4 if column_count <= 4 else 6.5 if column_count <= 6 else 5.8
            cell_style = ParagraphStyle(
                f"TableCell{column_count}", parent=body_style, fontSize=font_size,
                leading=font_size + 2.4, alignment=TA_CENTER, spaceAfter=0,
            )
            header_style = ParagraphStyle(
                f"TableHeader{column_count}", parent=cell_style, fontName=FONT_BOLD,
                textColor=colors.white,
            )
            rendered_rows = []
            for row_index, row in enumerate(rows):
                style = header_style if row_index == 0 else cell_style
                rendered_rows.append([Paragraph(inline_markdown(cell), style) for cell in row])
            width = A4[0] - 32 * mm
            table = Table(
                rendered_rows,
                colWidths=[width / column_count] * column_count,
                repeatRows=1,
                hAlign="LEFT",
                splitByRow=1,
            )
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, TABLE_ALT]),
                ("GRID", (0, 0), (-1, -1), 0.45, DIVIDER),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 3.5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3.5),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]))
            story.extend([Spacer(1, 5), table, Spacer(1, 8)])

    disclaimer = Paragraph(
        "内容由 AI 基于公开资料生成，不代表任何真实金融机构，不构成投资建议。",
        ParagraphStyle("Disclaimer", parent=body_style, fontSize=7.5, leading=11, textColor=TEXT_GREY),
    )
    story.extend([Spacer(1, 8), HorizontalRule(0.6, DIVIDER, 5, 7), KeepTogether([disclaimer])])

    def draw_page(canvas, document) -> None:
        canvas.saveState()
        page_width, page_height = A4
        canvas.setFillColor(NAVY_DEEP)
        canvas.rect(0, page_height - 14 * mm, page_width, 14 * mm, fill=1, stroke=0)
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 10)
        canvas.drawString(16 * mm, page_height - 9 * mm, "Goldman Sachs")
        canvas.setFont("Helvetica", 7)
        canvas.drawRightString(page_width - 16 * mm, page_height - 9 * mm, "Global Investment Research")
        canvas.setStrokeColor(ACCENT_GOLD)
        canvas.setLineWidth(1.5)
        canvas.line(0, page_height - 14 * mm, page_width, page_height - 14 * mm)
        canvas.setStrokeColor(DIVIDER)
        canvas.setLineWidth(0.5)
        canvas.line(16 * mm, 13 * mm, page_width - 16 * mm, 13 * mm)
        canvas.setFillColor(TEXT_GREY)
        canvas.setFont(FONT_REGULAR, 6.8)
        canvas.drawString(16 * mm, 8.5 * mm, "Confidential & Proprietary | For internal use only")
        canvas.drawRightString(page_width - 16 * mm, 8.5 * mm, f"Page {document.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=draw_page, onLaterPages=draw_page)


def main() -> int:
    parser = argparse.ArgumentParser(description="Render archived equity-research Markdown to PDF")
    parser.add_argument("--input", required=True, help="Archived Markdown source file")
    parser.add_argument("--output", required=True, help="Generated PDF path")
    parser.add_argument("--title", default="个股投资研究报告", help="Fallback report title")
    args = parser.parse_args()
    build_pdf(Path(args.input).resolve(), Path(args.output).resolve(), args.title.strip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
