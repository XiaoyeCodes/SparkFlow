type ReportBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; rows: string[][] }
  | { type: 'rule' }
  | { type: 'code'; text: string };

type PdfPage = { element: HTMLDivElement; body: HTMLDivElement };

const pageWidth = 794;
const pageHeight = 1123;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character] || character));
}

function inlineMarkdown(value: string) {
  return escapeHtml(value.trim())
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<span class="sf-pdf-link">$1</span>');
}

function isTableDivider(line: string) {
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(line.trim());
}

function splitOversizedText(text: string, maximum = 460) {
  if (text.length <= maximum) return [text];
  const pieces: string[] = [];
  let pending = text;
  while (pending.length > maximum) {
    const naturalBreak = Math.max(
      pending.lastIndexOf('。', maximum),
      pending.lastIndexOf('；', maximum),
      pending.lastIndexOf('，', maximum),
      pending.lastIndexOf('. ', maximum),
      pending.lastIndexOf(' ', maximum),
    );
    const position = naturalBreak > Math.floor(maximum * 0.5) ? naturalBreak + 1 : maximum;
    pieces.push(pending.slice(0, position).trim());
    pending = pending.slice(position).trim();
  }
  if (pending) pieces.push(pending);
  return pieces;
}

function markdownBlocks(markdown: string): ReportBlock[] {
  const lines = markdown.replace(/\r/g, '').split('\n');
  const blocks: ReportBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let codeLines: string[] | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    splitOversizedText(paragraph.join(' ').replace(/\s+/g, ' ').trim()).forEach((text) => {
      if (text) blocks.push({ type: 'paragraph', text });
    });
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push({ type: 'list', ...list });
    list = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      flushParagraph();
      flushList();
      if (codeLines) {
        blocks.push({ type: 'code', text: codeLines.join('\n') });
        codeLines = null;
      } else {
        codeLines = [];
      }
      continue;
    }
    if (codeLines) {
      codeLines.push(line);
      continue;
    }
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'rule' });
      continue;
    }
    if (trimmed.startsWith('>')) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'quote', text: trimmed.replace(/^>\s?/, '') });
      continue;
    }
    if (trimmed.startsWith('|')) {
      flushParagraph();
      flushList();
      const tableLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        tableLines.push(lines[index].trim());
        index += 1;
      }
      index -= 1;
      const rows = tableLines
        .filter((tableLine) => !isTableDivider(tableLine))
        .map((tableLine) => tableLine.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()));
      if (rows.length) blocks.push({ type: 'table', rows });
      continue;
    }

    const listItem = trimmed.match(/^(?:([-*+])|(\d+)[.)])\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      const ordered = Boolean(listItem[2]);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(listItem[3]);
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  if (codeLines?.length) blocks.push({ type: 'code', text: codeLines.join('\n') });
  return blocks;
}

