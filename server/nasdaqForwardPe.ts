import { fetch as request, type Dispatcher } from 'undici';
import type { SnapshotStore } from './publicDataCache';
import type { PeTicker, PeHistory, PePoint } from '../src/lib/forwardPe';

type Report = { date: string; VOO: number; QQQ: number; url: string };
const origin = 'https://www.nasdaq.com';
const day = 86_400_000;
const firstDate = '2026-08-05';
const reportUrl = /^https:\/\/www\.nasdaq\.com\/docs\/(?:global-indexes\/)?global-markets-dashboard(?:[-\w.]+)?$/i;
const asDate = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);

function validReport(row: Report, today: string) {
  return row && /^\d{4}-\d\d-\d\d$/.test(row.date) && row.date >= firstDate && row.date <= today
    && Number.isFinite(Date.parse(row.date)) && asDate(Date.parse(row.date)) === row.date
    && reportUrl.test(row.url) && [row.VOO, row.QQQ].every(n => Number.isFinite(n) && n > 0);
}

export function parseNasdaqPe(text: string, url: string, today: string): Report {
  const page = text.replace(/[−–]/g, '-').replace(/\s+/g, ' ');
  const date = /Data as of (\d{1,2})\/(\d{1,2})\/(\d{4})\b/i.exec(page);
  const header = /Global Equities Last MTD % Change QTD % Change YTD % Change LTM % Change Dividend Yield NTM P\/E NTM P\/E 10yr Avg\. Last vs\. 10yr Avg\./i.exec(page);
  if (!date || !header) throw new Error('Nasdaq 估值表日期或表头无法识别');
  const table = page.slice(header.index + header[0].length).split(/Russell 2000|Thematic Equity/i)[0];
  // Last price, four return periods, dividend yield, current NTM P/E, 10-year mean, difference.
  const columns = /\s+[\d,.]+(?:\s+[+\-]?[\d.]+%){5}\s+(\d+(?:\.\d+)?)\s+\d+(?:\.\d+)?\s+[+\-]?[\d.]+%/;
  const multiple = (index: string) => Number(new RegExp(index + columns.source, 'i').exec(table)?.[1]);
  const row = { date: date[3] + '-' + date[1].padStart(2, '0') + '-' + date[2].padStart(2, '0'),
    VOO: multiple('S&P 500'), QQQ: multiple('Nasdaq-100[®™]?'), url };
  if (!validReport(row, today)) throw new Error('Nasdaq 两项指数估值或观测日期无效');
  return row;
}

export async function readNasdaqPePdf(bytes: Uint8Array, url: string, today: string) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: bytes, isEvalSupported: false }).promise;
  try {
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    return parseNasdaqPe(content.items.map(item => 'str' in item ? item.str : '').join(' '), url, today);
  } finally { await pdf.destroy(); }
}

export function datedReportUrls(friday: Date) {
  const month = friday.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }).toLowerCase();
  const d = friday.getUTCDate(), y = friday.getUTCFullYear();
  const base = origin + '/docs/global-indexes/';
  return [...new Set([month.slice(0, 3), month])].map(m => base + 'global-markets-dashboard-' + [m, d, y].join('-'))
    .concat(base + 'Global-Markets-Dashboard-' + [friday.getUTCMonth() + 1, d, String(y).slice(2)].join('-'));
}

