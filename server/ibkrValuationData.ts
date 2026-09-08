import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ProxyAgent, fetch as upstreamFetch } from 'undici';
import type { ValuationInputs, ValuationSeries } from '../src/lib/ibkr/valuationTypes.ts';

type Point = ValuationSeries['points'][number];
type SeriesKey = keyof ValuationInputs['series'];
const root = process.cwd();
const stateDir = path.join(root, '.sparkflow', 'valuation');
const DAY = 86_400_000;
const SOURCES = {
  pe: ['Multpl · 标普500 TTM as-reported P/E', 'https://www.multpl.com/s-p-500-pe-ratio/table/by-month'],
  forwardYield: ['FactSet · 标普500未来12个月一致预期', 'https://insight.factset.com/topic/earnings'],
  treasury10y: ['FRED · 美联储 DGS10', 'https://fred.stlouisfed.org/series/DGS10'],
  fearGreed: ['CNN · Fear & Greed', 'https://www.cnn.com/markets/fear-and-greed'],
} as const;
const proxy = new ProxyAgent(process.env.SPARKFLOW_VALUATION_PROXY || 'http://127.0.0.1:7890');
let cache: { at: number; data: ValuationInputs } | undefined;
let flight: Promise<ValuationInputs> | undefined;
const slowCache = new Map<SeriesKey, { at: number; value: ValuationSeries }>();

/** Always settle source work even when a PDF worker or network cleanup stalls. */
export function valuationDeadline<T>(work: Promise<T>, milliseconds: number, cancel?: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { cancel?.(); } catch { /* Cancellation must not hold up the response. */ }
      reject(new Error('VALUATION_SOURCE_TIMEOUT'));
    }, milliseconds);
    work.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

function finite(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function missing(key: SeriesKey, note: string): ValuationSeries {
  const source = key in SOURCES ? SOURCES[key as keyof typeof SOURCES] : [`IBKR · ${key.toUpperCase()} IND`, 'https://www.interactivebrokers.com/docs/tws-api/doc/introduction'];
  return { points: [], current: null, asOf: null, source: source[0], sourceUrl: source[1], status: 'missing', note };
}
export function cleanValuationPoints(rows: unknown, minimum = 0, maximum = 1e9): Point[] {
  if (!Array.isArray(rows)) return [];
  const unique = new Map<string, Point>();
  const earliest = Date.now() - DAY * 366 * 11;
  for (const row of rows) {
    if (!row || typeof row !== 'object' || typeof row.date !== 'string') continue;
    const stamp = Date.parse(row.date); const value = finite(row.value);
    if (!Number.isFinite(stamp) || stamp > Date.now() + 60_000 || stamp < earliest || value === null || value < minimum || value > maximum) continue;
    const date = new Date(stamp).toISOString().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(row.date) && date !== row.date) continue;
    unique.set(date, { date, value });
  }
  return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date));
}
function textOnly(html: string) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;|&#xA0;/gi, ' ').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Math.min(0x10ffff, parseInt(code, 16))))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Math.min(0x10ffff, Number(code))))
    .replace(/\s+/g, ' ').trim();
}
function datedSeries(key: SeriesKey, points: Point[], note: string, maxAgeDays: number): ValuationSeries {
  const latest = points.at(-1); const item = missing(key, note);
  if (!latest) return item;
  return { ...item, points, current: latest.value, asOf: latest.date,
    status: Date.now() - Date.parse(latest.date) > maxAgeDays * DAY ? 'stale' : 'snapshot' };
}

