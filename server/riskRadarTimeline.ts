import { ProxyAgent, fetch as upstreamFetch } from 'undici';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

type Ticker = 'VOO' | 'QQQ';
type Point = { date: string; value: number };
type PricePoint = { date: string; close: number };

export type RiskTimelineValues = {
  marketCapRatio: number;
  cape: number;
  tenYear: number;
  twoYear: number;
  fear: number;
  price: number;
  sma: number;
  pe: number | null;
  volatility: number;
  drawdown: number;
  creditSpread: number;
  nfci: number;
  vix: number;
  debtService: number | null;
  priorCurveMin: number;
};

export type RiskTimelinePoint = {
  date: string;
  values: RiskTimelineValues;
  sentimentMode: 'cnn' | 'price-proxy';
  valuationMode: 'trailing' | 'scaled-forward' | 'unavailable';
};

export type RiskTimelinePayload = {
  generatedAt: string;
  period: { requestedYears: number; start: string; end: string };
  series: Array<{
    ticker: Ticker;
    proxyLabel: string;
    firstDate: string;
    lastDate: string;
    points: RiskTimelinePoint[];
  }>;
  sources: Array<{ label: string; url: string }>;
  methodology: string[];
  cache?: {
    storedAt: string;
    checkedAt: string;
    nextCheckAt: string;
    refreshing: boolean;
    stale: boolean;
    error: string | null;
  };
};

const DAY = 86_400_000;
const CACHE_MS = 60 * 60_000;
const MAX_STALE_MS = 14 * DAY;
const CACHE_FILE = path.join(process.cwd(), '.sparkflow', 'risk-radar-timeline.json');
const proxy = new ProxyAgent(process.env.SPARKFLOW_VALUATION_PROXY || 'http://127.0.0.1:7890');
type TimelineCache = { at: number; checkedAt: number; value: RiskTimelinePayload; error: string | null };
let cache: TimelineCache | null = null;
let flight: Promise<RiskTimelinePayload> | null = null;
let restoreFlight: Promise<void> | null = null;

const SOURCE_URLS = {
  marketCap: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=NCBEILQ027S',
  gdp: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=GDP',
  tenYear: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10',
  twoYear: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS2',
  cape: 'https://www.multpl.com/shiller-pe/table/by-month',
  spxPe: 'https://www.multpl.com/s-p-500-pe-ratio/table/by-month',
  ndxPe: 'https://historyofmarket.com/api/ndx/forward-pe.json',
  sentiment: 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata/2021-02-01',
  creditSpread: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=BAA10Y',
  nfci: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=NFCI',
  vix: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=VIXCLS',
  debtService: 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=TDSP',
} as const;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

function plainText(value: string) {
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;|&#xA0;/gi, ' ').replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Math.min(0x10ffff, parseInt(code, 16))))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Math.min(0x10ffff, Number(code))))
    .replace(/\s+/g, ' ').trim();
}

