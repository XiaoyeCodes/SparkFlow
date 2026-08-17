import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const TASK_ID_PATTERN = /^coze-[0-9]{13}-[a-f0-9]{12}$/;
const TASK_FILE_NAME = 'task.json';
const RAW_RESPONSE_FILE = 'raw-response.bin';
const RAW_HEADERS_FILE = 'raw-response.headers.json';
const ANSWER_FILE = 'answer-source.md';
const REPORT_FILE = 'report.md';
const GENERATED_PDF_FILE = 'generated.pdf';
const ORIGINAL_PDF_FILE = 'original.pdf';
const DEFAULT_MAX_BYTES = 24 * 1024 * 1024;
const BRANDING_LINE = /^(?:Goldman Sachs|Global Investment Research|Confidential\s*&\s*Proprietary.*|Page\s+\d+)$/i;

export type CozeReportTaskStatus = 'queued' | 'running' | 'completed' | 'failed';
export type CozeReportTaskStage = 'queued' | 'requesting' | 'archiving' | 'rendering' | 'extracting' | 'formatting' | 'completed' | 'failed';

export type CozeReportConfig = {
  url: string;
  token: string;
  projectId: string;
};

export type CozeTaskArtifact = {
  kind: 'raw-response' | 'answer-source' | 'original-pdf' | 'generated-pdf' | 'page-image' | 'embedded-image' | 'table';
  path: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  label: string;
  page?: number;
};

type CozeTaskRecord = {
  id: string;
  query: string;
  status: CozeReportTaskStatus;
  stage: CozeReportTaskStage;
  progress: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  warnings: string[];
  artifacts: CozeTaskArtifact[];
  responseContentType?: string;
};

export type CozeReportTaskSnapshot = Omit<CozeTaskRecord, 'artifacts'> & {
  markdown?: string;
  artifacts: Array<CozeTaskArtifact & { url: string }>;
};

type CozeReportTaskServiceOptions = {
  rootDir: string;
  stateDir?: string;
  maxBytes?: number;
  timeoutMs?: number;
  getConfig: () => CozeReportConfig;
  fetchImpl?: typeof fetch;
  pythonCommand?: string;
  reportScriptPath?: string;
};

type PdfTextItem = {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
};

type PdfTextRow = {
  y: number;
  items: PdfTextItem[];
};

type PdfExtractionResult = {
  text: string;
  pageArtifacts: CozeTaskArtifact[];
  imageArtifacts: CozeTaskArtifact[];
  tableArtifacts: CozeTaskArtifact[];
  tableMarkdown: string[];
};

function sha256(data: Buffer | string) {
  return createHash('sha256').update(data).digest('hex');
}

function safeTaskId(value: string) {
  const id = String(value || '').trim();
  if (!TASK_ID_PATTERN.test(id)) throw new Error('研报任务 ID 无效');
  return id;
}

function artifactUrl(taskId: string, relativePath: string) {
  const encoded = relativePath.split('/').map(encodeURIComponent).join('/');
  return `/api/coze/equity-research/tasks/${encodeURIComponent(taskId)}/files/${encoded}`;
}

function mimeForPath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.pdf') return 'application/pdf';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.md') return 'text/markdown; charset=utf-8';
  if (extension === '.json') return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function normalizeRelativePath(value: string) {
  const decoded = String(value || '').replace(/\\/g, '/');
  const segments = decoded.split('/').filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === '.' || segment === '..' || segment.includes('\0'))) {
    throw new Error('研报资源路径无效');
  }
  return segments.join('/');
}

async function writeFileAtomic(filePath: string, data: Buffer | string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, filePath);
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function artifactFromFile(
  taskDir: string,
  relativePath: string,
  kind: CozeTaskArtifact['kind'],
  label: string,
  page?: number,
) {
  const data = await readFile(path.join(taskDir, ...relativePath.split('/')));
  return {
    kind,
    path: relativePath,
    mimeType: mimeForPath(relativePath),
    bytes: data.length,
    sha256: sha256(data),
    label,
    ...(page ? { page } : {}),
  } satisfies CozeTaskArtifact;
}