async function fetchText(url: string, timeoutMs = 6000) {
  // Matches the project's established local proxy, then tries a bounded direct
  // connection. URLs are fixed source URLs, never supplied by the browser.
  const routes = new URL(url).hostname === 'fred.stlouisfed.org' ? [undefined, proxy] : [proxy, undefined];
  for (const dispatcher of routes) {
    try {
      const response = await upstreamFetch(url, { dispatcher, signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': 'Mozilla/5.0 SparkFlow/1.0', Accept: 'text/html,application/json,text/csv,*/*',
          ...(url.includes('dataviz.cnn.io') ? { Referer: SOURCES.fearGreed[1], Origin: 'https://www.cnn.com' } : {}) } });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP_${response.status}`); }
      const value = await response.text();
      if (value.length > 2_000_000) throw new Error('RESPONSE_TOO_LARGE');
      return value;
    } catch { /* Try the other configured route. */ }
  }
  throw new Error('SOURCE_UNAVAILABLE');
}

export function parseMultplPe(html: string): Point[] {
  if (!/S&amp;P 500 PE Ratio|S&P 500 PE Ratio/.test(html)) return [];
  const points: Point[] = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => textOnly(cell[1]));
    if (cells.length !== 2) continue;
    const parsedDate = Date.parse(`${cells[0]} UTC`);
    const value = Number(cells[1].replace(/[^\d.\-]/g, ''));
    if (!Number.isFinite(parsedDate) || !Number.isFinite(value) || value <= 0) continue;
    points.push({ date: new Date(parsedDate).toISOString().slice(0, 10), value });
  }
  return cleanValuationPoints(points, 0.01, 1000);
}

export function parseFredCsv(csv: string, seriesId: string): Point[] {
  const lines = csv.trim().split(/\r?\n/); const columns = lines.shift()?.replace(/^\uFEFF/, '').split(',') || [];
  const index = columns.indexOf(seriesId);
  if (index < 1 || !['DATE', 'observation_date'].includes(columns[0])) return [];
  return cleanValuationPoints(lines.flatMap(line => {
    const values = line.split(','); const raw = values[index]?.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values[0]) || !raw || raw === '.') return [];
    return [{ date: values[0], value: Number(raw) }];
  }), seriesId === 'DGS10' ? -10 : 0.0001, seriesId === 'DGS10' ? 100 : 1e9);
}
export function parseDgs10Csv(csv: string): Point[] { return parseFredCsv(csv, 'DGS10'); }

export function parseCnnFearGreed(payload: unknown): ValuationSeries {
  const item = missing('fearGreed', 'CNN 快照尚未返回');
  if (!payload || typeof payload !== 'object') return item;
  const raw = payload as Record<string, any>; const current = finite(raw.fear_and_greed?.score);
  const stamp = Date.parse(raw.fear_and_greed?.timestamp);
  if (current === null || current < 0 || current > 100 || !Number.isFinite(stamp) || stamp > Date.now() + 60_000) return item;
  const points = cleanValuationPoints((Array.isArray(raw.fear_and_greed_historical?.data) ? raw.fear_and_greed_historical.data : []).flatMap((row: any) => {
    const date = finite(row?.x); const value = finite(row?.y);
    return date !== null && Math.abs(date) < 8.64e15 && value !== null ? [{ date: new Date(date).toISOString(), value }] : [];
  }), 0, 100);
  return { ...item, points, current, asOf: new Date(stamp).toISOString(), status: Date.now() - stamp > 7 * DAY ? 'stale' : 'snapshot',
    note: `CNN 发布快照；官方公开接口返回 ${points.length} 个日样本${points.length ? `（${points[0].date} 起）` : ''}；指数绝对刻度 0–100，非全历史分位；未补造早期历史` };
}

export function parseFactsetForwardPe(html: string): { date: string; forwardPe: number } | null {
  const date = html.match(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})/)?.[1];
  const body = textOnly(html);
  // Require the explicitly named forward-12-month measure; never use a
  // trailing P/E, annual EPS or the five-/ten-year average beside it.
  const match = body.match(/(?:The\s+)?forward\s+12[-– ]month\s+P\s*\/\s*E\s+ratio\s+(?:for\s+the\s+S&P\s+500\s+)?is\s+(\d+(?:\.\d+)?)/i);
  const forwardPe = Number(match?.[1]);
  return date && Number.isFinite(Date.parse(date)) && Date.parse(date) <= Date.now() && forwardPe >= 3 && forwardPe <= 200 ? { date, forwardPe } : null;
}