async function fetchText(url: string, timeoutMs = 18_000) {
  const directFirst = new URL(url).hostname.endsWith('stlouisfed.org') || new URL(url).hostname === 'historyofmarket.com';
  const routes = directFirst ? [undefined, proxy] : [proxy, undefined];
  let lastError: unknown;
  for (const dispatcher of routes) {
    try {
      const response = await upstreamFetch(url, {
        ...(dispatcher ? { dispatcher } : {}),
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'User-Agent': 'Mozilla/5.0 SparkFlow/1.0',
          Accept: 'text/html,application/json,text/csv,*/*',
          ...(url.includes('dataviz.cnn.io') ? { Referer: 'https://www.cnn.com/markets/fear-and-greed', Origin: 'https://www.cnn.com' } : {}),
        },
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP_${response.status}`);
      }
      const text = await response.text();
      if (text.length > 9_000_000) throw new Error('RISK_TIMELINE_RESPONSE_TOO_LARGE');
      return text;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('RISK_TIMELINE_SOURCE_UNAVAILABLE');
}

function parseFred(csv: string, id: string): Point[] {
  const rows = csv.trim().split(/\r?\n/);
  const header = rows.shift()?.split(',') || [];
  const dateIndex = header.findIndex(value => /DATE/i.test(value));
  const valueIndex = header.findIndex(value => value.trim() === id);
  if (dateIndex < 0 || valueIndex < 0) return [];
  return rows.flatMap((row) => {
    const columns = row.split(',');
    const rawValue = columns[valueIndex]?.trim();
    const value = Number(rawValue);
    const date = columns[dateIndex]?.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && rawValue && rawValue !== '.' && finite(value) ? [{ date, value }] : [];
  });
}

function parseMultpl(html: string): Point[] {
  const points: Point[] = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => plainText(cell[1]));
    if (cells.length !== 2) continue;
    const stamp = Date.parse(`${cells[0]} UTC`);
    const value = Number(cells[1].replace(/[^\d.\-]/g, ''));
    if (Number.isFinite(stamp) && finite(value) && value > 0) points.push({ date: new Date(stamp).toISOString().slice(0, 10), value });
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

function parseYahoo(payload: string): PricePoint[] {
  const result = JSON.parse(payload)?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp as number[] : [];
  const closes = Array.isArray(result?.indicators?.quote?.[0]?.close) ? result.indicators.quote[0].close as unknown[] : [];
  return timestamps.flatMap((timestamp, index) => {
    const close = Number(closes[index]);
    return finite(close) && close > 0 ? [{ date: new Date(timestamp * 1000).toISOString().slice(0, 10), close }] : [];
  });
}

function yahooUrl(symbol: string) {
  const period1 = Math.floor(Date.UTC(1995, 0, 1) / 1000);
  const period2 = Math.floor(Date.now() / 1000) + 86_400;
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=history`;
}

function parseNdxValuation(text: string) {
  const value = JSON.parse(text) as Record<string, any>;
  const forward = Array.isArray(value.forward) ? value.forward.flatMap((row: any) => (
    typeof row?.date === 'string' && finite(Number(row?.value)) ? [{ date: row.date, value: Number(row.value) }] : []
  )) : [];
  const trailing = Number(value.current?.trailing);
  const currentForward = Number(value.current?.forward);
  const scale = finite(trailing) && finite(currentForward) && currentForward > 0 ? trailing / currentForward : 1.23;
  return { points: forward.map((row: Point) => ({ ...row, value: row.value * scale })), scale };
}

function parseCnnSentiment(text: string): Point[] {
  const historical = JSON.parse(text)?.fear_and_greed_historical?.data;
  if (!Array.isArray(historical)) return [];
  return historical.flatMap((row: any) => {
    const stamp = Number(row?.x);
    const value = Number(row?.y);
    return finite(stamp) && finite(value) ? [{ date: new Date(stamp).toISOString().slice(0, 10), value }] : [];
  }).sort((a: Point, b: Point) => a.date.localeCompare(b.date));
}

function latestAt(points: Point[], date: string, maxAgeDays: number) {
  let low = 0; let high = points.length - 1; let match: Point | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].date <= date) { match = points[middle]; low = middle + 1; } else high = middle - 1;
  }
  if (!match || Date.parse(date) - Date.parse(match.date) > maxAgeDays * DAY) return null;
  return match.value;
}

function monthEndIndices(points: PricePoint[]) {
  const result: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const month = points[index].date.slice(0, 7);
    if (points[index + 1]?.date.slice(0, 7) !== month) result.push(index);
  }
  return result;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

function priorCurveMinimum(tenYear: Point[], twoYear: Point[], date: string) {
  const end = new Date(`${date}T00:00:00Z`);
  const spreads: number[] = [];
  for (let offset = 0; offset <= 18; offset += 1) {
    const sample = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - offset, 15)).toISOString().slice(0, 10);
    const longRate = latestAt(tenYear, sample, 21);
    const shortRate = latestAt(twoYear, sample, 21);
    if (longRate !== null && shortRate !== null) spreads.push(longRate - shortRate);
  }
  return spreads.length ? Math.min(...spreads) : 0;
}