function reportTitle(markdown: string) {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.replace(/[*`]/g, '').trim();
  return heading || 'AI 深度研究报告';
}

function fileName(title: string) {
  const stamp = new Date().toISOString().slice(0, 10);
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 48) || 'AI-Research';
  return `SparkFlow-${safeTitle}-${stamp}.pdf`;
}

function reportDate() {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date()).replace(/\//g, '.');
}

function pageStyle() {
  return `
    box-sizing:border-box; width:${pageWidth}px; height:${pageHeight}px; overflow:hidden; position:relative;
    color:#dbe8ea; background:#071018;
    font-family:"SF Pro Display","PingFang SC","Microsoft YaHei",Arial,sans-serif;
  `;
}

function createPage(pageNumber: number, title: string, first: boolean): PdfPage {
  const element = document.createElement('div');
  element.style.cssText = pageStyle();
  const frame = document.createElement('div');
  frame.style.cssText = 'position:absolute;inset:22px;border:1px solid rgba(185,222,222,.12);border-radius:18px;pointer-events:none;';
  const topTint = document.createElement('div');
  topTint.style.cssText = 'position:absolute;right:0;top:0;width:370px;height:420px;background:rgba(42,125,121,.12);border-radius:0 0 0 260px;pointer-events:none;';
  const bottomTint = document.createElement('div');
  bottomTint.style.cssText = 'position:absolute;left:0;bottom:0;width:335px;height:380px;background:rgba(35,77,126,.13);border-radius:0 250px 0 0;pointer-events:none;';
  const pageGlow = document.createElement('div');
  pageGlow.style.cssText = 'position:absolute;right:-92px;top:112px;width:255px;height:255px;border:1px solid rgba(103,226,202,.15);border-radius:50%;box-shadow:0 0 88px rgba(69,207,185,.11);pointer-events:none;';
  const header = document.createElement('header');
  header.style.cssText = 'height:148px;box-sizing:border-box;padding:42px 52px 20px;position:relative;overflow:hidden;';
  header.innerHTML = `
    <div style="position:absolute;left:52px;right:52px;bottom:0;height:1px;background:rgba(123,220,206,.52);"></div>
    <div style="display:flex;align-items:center;gap:11px;font:700 10px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:2px;color:#91ead8;"><span style="display:inline-flex;width:21px;height:21px;align-items:center;justify-content:center;border:1px solid rgba(145,234,216,.62);border-radius:6px;color:#e0fffa;font-size:11px;letter-spacing:0;">S</span>SPARKFLOW</div>
    <div style="margin-top:12px;font:600 16px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.8px;color:#f0f8f8;">${first ? 'AI RESEARCH REPORT' : `SECTION ${String(pageNumber).padStart(2, '0')} / CONTINUED`}</div>
    <div style="position:absolute;right:52px;top:46px;text-align:right;"><div style="font:700 8px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:1.5px;color:#8cb0c7;">${first ? 'INTELLIGENCE NOTE' : 'RESEARCH CONTINUATION'}</div><div style="margin-top:8px;font:700 11px/1 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:1px;color:#dcebef;">PAGE ${String(pageNumber).padStart(2, '0')}</div></div>
  `;
  const body = document.createElement('div');
  body.style.cssText = 'height:917px;box-sizing:border-box;overflow:hidden;padding:32px 52px 20px;';
  if (first) {
    const intro = document.createElement('section');
    intro.style.cssText = 'margin:0 0 25px;padding:20px 24px 22px;border:1px solid rgba(172,221,219,.16);border-radius:14px;background:rgba(24,51,62,.66);box-shadow:inset 0 1px 0 rgba(227,255,252,.07);';
    intro.innerHTML = `
      <div style="font:700 9px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:1.8px;color:#8dcff2;">SIGNAL SYNTHESIS / VERIFIED RESEARCH</div>
      <h1 style="max-width:620px;margin:15px 0 12px;font-size:27px;line-height:1.26;letter-spacing:-.55px;color:#f5fbfb;">${inlineMarkdown(title)}</h1>
      <div style="display:flex;gap:12px;align-items:center;font:500 10px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.4px;color:#adc5c6;"><span>GENERATED ${reportDate()}</span><span style="color:#87e4d1;">●</span><span>RESEARCH REFERENCE ONLY</span></div>
    `;
    body.appendChild(intro);
  } else {
    const continuation = document.createElement('div');
    continuation.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:0 0 22px;padding:13px 16px;border-left:3px solid #82decf;border-radius:0 10px 10px 0;background:rgba(42,90,94,.24);font:600 10px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:1.1px;color:#b7d8d2;';
    continuation.innerHTML = `<span>${escapeHtml(title)}</span><span style="color:#78b9da;">CONTINUED</span>`;
    body.appendChild(continuation);
  }
  const footer = document.createElement('footer');
  footer.style.cssText = 'position:absolute;left:52px;right:52px;bottom:0;height:58px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid rgba(178,223,222,.18);font:500 8px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:1px;color:#8fa7aa;';
  footer.innerHTML = `<span>SPARKFLOW INTELLIGENCE SYSTEM</span><span style="color:#7edbc7;">${String(pageNumber).padStart(2, '0')}</span><span>FOR RESEARCH REFERENCE ONLY</span>`;
  element.append(topTint, bottomTint, frame, pageGlow, header, body, footer);
  return { element, body };
}

function createBlockElement(block: ReportBlock) {
  const element = document.createElement('section');
  element.style.cssText = 'break-inside:avoid;';
  if (block.type === 'heading') {
    const size = block.level === 1 ? '24px' : block.level === 2 ? '18px' : '14px';
    const color = block.level === 1 ? '#f4fffb' : block.level === 2 ? '#8cf0d2' : '#c8e8de';
    element.style.cssText += `margin:${block.level === 1 ? '28px' : '23px'} 0 11px;`;
    element.innerHTML = `<h${block.level} style="margin:0;font-size:${size};line-height:1.38;font-weight:${block.level === 3 ? 700 : 650};letter-spacing:${block.level === 1 ? '-.4px' : '.1px'};color:${color};">${inlineMarkdown(block.text)}</h${block.level}>`;
    return element;
  }
  if (block.type === 'paragraph') {
    element.style.cssText += 'margin:0 0 14px;font-size:13px;line-height:1.9;color:#d7e4e6;letter-spacing:.1px;';
    element.innerHTML = `<p style="margin:0;">${inlineMarkdown(block.text)}</p>`;
    return element;
  }
  if (block.type === 'quote') {
    element.style.cssText += 'margin:0 0 16px;padding:12px 15px;border-left:3px solid #85dfcd;border-radius:0 10px 10px 0;background:rgba(95,201,185,.10);font-size:13px;line-height:1.75;color:#e0f0ee;';
    element.innerHTML = inlineMarkdown(block.text);
    return element;
  }
  if (block.type === 'rule') {
    element.style.cssText += 'height:1px;margin:20px 0;background:rgba(110,229,199,.58);';
    return element;
  }
  if (block.type === 'code') {
    element.style.cssText += 'margin:0 0 16px;padding:13px 15px;overflow:hidden;background:#031011;border:1px solid rgba(128,237,210,.18);font:11px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace;color:#a7e7d4;white-space:pre-wrap;';
    element.textContent = block.text;
    return element;
  }
  if (block.type === 'list') {
    element.style.cssText += 'margin:0 0 16px;padding-left:21px;font-size:13px;line-height:1.75;color:#d0e4de;';
    const list = document.createElement(block.ordered ? 'ol' : 'ul');
    list.style.cssText = 'margin:0;padding:0 0 0 17px;';
    block.items.forEach((item) => {
      const listItem = document.createElement('li');
      listItem.style.cssText = 'margin:0 0 5px;padding-left:3px;';
      listItem.innerHTML = inlineMarkdown(item);
      list.appendChild(listItem);
    });
    element.appendChild(list);
    return element;
  }
  element.style.cssText += 'margin:0 0 17px;border:1px solid rgba(128,237,210,.20);overflow:hidden;';
  const columnCount = Math.max(...block.rows.map((row) => row.length));
  block.rows.forEach((row, rowIndex) => {
    const tableRow = document.createElement('div');
    tableRow.style.cssText = `display:grid;grid-template-columns:repeat(${columnCount},minmax(0,1fr));background:${rowIndex === 0 ? 'rgba(110,229,199,.12)' : rowIndex % 2 ? 'rgba(255,255,255,.025)' : 'transparent'};border-bottom:${rowIndex === block.rows.length - 1 ? '0' : '1px solid rgba(128,237,210,.13)'};`;
    row.forEach((cell) => {
      const tableCell = document.createElement('div');
      tableCell.style.cssText = `min-width:0;padding:8px 9px;border-right:1px solid rgba(128,237,210,.11);font-size:10px;line-height:1.5;color:${rowIndex === 0 ? '#e5fff7' : '#c7ddd7'};font-weight:${rowIndex === 0 ? 700 : 500};`;
      tableCell.innerHTML = inlineMarkdown(cell);
      tableRow.appendChild(tableCell);
    });
    element.appendChild(tableRow);
  });
  return element;
}

export async function exportSparkFlowResearchPdf(markdown: string) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const title = reportTitle(markdown);
  const pagesRoot = document.createElement('div');
  pagesRoot.style.cssText = `position:fixed;left:-${pageWidth + 80}px;top:0;width:${pageWidth}px;z-index:-1;pointer-events:none;`;
  document.body.appendChild(pagesRoot);

  try {
    const pages: PdfPage[] = [];
    let page = createPage(1, title, true);
    pages.push(page);
    pagesRoot.appendChild(page.element);
    let titleHeadingSkipped = false;
    markdownBlocks(markdown).forEach((block) => {
      if (!titleHeadingSkipped && block.type === 'heading' && block.level === 1 && block.text.replace(/[*`]/g, '').trim() === title) {
        titleHeadingSkipped = true;
        return;
      }
      const blockElement = createBlockElement(block);
      page.body.appendChild(blockElement);
      if (page.body.scrollHeight > page.body.clientHeight + 1) {
        page.body.removeChild(blockElement);
        page = createPage(pages.length + 1, title, false);
        pages.push(page);
        pagesRoot.appendChild(page.element);
        page.body.appendChild(blockElement);
      }
    });

    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const canvases = await Promise.all(pages.map((pageItem) => html2canvas(pageItem.element, {
      scale: 2,
      backgroundColor: '#071018',
      useCORS: true,
      logging: false,
    })));
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    pdf.setProperties({ title, author: 'SparkFlow Intelligence System', subject: 'AI Deep Research Report' });
    canvases.forEach((canvas, index) => {
      if (index > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297, undefined, 'FAST');
    });
    pdf.save(fileName(title));
  } finally {
    pagesRoot.remove();
  }
}