export function parseFactsetPdfText(text: string): { date: string; forwardPe: number } | null {
  const normalized = text.replace(/\s+/g, ' ').replace(/(?<=\d)\s+(?=[\d.])/g, '').replace(/(?<=\.)\s+(?=\d)/g, '');
  const dateLabel = normalized.match(/EARNINGS\s+INSIGHT\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i)?.[1];
  const stamp = dateLabel ? Date.parse(`${dateLabel} UTC`) : NaN;
  const forwardPe = Number(normalized.match(/Valuation:\s*The forward\s+12\s*[-– ]\s*month\s+P\/E ratio for the S&P\s*500 is\s+(\d+(?:\.\d+)?)/i)?.[1]);
  return Number.isFinite(stamp) && stamp <= Date.now() && forwardPe >= 3 && forwardPe <= 200
    ? { date: new Date(stamp).toISOString().slice(0, 10), forwardPe } : null;
}

async function latestFactsetReport(): Promise<{ date: string; forwardPe: number; url: string } | null> {
  // FactSet's public "Download the latest Earnings Insight" link resolves to
  // this stable address, which redirects to the dated official report.
  for (const dispatcher of [undefined, proxy]) {
    try {
      const response = await upstreamFetch('https://www.factset.com/earningsinsight', { dispatcher,
        signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'Mozilla/5.0 SparkFlow/1.0', Accept: 'application/pdf' } });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/pdf') || new URL(response.url).hostname !== 'advantage.factset.com') {
        await response.body?.cancel(); continue;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > 8_000_000) continue;
      const { getDocument } = await valuationDeadline(import('pdfjs-dist/legacy/build/pdf.mjs'), 3000);
      const loading = getDocument({ data: bytes, useSystemFonts: false, disableFontFace: true });
      const cancel = () => { void loading.destroy().catch(() => undefined); };
      try {
        const parsed = await valuationDeadline((async () => {
          const document = await loading.promise;
          const page = await document.getPage(1); const content = await page.getTextContent();
          return parseFactsetPdfText(content.items.map(item => 'str' in item ? item.str : '').join(' '));
        })(), 5000, cancel);
        if (parsed) return { ...parsed, url: response.url };
      } finally { cancel(); }
    } catch { /* Fall back to another network route or the public HTML articles. */ }
  }
  return null;
}

/** Optional licensed history: date,forwardPE,sourceUrl; dates mean publication dates. */
export function parseForwardPeImport(csv: string): { points: Point[]; sourceUrl: string | null } {
  const lines = csv.trim().split(/\r?\n/); const header = lines.shift()?.replace(/^\uFEFF/, '').split(',');
  if (header?.join(',') !== 'date,forwardPE,sourceUrl') return { points: [], sourceUrl: null };
  const urls = new Set<string>();
  const points = lines.flatMap(line => {
    const [date, raw, sourceUrl, extra] = line.split(','); const pe = Number(raw);
    if (extra !== undefined || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(pe) || pe < 3 || pe > 200) return [];
    try { if (new URL(sourceUrl).protocol !== 'https:') return []; } catch { return []; }
    urls.add(sourceUrl); return [{ date, value: 100 / pe }];
  });
  return { points: cleanValuationPoints(points, 0, 100), sourceUrl: urls.size === 1 ? [...urls][0] : null };
}