function buildSeries(ticker: Ticker, prices: PricePoint[], sources: {
  marketCap: Point[]; gdp: Point[]; cape: Point[]; tenYear: Point[]; twoYear: Point[];
  spxPe: Point[]; ndxPe: Point[]; sentiment: Point[]; creditSpread: Point[]; nfci: Point[]; vix: Point[]; debtService: Point[];
}, cutoff: string): RiskTimelinePayload['series'][number] {
  const points: RiskTimelinePoint[] = [];
  for (const index of monthEndIndices(prices)) {
    const item = prices[index];
    if (item.date < cutoff || index < 252) continue;
    // Quarterly national-account series are published with a lag. Keep the
    // latest released quarter active through the next release window so the
    // timeline uses the same vintage as the current gauge.
    const marketCap = latestAt(sources.marketCap, item.date, 220);
    const gdp = latestAt(sources.gdp, item.date, 220);
    const cape = latestAt(sources.cape, item.date, 70);
    const tenYear = latestAt(sources.tenYear, item.date, 21);
    const twoYear = latestAt(sources.twoYear, item.date, 21);
    const pe = latestAt(ticker === 'VOO' ? sources.spxPe : sources.ndxPe, item.date, ticker === 'VOO' ? 70 : 35);
    const creditSpread = latestAt(sources.creditSpread, item.date, 21);
    const nfci = latestAt(sources.nfci, item.date, 21);
    const vix = latestAt(sources.vix, item.date, 21);
    const debtService = latestAt(sources.debtService, item.date, 260);
    if ([marketCap, gdp, cape, tenYear, twoYear, creditSpread, nfci, vix].some(value => value === null) || !gdp) continue;
    const smaWindow = prices.slice(index - 199, index + 1);
    const volatilityWindow = prices.slice(index - 60, index + 1);
    const returns = volatilityWindow.slice(1).map((row, offset) => Math.log(row.close / volatilityWindow[offset].close));
    const deviation = (item.close / (smaWindow.reduce((sum, row) => sum + row.close, 0) / smaWindow.length) - 1) * 100;
    const volatility = (standardDeviation(returns) ?? 0) * Math.sqrt(252) * 100;
    const trailingYear = prices.slice(index - 251, index + 1);
    const peak = Math.max(...trailingYear.map(row => row.close));
    const drawdown = (item.close / peak - 1) * 100;
    const return125 = index >= 125 ? (item.close / prices[index - 125].close - 1) * 100 : 0;
    const observedSentiment = latestAt(sources.sentiment, item.date, 45);
    const sentimentProxy = clamp(50 + deviation * 1.25 + return125 * .55 - (volatility - 18) * .35 + drawdown * .65, 0, 100);
    const sma = item.close / (1 + deviation / 100);
    points.push({
      date: item.date,
      values: {
        marketCapRatio: marketCap! / gdp! * .1,
        cape: cape!, tenYear: tenYear!, twoYear: twoYear!, fear: observedSentiment ?? sentimentProxy,
        price: item.close, sma, pe, volatility, drawdown,
        creditSpread: creditSpread!, nfci: nfci!, vix: vix!, debtService,
        priorCurveMin: priorCurveMinimum(sources.tenYear, sources.twoYear, item.date),
      },
      sentimentMode: observedSentiment === null ? 'price-proxy' : 'cnn',
      valuationMode: pe === null ? 'unavailable' : ticker === 'VOO' ? 'trailing' : 'scaled-forward',
    });
  }
  if (!points.length) throw new Error(`${ticker}_RISK_TIMELINE_EMPTY`);
  return {
    ticker,
    proxyLabel: ticker === 'VOO' ? 'VOO · SPY 历史代理' : 'QQQ',
    firstDate: points[0].date,
    lastDate: points.at(-1)!.date,
    points,
  };
}