export function nasdaqPublicationReader(dispatcher: Dispatcher) {
  async function download(url: string) {
    const res = await request(url, { dispatcher, signal: AbortSignal.timeout(15_000),
      headers: { 'user-agent': 'Mozilla/5.0', accept: '*/*' } });
    if (!res.ok) {
      await res.body?.cancel();
      if (res.status === 404 || res.status === 410) return null;
      throw new Error('Nasdaq HTTP ' + res.status);
    }
    if (new URL(res.url).hostname !== 'www.nasdaq.com' || !res.body) {
      await res.body?.cancel();
      throw new Error('Nasdaq 返回的文件地址无效');
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > 5_000_000) throw new Error('Nasdaq 文件超出大小限制');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  return {
    async articles() {
      const links = new Set<string>();
      const collectArticles = (text: string) => {
        for (const url of text.match(/https:\/\/www\.nasdaq\.com\/articles\/[\w/-]*biweekly-investment-insights[\w/-]*/gi) ?? []) links.add(url);
      };
      const listings = await Promise.allSettled([
        download(origin + '/feed/nasdaq-original/rss.xml').then(file => collectArticles(file?.toString() ?? '')),
        (async () => {
          const index = (await download(origin + '/news-sitemap.xml'))?.toString() ?? '';
          collectArticles(index);
          const pages = new Set(index.match(/https:\/\/www\.nasdaq\.com\/news-sitemap\.xml\?page=\d+/g));
          for (const url of [...pages].slice(0, 8)) collectArticles((await download(url))?.toString() ?? '');
        })(),
      ]);
      if (listings.every(result => result.status === 'rejected')) throw new Error('Nasdaq 发布目录暂不可用');
      const reports = new Set<string>();
      for (const article of [...links].slice(0, 8)) {
        const html = (await download(article))?.toString() ?? '';
        for (const [, path] of html.matchAll(/href=["']((?:https:\/\/www\.nasdaq\.com)?\/docs\/(?:global-indexes\/)?global-markets-dashboard[-\w.]*)["']/gi)) {
          reports.add(new URL(path, origin).href);
        }
      }
      return [...reports];
    },
    async read(url: string, today: string) {
      const file = await download(url);
      if (!file) return null;
      if (file.toString('ascii', 0, 5) !== '%PDF-') throw new Error('Nasdaq 未返回 PDF');
      return readNasdaqPePdf(new Uint8Array(file), url, today);
    },
  };
}

export function createNasdaqPeService(seed: Report[], history: Record<PeTicker, PePoint[]>,
  store: SnapshotStore, source: ReturnType<typeof nasdaqPublicationReader>, now = Date.now) {
  const archive = new Map(seed.map(row => [row.date, row]));
  const archiveKey = 'nasdaq-global-equities-ntm-pe-v1';
  let refreshJob: Promise<void> | undefined;
  let lastError = '';
  const ready = store.read(archiveKey).then(raw => {
    if (!raw) return;
    const rows = JSON.parse(raw);
    if (Array.isArray(rows)) for (const row of rows) if (validReport(row, asDate(now()))) archive.set(row.date, row);
  }).catch(() => {});
  const sorted = () => [...archive.values()].sort((a, b) => a.date.localeCompare(b.date));

  async function update() {
    await ready;
    const today = asDate(now());
    const latest = sorted().at(-1)!;
    const visited = new Set<string>();
    let error = '';
    async function check(url: string) {
      if (visited.has(url) || !reportUrl.test(url)) return false;
      visited.add(url);
      try {
        const report = await source.read(url, today);
        if (!report || !validReport(report, today)) return false;
        // A dated PDF remains a better historical citation than a rolling download URL.
        const existing = archive.get(report.date);
        if (!existing || !url.toLowerCase().endsWith('/global-markets-dashboard')) archive.set(report.date, report);
        return true;
      } catch (e) { error = String(e); return false; }
    }
    let discovered: string[] = [];
    try { discovered = await source.articles(); } catch (e) { error = String(e); }
    // Date-stamped PDFs also work when the RSS feed omits an issue.
    await check(latest.url);
    for (const url of discovered) await check(url);
    const friday = new Date(today);
    friday.setUTCDate(friday.getUTCDate() - (friday.getUTCDay() + 2) % 7);
    const known = new Set([...archive.values()].map(row => row.url));
    const since = Math.max(Date.parse(firstDate), Math.min(Date.parse(latest.date), friday.getTime() - 28 * day));
    for (let date = friday.getTime(); date >= since; date -= 7 * day) {
      const candidates = datedReportUrls(new Date(date));
      if (candidates.some(url => known.has(url))) continue;
      for (const url of candidates) if (await check(url)) break;
    }
    await store.write(archiveKey, JSON.stringify(sorted()));
    lastError = error;
  }
  return {
    refresh() {
      if (!refreshJob) refreshJob = update().catch(e => { lastError = String(e); }).finally(() => { refreshJob = undefined; });
      return refreshJob;
    },
    async history(ticker: PeTicker): Promise<PeHistory> {
      await ready;
      return { ticker, consensus: history[ticker], reports: sorted().map(row => ({ date: row.date, value: row[ticker], url: row.url })),
        checkFailed: Boolean(lastError) };
    },
  };
}