async function loadForwardYield(): Promise<ValuationSeries> {
  let imported = { points: [] as Point[], sourceUrl: null as string | null };
  try { imported = parseForwardPeImport(await readFile(path.join(stateDir, 'forward-pe.csv'), 'utf8')); } catch { /* Optional licensed data. */ }
  if (imported.points.length) {
    return { ...datedSeries('forwardYield', imported.points,
      '本地导入的标普500未来12个月一致预期 P/E；前瞻盈利收益率 = 100 ÷ forwardPE（%）；date 必须为当时公布日期，历史不得回填最新盈利预测', 45),
      source: '本地导入 · NTM consensus forward P/E', sourceUrl: imported.sourceUrl };
  }
  const previous = await readSavedSeries('forwardYield');
  const report = await latestFactsetReport();
  if (report) {
    const points = cleanValuationPoints([...(previous?.points || []), { date: report.date, value: 100 / report.forwardPe }], 0, 100);
    return { ...datedSeries('forwardYield', points,
      `前瞻盈利收益率 = 100 ÷ FactSet 未来12个月一致预期 P/E（${report.forwardPe.toFixed(1)} 倍）；按 Earnings Insight 报告发表日归档；公开报告未提供可下载的完整历史，历史分位不足时不估造`, 45),
      sourceUrl: report.url };
  }
  let listing: string;
  try { listing = await fetchText(SOURCES.forwardYield[1]); } catch {
    if (previous?.points.length) return { ...previous, status: 'stale', note: previous.note + '；本次 FactSet 来源不可用，保留旧快照' };
    throw new Error('FACTSET_UNAVAILABLE');
  }
  const links = [...new Set([...listing.matchAll(/<a\b[^>]*class="fs--blog--item--upper"[^>]*href="(https:\/\/insight\.factset\.com\/[^"?#]+)"/g)].map(match => match[1]))].slice(0, 10);
  const results = await Promise.allSettled(links.map(async url => ({ url, value: parseFactsetForwardPe(await fetchText(url, 5000)) })));
  const published = results.flatMap(result => result.status === 'fulfilled' && result.value.value ? [{ ...result.value.value, url: result.value.url }] : []);
  published.sort((a, b) => a.date.localeCompare(b.date));
  const points = cleanValuationPoints([...(previous?.points || []), ...published.map(row => ({ date: row.date, value: 100 / row.forwardPe }))], 0, 100);
  if (!published.length && previous) return { ...previous, status: 'stale', note: previous.note + '；本次未能确认新的 FactSet NTM P/E' };
  const result = datedSeries('forwardYield', points,
    '前瞻盈利收益率 = 100 ÷ FactSet 未来12个月一致预期 P/E（%）；按报告发表日归档，不代表实时盈利预测；公开文章历史有限，不补造 1–10 年历史', 45);
  result.sourceUrl = published.at(-1)?.url || previous?.sourceUrl || result.sourceUrl;
  return result;
}

async function readSavedSeries(key: SeriesKey): Promise<ValuationSeries | null> {
  try {
    const raw = JSON.parse(await readFile(path.join(stateDir, `${key}.json`), 'utf8'));
    if (!raw || !Array.isArray(raw.points) || typeof raw.source !== 'string') return null;
    const points = cleanValuationPoints(raw.points, key === 'treasury10y' ? -10 : 0);
    return { ...missing(key, ''), ...raw, points };
  } catch { return null; }
}
async function saveSeries(key: SeriesKey, value: ValuationSeries) {
  if (value.current === null) return;
  try {
    await mkdir(stateDir, { recursive: true }); const file = path.join(stateDir, `${key}.json`);
    await writeFile(file + '.tmp', JSON.stringify(value), 'utf8'); await rename(file + '.tmp', file);
  } catch { /* A read-only filesystem must not discard successfully fetched data. */ }
}
async function loadCached(key: SeriesKey, ttl: number, loader: () => Promise<ValuationSeries>) {
  let entry = slowCache.get(key);
  if (!entry) {
    const [value, metadata] = await Promise.all([readSavedSeries(key), stat(path.join(stateDir, `${key}.json`)).catch(() => null)]);
    if (value && value.current !== null && value.status !== 'missing' && value.status !== 'stale' && metadata) {
      entry = { at: metadata.mtimeMs, value };
      slowCache.set(key, entry);
    }
  }
  if (entry && Date.now() - entry.at < ttl) return entry.value;
  try {
    const value = await valuationDeadline(loader(), 32_000);
    if (value.current === null) throw new Error('EMPTY_SOURCE');
    slowCache.set(key, { at: Date.now(), value }); await saveSeries(key, value); return value;
  } catch {
    const previous = entry?.value || await readSavedSeries(key);
    return previous ? { ...previous, status: 'stale' as const, note: previous.note + '；本次源站不可用，显示缓存' }
      : missing(key, `${key === 'forwardYield' ? '一致预期估值来源' : '公开数据源'}暂不可用；未使用样例数据`);
  }
}

function runIbkrBridge(): Promise<Partial<ValuationInputs['series']>> {
  const vibeRoot = process.env.VIBE_TRADING_ROOT || path.join(root, 'services', 'vibe-trading');
  const executable = path.join(vibeRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!existsSync(executable)) return Promise.resolve(Object.fromEntries(['vix', 'spx', 'ndx'].map(key => [key, missing(key as SeriesKey, 'IBKR Python 环境尚未准备')])));
  return new Promise(resolve => {
    const child = spawn(executable, [path.join(root, 'scripts', 'ibkr-valuation-snapshot.py')], { cwd: root, windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    let output = ''; let settled = false;
    const finish = (data: Partial<ValuationInputs['series']>) => { if (!settled) { settled = true; clearTimeout(timer); resolve(data); } };
    const fallback = () => Object.fromEntries(['vix', 'spx', 'ndx'].map(key => [key, missing(key as SeriesKey, 'IBKR 行情桥接暂不可用或超时')])) as Partial<ValuationInputs['series']>;
    const timer = setTimeout(() => { child.kill(); finish(fallback()); }, 27_000);
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); if (output.length > 4_000_000) { child.kill(); finish(fallback()); } });
    child.on('error', () => finish(fallback()));
    child.on('close', () => {
      try {
        const payload = JSON.parse(output.trim()); const result: Partial<ValuationInputs['series']> = {};
        for (const key of ['vix', 'spx', 'ndx'] as const) {
          const raw = payload?.series?.[key];
          if (!raw || typeof raw.source !== 'string' || !raw.source.startsWith('IBKR')) continue;
          result[key] = { ...raw, points: cleanValuationPoints(raw.points, 0.0001), current: finite(raw.current),
            status: ['live', 'delayed', 'frozen', 'close', 'snapshot', 'stale', 'missing'].includes(raw.status) ? raw.status : 'missing' };
        }
        finish(result);
      } catch { finish(fallback()); }
    });
  });
}

const YAHOO_INDICES = { vix: '^VIX', spx: '^GSPC', ndx: '^NDX' } as const;
const FRED_INDICES = { vix: ['VIXCLS', 'CBOE'], spx: ['SP500', 'S&P Dow Jones Indices'], ndx: ['NASDAQ100', 'Nasdaq'] } as const;
const officialCache = new Map<string, { at: number; value: ValuationSeries }>();
async function officialIndex(key: keyof typeof FRED_INDICES): Promise<ValuationSeries> {
  const entry = officialCache.get(key);
  if (entry && Date.now() - entry.at < 3600_000) return entry.value;
  const [id, owner] = FRED_INDICES[key];
  try {
    const points = parseFredCsv(await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`), id);
    const value = { ...datedSeries(key, points, `${owner} 官方指数经 FRED 发布；${points.length} 条日收盘记录；仅代表最近收盘，不是盘中实时行情${key === 'spx' ? '；FRED 授权提供约10年历史' : ''}`, 7),
      source: `${owner} / FRED · ${id}`, sourceUrl: `https://fred.stlouisfed.org/series/${id}` };
    if (value.current === null) throw new Error('OFFICIAL_EMPTY');
    if (value.status === 'snapshot') value.status = 'close';
    officialCache.set(key, { at: Date.now(), value });
    await saveSeries(key, value); return value;
  } catch {
    const saved = await readSavedSeries(key);
    return saved?.source.includes('/ FRED') ? { ...saved, status: 'stale', note: saved.note + '；本次官方来源未响应，保留缓存' }
      : { ...missing(key, '官方日收盘数据暂不可用'), source: `${owner} / FRED · ${id}`, sourceUrl: `https://fred.stlouisfed.org/series/${id}` };
  }
}
export function parseYahooIndex(payload: unknown, key: keyof typeof YAHOO_INDICES): ValuationSeries {
  const item = { ...missing(key, 'Yahoo Finance 指数行情未返回'), source: `Yahoo Finance · ${YAHOO_INDICES[key]}`,
    sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(YAHOO_INDICES[key])}/` };
  const raw = (payload as any)?.chart?.result?.[0]; const meta = raw?.meta;
  if (meta?.symbol !== YAHOO_INDICES[key] || !Array.isArray(raw?.timestamp)) return item;
  const closes = raw.indicators?.quote?.[0]?.close;
  const points = cleanValuationPoints(raw.timestamp.flatMap((stamp: unknown, index: number) => {
    const epoch = finite(stamp); const value = finite(closes?.[index]);
    return epoch !== null && epoch > 0 && epoch < 8.64e12 && value !== null ? [{ date: new Date(epoch * 1000).toISOString(), value }] : [];
  }), 0.0001);
  const price = finite(meta.regularMarketPrice); const marketTime = finite(meta.regularMarketTime);
  const usableQuote = price !== null && price > 0 && marketTime !== null && marketTime > 0 && marketTime * 1000 <= Date.now() + 60_000;
  const latest = points.at(-1);
  if (!usableQuote && !latest) return item;
  const asOf = usableQuote ? new Date(marketTime! * 1000).toISOString() : latest!.date;
  return { ...item, points, current: usableQuote ? price : latest!.value, asOf,
    status: Date.now() - Date.parse(asOf) > 7 * DAY ? 'stale' : usableQuote ? 'delayed' : 'close',
    note: `IBKR 行情不可用时的 Yahoo Finance 备用源；${points.length} 条指数日线${points.length ? `（${points[0].date} 起）` : ''}；时间为源站 regularMarketTime；公开行情可能延迟，非 IBKR 实时订阅` };
}
async function yahooIndex(key: keyof typeof YAHOO_INDICES): Promise<ValuationSeries> {
  const previous = slowCache.get(key);
  if (previous?.value.source.startsWith('Yahoo Finance') && Date.now() - previous.at < 60_000) return previous.value;
  const start = new Date(); start.setUTCFullYear(start.getUTCFullYear() - 11);
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(YAHOO_INDICES[key])}?interval=1d&period1=${Math.floor(start.getTime() / 1000)}&period2=${Math.floor(Date.now() / 1000)}&events=history`;
    const value = parseYahooIndex(JSON.parse(await fetchText(url)), key);
    if (value.current === null) throw new Error('YAHOO_EMPTY');
    slowCache.set(key, { at: Date.now(), value }); await saveSeries(key, value); return value;
  } catch {
    const saved = previous?.value || await readSavedSeries(key);
    return saved?.source.startsWith('Yahoo Finance') ? { ...saved, status: 'stale', note: saved.note + '；本次源站不可用，保留缓存' }
      : { ...missing(key, 'IBKR 与 Yahoo Finance 均未返回可用行情'), source: `Yahoo Finance · ${YAHOO_INDICES[key]}`, sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(YAHOO_INDICES[key])}/` };
  }
}
async function loadIndices() {
  // Warm the user-authorized public backup in parallel so a silent Gateway
  // cannot add its full timeout in front of a second network wait.
  const [ibkr, backup, official] = await Promise.all([runIbkrBridge(), Promise.all((['vix', 'spx', 'ndx'] as const).map(yahooIndex)),
    Promise.all((['vix', 'spx', 'ndx'] as const).map(officialIndex))]);
  return Object.fromEntries((['vix', 'spx', 'ndx'] as const).map((key, index) => {
    const native = ibkr[key]; const alternate = backup[index];
    const nativeFresh = native?.current !== null && native?.current !== undefined && native.status !== 'stale' && native.status !== 'missing';
    // A current IBKR quote without a usable multi-year history is retained as
    // its own source; don't splice Yahoo history into an IBKR-labelled series.
    if (nativeFresh && native.points.length >= 1500) return [key, native];
    if (alternate.current !== null && alternate.status !== 'stale') return [key, { ...alternate, note: alternate.note + (native?.note ? `；IBKR 状态：${native.note}` : '') }];
    if (official[index].current !== null && official[index].status !== 'stale') return [key, { ...official[index], note: official[index].note + '；IBKR 与 Yahoo 暂不可用，已切换官方收盘源' }];
    return [key, nativeFresh ? native : alternate];
  })) as Pick<ValuationInputs['series'], 'vix' | 'spx' | 'ndx'>;
}
async function boundedIndices(): Promise<Pick<ValuationInputs['series'], 'vix' | 'spx' | 'ndx'>> {
  try { return await valuationDeadline(loadIndices(), 32_000); } catch {
    const keys = ['vix', 'spx', 'ndx'] as const;
    const values = await Promise.all(keys.map(async key => {
      const saved = await readSavedSeries(key);
      return saved ? { ...saved, status: 'stale' as const, note: saved.note + '；本次指数来源超过32秒时限，保留旧数据' }
        : missing(key, '指数来源超过32秒时限，尚无可用历史缓存');
    }));
    return { vix: values[0], spx: values[1], ndx: values[2] };
  }
}

/** Read-only public inputs. Force refreshes market quotes; slow publications keep their own TTL. */
export function loadValuationInputs({ force = false }: { force?: boolean } = {}): Promise<ValuationInputs> {
  if (flight) return flight;
  if (cache && Date.now() - cache.at < (force ? 15_000 : 60_000)) return Promise.resolve(cache.data);
  flight = (async () => {
    const [indices, pe, forwardYield, treasury10y, fearGreed] = await Promise.all([
      boundedIndices(),
      loadCached('pe', 6 * 3600_000, async () => datedSeries('pe', parseMultplPe(await fetchText(SOURCES.pe[1])),
        'TTM 已报告盈利口径；月度历史，最新 PE 为最新已报告盈利与市价估计；不使用 CAPE / Shiller PE', 45)),
      loadCached('forwardYield', 6 * 3600_000, loadForwardYield),
      loadCached('treasury10y', 3600_000, async () => datedSeries('treasury10y', parseDgs10Csv(await fetchText('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10')),
        '10 年期美国国债固定期限名义收益率，日频，单位 %；FRED H.15 发布值，非盘中实时利率', 7)),
      loadCached('fearGreed', 5 * 60_000, async () => parseCnnFearGreed(JSON.parse(await fetchText('https://production.dataviz.cnn.io/index/fearandgreed/graphdata')))),
    ]);
    const data: ValuationInputs = { fetchedAt: new Date().toISOString(), series: {
      vix: indices.vix || missing('vix', 'IBKR 未返回 VIX'), spx: indices.spx || missing('spx', 'IBKR 未返回 SPX'),
      ndx: indices.ndx || missing('ndx', 'IBKR 未返回 NDX'), pe, forwardYield, treasury10y, fearGreed,
    } };
    cache = { at: Date.now(), data }; return data;
  })().finally(() => { flight = undefined; });
  return flight;
}