async function buildTimeline(): Promise<RiskTimelinePayload> {
  const now = new Date();
  const cutoff = new Date(Date.UTC(now.getUTCFullYear() - 30, now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const [spyText, qqqText, marketCapText, gdpText, capeText, tenYearText, twoYearText, spxPeText, ndxPeText, sentimentText,
    creditSpreadText, nfciText, vixText, debtServiceText] = await Promise.all([
    fetchText(yahooUrl('SPY')), fetchText(yahooUrl('QQQ')),
    fetchText(SOURCE_URLS.marketCap), fetchText(SOURCE_URLS.gdp), fetchText(SOURCE_URLS.cape),
    fetchText(SOURCE_URLS.tenYear), fetchText(SOURCE_URLS.twoYear), fetchText(SOURCE_URLS.spxPe),
    fetchText(SOURCE_URLS.ndxPe), fetchText(SOURCE_URLS.sentiment).catch(() => ''),
    fetchText(SOURCE_URLS.creditSpread), fetchText(SOURCE_URLS.nfci), fetchText(SOURCE_URLS.vix), fetchText(SOURCE_URLS.debtService),
  ]);
  const ndxPe = parseNdxValuation(ndxPeText);
  const sources = {
    marketCap: parseFred(marketCapText, 'NCBEILQ027S'), gdp: parseFred(gdpText, 'GDP'),
    cape: parseMultpl(capeText), tenYear: parseFred(tenYearText, 'DGS10'), twoYear: parseFred(twoYearText, 'DGS2'),
    spxPe: parseMultpl(spxPeText), ndxPe: ndxPe.points, sentiment: sentimentText ? parseCnnSentiment(sentimentText) : [],
    creditSpread: parseFred(creditSpreadText, 'BAA10Y'), nfci: parseFred(nfciText, 'NFCI'),
    vix: parseFred(vixText, 'VIXCLS'), debtService: parseFred(debtServiceText, 'TDSP'),
  };
  const series = [buildSeries('VOO', parseYahoo(spyText), sources, cutoff), buildSeries('QQQ', parseYahoo(qqqText), sources, cutoff)];
  return {
    generatedAt: new Date().toISOString(),
    period: { requestedYears: 30, start: cutoff, end: series.map(item => item.lastDate).sort().at(-1)! },
    series,
    sources: [
      { label: 'Yahoo Finance · SPY / QQQ 历史日线', url: 'https://finance.yahoo.com/' },
      { label: 'Federal Reserve / BEA · FRED', url: 'https://fred.stlouisfed.org/' },
      { label: 'Robert Shiller / Multpl · CAPE 与 S&P 500 P/E', url: SOURCE_URLS.cape },
      { label: 'History of Market · NDX 12个月预期 P/E', url: SOURCE_URLS.ndxPe },
      { label: 'CNN · Fear & Greed', url: 'https://www.cnn.com/markets/fear-and-greed' },
      { label: 'FRED · Baa企业债利差 / NFCI / VIX / 家庭债务偿付率', url: 'https://fred.stlouisfed.org/' },
    ],
    methodology: [
      '每月取最后一个交易日，分别计算潜在脆弱性与即时市场压力；页面总状态取两层中较高者。',
      'VOO 在成立前及全历史连续计算使用 SPY 作为同指数行情代理。',
      `QQQ 长期估值使用 NDX 12个月预期 P/E，并按当前同期 trailing/forward 比例 ${ndxPe.scale.toFixed(2)} 换算为估值代理。`,
      'CNN 无公开历史读数的月份使用价格趋势、125日收益、波动率与回撤构建的情绪代理；图中按重建走势展示，不视为逐月官方存档。',
      '信用压力采用FRED长期Baa企业债相对10年期美债利差；融资环境采用Chicago Fed NFCI，期权压力采用Cboe VIX。QQQ早期P/E缺失时仅在该层按可用权重归一化，并显示覆盖度。',
    ],
  };
}

function validTimeline(value: unknown): value is RiskTimelinePayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as RiskTimelinePayload;
  const generatedAt = Date.parse(candidate.generatedAt || '');
  if (!Number.isFinite(generatedAt) || generatedAt > Date.now() + 60_000 || Date.now() - generatedAt > MAX_STALE_MS) return false;
  return Array.isArray(candidate.series)
    && candidate.series.length === 2
    && candidate.series.every(series => (series.ticker === 'VOO' || series.ticker === 'QQQ') && series.points?.length > 1);
}

function cacheView(snapshot: TimelineCache, refreshing = Boolean(flight)): RiskTimelinePayload {
  const now = Date.now();
  return {
    ...snapshot.value,
    cache: {
      storedAt: new Date(snapshot.at).toISOString(),
      checkedAt: new Date(snapshot.checkedAt).toISOString(),
      nextCheckAt: new Date(snapshot.checkedAt + CACHE_MS).toISOString(),
      refreshing,
      stale: now - snapshot.at >= CACHE_MS,
      error: snapshot.error,
    },
  };
}

async function restoreCache() {
  if (!restoreFlight) restoreFlight = (async () => {
    try {
      const stored = JSON.parse(await readFile(CACHE_FILE, 'utf8')) as Partial<TimelineCache> & { version?: number };
      if (stored.version !== 1 || !validTimeline(stored.value)) return;
      const at = Number(stored.at);
      const checkedAt = Number(stored.checkedAt);
      if (!Number.isFinite(at) || !Number.isFinite(checkedAt)) return;
      cache = { at, checkedAt: Math.min(Date.now(), checkedAt), value: stored.value, error: null };
    } catch { /* A missing or damaged cache is rebuilt from the public sources. */ }
  })();
  return restoreFlight;
}

async function persistCache(snapshot: TimelineCache) {
  await mkdir(path.dirname(CACHE_FILE), { recursive: true });
  const temporary = `${CACHE_FILE}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ version: 1, ...snapshot }), 'utf8');
    await rename(temporary, CACHE_FILE);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

function refreshTimeline(): Promise<RiskTimelinePayload> {
  if (flight) return flight;
  flight = buildTimeline().then(async value => {
    const now = Date.now();
    cache = { at: now, checkedAt: now, value, error: null };
    await persistCache(cache).catch(() => undefined);
    return cacheView(cache, false);
  }).catch(error => {
    if (!cache) throw error;
    cache.checkedAt = Date.now();
    cache.error = '历史数据更新失败，继续显示最近一次成功缓存';
    return cacheView(cache, false);
  }).finally(() => { flight = null; });
  return flight;
}

export async function getRiskRadarTimeline(force = false) {
  await restoreCache();
  if (!cache) return refreshTimeline();
  const now = Date.now();
  if (force) {
    if (now - cache.checkedAt < 10_000) return cacheView(cache);
    return refreshTimeline();
  }
  if (now - cache.checkedAt >= CACHE_MS) {
    void refreshTimeline();
    return cacheView(cache, true);
  }
  return cacheView(cache);
}