function stripOuterMarkdownFence(value: string) {
  const normalized = value.replace(/\r\n?/g, '\n');
  const match = normalized.match(/^\s*```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```\s*$/i);
  return match ? match[1] : normalized;
}

function htmlToMarkdown(value: string) {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
  });
  turndown.use(gfm);
  turndown.addRule('preserveImageAlt', {
    filter: 'img',
    replacement: (_content, node) => {
      const element = node as any;
      const source = element.getAttribute('src') || '';
      const alt = element.getAttribute('alt') || '报告图片';
      return source ? `![${alt}](${source})` : `[图片：${alt}]`;
    },
  });
  return turndown.turndown(value);
}

export function buildLosslessDisplayMarkdown(source: string, query: string) {
  const exactContent = stripOuterMarkdownFence(source);
  const converted = /<\/?(?:html|body|h1|h2|h3|p|li|table|img|a)\b/i.test(exactContent)
    ? htmlToMarkdown(exactContent)
    : exactContent;
  const lines = converted.replace(/\r\n?/g, '\n').split('\n');
  const formatted = lines.map((line) => {
    const text = line.trim();
    if (!text || /^#{1,6}\s/.test(text) || /^[-*+]\s/.test(text) || /^\|/.test(text) || /^>/.test(text)) return line;
    if (/^(执行摘要|核心观点|公司简介|行业分析|市场环境|经营状况|财务(?:分析|表格|与经营质量)?|同业对比|估值与可比公司|股价与估值|基本面与技术面分析|投资建议|风险(?:矩阵与情景)?|研究结论|结论|数据来源与局限|附录)\s*[：:]?$/.test(text)) {
      return `## ${text.replace(/[：:]$/, '')}`;
    }
    if (/^(?:第\s*)?(?:[一二三四五六七八九十]+|\d+)[、.．]\s*[^。；]{2,48}$/.test(text)) return `## ${text}`;
    return line;
  }).join('\n').trim();
  return /^#\s+/m.test(formatted) ? formatted : `# ${query} 投资研究报告\n\n${formatted}`;
}

function parseSsePayload(raw: string) {
  const answers: string[] = [];
  const pdfReferences: string[] = [];
  let sawSse = false;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    sawSse = true;
    const eventData = line.slice(5).trim();
    if (!eventData || eventData === '[DONE]') continue;
    try {
      const payload = JSON.parse(eventData);
      collectAnswers(payload, answers);
      collectPdfReferences(payload, pdfReferences);
    } catch {
      // Keepalive or diagnostic text remains archived byte-for-byte in raw-response.bin.
    }
  }
  if (!sawSse) {
    try {
      const payload = JSON.parse(raw);
      collectAnswers(payload, answers);
      collectPdfReferences(payload, pdfReferences);
    } catch {
      answers.push(raw);
    }
  }
  collectPdfReferences(answers.join(''), pdfReferences);
  return { answer: answers.join(''), pdfReferences: [...new Set(pdfReferences)] };
}

function collectAnswers(value: unknown, answers: string[]) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectAnswers(item, answers));
    return;
  }
  const record = value as Record<string, unknown>;
  if (record.type === 'answer') {
    const content = record.content && typeof record.content === 'object' ? record.content as Record<string, unknown> : undefined;
    const answer = content?.answer ?? record.answer;
    if (typeof answer === 'string') answers.push(answer);
    return;
  }
  const direct = record.answer ?? (record.output && typeof record.output === 'object' ? (record.output as Record<string, unknown>).answer : undefined);
  if (typeof direct === 'string') answers.push(direct);
  for (const [key, item] of Object.entries(record)) {
    if (key === 'answer' || key === 'output' || key === 'content') continue;
    collectAnswers(item, answers);
  }
}

function collectPdfReferences(value: unknown, references: string[], parentMime = '') {
  if (typeof value === 'string') {
    const text = value.trim();
    if (/^data:application\/pdf;base64,/i.test(text)) references.push(text);
    for (const match of text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
      const candidate = match[0].replace(/[.,;，。；]+$/, '');
      if (/\.pdf(?:$|[?#])/i.test(candidate) || /pdf/i.test(parentMime)) references.push(candidate);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectPdfReferences(item, references, parentMime));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const mime = String(record.mime_type || record.content_type || record.media_type || parentMime || '');
  for (const [key, item] of Object.entries(record)) {
    collectPdfReferences(item, references, /mime|type/i.test(key) ? String(item || mime) : mime);
  }
}

function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
  options: { cwd?: string; env?: NodeJS.ProcessEnv; maxBytes?: number } = {},
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
    });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`进程执行超时：${command}`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      outputBytes += Buffer.byteLength(chunk);
      if (options.maxBytes && outputBytes > options.maxBytes) {
        child.kill();
        return;
      }
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (options.maxBytes && outputBytes > options.maxBytes) reject(new Error('研报脚本输出超过大小限制'));
      else if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} 执行失败（${code ?? 'unknown'}）：${stderr.trim() || stdout.trim()}`));
    });
  });
}

function textRowsFromContent(items: any[]) {
  const rows: PdfTextRow[] = [];
  for (const item of items) {
    const text = String(item?.str || '').trim();
    const transform = Array.isArray(item?.transform) ? item.transform : [];
    if (!text || transform.length < 6) continue;
    const x = Number(transform[4]) || 0;
    const y = Number(transform[5]) || 0;
    const width = Math.abs(Number(item?.width) || 0);
    const height = Math.abs(Number(item?.height) || Number(transform[3]) || 10);
    let row = rows.find((candidate) => Math.abs(candidate.y - y) < Math.max(2.5, height * 0.3));
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push({ x, y, width, height, text });
  }
  return rows
    .sort((left, right) => right.y - left.y)
    .map((row) => ({ ...row, items: row.items.sort((left, right) => left.x - right.x) }));
}

function rowsToText(rows: PdfTextRow[]) {
  return rows.map((row) => row.items.map((item) => item.text).join(' ').trim()).filter(Boolean).join('\n');
}

function escapeTableCell(value: string) {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function detectTables(rows: PdfTextRow[], pageWidth: number) {
  const results: string[] = [];
  let index = 0;
  while (index < rows.length) {
    const seed = rows[index];
    const columns = seed.items.length;
    const spread = columns > 1 ? seed.items.at(-1)!.x - seed.items[0].x : 0;
    if (columns < 2 || columns > 8 || spread < pageWidth * 0.24) {
      index += 1;
      continue;
    }
    const group = [seed];
    let cursor = index + 1;
    while (cursor < rows.length) {
      const candidate = rows[cursor];
      if (candidate.items.length !== columns) break;
      const aligned = candidate.items.every((item, column) => Math.abs(item.x - seed.items[column].x) < Math.max(18, pageWidth * 0.035));
      const verticalGap = Math.abs(group.at(-1)!.y - candidate.y);
      if (!aligned || verticalGap > Math.max(32, seed.items[0].height * 3.2)) break;
      group.push(candidate);
      cursor += 1;
    }
    if (group.length >= 3) {
      const matrix = group.map((row) => row.items.map((item) => escapeTableCell(item.text)));
      const header = matrix[0];
      results.push([
        `| ${header.join(' | ')} |`,
        `| ${header.map(() => '---').join(' | ')} |`,
        ...matrix.slice(1).map((cells) => `| ${cells.join(' | ')} |`),
      ].join('\n'));
      index = cursor;
    } else {
      index += 1;
    }
  }
  return results;
}

function isIgnorableComparisonLine(value: string) {
  return BRANDING_LINE.test(value.trim());
}

export function normalizeReportComparisonText(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_>#|\-]/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line && !isIgnorableComparisonLine(line))
    .join('\n');
}

async function resolvePdfObject(page: any, name: string) {
  return new Promise<any>((resolve) => {
    let settled = false;
    const finish = (value: any) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => finish(undefined), 2_000);
    try {
      const existing = page.objs.get(name, (value: any) => {
        clearTimeout(timer);
        finish(value);
      });
      if (existing) {
        clearTimeout(timer);
        finish(existing);
      }
    } catch {
      clearTimeout(timer);
      finish(undefined);
    }
  });
}

function findPdftoppmExecutable() {
  const configured = String(process.env.PDFTOPPM_PATH || '').trim();
  if (configured && existsSync(configured)) return configured;
  const executable = process.platform === 'win32' ? 'pdftoppm.exe' : 'pdftoppm';
  for (const entryValue of String(process.env.PATH || '').split(path.delimiter)) {
    const entry = entryValue.replace(/^"|"$/g, '').trim();
    if (!entry) continue;
    const direct = path.join(entry, executable);
    if (existsSync(direct)) return direct;
    if (process.platform === 'win32') {
      const bundled = path.resolve(entry, '..', '..', 'native', 'poppler', 'Library', 'bin', 'pdftoppm.exe');
      if (existsSync(bundled)) return bundled;
    }
  }
  return undefined;
}

async function renderPdfPagesWithPoppler(pdfPath: string, outputDir: string, pageCount: number) {
  const executable = findPdftoppmExecutable();
  if (!executable) return new Map<number, string>();
  const prefix = path.join(outputDir, 'poppler-page');
  try {
    await runProcess(executable, ['-png', '-r', '168', pdfPath, prefix], 120_000);
  } catch {
    return new Map<number, string>();
  }
  const files = (await readdir(outputDir))
    .filter((file) => /^poppler-page-\d+\.png$/i.test(file))
    .sort((left, right) => Number(left.match(/(\d+)\.png$/i)?.[1]) - Number(right.match(/(\d+)\.png$/i)?.[1]));
  const rendered = new Map<number, string>();
  for (let pageNumber = 1; pageNumber <= Math.min(pageCount, files.length); pageNumber += 1) {
    const relative = `assets/pages/page-${String(pageNumber).padStart(3, '0')}.png`;
    const target = path.join(outputDir, `page-${String(pageNumber).padStart(3, '0')}.png`);
    await rename(path.join(outputDir, files[pageNumber - 1]), target);
    rendered.set(pageNumber, relative);
  }
  return rendered;
}

function rgbaFromPdfImage(image: any) {
  const width = Number(image?.width) || 0;
  const height = Number(image?.height) || 0;
  const source = image?.data;
  if (!width || !height || !source || typeof source.length !== 'number') return undefined;
  const pixels = width * height;
  const rgba = new Uint8ClampedArray(pixels * 4);
  if (source.length === pixels * 4) {
    rgba.set(source);
  } else if (source.length === pixels * 3) {
    for (let sourceIndex = 0, targetIndex = 0; sourceIndex < source.length; sourceIndex += 3, targetIndex += 4) {
      rgba[targetIndex] = source[sourceIndex];
      rgba[targetIndex + 1] = source[sourceIndex + 1];
      rgba[targetIndex + 2] = source[sourceIndex + 2];
      rgba[targetIndex + 3] = 255;
    }
  } else if (source.length === pixels) {
    for (let index = 0; index < pixels; index += 1) {
      const value = source[index];
      const offset = index * 4;
      rgba[offset] = value;
      rgba[offset + 1] = value;
      rgba[offset + 2] = value;
      rgba[offset + 3] = 255;
    }
  } else if (source.length === Math.ceil(pixels / 8)) {
    for (let index = 0; index < pixels; index += 1) {
      const value = source[Math.floor(index / 8)] & (1 << (7 - (index % 8))) ? 255 : 0;
      const offset = index * 4;
      rgba[offset] = value;
      rgba[offset + 1] = value;
      rgba[offset + 2] = value;
      rgba[offset + 3] = 255;
    }
  } else {
    return undefined;
  }
  return { width, height, rgba };
}

async function extractPdfArtifacts(taskId: string, taskDir: string, pdfPath: string): Promise<PdfExtractionResult> {
  const canvasApi = await import('@napi-rs/canvas');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const globals = globalThis as any;
  if (!globals.DOMMatrix) globals.DOMMatrix = canvasApi.DOMMatrix;
  if (!globals.ImageData) globals.ImageData = canvasApi.ImageData;
  if (!globals.Path2D) globals.Path2D = canvasApi.Path2D;
  const data = await readFile(pdfPath);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(data),
    disableWorker: true,
    disableFontFace: false,
    useSystemFonts: true,
  } as any);
  const document = await loadingTask.promise;
  const pageArtifacts: CozeTaskArtifact[] = [];
  const imageArtifacts: CozeTaskArtifact[] = [];
  const tableArtifacts: CozeTaskArtifact[] = [];
  const textPages: string[] = [];
  const tableMarkdown: string[] = [];
  const seenImages = new Set<string>();
  const renderedPages = await renderPdfPagesWithPoppler(pdfPath, path.join(taskDir, 'assets', 'pages'), document.numPages);
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.75 });
      const pageRelative = `assets/pages/page-${String(pageNumber).padStart(3, '0')}.png`;
      if (!renderedPages.has(pageNumber)) {
        const canvas = canvasApi.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const context = canvas.getContext('2d');
        await page.render({ canvas, canvasContext: context as any, viewport } as any).promise;
        await writeFile(path.join(taskDir, ...pageRelative.split('/')), canvas.toBuffer('image/png'));
      }
      pageArtifacts.push(await artifactFromFile(taskDir, pageRelative, 'page-image', `PDF 第 ${pageNumber} 页视觉存档`, pageNumber));

      const content = await page.getTextContent();
      const rows = textRowsFromContent(content.items as any[]);
      const pageText = rowsToText(rows);
      if (pageText) textPages.push(pageText);
      const tables = detectTables(rows, viewport.width / 1.75);
      for (let tableIndex = 0; tableIndex < tables.length; tableIndex += 1) {
        const markdown = tables[tableIndex];
        const tableRelative = `assets/tables/page-${String(pageNumber).padStart(3, '0')}-table-${String(tableIndex + 1).padStart(2, '0')}.md`;
        await writeFile(path.join(taskDir, ...tableRelative.split('/')), `${markdown}\n`, 'utf8');
        tableArtifacts.push(await artifactFromFile(taskDir, tableRelative, 'table', `第 ${pageNumber} 页表格 ${tableIndex + 1}`, pageNumber));
        tableMarkdown.push(markdown);
      }

      try {
        const operatorList = await page.getOperatorList();
        let imageIndex = 0;
        for (let operatorIndex = 0; operatorIndex < operatorList.fnArray.length; operatorIndex += 1) {
          const fn = operatorList.fnArray[operatorIndex];
          const args = operatorList.argsArray[operatorIndex];
          let image: any;
          if (fn === pdfjs.OPS.paintInlineImageXObject) image = args?.[0];
          if (fn === pdfjs.OPS.paintImageXObject && typeof args?.[0] === 'string') image = await resolvePdfObject(page, args[0]);
          const decoded = rgbaFromPdfImage(image);
          if (!decoded || decoded.width < 24 || decoded.height < 24) continue;
          const fingerprint = sha256(Buffer.from(decoded.rgba));
          if (seenImages.has(fingerprint)) continue;
          seenImages.add(fingerprint);
          imageIndex += 1;
          const imageCanvas = canvasApi.createCanvas(decoded.width, decoded.height);
          const imageContext = imageCanvas.getContext('2d');
          const imageData = imageContext.createImageData(decoded.width, decoded.height);
          imageData.data.set(decoded.rgba);
          imageContext.putImageData(imageData, 0, 0);
          const imageRelative = `assets/images/page-${String(pageNumber).padStart(3, '0')}-image-${String(imageIndex).padStart(2, '0')}.png`;
          await writeFile(path.join(taskDir, ...imageRelative.split('/')), imageCanvas.toBuffer('image/png'));
          imageArtifacts.push(await artifactFromFile(taskDir, imageRelative, 'embedded-image', `第 ${pageNumber} 页图片 ${imageIndex}`, pageNumber));
        }
      } catch {
        // The rendered page remains the visual-lossless fallback for vector-only or unsupported images.
      }
      page.cleanup();
    }
  } finally {
    await document.destroy();
  }
  return {
    text: textPages.join('\n\n'),
    pageArtifacts,
    imageArtifacts,
    tableArtifacts,
    tableMarkdown,
  };
}

async function loadPdfReference(reference: string, token: string, maxBytes: number, fetchImpl: typeof fetch) {
  if (/^data:application\/pdf;base64,/i.test(reference)) {
    const data = Buffer.from(reference.slice(reference.indexOf(',') + 1), 'base64');
    if (data.length > maxBytes) throw new Error('外部研报 PDF 超过大小限制');
    return data;
  }
  const url = new URL(reference);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('外部研报 PDF 地址无效');
  const response = await fetchImpl(url, {
    headers: /(?:^|\.)coze\.(?:cn|site)$/i.test(url.hostname) ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error(`外部研报 PDF 下载失败：HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > maxBytes) throw new Error('外部研报 PDF 超过大小限制');
  if (data.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('外部文件不是有效 PDF');
  return data;
}

function buildAssetAppendix(taskId: string, extraction: PdfExtractionResult) {
  const sections: string[] = [];
  if (extraction.tableArtifacts.length) {
    const tables = extraction.tableArtifacts.map((artifact, index) => {
      const sourceLink = artifactUrl(taskId, artifact.path);
      return `### 提取表格 ${index + 1} · 第 ${artifact.page} 页\n\n[下载独立表格文件](${sourceLink})\n\n${extraction.tableMarkdown[index]}`;
    });
    sections.push(`## PDF 表格复原\n\n${tables.join('\n\n')}`);
  }
  if (extraction.imageArtifacts.length) {
    const images = extraction.imageArtifacts.map((artifact) => `![${artifact.label}](${artifactUrl(taskId, artifact.path)})`);
    sections.push(`## PDF 图片与图表\n\n${images.join('\n\n')}`);
  }
  if (extraction.pageArtifacts.length) {
    const pages = extraction.pageArtifacts.map((artifact) => `### 第 ${artifact.page} 页视觉存档\n\n![${artifact.label}](${artifactUrl(taskId, artifact.path)})`);
    sections.push(`## PDF 原始页面视觉校验\n\n> 页面影像用于保留矢量图、复杂图表和无法结构化的版式信息；正文仍以以上 Markdown 为准。\n\n${pages.join('\n\n')}`);
  }
  return sections.length ? `\n\n---\n\n${sections.join('\n\n')}` : '';
}

export class CozeReportTaskService {
  private readonly rootDir: string;
  private readonly tasksDir: string;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly getConfig: () => CozeReportConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly pythonCommand: string;
  private readonly reportScriptPath: string;
  private readonly running = new Set<string>();
  private readonly initialized: Promise<void>;

  constructor(options: CozeReportTaskServiceOptions) {
    this.rootDir = options.rootDir;
    this.tasksDir = path.join(options.stateDir || path.join(options.rootDir, '.sparkflow'), 'coze-reports');
    this.maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
    this.timeoutMs = options.timeoutMs || 360_000;
    this.getConfig = options.getConfig;
    this.fetchImpl = options.fetchImpl || fetch;
    this.pythonCommand = options.pythonCommand || process.env.COZE_REPORT_PYTHON || 'python';
    this.reportScriptPath = options.reportScriptPath || path.join(this.rootDir, 'scripts', 'generate-equity-report.py');
    this.initialized = this.recoverInterruptedTasks();
  }

  private taskDir(taskId: string) {
    return path.join(this.tasksDir, safeTaskId(taskId));
  }

  private taskFile(taskId: string) {
    return path.join(this.taskDir(taskId), TASK_FILE_NAME);
  }

  private async readRecord(taskId: string) {
    const raw = await readFile(this.taskFile(taskId), 'utf8');
    return JSON.parse(raw) as CozeTaskRecord;
  }

  private async saveRecord(record: CozeTaskRecord) {
    record.updatedAt = new Date().toISOString();
    await writeJsonAtomic(this.taskFile(record.id), record);
    return record;
  }

  private async patchRecord(taskId: string, patch: Partial<CozeTaskRecord>) {
    const record = await this.readRecord(taskId);
    return this.saveRecord({ ...record, ...patch, id: record.id, query: record.query });
  }

  private async recoverInterruptedTasks() {
    await mkdir(this.tasksDir, { recursive: true });
    const entries = await readdir(this.tasksDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !TASK_ID_PATTERN.test(entry.name)) continue;
      try {
        const record = await this.readRecord(entry.name);
        if (record.status !== 'queued' && record.status !== 'running') continue;
        await this.saveRecord({
          ...record,
          status: 'failed',
          stage: 'failed',
          progress: record.progress,
          error: '服务进程曾在任务完成前停止；原始产物已保留，请重新发起任务。',
        });
      } catch {
        // A corrupt task directory is isolated and never blocks other reports.
      }
    }
  }

  async createTask(queryValue: string) {
    await this.initialized;
    const query = String(queryValue || '').trim().replace(/\s*cz$/i, '').trim();
    if (!query) throw new Error('请输入股票代码或公司名称');
    if (query.length > 120) throw new Error('股票代码或公司名称过长');
    const id = `coze-${Date.now()}-${randomBytes(6).toString('hex')}`;
    const createdAt = new Date().toISOString();
    const record: CozeTaskRecord = {
      id,
      query,
      status: 'queued',
      stage: 'queued',
      progress: 0,
      createdAt,
      updatedAt: createdAt,
      warnings: [],
      artifacts: [],
    };
    await mkdir(this.taskDir(id), { recursive: true });
    await this.saveRecord(record);
    void this.runTask(id);
    return this.getTask(id);
  }

  async getTask(taskIdValue: string): Promise<CozeReportTaskSnapshot> {
    await this.initialized;
    const taskId = safeTaskId(taskIdValue);
    const record = await this.readRecord(taskId);
    const reportPath = path.join(this.taskDir(taskId), REPORT_FILE);
    const markdown = existsSync(reportPath) ? await readFile(reportPath, 'utf8') : undefined;
    return {
      ...record,
      ...(markdown ? { markdown } : {}),
      artifacts: record.artifacts.map((artifact) => ({ ...artifact, url: artifactUrl(taskId, artifact.path) })),
    };
  }

  async listTasks(limit = 40) {
    await this.initialized;
    const entries = await readdir(this.tasksDir, { withFileTypes: true });
    const records: CozeReportTaskSnapshot[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !TASK_ID_PATTERN.test(entry.name)) continue;
      try {
        records.push(await this.getTask(entry.name));
      } catch {
        // Ignore corrupt tasks while keeping all valid history available.
      }
    }
    return records.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)).slice(0, limit);
  }

  async readTaskFile(taskIdValue: string, relativePathValue: string) {
    await this.initialized;
    const taskId = safeTaskId(taskIdValue);
    const relativePath = normalizeRelativePath(relativePathValue);
    const taskDir = this.taskDir(taskId);
    const resolved = path.resolve(taskDir, ...relativePath.split('/'));
    const prefix = `${path.resolve(taskDir)}${path.sep}`;
    if (!resolved.startsWith(prefix)) throw new Error('研报资源路径越界');
    const info = await stat(resolved);
    if (!info.isFile()) throw new Error('研报资源不存在');
    return {
      data: await readFile(resolved),
      mimeType: mimeForPath(resolved),
      fileName: path.basename(resolved),
    };
  }

  private async archiveArtifact(taskId: string, relativePath: string, kind: CozeTaskArtifact['kind'], label: string, page?: number) {
    const artifact = await artifactFromFile(this.taskDir(taskId), relativePath, kind, label, page);
    const record = await this.readRecord(taskId);
    const artifacts = [...record.artifacts.filter((item) => item.path !== artifact.path), artifact];
    await this.saveRecord({ ...record, artifacts });
    return artifact;
  }

  private async runTask(taskId: string) {
    if (this.running.has(taskId)) return;
    this.running.add(taskId);
    const taskDir = this.taskDir(taskId);
    try {
      let record = await this.patchRecord(taskId, { status: 'running', stage: 'requesting', progress: 8, error: undefined });
      const config = this.getConfig();
      const result = await runProcess(
        this.pythonCommand,
        [
          this.reportScriptPath,
          record.query,
          '--timeout',
          String(Math.max(30, Math.floor((this.timeoutMs - 15_000) / 1000))),
        ],
        this.timeoutMs,
        {
          cwd: this.rootDir,
          env: {
            COZE_REPORT_TOKEN: config.token,
            COZE_REPORT_URL: config.url,
            COZE_REPORT_PROJECT_ID: config.projectId,
            PYTHONIOENCODING: 'utf-8',
            PYTHONUTF8: '1',
          },
          maxBytes: this.maxBytes,
        },
      );
      const answer = result.stdout;
      if (!answer.trim()) throw new Error('研报脚本没有返回正文');
      const data = Buffer.from(answer, 'utf8');
      await writeFile(path.join(taskDir, RAW_RESPONSE_FILE), data);
      const rawArtifact = await this.archiveArtifact(taskId, RAW_RESPONSE_FILE, 'raw-response', '研报脚本完整输出');
      await writeJsonAtomic(path.join(taskDir, RAW_HEADERS_FILE), {
        capturedAt: new Date().toISOString(),
        source: 'scripts/generate-equity-report.py',
        endpoint: config.url,
        contentType: 'text/markdown; charset=utf-8',
        bytes: rawArtifact.bytes,
        sha256: rawArtifact.sha256,
      });
      record = await this.patchRecord(taskId, {
        stage: 'archiving',
        progress: 62,
        responseContentType: 'text/markdown; charset=utf-8',
      });
      await writeFile(path.join(taskDir, ANSWER_FILE), answer, 'utf8');
      await this.archiveArtifact(taskId, ANSWER_FILE, 'answer-source', '完整研报源文件');
      await this.patchRecord(taskId, { stage: 'formatting', progress: 82, warnings: record.warnings });
      record = await this.readRecord(taskId);
      const report = `${buildLosslessDisplayMarkdown(answer, record.query)}\n`;
      await writeFile(path.join(taskDir, REPORT_FILE), report, 'utf8');
      const completedAt = new Date().toISOString();
      await this.saveRecord({
        ...record,
        status: 'completed',
        stage: 'completed',
        progress: 100,
        completedAt,
        error: undefined,
        warnings: record.warnings,
      });
    } catch (error) {
      try {
        if (process.env.SPARKFLOW_DEBUG_COZE === '1') console.error(error);
        const message = error instanceof Error ? error.message : String(error);
        await this.patchRecord(taskId, { status: 'failed', stage: 'failed', error: message });
      } catch {
        // The original failure is more useful than a secondary metadata write failure.
      }
    } finally {
      this.running.delete(taskId);
    }
  }
}
