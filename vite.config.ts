import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { get as httpsGet } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import path from 'node:path';
import { ProxyAgent } from 'undici';
import { defineConfig, type ViteDevServer } from 'vite';
import {
  getMarketHalfDay,
  getMarketHolidayDates,
  getMarketHolidayName,
  type MarketCalendarId,
} from './src/data/marketCalendars';

const rootDir = process.cwd();
const allWeatherDataDir = path.join(rootDir, 'public', 'allweather', 'data');
const foreignProxyUrl = 'http://127.0.0.1:7890';
const foreignProxyAgent = new ProxyAgent(foreignProxyUrl);
const vibeTradingRoot = process.env.VIBE_TRADING_ROOT || path.join(rootDir, 'services', 'vibe-trading');
const sparkflowStateDir = path.join(rootDir, '.sparkflow');
const vibePortFile = path.join(sparkflowStateDir, 'vibe.port');
const vibePidFile = path.join(sparkflowStateDir, 'vibe.pid');
const vibePortRange = Array.from({ length: 101 }, (_, index) => 8899 + index);
let cachedVibeBaseUrl = '';
let vibeStartupPromise: Promise<string> | null = null;

type MarketSource = {
  label: string;
  url: string;
  latestDate?: string;
  ageDays?: number;
  freshnessLabel?: string;
  summary?: string;
  error?: string;
  quotes?: Record<string, QuotePoint>;
};

type PricePoint = {
  date: string;
  close: number;
};

type QuotePoint = {
  price: number;
  changePercent?: number;
  date?: string;
};

type AssetSignal = {
  label: string;
  ticker: string;
  latestDate?: string;
  return6m: number;
  return1y: number;
  return3y: number;
  drawdownFromPeak: number;
  maxDrawdown3y: number;
  vol1y: number;
};

type FetchRoute = 'direct' | 'proxy';
type NewsCategory = 'tech' | 'finance' | 'society' | 'livelihood' | 'world';

type NewsItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  category: NewsCategory;
  categoryLabel: string;
  origin: 'domestic' | 'foreign';
  route: FetchRoute;
  publishedAt?: string;
  summary?: string;
  heat: number;
  importance: number;
  recency: number;
  weight: number;
  weightLabel: string;
};

type NewsSourceConfig = {
  id: string;
  label: string;
  category: NewsCategory;
  sourceWeight: number;
  origin: 'domestic' | 'foreign';
  route: FetchRoute;
  url: string;
  kind: 'rss';
};

type MarketIndexSnapshot = {
  id: string;
  code: string;
  name: string;
  region: 'CN' | 'HK' | 'US' | 'CRYPTO';
  market: 'china' | 'hongkong' | 'us' | 'crypto';
  proxyFor?: string;
  price: number;
  change: number;
  changePercent: number;
  turnover?: number;
  advancers?: number;
  decliners?: number;
  flat?: number;
  updatedAt?: string;
  sourceUrl: string;
  validation: {
    status: 'verified' | 'review' | 'single-source';
    source: string;
    price?: number;
    deviationPercent?: number;
  };
};

type ChinaHeatmapStock = {
  code: string;
  name: string;
  logoUrl?: string;
  price: number;
  changePercent: number;
  marketCap: number;
  pe?: number;
  pb?: number;
  industry: string;
  updatedAt?: string;
  sourceUrl: string;
};

type SectorPulse = {
  code: string;
  name: string;
  changePercent: number;
  mainNetInflow: number;
  mainNetRatio: number;
};

type ResearchReport = {
  id: string;
  title: string;
  stockCode: string;
  stockName: string;
  institution: string;
  analysts: string;
  publishedAt?: string;
  rating: string;
  industry: string;
  epsThisYear?: number;
  epsNextYear?: number;
  url: string;
};

type ScoreDimension = {
  id: string;
  label: string;
  score: number;
  weight: number;
  summary: string;
  evidence: string[];
};

type InvestorLens = {
  id: string;
  name: string;
  principle: string;
  score: number;
  confidence: '高' | '中' | '低';
  read: string;
  watch: string;
};

type ValuationTemperatureRow = {
  TRADE_DATE?: string;
  PE_TTM_AVG?: number | string;
  PE_TTM?: number | string;
  PB_MRQ?: number | string;
  CLOSE_PRICE?: number | string;
  BOARD_CODE?: string;
  BOARD_NAME?: string;
  ORIGINALCODE?: string;
  TOTAL_MARKET_CAP?: number | string;
};

type ValuationTemperaturePoint = {
  time: string;
  value: number;
};

type ValuationTemperatureItem = {
  id: string;
  name: string;
  code: string;
  category: 'market' | 'industry';
  temperature: number;
  temperatureDelta: number;
  zone: 'cold' | 'low' | 'fair' | 'warm' | 'hot';
  zoneLabel: string;
  currentPe: number;
  currentPb?: number;
  sampleSize: number;
  updatedAt: string;
  marketCap?: number;
  history?: ValuationTemperaturePoint[];
};

type MarketCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type AllMarketPbRow = {
  date?: string;
  middlePB?: number | string;
  equalWeightAveragePB?: number | string;
  close?: number | string;
};

type IndexPbRow = {
  date?: string;
  close?: number | string;
  pb?: number | string;
  addPb?: number | string;
  middlePb?: number | string;
};

type CsiIndexPerformanceRow = {
  tradeDate?: string;
  close?: number | string;
};

function sendJson(res: ViteDevServer['middlewares'] extends infer _ ? any : never, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function getRequestBody(req: ViteDevServer['middlewares'] extends infer _ ? any : never) {
  return new Promise<string>((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function fetchText(url: string, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'SparkFlow/1.0 local research agent',
        Referer: 'https://finance.sina.com.cn/',
        Accept: 'application/json,text/csv,text/plain,*/*',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url: string, timeoutMs = 9000) {
  const text = await fetchText(url, timeoutMs);
  return JSON.parse(text);
}

async function fetchJsonWithRetry(url: string, attempts = 2, timeoutMs = 9000) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetchJson(url, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function fetchRoutedText(url: string, route: FetchRoute, timeoutMs = 12000, accept = 'application/rss+xml,application/xml,text/xml,text/plain,*/*') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const init: RequestInit & { dispatcher?: any } = {
      signal: controller.signal,
      headers: {
        'User-Agent': 'SparkFlow/1.0 local intelligence console',
        Accept: accept,
      },
    };
    if (route === 'proxy') init.dispatcher = foreignProxyAgent;
    const response = await fetch(url, init);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchExternalText(url: string, timeoutMs = 18000, accept = 'text/plain,*/*') {
  try {
    return await fetchRoutedText(url, 'direct', Math.min(timeoutMs, 3500), accept);
  } catch {
    return fetchRoutedText(url, 'proxy', timeoutMs, accept);
  }
}

async function fetchExternalCsv(url: string, timeoutMs = 18000) {
  return fetchExternalText(url, timeoutMs, 'text/csv,text/plain,*/*');
}

async function fetchExternalJson(url: string, timeoutMs = 18000) {
  return JSON.parse(await fetchExternalText(url, timeoutMs, 'application/json,text/plain,*/*'));
}

const fastMarketRoutePreference = new Map<string, FetchRoute>([
  ['query1.finance.yahoo.com', 'proxy'],
  ['api.coingecko.com', 'proxy'],
  ['api.binance.com', 'proxy'],
]);

async function fetchFastMarketText(url: string, timeoutMs = 5_000) {
  const host = new URL(url).host;
  const preferredRoute = fastMarketRoutePreference.get(host) || 'direct';
  const routes: FetchRoute[] = preferredRoute === 'direct' ? ['direct', 'proxy'] : ['proxy', 'direct'];
  let lastError: unknown;
  for (const route of routes) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const init: RequestInit & { dispatcher?: any } = {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0 Safari/537.36',
          Accept: 'application/json,text/plain,*/*',
          Referer: url.includes('yahoo.com')
            ? 'https://finance.yahoo.com/'
            : url.includes('sina.com.cn')
              ? 'https://finance.sina.com.cn/'
              : `https://${host}/`,
        },
      };
      if (route === 'proxy') init.dispatcher = foreignProxyAgent;
      const response = await fetch(url, init);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      fastMarketRoutePreference.set(host, route);
      return await response.text();
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${host} 快速行情暂时不可用`);
}

function decodeXml(value = '') {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripTags(value = '') {
  return decodeXml(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickXml(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXml(match[1]).trim() : '';
}

function parseDate(value?: string) {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

const categoryLabels: Record<NewsCategory, string> = {
  tech: '科技 / AI',
  finance: '金融 / 商业',
  society: '社会',
  livelihood: '民生 / 政策',
  world: '国际'
};

const impactKeywords = [
  '央行',
  '美联储',
  '利率',
  '财政',
  '监管',
  '证监会',
  '国务院',
  '政策',
  'IPO',
  '并购',
  '融资',
  'AI',
  '人工智能',
  '芯片',
  '半导体',
  '算力',
  '数据中心',
  '机器人',
  '就业',
  '医保',
  '教育',
  '住房',
  '养老',
  '安全',
  '隐私',
  '战争',
  '制裁'
];

const newsSources: NewsSourceConfig[] = [
  { id: 'ithome', label: 'IT之家', category: 'tech', sourceWeight: 66, origin: 'domestic', route: 'direct', url: 'https://www.ithome.com/rss/', kind: 'rss' },
  { id: '36kr', label: '36氪', category: 'finance', sourceWeight: 68, origin: 'domestic', route: 'direct', url: 'https://36kr.com/feed', kind: 'rss' },
  { id: 'huxiu', label: '虎嗅', category: 'tech', sourceWeight: 70, origin: 'domestic', route: 'direct', url: 'https://rss.huxiu.com/', kind: 'rss' },
  { id: 'wallstreetcn', label: '华尔街见闻', category: 'finance', sourceWeight: 78, origin: 'domestic', route: 'direct', url: 'https://dedicated.wallstreetcn.com/rss.xml', kind: 'rss' },
  { id: 'chinanews-finance', label: '中新财经', category: 'finance', sourceWeight: 70, origin: 'domestic', route: 'direct', url: 'https://www.chinanews.com.cn/rss/finance.xml', kind: 'rss' },
  { id: 'gov-cn', label: '中国政府网', category: 'livelihood', sourceWeight: 86, origin: 'domestic', route: 'direct', url: 'https://www.gov.cn/pushinfo/v150203/rss.xml', kind: 'rss' },
  { id: 'chinanews-society', label: '中新社会', category: 'society', sourceWeight: 66, origin: 'domestic', route: 'direct', url: 'https://www.chinanews.com.cn/rss/society.xml', kind: 'rss' },
  { id: 'chinanews-world', label: '中新国际', category: 'world', sourceWeight: 68, origin: 'domestic', route: 'direct', url: 'https://www.chinanews.com.cn/rss/world.xml', kind: 'rss' },
];

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getRecencyScore(publishedAt?: string) {
  if (!publishedAt) return 42;
  const ageHours = Math.max(0, (Date.now() - new Date(publishedAt).getTime()) / 3600000);
  if (!Number.isFinite(ageHours)) return 42;
  return clampScore(100 * Math.exp(-ageHours / 36));
}

function getKeywordScore(title: string, summary = '') {
  const text = `${title} ${summary}`.toLowerCase();
  const hits = impactKeywords.filter((keyword) => text.includes(keyword.toLowerCase())).length;
  return clampScore(Math.min(100, hits * 14));
}

function getWeightLabel(weight: number) {
  if (weight >= 78) return '高优先';
  if (weight >= 58) return '值得看';
  if (weight >= 38) return '观察';
  return '低噪';
}

function enrichNewsItem(
  item: Omit<NewsItem, 'category' | 'categoryLabel' | 'heat' | 'importance' | 'recency' | 'weight' | 'weightLabel'>,
  source: NewsSourceConfig,
  heat = 0
): NewsItem {
  const recency = getRecencyScore(item.publishedAt);
  const keywordScore = getKeywordScore(item.title, item.summary);
  const importance = clampScore(source.sourceWeight * 0.58 + keywordScore * 0.42);
  const heatScore = clampScore(heat);
  const weight = clampScore(recency * 0.35 + importance * 0.45 + heatScore * 0.2);

  return {
    ...item,
    category: source.category,
    categoryLabel: categoryLabels[source.category],
    heat: heatScore,
    importance,
    recency,
    weight,
    weightLabel: getWeightLabel(weight)
  };
}

function parseRssItems(xml: string, source: NewsSourceConfig): NewsItem[] {
  const blocks = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) || [];
  const itemLimit = source.id === 'wallstreetcn' ? 40 : 12;
  return blocks.slice(0, itemLimit).map((block, index) => {
    const title = stripTags(pickXml(block, 'title')) || `${source.label} #${index + 1}`;
    const linkFromTag = pickXml(block, 'link');
    const hrefMatch = block.match(/<link[^>]+href=["']([^"']+)["']/i);
    const link = decodeXml(hrefMatch?.[1] || linkFromTag).trim();
    const summary = stripTags(pickXml(block, 'description') || pickXml(block, 'summary') || pickXml(block, 'content:encoded'));
    const publishedAt = parseDate(pickXml(block, 'pubDate') || pickXml(block, 'published') || pickXml(block, 'updated'));

    return enrichNewsItem(
      {
        id: `${source.id}-${index}-${title}`,
        title,
        url: link || source.url,
        source: source.label,
        origin: source.origin,
        route: source.route,
        publishedAt,
        summary: summary.slice(0, 180)
      },
      source
    );
  });
}

async function fetchNewsSource(source: NewsSourceConfig) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const xml = await fetchExternalText(source.url, 18000, 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*');
      return parseRssItems(xml, source);
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${source.label} RSS 暂时不可用`);
}

async function getNewsFeed() {
  const settled = await Promise.allSettled(newsSources.map(fetchNewsSource));
  const sourceResults = settled.map((result, index) => {
    const source = newsSources[index];
    return {
      id: source.id,
      label: source.label,
      category: source.category,
      categoryLabel: categoryLabels[source.category],
      origin: source.origin,
      route: source.route,
      proxy: source.route === 'proxy' ? foreignProxyUrl : undefined,
      ok: result.status === 'fulfilled',
      count: result.status === 'fulfilled' ? result.value.length : 0,
      error: result.status === 'rejected' ? (result.reason instanceof Error ? result.reason.message : String(result.reason)) : undefined,
    };
  });
  const allItems = settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  const items = allItems
    .sort((a, b) => b.weight - a.weight || new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime())
    .slice(0, 80);
  const categories = Object.entries(categoryLabels).map(([id, label]) => {
    const scoped = allItems.filter((item) => item.category === id);
    const topWeight = scoped.reduce((max, item) => Math.max(max, item.weight), 0);
    return {
      id,
      label,
      count: scoped.length,
      topWeight,
      averageWeight: scoped.length ? Math.round(scoped.reduce((sum, item) => sum + item.weight, 0) / scoped.length) : 0
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    proxy: foreignProxyUrl,
    categories,
    sources: sourceResults,
    items,
  };
}

const marketIndexConfigs = [
  { id: 'sse', secid: '1.000001', tencent: 's_sh000001', name: '上证指数', region: 'CN' as const, market: 'china' as const, weight: 0.12 },
  { id: 'szse', secid: '0.399001', tencent: 's_sz399001', name: '深证成指', region: 'CN' as const, market: 'china' as const, weight: 0.1 },
  { id: 'chinext', secid: '0.399006', tencent: 's_sz399006', name: '创业板指', region: 'CN' as const, market: 'china' as const, weight: 0.09 },
  { id: 'csi300', secid: '1.000300', tencent: 's_sh000300', name: '沪深300', region: 'CN' as const, market: 'china' as const, weight: 0.11 },
  { id: 'star50', secid: '1.000688', tencent: 's_sh000688', name: '科创50', region: 'CN' as const, market: 'china' as const, weight: 0.08 },
  { id: 'hsi', secid: '100.HSI', tencent: 's_hkHSI', name: '恒生指数', region: 'HK' as const, market: 'hongkong' as const, weight: 0.08 },
  { id: 'hstech', secid: '124.HSTECH', tencent: 's_hkHSTECH', name: '恒生科技指数', region: 'HK' as const, market: 'hongkong' as const, weight: 0.08 },
  { id: 'hscei', secid: '100.HSCEI', tencent: 's_hkHSCEI', name: '国企指数', region: 'HK' as const, market: 'hongkong' as const, weight: 0.07 },
  { id: 'hscci', secid: '124.HSCCI', tencent: 's_hkHSCCI', name: '红筹指数', region: 'HK' as const, market: 'hongkong' as const, weight: 0.06 },
  { id: 'hsci', secid: '124.HSCI', tencent: 's_hkHSCI', name: '恒生综合指数', region: 'HK' as const, market: 'hongkong' as const, weight: 0.06 },
  { id: 'nasdaq', secid: '100.NDX', tencent: 'usNDX', name: '纳斯达克100', region: 'US' as const, market: 'us' as const, weight: 0.11 },
  { id: 'sp500', secid: '100.SPX', tencent: 'usINX', name: '标普500', region: 'US' as const, market: 'us' as const, weight: 0.11 },
  { id: 'dow', secid: '100.DJIA', tencent: 'usDJI', name: '道琼斯', region: 'US' as const, market: 'us' as const, weight: 0.07 },
  { id: 'mags', secid: '107.MAGS', tencent: 'usMAGS', name: '七巨头 MAGS', region: 'US' as const, market: 'us' as const, proxyFor: '美股科技七巨头 ETF 代理', weight: 0.06 },
  { id: 'sox', secid: '251.SOX', tencent: 'usSOX', name: '费城半导体', region: 'US' as const, market: 'us' as const, weight: 0.07 },
];

const chinaValuationMarketConfigs = [
  { id: 'csi300', marketCode: '000300', ticker: 'sh000300', name: '沪深300', chartName: '沪深300' },
  { id: 'sh-main', marketCode: '000001', ticker: 'sh000001', name: '沪市主板', chartName: '上证指数' },
  { id: 'sz-main', marketCode: '399001', ticker: 'sz399001', name: '深市主板', chartName: '深证成指' },
  { id: 'chinext', marketCode: '399006', ticker: 'sz399006', name: '创业板', chartName: '创业板指' },
  { id: 'star-market', marketCode: '000688', ticker: 'sh000688', name: '科创板', chartName: '科创50' },
];

const bookValueIndexConfigs = [
  {
    id: 'sse-composite',
    name: '上证指数',
    code: '000001',
    pbIndexCode: '1',
    pagePath: 'index-basic?indexCode=1',
    pbField: 'addPb',
    eastmoneySecid: '1.000001',
    priceSourceName: '东方财富',
    pbLabel: '上证A股加权PB',
  },
  {
    id: 'csi300',
    name: '沪深300',
    code: '000300',
    pbIndexCode: '000300.SH',
    pagePath: 'index-pb?indexCode=000300.SH',
    priceIndexCode: '000300',
    totalReturnIndexCode: 'H00300',
    pbLabel: '沪深300加权PB',
  },
  {
    id: 'csi500',
    name: '中证500',
    code: '000905',
    pbIndexCode: '000905.SH',
    pagePath: 'index-pb?indexCode=000905.SH',
    priceIndexCode: '000905',
    totalReturnIndexCode: 'H00905',
    pbLabel: '中证500加权PB',
  },
  {
    id: 'csi-a500',
    name: '中证A500',
    code: '000510',
    pbIndexCode: '000510.CSI',
    pagePath: 'index-pb?indexCode=000510.CSI',
    priceIndexCode: '000510',
    pbLabel: '中证A500加权PB',
  },
  {
    id: 'chinext-board',
    name: '创业板综',
    code: '399102',
    pbIndexCode: '4',
    pagePath: 'cybPB',
    pbLabel: '创业板全市场加权PB',
  },
  {
    id: 'star50',
    name: '科创50',
    code: '000688',
    pbIndexCode: '000688.SH',
    pagePath: 'index-pb?indexCode=000688.SH',
    priceIndexCode: '000688',
    pbLabel: '科创50加权PB',
  },
] as const;

type RegionalValuationMode = 'hongkong' | 'us' | InternationalMarketMode;
type RegionalContentMode = 'hongkong' | 'us';

type RegionalIndexValuationConfig = {
  id: string;
  name: string;
  code: string;
  secid: string;
  officialUrl: string;
  sampleCodes: readonly string[];
  yahooSymbol?: string;
};

type RegionalValuationConfig = {
  label: string;
  sampleSize: number;
  indices: readonly RegionalIndexValuationConfig[];
};

const regionalValuationConfigs: Record<RegionalValuationMode, RegionalValuationConfig> = {
  hongkong: {
    label: '港股',
    sampleSize: 8,
    indices: [
      {
        id: 'hsi', name: '恒生指数', code: 'HSI', secid: '100.HSI',
        officialUrl: 'https://www.hsi.com.hk/eng/indexes/all-indexes/hsi',
        sampleCodes: ['00700', '09988', '00005', '01299', '00939', '01398', '00941', '00388'],
      },
      {
        id: 'hstech', name: '恒生科技指数', code: 'HSTECH', secid: '124.HSTECH',
        officialUrl: 'https://www.hsi.com.hk/eng/indexes/all-indexes/hstech',
        sampleCodes: ['00700', '09988', '01810', '03690', '09618', '09999', '01024', '00981'],
      },
      {
        id: 'hscei', name: '恒生中国企业指数', code: 'HSCEI', secid: '100.HSCEI',
        officialUrl: 'https://www.hsi.com.hk/eng/indexes/all-indexes/hscei',
        sampleCodes: ['00700', '09988', '00939', '01398', '00941', '01810', '03690', '02628'],
      },
      {
        id: 'hsci', name: '恒生综合指数', code: 'HSCI', secid: '124.HSCI',
        officialUrl: 'https://www.hsi.com.hk/eng/indexes/all-indexes/hsci',
        sampleCodes: ['00700', '09988', '00005', '01299', '00939', '01398', '00941', '01810'],
      },
    ],
  },
  us: {
    label: '美股',
    sampleSize: 8,
    indices: [
      {
        id: 'sp500', name: '标普500', code: 'SPX', secid: '100.SPX',
        officialUrl: 'https://www.spglobal.com/spdji/en/indices/equity/sp-500/',
        sampleCodes: ['NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOG', 'META', 'BRK_B', 'AVGO'],
      },
      {
        id: 'nasdaq100', name: '纳斯达克100', code: 'NDX', secid: '100.NDX',
        officialUrl: 'https://indexes.nasdaqomx.com/Index/Overview/NDX',
        sampleCodes: ['NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOG', 'META', 'AVGO', 'TSLA'],
      },
      {
        id: 'dow', name: '道琼斯工业指数', code: 'DJIA', secid: '100.DJIA',
        officialUrl: 'https://www.spglobal.com/spdji/en/indices/equity/dow-jones-industrial-average/',
        sampleCodes: ['GS', 'MSFT', 'HD', 'CAT', 'MCD', 'AMZN', 'NVDA', 'AAPL'],
      },
      {
        id: 'sox', name: '费城半导体指数', code: 'SOX', secid: '251.SOX',
        officialUrl: 'https://indexes.nasdaqomx.com/Index/Overview/SOX',
        sampleCodes: ['NVDA', 'AVGO', 'AMD', 'MU', 'ASML', 'AMAT', 'LRCX', 'QCOM'],
        yahooSymbol: '^SOX',
      },
    ],
  },
  japan: {
    label: '日股', sampleSize: 6,
    indices: [
      { id: 'nikkei225', name: '日经225', code: 'N225', secid: '', yahooSymbol: '^N225', officialUrl: 'https://indexes.nikkei.co.jp/en/nkave/' , sampleCodes: ['7203.T', '8306.T', '6758.T', '6501.T', '9983.T', '6861.T'] },
      { id: 'topix', name: '东证指数', code: 'TOPIX', secid: '', yahooSymbol: '1306.T', officialUrl: 'https://www.jpx.co.jp/english/markets/indices/topix/', sampleCodes: ['7203.T', '8306.T', '6758.T', '6501.T', '7974.T', '9984.T'] },
      { id: 'jpx400', name: 'JPX日经400', code: 'JPX400', secid: '', yahooSymbol: '1591.T', officialUrl: 'https://www.jpx.co.jp/english/markets/indices/jpx-nikkei400/', sampleCodes: ['7203.T', '8306.T', '6758.T', '6501.T', '6861.T', '8035.T'] },
    ],
  },
  korea: {
    label: '韩股', sampleSize: 6,
    indices: [
      { id: 'kospi', name: '韩国KOSPI', code: 'KS11', secid: '', yahooSymbol: '^KS11', officialUrl: 'https://global.krx.co.kr/', sampleCodes: ['005930.KS', '000660.KS', '373220.KS', '005380.KS', '207940.KS', '000270.KS'] },
      { id: 'kosdaq', name: '韩国KOSDAQ', code: 'KQ11', secid: '', yahooSymbol: '^KQ11', officialUrl: 'https://global.krx.co.kr/', sampleCodes: ['035420.KS', '035720.KS', '068270.KS', '207940.KS', '373220.KS', '000660.KS'] },
      { id: 'kospi200', name: 'KOSPI 200', code: 'KS200', secid: '', yahooSymbol: '^KS200', officialUrl: 'https://global.krx.co.kr/', sampleCodes: ['005930.KS', '000660.KS', '373220.KS', '005380.KS', '000270.KS', '105560.KS'] },
    ],
  },
  india: {
    label: '印度股市', sampleSize: 6,
    indices: [
      { id: 'nifty50', name: '印度NIFTY 50', code: 'NSEI', secid: '', yahooSymbol: '^NSEI', officialUrl: 'https://www.niftyindices.com/indices/equity/broad-based-indices/NIFTY--50', sampleCodes: ['RELIANCE.NS', 'HDFCBANK.NS', 'BHARTIARTL.NS', 'TCS.NS', 'ICICIBANK.NS', 'INFY.NS'] },
      { id: 'sensex', name: '孟买SENSEX', code: 'BSESN', secid: '', yahooSymbol: '^BSESN', officialUrl: 'https://www.bseindices.com/', sampleCodes: ['RELIANCE.NS', 'HDFCBANK.NS', 'BHARTIARTL.NS', 'TCS.NS', 'ICICIBANK.NS', 'INFY.NS'] },
      { id: 'niftybank', name: 'NIFTY银行', code: 'NSEBANK', secid: '', yahooSymbol: '^NSEBANK', officialUrl: 'https://www.niftyindices.com/', sampleCodes: ['HDFCBANK.NS', 'ICICIBANK.NS', 'SBIN.NS', 'LICI.NS', 'RELIANCE.NS', 'TCS.NS'] },
    ],
  },
  germany: {
    label: '德国股市', sampleSize: 6,
    indices: [
      { id: 'dax', name: '德国DAX', code: 'DAX', secid: '', yahooSymbol: '^GDAXI', officialUrl: 'https://www.dax-indices.com/', sampleCodes: ['SAP.DE', 'SIE.DE', 'ALV.DE', 'DTE.DE', 'BAS.DE', 'BMW.DE'] },
      { id: 'mdax', name: '德国MDAX', code: 'MDAX', secid: '', yahooSymbol: '^MDAXI', officialUrl: 'https://www.dax-indices.com/', sampleCodes: ['SAP.DE', 'SIE.DE', 'ALV.DE', 'DTE.DE', 'MUV2.DE', 'IFX.DE'] },
      { id: 'tecdax', name: '德国TecDAX', code: 'TECDAX', secid: '', yahooSymbol: '^TECDAX', officialUrl: 'https://www.dax-indices.com/', sampleCodes: ['SAP.DE', 'IFX.DE', 'DTE.DE', 'SIE.DE', 'ALV.DE', 'MUV2.DE'] },
    ],
  },
  france: {
    label: '法国股市', sampleSize: 6,
    indices: [
      { id: 'cac40', name: '法国CAC 40', code: 'CAC40', secid: '', yahooSymbol: '^FCHI', officialUrl: 'https://live.euronext.com/en/product/indices/FR0003500008-XPAR', sampleCodes: ['MC.PA', 'OR.PA', 'TTE.PA', 'AIR.PA', 'RMS.PA', 'SU.PA'] },
      { id: 'sbf120', name: '法国SBF 120', code: 'SBF120', secid: '', yahooSymbol: '^SBF120', officialUrl: 'https://live.euronext.com/', sampleCodes: ['MC.PA', 'OR.PA', 'TTE.PA', 'AIR.PA', 'SAN.PA', 'BNP.PA'] },
      { id: 'cacnext20', name: 'CAC Next 20', code: 'CACNEXT20', secid: '', yahooSymbol: '^CN20', officialUrl: 'https://live.euronext.com/', sampleCodes: ['SAN.PA', 'BNP.PA', 'CS.PA', 'EL.PA', 'SU.PA', 'AIR.PA'] },
    ],
  },
  uk: {
    label: '英国股市', sampleSize: 6,
    indices: [
      { id: 'ftse100', name: '英国富时100', code: 'FTSE100', secid: '', yahooSymbol: '^FTSE', officialUrl: 'https://www.londonstockexchange.com/indices/ftse-100', sampleCodes: ['SHEL.L', 'AZN.L', 'HSBA.L', 'ULVR.L', 'BP.L', 'GSK.L'] },
      { id: 'ftse250', name: '英国富时250', code: 'FTSE250', secid: '', yahooSymbol: '^FTMC', officialUrl: 'https://www.londonstockexchange.com/indices/ftse-250', sampleCodes: ['REL.L', 'LSEG.L', 'BATS.L', 'RIO.L', 'SHEL.L', 'AZN.L'] },
      { id: 'ftseall', name: '富时全股指数', code: 'FTAS', secid: '', yahooSymbol: '^FTAS', officialUrl: 'https://www.londonstockexchange.com/indices/ftse-all-share', sampleCodes: ['SHEL.L', 'AZN.L', 'HSBA.L', 'ULVR.L', 'REL.L', 'LSEG.L'] },
    ],
  },
};

const cryptoAssetConfigs = [
  { id: 'bitcoin', symbol: 'BTC', binance: 'BTCUSDT', name: '比特币' },
  { id: 'ethereum', symbol: 'ETH', binance: 'ETHUSDT', name: '以太坊' },
  { id: 'binancecoin', symbol: 'BNB', binance: 'BNBUSDT', name: 'BNB' },
  { id: 'solana', symbol: 'SOL', binance: 'SOLUSDT', name: 'Solana' },
  { id: 'ripple', symbol: 'XRP', binance: 'XRPUSDT', name: 'XRP' },
  { id: 'dogecoin', symbol: 'DOGE', binance: 'DOGEUSDT', name: 'Dogecoin' },
];

type CryptoMarketUniverseRow = {
  id: string;
  symbol: string;
  name: string;
  image?: string;
  current_price: number;
  market_cap: number;
  market_cap_rank?: number;
  price_change_percentage_24h?: number;
  last_updated?: string;
};

const CRYPTO_STABLECOINS = new Set(['USDT', 'USDC', 'USDS', 'DAI', 'FDUSD', 'USDE', 'PYUSD', 'USD1', 'TUSD', 'USDD', 'FRAX', 'GHO', 'LUSD']);
const CRYPTO_MEME_ASSETS = new Set(['DOGE', 'SHIB', 'PEPE', 'BONK', 'WIF', 'FLOKI', 'BRETT', 'MOG', 'POPCAT', 'SPX', 'PENGU', 'TRUMP']);
const CRYPTO_EXCHANGE_ASSETS = new Set(['BNB', 'CRO', 'LEO', 'OKB', 'BGB', 'KCS', 'GT', 'HT', 'MX', 'WBT']);
const CRYPTO_DEFI_ASSETS = new Set(['UNI', 'AAVE', 'SKY', 'MKR', 'LDO', 'ENA', 'CRV', 'PENDLE', 'JUP', 'RUNE', 'CAKE', 'COMP', 'SNX', 'SUSHI', '1INCH', 'DYDX', 'INJ', 'HYPE']);
const CRYPTO_LAYER2_ASSETS = new Set(['ARB', 'OP', 'MNT', 'STRK', 'ZK', 'IMX', 'POL', 'STX', 'METIS', 'ZRO']);
const CRYPTO_AI_ASSETS = new Set(['TAO', 'FET', 'RENDER', 'RNDR', 'GRT', 'VIRTUAL', 'AKT', 'AIOZ', 'WLD', 'KAITO']);
const CRYPTO_RWA_ASSETS = new Set(['ONDO', 'QNT', 'XDC', 'CFG', 'OM', 'PLUME', 'FIGR_HELOC']);
const CRYPTO_GAMING_ASSETS = new Set(['GALA', 'SAND', 'MANA', 'APE', 'AXS', 'RON', 'BEAM', 'FLOW', 'CHZ']);
const CRYPTO_PRIVACY_ASSETS = new Set(['XMR', 'ZEC', 'DASH', 'ROSE', 'SCRT']);
const CRYPTO_INFRA_ASSETS = new Set(['LINK', 'FIL', 'AR', 'THETA', 'TIA', 'PYTH', 'JASMY', 'IOTA', 'GNO']);
const CRYPTO_PAYMENT_ASSETS = new Set(['XRP', 'XLM', 'LTC', 'BCH', 'HBAR', 'ALGO']);
const CRYPTO_EXCLUDED_IDS = new Set([
  'wrapped-bitcoin',
  'wrapped-ethereum',
  'weth',
  'staked-ether',
  'lido-staked-ether',
  'coinbase-wrapped-btc',
  'binance-peg-weth',
  'wrapped-steth',
  'renbtc',
]);

function classifyCryptoAsset(symbol: string) {
  if (CRYPTO_STABLECOINS.has(symbol)) return '稳定币';
  if (CRYPTO_MEME_ASSETS.has(symbol)) return 'Meme';
  if (CRYPTO_EXCHANGE_ASSETS.has(symbol)) return '交易平台';
  if (CRYPTO_DEFI_ASSETS.has(symbol)) return 'DeFi';
  if (CRYPTO_LAYER2_ASSETS.has(symbol)) return 'Layer 2';
  if (CRYPTO_AI_ASSETS.has(symbol)) return 'AI 与算力';
  if (CRYPTO_RWA_ASSETS.has(symbol)) return 'RWA';
  if (CRYPTO_GAMING_ASSETS.has(symbol)) return '游戏与 NFT';
  if (CRYPTO_PRIVACY_ASSETS.has(symbol)) return '隐私资产';
  if (CRYPTO_INFRA_ASSETS.has(symbol)) return '数据与基础设施';
  if (CRYPTO_PAYMENT_ASSETS.has(symbol)) return '支付与跨境';
  return '公链与基础层';
}

function asFiniteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function round(value: number, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function dataCenterUrl(reportName: string, params: Record<string, string | number>) {
  const search = new URLSearchParams({
    reportName,
    columns: 'ALL',
    source: 'WEB',
    client: 'WEB',
  });
  Object.entries(params).forEach(([key, value]) => search.set(key, String(value)));
  return `https://datacenter-web.eastmoney.com/api/data/v1/get?${search.toString()}`;
}

function dateOnly(value?: string) {
  return String(value || '').slice(0, 10);
}

function percentileRank(values: number[], current: number) {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0);
  if (!clean.length || !Number.isFinite(current) || current <= 0) return 50;
  const lower = clean.filter((value) => value < current).length;
  const equal = clean.filter((value) => value === current).length;
  return (lower + equal * 0.5) / clean.length * 100;
}

function temperatureZone(temperature: number) {
  if (temperature < 20) return { zone: 'cold' as const, zoneLabel: '极冷 · 短期低位' };
  if (temperature < 40) return { zone: 'low' as const, zoneLabel: '偏冷 · 短期较低' };
  if (temperature < 60) return { zone: 'fair' as const, zoneLabel: '中性 · 短期适中' };
  if (temperature < 80) return { zone: 'warm' as const, zoneLabel: '偏热 · 短期较高' };
  return { zone: 'hot' as const, zoneLabel: '过热 · 短期高位' };
}

function buildValuationTemperature(
  config: { id: string; name: string; code: string; category: 'market' | 'industry'; marketCap?: number },
  rows: ValuationTemperatureRow[],
  includeHistory = false,
): ValuationTemperatureItem | undefined {
  const ordered = [...rows]
    .filter((row) => dateOnly(row.TRADE_DATE))
    .sort((left, right) => dateOnly(left.TRADE_DATE).localeCompare(dateOnly(right.TRADE_DATE)));
  if (!ordered.length) return undefined;

  const peValues = ordered.map((row) => asFiniteNumber(row.PE_TTM_AVG ?? row.PE_TTM)).filter((value): value is number => value !== undefined && value > 0);
  const pbValues = ordered.map((row) => asFiniteNumber(row.PB_MRQ)).filter((value): value is number => value !== undefined && value > 0);
  const temperatureFor = (row: ValuationTemperatureRow) => {
    const pe = asFiniteNumber(row.PE_TTM_AVG ?? row.PE_TTM);
    const pb = asFiniteNumber(row.PB_MRQ);
    const peRank = pe !== undefined && pe > 0 ? percentileRank(peValues, pe) : undefined;
    const pbRank = pb !== undefined && pb > 0 ? percentileRank(pbValues, pb) : undefined;
    if (peRank !== undefined && pbRank !== undefined) return peRank * 0.6 + pbRank * 0.4;
    return peRank ?? pbRank ?? 50;
  };

  const current = ordered.at(-1)!;
  const currentPe = asFiniteNumber(current.PE_TTM_AVG ?? current.PE_TTM);
  if (currentPe === undefined || currentPe <= 0) return undefined;
  const currentTemperature = Math.max(0, Math.min(100, temperatureFor(current)));
  const comparison = ordered[Math.max(0, ordered.length - 21)];
  const comparisonTemperature = temperatureFor(comparison);
  const zone = temperatureZone(currentTemperature);
  const history = includeHistory
    ? ordered.map((row) => ({ time: dateOnly(row.TRADE_DATE), value: round(Math.max(0, Math.min(100, temperatureFor(row))), 1) }))
    : undefined;

  return {
    ...config,
    temperature: round(currentTemperature, 1),
    temperatureDelta: round(currentTemperature - comparisonTemperature, 1),
    ...zone,
    currentPe: round(currentPe, 2),
    currentPb: asFiniteNumber(current.PB_MRQ) ? round(asFiniteNumber(current.PB_MRQ)!, 2) : undefined,
    sampleSize: Math.max(peValues.length, pbValues.length),
    updatedAt: dateOnly(current.TRADE_DATE),
    history,
  };
}

async function getDataCenterRows(url: string) {
  const payload = await fetchJsonWithRetry(url, 2, 15000);
  const rows = payload?.result?.data;
  if (!Array.isArray(rows)) throw new Error('东方财富估值数据为空');
  return rows as ValuationTemperatureRow[];
}

async function getMarketValuationTemperature(config: typeof chinaValuationMarketConfigs[number]) {
  const url = dataCenterUrl('RPT_VALUEMARKET', {
    pageNumber: 1,
    pageSize: 500,
    sortColumns: 'TRADE_DATE',
    sortTypes: -1,
    filter: `(TRADE_MARKET_CODE="${config.marketCode}")`,
  });
  const rows = await getDataCenterRows(url);
  return buildValuationTemperature({
    id: config.id,
    name: config.name,
    code: config.marketCode,
    category: 'market',
  }, rows, true);
}

async function getTopIndustryTemperatures() {
  const latestUrl = dataCenterUrl('RPT_VALUEINDUSTRY_DET', {
    pageNumber: 1,
    pageSize: 1,
    sortColumns: 'TRADE_DATE',
    sortTypes: -1,
  });
  const latestRows = await getDataCenterRows(latestUrl);
  const latestDate = dateOnly(latestRows[0]?.TRADE_DATE);
  if (!latestDate) throw new Error('未取得行业估值日期');

  const currentUrl = dataCenterUrl('RPT_VALUEINDUSTRY_DET', {
    pageNumber: 1,
    pageSize: 500,
    sortColumns: 'TOTAL_MARKET_CAP',
    sortTypes: -1,
    filter: `(TRADE_DATE='${latestDate}')`,
  });
  const currentRows = await getDataCenterRows(currentUrl);
  const priority = new Map([['半导体', 0], ['银行Ⅱ', 1]]);
  const selected = currentRows
    .filter((row) => row.BOARD_CODE && row.BOARD_NAME && (asFiniteNumber(row.PE_TTM) || asFiniteNumber(row.PB_MRQ)))
    .sort((left, right) => {
      const leftPriority = priority.get(String(left.BOARD_NAME));
      const rightPriority = priority.get(String(right.BOARD_NAME));
      if (leftPriority !== undefined || rightPriority !== undefined) {
        return (leftPriority ?? 100) - (rightPriority ?? 100);
      }
      return (asFiniteNumber(right.TOTAL_MARKET_CAP) || 0) - (asFiniteNumber(left.TOTAL_MARKET_CAP) || 0);
    })
    .slice(0, 10);

  const results = await Promise.allSettled(selected.map(async (row) => {
    const boardCode = String(row.BOARD_CODE);
    const historyUrl = dataCenterUrl('RPT_VALUEINDUSTRY_DET', {
      pageNumber: 1,
      pageSize: 500,
      sortColumns: 'TRADE_DATE',
      sortTypes: -1,
      filter: `(BOARD_CODE="${boardCode}")`,
    });
    const historyRows = await getDataCenterRows(historyUrl);
    return buildValuationTemperature({
      id: `industry-${boardCode}`,
      name: String(row.BOARD_NAME).replace(/Ⅱ$/, ''),
      code: boardCode,
      category: 'industry',
      marketCap: asFiniteNumber(row.TOTAL_MARKET_CAP),
    }, historyRows);
  }));
  return results.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : []);
}

async function getTencentMarketCandles(ticker: string, count = 500) {
  const search = new URLSearchParams({ param: `${ticker},day,,,${count},qfq` });
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?${search.toString()}`;
  const payload = await fetchJsonWithRetry(url, 2, 15000);
  const record = payload?.data?.[ticker];
  const rows = record?.qfqday || record?.day;
  if (!Array.isArray(rows)) throw new Error(`腾讯证券 ${ticker} 日 K 数据为空`);
  const candles = rows.flatMap((row: unknown) => {
    if (!Array.isArray(row) || row.length < 6) return [];
    const [time, open, close, high, low, volume] = row;
    const values = [open, high, low, close, volume].map(Number);
    if (!String(time) || values.some((value) => !Number.isFinite(value))) return [];
    return [{
      time: String(time),
      open: values[0],
      high: values[1],
      low: values[2],
      close: values[3],
      volume: values[4],
    } satisfies MarketCandle];
  });
  return { url, candles };
}

function median(values: number[]) {
  const ordered = [...values].filter(Number.isFinite).sort((left, right) => left - right);
  if (!ordered.length) return 0;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

async function getAllMarketPbHistory() {
  const pageUrl = 'https://legulegu.com/stockdata/all-pb';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const pageInit: RequestInit & { dispatcher?: any } = {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 SparkFlow local research console',
        Accept: 'text/html,application/xhtml+xml',
      },
    };
    pageInit.dispatcher = foreignProxyAgent;
    const pageResponse = await fetch(pageUrl, pageInit);
    if (!pageResponse.ok) throw new Error(`全A市净率页面 HTTP ${pageResponse.status}`);
    const html = await pageResponse.text();
    const csrf = html.match(/<meta\s+name="_csrf"\s+content="([^"]+)"/i)?.[1];
    if (!csrf) throw new Error('全A市净率 CSRF 令牌缺失');

    const setCookies = (pageResponse.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
      || [pageResponse.headers.get('set-cookie') || ''];
    const cookie = setCookies
      .flatMap((value) => value.split(/,(?=[^;,]+=)/))
      .map((value) => value.split(';')[0]?.trim())
      .filter(Boolean)
      .join('; ');
    const shanghaiDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const token = createHash('md5').update(shanghaiDate).digest('hex');
    const apiUrl = new URL('https://legulegu.com/api/stock-data/market-index-pb');
    apiUrl.searchParams.set('marketId', 'ALL');
    apiUrl.searchParams.set('token', token);
    const dataInit: RequestInit & { dispatcher?: any } = {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 SparkFlow local research console',
        Accept: 'application/json',
        Referer: pageUrl,
        'X-CSRF-Token': csrf,
        Cookie: cookie,
      },
    };
    dataInit.dispatcher = foreignProxyAgent;
    const dataResponse = await fetch(apiUrl, dataInit);
    if (!dataResponse.ok) throw new Error(`全A市净率接口 HTTP ${dataResponse.status}`);
    const payload = await dataResponse.json() as { data?: AllMarketPbRow[] };
    if (!Array.isArray(payload.data) || !payload.data.length) throw new Error('全A市净率历史为空');
    return {
      sourceUrl: pageUrl,
      rows: payload.data,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function getIndexPbHistory(config: typeof bookValueIndexConfigs[number]) {
  const pageUrl = `https://legulegu.com/stockdata/${config.pagePath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const pageInit: RequestInit & { dispatcher?: any } = {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 SparkFlow local research console',
        Accept: 'text/html,application/xhtml+xml',
      },
    };
    pageInit.dispatcher = foreignProxyAgent;
    const pageResponse = await fetch(pageUrl, pageInit);
    if (!pageResponse.ok) throw new Error(`${config.name}市净率页面 HTTP ${pageResponse.status}`);
    const html = await pageResponse.text();
    const csrf = html.match(/<meta\s+name="_csrf"\s+content="([^"]+)"/i)?.[1];
    if (!csrf) throw new Error(`${config.name}市净率 CSRF 令牌缺失`);

    const setCookies = (pageResponse.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
      || [pageResponse.headers.get('set-cookie') || ''];
    const cookie = setCookies
      .flatMap((value) => value.split(/,(?=[^;,]+=)/))
      .map((value) => value.split(';')[0]?.trim())
      .filter(Boolean)
      .join('; ');
    const shanghaiDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const token = createHash('md5').update(shanghaiDate).digest('hex');
    const apiUrl = new URL('https://legulegu.com/api/stockdata/index-basic-pb');
    apiUrl.searchParams.set('indexCode', config.pbIndexCode);
    apiUrl.searchParams.set('token', token);
    const dataInit: RequestInit & { dispatcher?: any } = {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 SparkFlow local research console',
        Accept: 'application/json',
        Referer: pageUrl,
        'X-CSRF-Token': csrf,
        Cookie: cookie,
      },
    };
    dataInit.dispatcher = foreignProxyAgent;
    const dataResponse = await fetch(apiUrl, dataInit);
    if (!dataResponse.ok) throw new Error(`${config.name}市净率接口 HTTP ${dataResponse.status}`);
    const payload = await dataResponse.json() as { data?: IndexPbRow[] };
    if (!Array.isArray(payload.data) || !payload.data.length) throw new Error(`${config.name}市净率历史为空`);
    return { sourceUrl: pageUrl, rows: payload.data };
  } finally {
    clearTimeout(timer);
  }
}

async function getCsiIndexPerformance(indexCode: string) {
  const shanghaiDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()).replaceAll('-', '');
  const search = new URLSearchParams({
    indexCode,
    startDate: '20041231',
    endDate: shanghaiDate,
  });
  const url = `https://www.csindex.com.cn/csindex-home/perf/index-perf?${search.toString()}`;
  const payload = await fetchJsonWithRetry(url, 2, 30000) as { data?: CsiIndexPerformanceRow[] };
  if (!Array.isArray(payload.data) || !payload.data.length) {
    throw new Error(`中证指数 ${indexCode} 历史行情为空`);
  }
  const points = payload.data.flatMap((row) => {
    const compactDate = String(row.tradeDate || '');
    const close = asFiniteNumber(row.close);
    if (!/^\d{8}$/.test(compactDate) || close === undefined || close <= 0) return [];
    return [{
      time: `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`,
      close,
    }];
  });
  return { url, points };
}

async function getEastMoneyIndexPerformance(secid: string) {
  const search = new URLSearchParams({
    secid,
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56',
    klt: '101',
    fqt: '0',
    beg: '20041231',
    end: '20500101',
  });
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?${search.toString()}`;
  const payload = await fetchJsonWithRetry(url, 2, 30000) as { data?: { klines?: string[] } };
  const klines = payload.data?.klines;
  if (!Array.isArray(klines) || !klines.length) {
    throw new Error(`东方财富指数 ${secid} 历史行情为空`);
  }
  const points = klines.flatMap((row) => {
    const columns = row.split(',');
    const time = dateOnly(columns[0]);
    const close = asFiniteNumber(columns[2]);
    return time && close !== undefined && close > 0 ? [{ time, close }] : [];
  });
  return { url, points };
}

async function getIndexBookValueAnchor(config: typeof bookValueIndexConfigs[number]) {
  const [{ sourceUrl, rows }, priceResult, totalReturnResult] = await Promise.all([
    getIndexPbHistory(config),
    'priceIndexCode' in config
      ? getCsiIndexPerformance(config.priceIndexCode)
      : 'eastmoneySecid' in config
        ? getEastMoneyIndexPerformance(config.eastmoneySecid)
        : Promise.resolve(undefined),
    'totalReturnIndexCode' in config ? getCsiIndexPerformance(config.totalReturnIndexCode) : Promise.resolve(undefined),
  ]);
  const priceByDate = new Map(priceResult?.points.map((point) => [point.time, point.close]) || []);
  const totalReturnByDate = new Map(totalReturnResult?.points.map((point) => [point.time, point.close]) || []);
  const joined = rows.flatMap((row) => {
    const time = dateOnly(row.date);
    const pb = asFiniteNumber('pbField' in config ? row[config.pbField] : row.pb);
    const marketValue = priceByDate.get(time) ?? asFiniteNumber(row.close);
    if (!time || pb === undefined || pb <= 0 || marketValue === undefined || marketValue <= 0) return [];
    const totalReturnValue = totalReturnByDate.get(time);
    return [{ time, marketValue, totalReturnValue, pb }];
  }).sort((left, right) => left.time.localeCompare(right.time));
  if (joined.length < 200) throw new Error(`${config.name}价格与市净率可对齐历史不足`);

  const fairPb = median(joined.map((item) => item.pb));
  const points = joined.map((item) => {
    const bookValue = item.marketValue / item.pb;
    return {
      time: item.time,
      marketValue: round(item.marketValue, 2),
      ...(item.totalReturnValue !== undefined ? { totalReturnValue: round(item.totalReturnValue, 2) } : {}),
      pb: round(item.pb, 4),
      bookValue: round(bookValue, 6),
      anchorValue: round(bookValue * fairPb, 2),
    };
  });
  const current = points.at(-1)!;
  const pbPercentile = percentileRank(points.map((item) => item.pb), current.pb);
  const premiumPercent = (current.marketValue / current.anchorValue - 1) * 100;
  const status = premiumPercent >= 15
    ? '显著高于价值锚'
    : premiumPercent >= 5
      ? '略高于价值锚'
      : premiumPercent <= -15
        ? '显著低于价值锚'
        : premiumPercent <= -5
          ? '略低于价值锚'
          : '接近价值锚';
  const hasTotalReturn = Boolean(totalReturnResult && points[0]?.totalReturnValue && current.totalReturnValue);

  return {
    id: config.id,
    name: config.name,
    code: config.code,
    pbLabel: config.pbLabel,
    generatedAt: new Date().toISOString(),
    hasTotalReturn,
    current: {
      marketValue: round(current.marketValue, 2),
      ...(current.totalReturnValue !== undefined ? { totalReturnValue: round(current.totalReturnValue, 2) } : {}),
      anchorValue: round(current.anchorValue, 2),
      pb: round(current.pb, 2),
      fairPb: round(fairPb, 2),
      pbPercentile: round(pbPercentile, 1),
      premiumPercent: round(premiumPercent, 1),
      status,
      updatedAt: current.time,
    },
    points,
    methodology: `${config.name}净资产代理 = 指数价格 ÷ ${config.pbLabel}；虚线按所选区间PB中位数重估。${hasTotalReturn ? '全收益指数用于拆分股息贡献。' : '因缺少同口径全收益历史，暂不单独拆分股息贡献。'}该代理不等同于指数公司官方净资产或企业内在价值。`,
    sources: [
      { label: `${config.pbLabel} · 乐咕乐股`, url: sourceUrl },
      ...(priceResult ? [{
        label: `${config.name}价格指数 · ${'priceSourceName' in config ? config.priceSourceName : '中证指数'}`,
        url: priceResult.url,
      }] : []),
      ...(totalReturnResult ? [{ label: `${config.name}全收益指数 · 中证指数`, url: totalReturnResult.url }] : []),
    ],
  };
}

async function getBookValueAnchor() {
  const [{ sourceUrl, rows }, priceResult, totalReturnResult] = await Promise.all([
    getAllMarketPbHistory(),
    getCsiIndexPerformance('000985'),
    getCsiIndexPerformance('H00985'),
  ]);
  const pbByDate = new Map(rows.flatMap((row) => {
    const time = dateOnly(row.date);
    const pb = asFiniteNumber(row.middlePB);
    return time && pb !== undefined && pb > 0 ? [[time, pb] as const] : [];
  }));
  const totalReturnByDate = new Map(totalReturnResult.points.map((point) => [point.time, point.close]));
  const joined = priceResult.points.flatMap((point) => {
    const pb = pbByDate.get(point.time);
    const totalReturnValue = totalReturnByDate.get(point.time);
    if (pb === undefined || totalReturnValue === undefined) return [];
    return [{
      time: point.time,
      marketValue: point.close,
      totalReturnValue,
      pb,
    }];
  });
  if (joined.length < 1000) throw new Error('中证全指、全收益与全A市净率可对齐历史不足');

  const fairPb = median(joined.map((item) => item.pb));
  const points = joined.map((item) => {
    const bookValue = item.marketValue / item.pb;
    return {
      ...item,
      bookValue: round(bookValue, 6),
      anchorValue: round(bookValue * fairPb, 2),
    };
  });
  const current = points.at(-1)!;
  const pbPercentile = percentileRank(points.map((item) => item.pb), current.pb);
  const premiumPercent = (current.marketValue / current.anchorValue - 1) * 100;
  const status = premiumPercent >= 15
    ? '显著高于价值锚'
    : premiumPercent >= 5
      ? '略高于价值锚'
      : premiumPercent <= -15
        ? '显著低于价值锚'
        : premiumPercent <= -5
          ? '略低于价值锚'
          : '接近价值锚';

  return {
    id: 'csi-all-share',
    name: '中证全指',
    code: '000985',
    pbLabel: '全A中位PB',
    generatedAt: new Date().toISOString(),
    hasTotalReturn: true,
    current: {
      marketValue: round(current.marketValue, 2),
      totalReturnValue: round(current.totalReturnValue, 2),
      anchorValue: round(current.anchorValue, 2),
      pb: round(current.pb, 2),
      fairPb: round(fairPb, 2),
      pbPercentile: round(pbPercentile, 1),
      premiumPercent: round(premiumPercent, 1),
      status,
      updatedAt: current.time,
    },
    points,
    methodology: `中证全指价格 ÷ 当日全A中位PB得到净资产代理；中证全指全收益用于拆分股息贡献；${round(fairPb, 2)}倍全历史中位PB用于估值中枢参考。净资产代理与全A中位PB均为研究口径，不等同于逐家公司净资产或中证官方加权PB。`,
    sources: [
      { label: '中证全指价格指数 · 中证指数', url: priceResult.url },
      { label: '中证全指全收益指数 · 中证指数', url: totalReturnResult.url },
      { label: '全A中位市净率 · 乐咕乐股', url: sourceUrl },
      { label: '中证全指说明 · 中证指数', url: 'https://www.csindex.com.cn/#/indices/family/detail?indexCode=000985' },
    ],
  };
}

function buildCompositeMarketTemperature(markets: ValuationTemperatureItem[]) {
  const weights = new Map([
    ['csi300', 0.35],
    ['sh-main', 0.25],
    ['sz-main', 0.2],
    ['chinext', 0.12],
    ['star-market', 0.08],
  ]);
  const available = markets.filter((item) => weights.has(item.id));
  const totalWeight = available.reduce((sum, item) => sum + (weights.get(item.id) || 0), 0);
  if (!available.length || totalWeight <= 0) throw new Error('A股综合估值温度暂时不可用');
  const weighted = (selector: (item: ValuationTemperatureItem) => number) => available.reduce(
    (sum, item) => sum + selector(item) * (weights.get(item.id) || 0),
    0,
  ) / totalWeight;

  const historyByDate = new Map<string, Array<{ value: number; weight: number }>>();
  available.forEach((item) => {
    const weight = weights.get(item.id) || 0;
    item.history?.forEach((point) => {
      const entries = historyByDate.get(point.time) || [];
      entries.push({ value: point.value, weight });
      historyByDate.set(point.time, entries);
    });
  });
  const history = [...historyByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([time, entries]) => {
      const weight = entries.reduce((sum, entry) => sum + entry.weight, 0);
      return {
        time,
        value: round(entries.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / weight, 1),
      };
    });

  const temperature = Math.max(0, Math.min(100, weighted((item) => item.temperature)));
  return {
    id: 'all-market',
    name: 'A股综合',
    code: 'CN-COMPOSITE',
    category: 'market' as const,
    temperature: round(temperature, 1),
    temperatureDelta: round(weighted((item) => item.temperatureDelta), 1),
    ...temperatureZone(temperature),
    currentPe: round(weighted((item) => item.currentPe), 2),
    sampleSize: Math.min(...available.map((item) => item.sampleSize)),
    updatedAt: available.map((item) => item.updatedAt).sort().at(-1) || '',
    history,
  };
}

async function getChinaValuationDashboard() {
  const [marketResult, industryResult, allMarketBookValueResult] = await Promise.all([
    Promise.allSettled(chinaValuationMarketConfigs.map(getMarketValuationTemperature)),
    getTopIndustryTemperatures(),
    getBookValueAnchor()
      .catch(async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return getBookValueAnchor();
      })
      .catch(() => undefined),
  ]);
  const indexBookValueAnchors = [];
  for (const [index, config] of bookValueIndexConfigs.entries()) {
    try {
      indexBookValueAnchors.push(await getIndexBookValueAnchor(config));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 350 + index * 150));
      try {
        indexBookValueAnchors.push(await getIndexBookValueAnchor(config));
      } catch {
        // Keep the rest of the valuation dashboard available when one upstream series is unavailable.
      }
    }
  }
  const markets = marketResult.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : []);
  const bookValueAnchors = [
    ...(allMarketBookValueResult ? [allMarketBookValueResult] : []),
    ...indexBookValueAnchors,
  ];
  const overall = buildCompositeMarketTemperature(markets);

  const rawCharts = chinaValuationMarketConfigs.flatMap((config) => {
    const market = markets.find((item) => item.id === config.id);
    if (!market) return [];
    return [{
      id: config.id,
      name: `${market.name}相对估值热度`,
      ticker: config.marketCode,
      sourceUrl: 'https://data.eastmoney.com/gzfx/',
      temperature: market.history || [],
    }];
  });
  const csi300Chart = rawCharts.find((item) => item.id === 'csi300');
  const charts = [
    ...(csi300Chart ? [{
      ...csi300Chart,
      id: 'all-market',
      name: 'A股综合相对估值热度',
      temperature: overall.history,
    }] : []),
    ...rawCharts.filter((item) => item.id !== 'csi300'),
  ];
  const marketCards = [
    overall,
    ...markets.filter((item) => item.id !== 'csi300'),
  ];

  return {
    generatedAt: new Date().toISOString(),
    methodology: '热度为近 500 个交易日相对估值分位：各市场采用 PE 60% + PB 40%；A股综合再按沪深300 35%、沪市25%、深市20%、创业板12%、科创板8%加权。热度仅表示短周期相对位置，不构成定投或买卖信号。',
    periodLabel: '近 500 个交易日',
    sources: [
      { label: '东方财富 Choice 公开估值页', url: 'https://data.eastmoney.com/gzfx/' },
      { label: '中证全指说明', url: 'https://www.csindex.com.cn/#/indices/family/detail?indexCode=000985' },
    ],
    overall: { ...overall, history: undefined },
    markets: marketCards.map((item) => ({ ...item, history: undefined })),
    industries: industryResult,
    charts,
    bookValueAnchor: allMarketBookValueResult,
    bookValueAnchors,
  };
}

type YahooFundamentalPoint = {
  effectiveDate: string;
  equity: number;
  shares: number;
  netIncome?: number;
};

type YahooPricePoint = {
  time: string;
  close: number;
};

function yahooSymbolForStock(mode: RegionalValuationMode, stock: ChinaHeatmapStock) {
  if (mode === 'hongkong') return `${stock.code.replace(/^0+/, '').padStart(4, '0')}.HK`;
  if (mode === 'us') return stock.code.replace(/[._]/g, '-').toUpperCase();
  return stock.code.toUpperCase();
}

const yahooFundamentalCache = new Map<string, { storedAt: number; data: Awaited<ReturnType<typeof getYahooFundamentalHistory>> }>();
const yahooFundamentalInFlight = new Map<string, Promise<Awaited<ReturnType<typeof getYahooFundamentalHistory>>>>();

async function getYahooFundamentalHistory(symbol: string) {
  const encoded = encodeURIComponent(symbol);
  const period2 = Math.floor(Date.now() / 1000) + 86400;
  const period1 = period2 - 7 * 366 * 86400;
  const fundamentalUrl = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encoded}?symbol=${encoded}&type=annualStockholdersEquity,annualDilutedAverageShares,annualBasicAverageShares,annualNetIncome&period1=${period1}&period2=${period2}`;
  const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=5y&interval=1d&events=history`;
  const [fundamentalText, chartText] = await Promise.all([
    fetchRoutedText(fundamentalUrl, 'proxy', 18000, 'application/json'),
    fetchRoutedText(chartUrl, 'proxy', 18000, 'application/json'),
  ]);
  const fundamentalPayload = JSON.parse(fundamentalText) as Record<string, any>;
  const chartPayload = JSON.parse(chartText) as Record<string, any>;
  const series = Array.isArray(fundamentalPayload?.timeseries?.result)
    ? fundamentalPayload.timeseries.result as Array<Record<string, any>>
    : [];
  const valuesFor = (type: string) => {
    const record = series.find((item) => item?.meta?.type?.includes(type));
    const values = Array.isArray(record?.[type]) ? record[type] as Array<Record<string, any>> : [];
    return new Map(values.flatMap((item) => {
      const date = dateOnly(item.asOfDate);
      const value = asFiniteNumber(item?.reportedValue?.raw);
      return date && value !== undefined ? [[date, value] as const] : [];
    }));
  };
  const equities = valuesFor('annualStockholdersEquity');
  const dilutedShares = valuesFor('annualDilutedAverageShares');
  const basicShares = valuesFor('annualBasicAverageShares');
  const netIncome = valuesFor('annualNetIncome');
  const fundamentals: YahooFundamentalPoint[] = [...equities.entries()].flatMap(([date, equity]) => {
    const shares = dilutedShares.get(date) ?? basicShares.get(date);
    if (!shares || shares <= 0 || equity <= 0) return [];
    const effective = new Date(`${date}T00:00:00Z`);
    effective.setUTCDate(effective.getUTCDate() + 90);
    return [{
      effectiveDate: effective.toISOString().slice(0, 10),
      equity,
      shares,
      netIncome: netIncome.get(date),
    }];
  }).sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate));

  const chart = chartPayload?.chart?.result?.[0];
  const timestamps = Array.isArray(chart?.timestamp) ? chart.timestamp as number[] : [];
  const closes = Array.isArray(chart?.indicators?.quote?.[0]?.close)
    ? chart.indicators.quote[0].close as Array<number | null>
    : [];
  const prices: YahooPricePoint[] = timestamps.flatMap((timestamp, index) => {
    const close = asFiniteNumber(closes[index]);
    if (!timestamp || close === undefined || close <= 0) return [];
    return [{ time: new Date(timestamp * 1000).toISOString().slice(0, 10), close }];
  });
  if (fundamentals.length < 2 || prices.length < 200) throw new Error(`${symbol} 公开财务历史不足`);
  return { symbol, fundamentalUrl, chartUrl, fundamentals, prices };
}

async function getCachedYahooFundamentalHistory(symbol: string) {
  const cached = yahooFundamentalCache.get(symbol);
  if (cached && Date.now() - cached.storedAt < 6 * 60 * 60 * 1000) return cached.data;
  const activeRequest = yahooFundamentalInFlight.get(symbol);
  if (activeRequest) return activeRequest;
  const request = getYahooFundamentalHistory(symbol)
    .then((data) => {
      yahooFundamentalCache.set(symbol, { storedAt: Date.now(), data });
      return data;
    })
    .finally(() => yahooFundamentalInFlight.delete(symbol));
  yahooFundamentalInFlight.set(symbol, request);
  return request;
}

function buildRegionalIndustryTemperatures(stocks: ChinaHeatmapStock[], updatedAt: string) {
  const grouped = new Map<string, ChinaHeatmapStock[]>();
  stocks.forEach((stock) => {
    const peers = grouped.get(stock.industry) || [];
    peers.push(stock);
    grouped.set(stock.industry, peers);
  });
  const metrics = [...grouped.entries()].flatMap(([name, peers]) => {
    const eligible = peers.filter((stock) => stock.marketCap > 0 && stock.pe && stock.pe > 0 && stock.pe < 500 && stock.pb && stock.pb > 0 && stock.pb < 80);
    if (eligible.length < 2) return [];
    const marketCap = eligible.reduce((sum, stock) => sum + stock.marketCap, 0);
    const earnings = eligible.reduce((sum, stock) => sum + stock.marketCap / stock.pe!, 0);
    const book = eligible.reduce((sum, stock) => sum + stock.marketCap / stock.pb!, 0);
    if (earnings <= 0 || book <= 0) return [];
    return [{ name, marketCap, pe: marketCap / earnings, pb: marketCap / book, sampleSize: eligible.length }];
  }).sort((left, right) => right.marketCap - left.marketCap).slice(0, 10);
  const peValues = metrics.map((item) => item.pe);
  const pbValues = metrics.map((item) => item.pb);
  return metrics.map((item, index) => {
    const temperature = percentileRank(peValues, item.pe) * 0.6 + percentileRank(pbValues, item.pb) * 0.4;
    return {
      id: `regional-industry-${index}`,
      name: item.name,
      code: `REGION-${index}`,
      category: 'industry' as const,
      temperature: round(temperature, 1),
      temperatureDelta: 0,
      ...temperatureZone(temperature),
      currentPe: round(item.pe, 2),
      currentPb: round(item.pb, 2),
      sampleSize: item.sampleSize,
      updatedAt,
      marketCap: item.marketCap,
    };
  });
}

function normalizeRegionalStockCode(mode: RegionalValuationMode, value: string) {
  if (mode === 'hongkong') return value.replace(/\D/g, '').padStart(5, '0');
  if (mode !== 'us') return value.trim().toUpperCase();
  return value.replace(/[._-]/g, '').toUpperCase();
}

async function enrichInternationalValuationStocks(
  mode: InternationalMarketMode,
  stocks: ChinaHeatmapStock[],
  sampleCodes: readonly string[],
) {
  const wanted = new Set(sampleCodes.map((code) => normalizeRegionalStockCode(mode, code)));
  const settled = await Promise.allSettled(stocks.map(async (stock) => {
    if (!wanted.has(normalizeRegionalStockCode(mode, stock.code))) return stock;
    const history = await getCachedYahooFundamentalHistory(yahooSymbolForStock(mode, stock));
    const latest = history.fundamentals.at(-1);
    if (!latest || latest.shares <= 0 || latest.equity <= 0) return stock;
    const bookValuePerShare = latest.equity / latest.shares;
    const earningsPerShare = latest.netIncome && latest.netIncome > 0 ? latest.netIncome / latest.shares : undefined;
    return {
      ...stock,
      pb: bookValuePerShare > 0 ? stock.price / bookValuePerShare : undefined,
      pe: earningsPerShare && earningsPerShare > 0 ? stock.price / earningsPerShare : undefined,
    };
  }));
  return settled.map((result, index) => result.status === 'fulfilled' ? result.value : stocks[index]);
}

async function getRegionalIndexPerformance(indexConfig: RegionalIndexValuationConfig) {
  const eastMoneyResult = indexConfig.secid
    ? await getEastMoneyIndexPerformance(indexConfig.secid).catch(() => ({ url: indexConfig.officialUrl, points: [] as YahooPricePoint[] }))
    : { url: indexConfig.officialUrl, points: [] as YahooPricePoint[] };
  if (eastMoneyResult.points.length >= 250 || !indexConfig.yahooSymbol) return eastMoneyResult;

  const encoded = encodeURIComponent(indexConfig.yahooSymbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=5y&interval=1d&events=history`;
  const payload = JSON.parse(await fetchRoutedText(url, 'proxy', 18000, 'application/json')) as Record<string, any>;
  const chart = payload?.chart?.result?.[0];
  const timestamps = Array.isArray(chart?.timestamp) ? chart.timestamp as number[] : [];
  const closes = Array.isArray(chart?.indicators?.quote?.[0]?.close)
    ? chart.indicators.quote[0].close as Array<number | null>
    : [];
  const points = timestamps.flatMap((timestamp, index) => {
    const close = asFiniteNumber(closes[index]);
    if (!timestamp || close === undefined || close <= 0) return [];
    return [{ time: new Date(timestamp * 1000).toISOString().slice(0, 10), close }];
  });
  if (points.length < 250) return eastMoneyResult;
  return { url, points };
}

async function buildRegionalIndexValuation(
  mode: RegionalValuationMode,
  config: RegionalValuationConfig,
  indexConfig: RegionalIndexValuationConfig,
  stocks: ChinaHeatmapStock[],
) {
  const eligibleStocks = stocks
    .filter((stock) => stock.marketCap > 0)
    .sort((left, right) => right.marketCap - left.marketCap);
  const stocksByCode = new Map(eligibleStocks.map((stock) => [normalizeRegionalStockCode(mode, stock.code), stock]));
  const preferredStocks = indexConfig.sampleCodes.flatMap((code) => {
    const stock = stocksByCode.get(normalizeRegionalStockCode(mode, code));
    return stock ? [stock] : [];
  });
  const candidates = [...new Map([...preferredStocks, ...eligibleStocks]
    .map((stock) => [normalizeRegionalStockCode(mode, stock.code), stock])).values()]
    .slice(0, config.sampleSize + 8);
  const settled = await Promise.allSettled(candidates.map((stock) => (
    getCachedYahooFundamentalHistory(yahooSymbolForStock(mode, stock))
  )));
  const samples = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []).slice(0, config.sampleSize);
  if (samples.length < 4) throw new Error(`${indexConfig.name}公开财务样本不足，暂时无法生成估值代理`);

  const indexResult = await getRegionalIndexPerformance(indexConfig);
  const priceMaps = samples.map((sample) => new Map(sample.prices.map((point) => [point.time, point.close])));
  const rawProxyRows = indexResult.points.slice(-1350).flatMap((indexPoint) => {
    let marketCap = 0;
    let bookValue = 0;
    let netIncome = 0;
    let contributors = 0;
    samples.forEach((sample, sampleIndex) => {
      const price = priceMaps[sampleIndex].get(indexPoint.time);
      const fundamental = sample.fundamentals.filter((item) => item.effectiveDate <= indexPoint.time).at(-1);
      if (!price || !fundamental) return;
      marketCap += price * fundamental.shares;
      bookValue += fundamental.equity;
      netIncome += fundamental.netIncome || 0;
      contributors += 1;
    });
    if (contributors < Math.max(3, Math.floor(samples.length * 0.55)) || marketCap <= 0 || bookValue <= 0 || netIncome <= 0) return [];
    return [{
      time: indexPoint.time,
      marketValue: indexPoint.close,
      pe: marketCap / netIncome,
      pb: marketCap / bookValue,
    }];
  });
  if (rawProxyRows.length < 250) throw new Error(`${indexConfig.name}估值代理可对齐历史不足`);

  const sampleSymbols = new Set(samples.map((sample) => sample.symbol));
  const currentSampleStocks = candidates.filter((stock) => sampleSymbols.has(yahooSymbolForStock(mode, stock)));
  const currentMarketCap = currentSampleStocks.reduce((sum, stock) => sum + stock.marketCap, 0);
  const currentEarnings = currentSampleStocks.reduce((sum, stock) => sum + stock.marketCap / stock.pe!, 0);
  const currentBookValue = currentSampleStocks.reduce((sum, stock) => sum + stock.marketCap / stock.pb!, 0);
  const directPe = currentEarnings > 0 ? currentMarketCap / currentEarnings : rawProxyRows.at(-1)!.pe;
  const directPb = currentBookValue > 0 ? currentMarketCap / currentBookValue : rawProxyRows.at(-1)!.pb;
  const peScale = directPe / rawProxyRows.at(-1)!.pe;
  const pbScale = directPb / rawProxyRows.at(-1)!.pb;
  const proxyRows = rawProxyRows.map((point) => ({
    ...point,
    pe: point.pe * peScale,
    pb: point.pb * pbScale,
  }));

  const latest = proxyRows.at(-1)!;
  const valuationRows: ValuationTemperatureRow[] = proxyRows.slice(-500).map((point) => ({
    TRADE_DATE: point.time,
    PE_TTM_AVG: point.pe,
    PB_MRQ: point.pb,
  }));
  const temperatureWithHistory = buildValuationTemperature({
    id: indexConfig.id,
    name: indexConfig.name,
    code: indexConfig.code,
    category: 'market',
  }, valuationRows, true)!;
  const fairPb = median(proxyRows.map((point) => point.pb));
  const anchorPoints = proxyRows.map((point) => {
    const bookValue = point.marketValue / point.pb;
    return {
      time: point.time,
      marketValue: round(point.marketValue, 2),
      pb: round(point.pb, 4),
      bookValue: round(bookValue, 6),
      anchorValue: round(bookValue * fairPb, 2),
    };
  });
  const anchorCurrent = anchorPoints.at(-1)!;
  const pbPercentile = percentileRank(anchorPoints.map((point) => point.pb), anchorCurrent.pb);
  const premiumPercent = (anchorCurrent.marketValue / anchorCurrent.anchorValue - 1) * 100;
  const status = premiumPercent >= 15
    ? '显著高于价值锚'
    : premiumPercent >= 5
      ? '略高于价值锚'
      : premiumPercent <= -15
        ? '显著低于价值锚'
        : premiumPercent <= -5
          ? '略低于价值锚'
          : '接近价值锚';
  const sampleNames = samples.map((sample) => sample.symbol).join('、');
  const bookValueAnchor = {
    id: indexConfig.id,
    name: indexConfig.name,
    code: indexConfig.code,
    pbLabel: `${indexConfig.name}成份股样本加权PB`,
    generatedAt: new Date().toISOString(),
    hasTotalReturn: false,
    current: {
      marketValue: round(anchorCurrent.marketValue, 2),
      anchorValue: round(anchorCurrent.anchorValue, 2),
      pb: round(anchorCurrent.pb, 2),
      fairPb: round(fairPb, 2),
      pbPercentile: round(pbPercentile, 1),
      premiumPercent: round(premiumPercent, 1),
      status,
      updatedAt: anchorCurrent.time,
    },
    points: anchorPoints,
    methodology: `${indexConfig.name}价格除以代表性成份股公开年报净资产所构造的加权PB代理；财报按披露后90日生效以降低前视偏差，并用${mode === 'hongkong' || mode === 'us' ? '东方财富' : 'Yahoo Finance'}当前个股PB校准最新截面。样本为 ${sampleNames}。该序列用于观察方向与历史中枢，不等同于指数公司授权PB。`,
    sources: [
      { label: `${indexConfig.name}历史行情 · ${mode === 'hongkong' || mode === 'us' ? '东方财富' : 'Yahoo Finance'}`, url: indexResult.url },
      { label: '公司年报财务序列 · Yahoo Finance', url: 'https://finance.yahoo.com/' },
      { label: `${indexConfig.name}官方指数页`, url: indexConfig.officialUrl },
    ],
  };

  return {
    temperature: temperatureWithHistory,
    chart: {
      id: indexConfig.id,
      name: `${indexConfig.name}相对估值热度`,
      ticker: indexConfig.code,
      sourceUrl: indexConfig.officialUrl,
      temperature: temperatureWithHistory.history || [],
    },
    anchor: bookValueAnchor,
    sampleCount: samples.length,
    latestTime: latest.time,
  };
}

async function getRegionalValuationDashboard(mode: RegionalValuationMode) {
  const config = regionalValuationConfigs[mode];
  const heatmap = mode === 'hongkong'
    ? await getCachedHongKongMarketHeatmap()
    : mode === 'us'
      ? await getCachedUsMarketHeatmap()
      : await getCachedGlobalMarketHeatmap(mode);
  const rawValuationStocks = heatmap.stocks as ChinaHeatmapStock[];
  const valuationStocks = mode === 'hongkong' || mode === 'us'
    ? rawValuationStocks
    : await enrichInternationalValuationStocks(mode, rawValuationStocks, config.indices[0]?.sampleCodes || []);
  const settled = await Promise.allSettled(config.indices.map((indexConfig) => (
    buildRegionalIndexValuation(mode, config, indexConfig, valuationStocks)
  )));
  const indexResults = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  if (!indexResults.length) throw new Error(`${config.label}主要指数公开财务样本不足，暂时无法生成估值代理`);

  const primary = indexResults[0];
  const overallWithHistory = {
    ...primary.temperature,
    id: 'all-market',
  };
  const marketCards = [
    { ...overallWithHistory, history: undefined },
    ...indexResults.slice(1).map((result) => ({ ...result.temperature, history: undefined })),
  ];
  const charts = [
    { ...primary.chart, id: 'all-market' },
    ...indexResults.slice(1).map((result) => result.chart),
  ];
  const bookValueAnchors = indexResults.map((result) => result.anchor);
  const industries = buildRegionalIndustryTemperatures(valuationStocks, primary.latestTime);
  const sources = [...new Map(bookValueAnchors.flatMap((anchor) => anchor.sources)
    .map((source) => [source.url, source])).values()];
  return {
    market: mode,
    marketLabel: config.label,
    generatedAt: new Date().toISOString(),
    methodology: `近500个交易日估值热度按指数分别采用代表性成份股加权PE 60% + PB 40%的历史分位；历史形态来自公开年报与指数行情，最新截面以${mode === 'hongkong' || mode === 'us' ? '东方财富' : 'Yahoo Finance'}个股PE/PB校准；行业卡片为当前横截面相对温度。覆盖 ${indexResults.length} 个主要指数，属于公开样本代理，不是交易所授权指数估值。`,
    periodLabel: '近 500 个交易日',
    sources,
    overall: { ...overallWithHistory, history: undefined },
    markets: marketCards,
    industries,
    charts,
    bookValueAnchor: primary.anchor,
    bookValueAnchors,
    coverage: `${indexResults.length} 个主要指数 · 每个指数 ${Math.min(...indexResults.map((result) => result.sampleCount))}-${Math.max(...indexResults.map((result) => result.sampleCount))} 家代表性成份股`,
  };
}

async function getEquityIndexSnapshots() {
  const eastmoneyUrl = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${marketIndexConfigs
    .map((item) => item.secid)
    .join(',')}&fields=f12,f14,f2,f3,f4,f6,f104,f105,f106,f124`;
  const tencentUrl = `https://qt.gtimg.cn/q=${marketIndexConfigs.map((item) => item.tencent).join(',')}`;
  const [eastmoneyResult, tencentResult] = await Promise.allSettled([
    fetchExternalJson(eastmoneyUrl),
    fetchExternalText(tencentUrl, 18000, 'text/plain,*/*'),
  ]);

  const tencentQuotes = new Map<string, { price: number; change?: number; changePercent?: number }>();
  if (tencentResult.status === 'fulfilled') {
    for (const match of tencentResult.value.matchAll(/v_([^=]+)="([^"]*)"/g)) {
      const fields = match[2].split('~');
      const price = asFiniteNumber(fields[3]);
      if (price === undefined) continue;
      const longQuote = fields.length > 32;
      tencentQuotes.set(match[1].toLowerCase(), {
        price,
        change: asFiniteNumber(longQuote ? fields[31] : fields[4]),
        changePercent: asFiniteNumber(longQuote ? fields[32] : fields[5]),
      });
    }
  }

  const rows = eastmoneyResult.status === 'fulfilled' && Array.isArray(eastmoneyResult.value?.data?.diff)
    ? eastmoneyResult.value.data.diff as Array<Record<string, unknown>>
    : [];
  if (!rows.length && !tencentQuotes.size) throw new Error('东方财富与腾讯主要指数行情均不可用');
  const byCode = new Map(rows.map((row: Record<string, unknown>) => [String(row.f12 || '').toUpperCase(), row]));
  const indices: MarketIndexSnapshot[] = marketIndexConfigs.flatMap((config) => {
    const code = config.secid.split('.').at(-1)?.toUpperCase() || '';
    const row = byCode.get(code) as Record<string, unknown> | undefined;
    const eastmoneyPrice = asFiniteNumber(row?.f2);
    const tencent = tencentQuotes.get(config.tencent.toLowerCase());
    const preferTencent = tencent !== undefined && (config.region === 'US' || eastmoneyPrice === undefined);
    const livePrice = preferTencent ? tencent.price : eastmoneyPrice;
    if (livePrice === undefined) return [];
    const liveChange = preferTencent ? tencent.change ?? asFiniteNumber(row?.f4) ?? 0 : asFiniteNumber(row?.f4) ?? 0;
    const liveChangePercent = preferTencent
      ? tencent.changePercent ?? asFiniteNumber(row?.f3) ?? 0
      : asFiniteNumber(row?.f3) ?? 0;
    const deviationPercent = tencent && eastmoneyPrice !== undefined ? Math.abs(tencent.price - eastmoneyPrice) / Math.max(eastmoneyPrice, 0.0001) * 100 : undefined;
    const timestamp = asFiniteNumber(row?.f124);
    return [{
      id: config.id,
      code,
      name: config.name,
      region: config.region,
      market: config.market,
      proxyFor: 'proxyFor' in config ? config.proxyFor : undefined,
      price: livePrice,
      change: liveChange,
      changePercent: liveChangePercent,
      turnover: asFiniteNumber(row?.f6),
      advancers: asFiniteNumber(row?.f104),
      decliners: asFiniteNumber(row?.f105),
      flat: asFiniteNumber(row?.f106),
      updatedAt: preferTencent ? new Date().toISOString() : timestamp ? new Date(timestamp * 1000).toISOString() : undefined,
      sourceUrl: preferTencent ? tencentUrl : eastmoneyUrl,
      validation: {
        status: deviationPercent === undefined ? 'single-source' : deviationPercent <= 0.25 ? 'verified' : 'review',
        source: preferTencent ? eastmoneyPrice === undefined ? '未取得第二来源' : '东方财富' : tencent ? '腾讯证券' : '未取得第二来源',
        price: preferTencent ? eastmoneyPrice : tencent?.price,
        deviationPercent: deviationPercent === undefined ? undefined : round(deviationPercent, 3),
      },
    }];
  });

  return {
    indices,
    eastmoneyUrl,
    tencentUrl,
    tencentAvailable: tencentResult.status === 'fulfilled',
  };
}

async function getCryptoMarketSnapshots() {
  const binanceUrl = `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(cryptoAssetConfigs.map((item) => item.binance)))}`;
  const okxUrl = 'https://www.okx.com/api/v5/market/tickers?instType=SPOT';
  const [binanceResult, okxResult] = await Promise.allSettled([
    fetchRoutedText(binanceUrl, 'proxy', 12000, 'application/json'),
    fetchRoutedText(okxUrl, 'proxy', 12000, 'application/json'),
  ]);

  const binanceRows = binanceResult.status === 'fulfilled'
    ? JSON.parse(binanceResult.value) as Array<Record<string, unknown>>
    : [];
  const okxPayload = okxResult.status === 'fulfilled'
    ? JSON.parse(okxResult.value) as { data?: Array<Record<string, unknown>> }
    : {};
  const bySymbol = new Map(
    Array.isArray(binanceRows)
      ? binanceRows.map((row) => [String(row.symbol || '').toUpperCase(), row])
      : [],
  );
  const byInstrument = new Map(
    Array.isArray(okxPayload.data)
      ? okxPayload.data.map((row) => [String(row.instId || '').toUpperCase(), row])
      : [],
  );

  const indices: MarketIndexSnapshot[] = cryptoAssetConfigs.flatMap((config) => {
    const binance = bySymbol.get(config.binance);
    const okx = byInstrument.get(`${config.symbol}-USDT`);
    const binancePrice = asFiniteNumber(binance?.lastPrice);
    const okxPrice = asFiniteNumber(okx?.last);
    const price = binancePrice ?? okxPrice;
    if (price === undefined) return [];

    const okxOpen = asFiniteNumber(okx?.open24h);
    const okxChangePercent = okxPrice !== undefined && okxOpen
      ? (okxPrice - okxOpen) / okxOpen * 100
      : undefined;
    const changePercent = asFiniteNumber(binance?.priceChangePercent)
      ?? okxChangePercent
      ?? 0;
    const deviationPercent = binancePrice !== undefined && okxPrice !== undefined
      ? Math.abs(binancePrice - okxPrice) / Math.max(price, 0.00000001) * 100
      : undefined;
    const closeTime = asFiniteNumber(binance?.closeTime);
    const okxTime = asFiniteNumber(okx?.ts);
    const updatedAt = closeTime
      ? new Date(closeTime).toISOString()
      : okxTime
        ? new Date(okxTime).toISOString()
        : new Date().toISOString();

    return [{
      id: `crypto-${config.symbol.toLowerCase()}`,
      code: config.symbol,
      name: config.name,
      region: 'CRYPTO',
      market: 'crypto',
      price,
      change: price * changePercent / 100,
      changePercent,
      turnover: asFiniteNumber(binance?.quoteVolume),
      updatedAt,
      sourceUrl: `https://www.okx.com/trade-spot/${config.symbol.toLowerCase()}-usdt`,
      validation: {
        status: deviationPercent === undefined ? 'single-source' : deviationPercent <= 0.6 ? 'verified' : 'review',
        source: binancePrice !== undefined && okxPrice !== undefined ? 'Binance + OKX' : binancePrice !== undefined ? 'Binance' : 'OKX',
        price: okxPrice,
        deviationPercent: deviationPercent === undefined ? undefined : round(deviationPercent, 3),
      },
    }];
  });

  if (!indices.length) {
    const reasons = [
      binanceResult.status === 'rejected' ? `Binance: ${String(binanceResult.reason)}` : '',
      okxResult.status === 'rejected' ? `OKX: ${String(okxResult.reason)}` : '',
    ].filter(Boolean);
    throw new Error(`加密货币行情为空${reasons.length ? `（${reasons.join('；')}）` : ''}`);
  }

  return {
    indices,
    binanceUrl,
    okxUrl,
    binanceAvailable: binanceResult.status === 'fulfilled',
    okxAvailable: okxResult.status === 'fulfilled',
  };
}

async function getMarketIndexSnapshots() {
  const [equityResult, cryptoResult] = await Promise.allSettled([
    getEquityIndexSnapshots(),
    getCachedCryptoMarketSnapshots(),
  ]);
  if (equityResult.status === 'rejected' && cryptoResult.status === 'rejected') {
    throw new Error(`股票与加密行情均不可用：${String(equityResult.reason)}；${String(cryptoResult.reason)}`);
  }

  return {
    indices: [
      ...(equityResult.status === 'fulfilled' ? equityResult.value.indices : []),
      ...(cryptoResult.status === 'fulfilled' ? cryptoResult.value.indices : []),
    ],
    eastmoneyUrl: equityResult.status === 'fulfilled' ? equityResult.value.eastmoneyUrl : 'https://quote.eastmoney.com/center/',
    tencentUrl: equityResult.status === 'fulfilled' ? equityResult.value.tencentUrl : 'https://stockapp.finance.qq.com/',
    tencentAvailable: equityResult.status === 'fulfilled' && equityResult.value.tencentAvailable,
    binanceUrl: cryptoResult.status === 'fulfilled' ? cryptoResult.value.binanceUrl : 'https://www.binance.com/en/markets/overview',
    okxUrl: cryptoResult.status === 'fulfilled' ? cryptoResult.value.okxUrl : 'https://www.okx.com/markets/prices',
    cryptoAvailable: cryptoResult.status === 'fulfilled',
  };
}

async function getChinaMarketHeatmap() {
  const baseUrl = 'https://push2delay.eastmoney.com/api/qt/clist/get?pz=100&po=1&np=1&fltt=2&invt=2&fid=f20&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f12,f14,f2,f3,f20,f100,f124';
  const industryUrl = 'https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f20&fs=m:90+t:2&fields=f12,f14,f20';
  const [payloads, industryPayload] = await Promise.all([
    Promise.all(
      [1, 2, 3, 4].map((page) => fetchJsonWithRetry(`${baseUrl}&pn=${page}`, 2, 12000)),
    ),
    fetchJsonWithRetry(industryUrl, 2, 12000),
  ]);
  const rawRows: Record<string, unknown>[] = payloads.flatMap(
    (payload) => Array.isArray(payload?.data?.diff) ? payload.data.diff : [],
  );
  const rows = Array.from(
    new Map(rawRows.map((row) => [String(row.f12 || '').trim(), row])).values(),
  ).filter((row) => String(row.f12 || '').trim()).slice(0, 320);
  if (!Array.isArray(rows) || !rows.length) throw new Error('A 股热力图行情为空');
  const industryRows: Record<string, unknown>[] = Array.isArray(industryPayload?.data?.diff)
    ? industryPayload.data.diff
    : [];
  const industryMarketCaps = industryRows.reduce<Record<string, number>>((result, row) => {
    const industry = String(row.f14 || '').trim();
    const marketCap = asFiniteNumber(row.f20);
    if (industry && marketCap && marketCap > 0) result[industry] = marketCap;
    return result;
  }, {});

  const stocks: ChinaHeatmapStock[] = rows.flatMap((row: Record<string, unknown>) => {
    const code = String(row.f12 || '').trim();
    const name = String(row.f14 || '').trim();
    const price = asFiniteNumber(row.f2);
    const changePercent = asFiniteNumber(row.f3);
    const marketCap = asFiniteNumber(row.f20);
    if (!code || !name || price === undefined || changePercent === undefined || !marketCap || marketCap <= 0) return [];
    const timestamp = asFiniteNumber(row.f124);
    const exchange = code.startsWith('6') ? 'sh' : code.startsWith('8') || code.startsWith('4') ? 'bj' : 'sz';
    return [{
      code,
      name,
      price,
      changePercent,
      marketCap,
      industry: String(row.f100 || '其他').trim() || '其他',
      updatedAt: timestamp ? new Date(timestamp * 1000).toISOString() : undefined,
      sourceUrl: `https://quote.eastmoney.com/${exchange}${code}.html`,
    }];
  });

  return {
    generatedAt: new Date().toISOString(),
    count: stocks.length,
    coverage: '前 320 家个股 · 行业面积按全市场板块市值校准',
    source: '东方财富',
    sourceUrl: baseUrl,
    industrySourceUrl: industryUrl,
    industryMarketCaps,
    stocks,
  };
}

async function getHongKongMarketHeatmap() {
  const baseUrl = 'https://push2delay.eastmoney.com/api/qt/clist/get?pz=100&po=1&np=1&fltt=2&invt=2&fid=f20&fs=m:116+t:3&fields=f12,f14,f2,f3,f9,f20,f23,f100,f124';
  const payloads = await Promise.all(
    [1, 2, 3, 4, 5].map((page) => fetchJsonWithRetry(`${baseUrl}&pn=${page}`, 2, 12000)),
  );
  const rawRows: Record<string, unknown>[] = payloads.flatMap(
    (payload) => Array.isArray(payload?.data?.diff) ? payload.data.diff : [],
  );
  const rows = Array.from(
    new Map(rawRows.map((row) => [String(row.f12 || '').trim(), row])).values(),
  )
    .filter((row) => {
      const code = String(row.f12 || '').trim();
      const name = String(row.f14 || '').trim();
      return code && !code.startsWith('8') && !/-R$/i.test(name);
    })
    .slice(0, 320);
  if (!rows.length) throw new Error('港股热力图行情为空');

  const stocks: ChinaHeatmapStock[] = rows.flatMap((row) => {
    const code = String(row.f12 || '').trim().padStart(5, '0');
    const name = String(row.f14 || '').trim();
    const price = asFiniteNumber(row.f2);
    const changePercent = asFiniteNumber(row.f3);
    const marketCap = asFiniteNumber(row.f20);
    if (!code || !name || price === undefined || changePercent === undefined || !marketCap || marketCap <= 0) return [];
    const timestamp = asFiniteNumber(row.f124);
    return [{
      code,
      name,
      price,
      changePercent,
      marketCap,
      pe: asFiniteNumber(row.f9),
      pb: asFiniteNumber(row.f23),
      industry: String(row.f100 || '其他').trim() || '其他',
      updatedAt: timestamp ? new Date(timestamp * 1000).toISOString() : undefined,
      sourceUrl: `https://quote.eastmoney.com/hk/${code}.html`,
    }];
  });
  if (!stocks.length) throw new Error('港股热力图缺少有效行情');

  const industryMarketCaps = stocks.reduce<Record<string, number>>((result, stock) => {
    result[stock.industry] = (result[stock.industry] || 0) + stock.marketCap;
    return result;
  }, {});

  return {
    generatedAt: new Date().toISOString(),
    count: stocks.length,
    coverage: `港股主板总市值前 ${stocks.length} 家公司 · 行业面积按样本市值校准`,
    source: '东方财富',
    sourceUrl: baseUrl,
    industryMarketCaps,
    stocks,
  };
}

async function getUsMarketHeatmap() {
  const baseUrl = 'https://push2delay.eastmoney.com/api/qt/clist/get?pz=100&po=1&np=1&fltt=2&invt=2&fid=f20&fs=m:105,m:106&fields=f12,f13,f14,f2,f3,f9,f20,f23,f100,f124';
  const payloads = await Promise.all(
    [1, 2, 3, 4, 5].map((page) => fetchJsonWithRetry(`${baseUrl}&pn=${page}`, 2, 12000)),
  );
  const rawRows: Record<string, unknown>[] = payloads.flatMap(
    (payload) => Array.isArray(payload?.data?.diff) ? payload.data.diff : [],
  );
  const rows = Array.from(
    new Map(rawRows.map((row) => [String(row.f12 || '').trim().toUpperCase(), row])).values(),
  )
    .filter((row) => {
      const code = String(row.f12 || '').trim();
      const industry = String(row.f100 || '').trim();
      return code && industry && industry !== '-';
    })
    .slice(0, 320);
  if (!rows.length) throw new Error('美股热力图行情为空');

  const stocks: ChinaHeatmapStock[] = rows.flatMap((row) => {
    const code = String(row.f12 || '').trim().toUpperCase();
    const name = String(row.f14 || '').trim();
    const price = asFiniteNumber(row.f2);
    const changePercent = asFiniteNumber(row.f3);
    const marketCap = asFiniteNumber(row.f20);
    const exchangeCode = String(row.f13 || '');
    const exchange = exchangeCode === '105' ? 'NASDAQ' : exchangeCode === '106' ? 'NYSE' : '';
    if (!code || !name || !exchange || price === undefined || changePercent === undefined || !marketCap || marketCap <= 0) return [];
    const timestamp = asFiniteNumber(row.f124);
    return [{
      code,
      name,
      exchange,
      price,
      changePercent,
      marketCap,
      pe: asFiniteNumber(row.f9),
      pb: asFiniteNumber(row.f23),
      industry: String(row.f100 || '其他').trim() || '其他',
      updatedAt: timestamp ? new Date(timestamp * 1000).toISOString() : undefined,
      sourceUrl: `https://quote.eastmoney.com/us/${encodeURIComponent(code)}.html`,
    }];
  });
  if (!stocks.length) throw new Error('美股热力图缺少有效行情');

  const industryMarketCaps = stocks.reduce<Record<string, number>>((result, stock) => {
    result[stock.industry] = (result[stock.industry] || 0) + stock.marketCap;
    return result;
  }, {});

  return {
    generatedAt: new Date().toISOString(),
    count: stocks.length,
    coverage: `纳斯达克与纽交所总市值前 ${stocks.length} 家公司 · 已过滤无行业分类证券`,
    source: '东方财富',
    sourceUrl: baseUrl,
    industryMarketCaps,
    stocks,
  };
}

async function getCryptoMarketUniverse() {
  const sourceUrl = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=180&page=1&sparkline=false&price_change_percentage=24h&locale=zh';
  let text: string;
  try {
    text = await fetchRoutedText(sourceUrl, 'direct', 15000, 'application/json');
  } catch {
    text = await fetchRoutedText(sourceUrl, 'proxy', 15000, 'application/json');
  }
  const payload = JSON.parse(text) as CryptoMarketUniverseRow[];
  if (!Array.isArray(payload) || !payload.length) throw new Error('CoinGecko 加密资产市值数据为空');

  const symbols = new Set<string>();
  const rows = payload.filter((row) => {
    const symbol = String(row.symbol || '').trim().toUpperCase();
    const marketCap = asFiniteNumber(row.market_cap);
    if (
      !row.id
      || !symbol
      || symbols.has(symbol)
      || CRYPTO_EXCLUDED_IDS.has(row.id)
      || classifyCryptoAsset(symbol) === '稳定币'
      || !marketCap
      || marketCap <= 0
    ) return false;
    symbols.add(symbol);
    return true;
  }).slice(0, 120);
  if (!rows.length) throw new Error('CoinGecko 加密资产市值数据缺少有效项目');
  return { sourceUrl, rows };
}

async function getCryptoMarketHeatmap() {
  const universe = await getCachedCryptoHeatmapUniverse();
  const binanceUrl = 'https://api.binance.com/api/v3/ticker/24hr?type=MINI';
  const binanceResult = await Promise.allSettled([
    fetchRoutedText(binanceUrl, 'proxy', 12000, 'application/json'),
  ]);
  const binanceRows = binanceResult[0].status === 'fulfilled'
    ? JSON.parse(binanceResult[0].value) as Array<Record<string, unknown>>
    : [];
  const tickerByPair = new Map(
    Array.isArray(binanceRows)
      ? binanceRows.map((row) => [String(row.symbol || '').trim().toUpperCase(), row])
      : [],
  );

  const stocks: ChinaHeatmapStock[] = universe.rows.flatMap((row) => {
    const code = String(row.symbol || '').trim().toUpperCase();
    const ticker = tickerByPair.get(`${code}USDT`);
    const marketCap = asFiniteNumber(row.market_cap);
    const price = asFiniteNumber(ticker?.lastPrice) ?? asFiniteNumber(row.current_price);
    const openPrice = asFiniteNumber(ticker?.openPrice);
    const tickerPrice = asFiniteNumber(ticker?.lastPrice);
    const changePercent = tickerPrice !== undefined && openPrice !== undefined && openPrice > 0
      ? (tickerPrice - openPrice) / openPrice * 100
      : asFiniteNumber(row.price_change_percentage_24h) ?? 0;
    if (!code || !row.name || price === undefined || !marketCap || marketCap <= 0) return [];
    const closeTime = asFiniteNumber(ticker?.closeTime);
    return [{
      code,
      name: String(row.name).trim(),
      logoUrl: row.image,
      price,
      changePercent,
      marketCap,
      industry: classifyCryptoAsset(code),
      updatedAt: closeTime ? new Date(closeTime).toISOString() : row.last_updated,
      sourceUrl: `https://www.coingecko.com/zh/数字货币/${encodeURIComponent(row.id)}`,
    }];
  });
  if (!stocks.length) throw new Error('加密资产热力图缺少有效行情');

  const industryMarketCaps = stocks.reduce<Record<string, number>>((result, stock) => {
    result[stock.industry] = (result[stock.industry] || 0) + stock.marketCap;
    return result;
  }, {});
  const binanceAvailable = tickerByPair.size > 0;
  return {
    generatedAt: new Date().toISOString(),
    count: stocks.length,
    coverage: `全球市值前 ${stocks.length} 项非稳定币加密资产 · 赛道面积按美元市值聚合`,
    source: binanceAvailable ? 'CoinGecko 市值 + Binance 行情' : 'CoinGecko',
    sourceUrl: universe.sourceUrl,
    industryMarketCaps,
    stocks,
  };
}

async function getSectorPulse() {
  const makeUrl = (descending: boolean) => `https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=50&po=${descending ? 1 : 0}&np=1&fltt=2&invt=2&fid=f62&fs=m:90+t:2&fields=f12,f14,f2,f3,f62,f184`;
  const url = makeUrl(true);
  const topPayload = await fetchJsonWithRetry(url, 2, 12000);
  await new Promise((resolve) => setTimeout(resolve, 180));
  const bottomPayload = await fetchJsonWithRetry(makeUrl(false), 2, 12000);
  const rows = [topPayload, bottomPayload].flatMap((payload) => Array.isArray(payload?.data?.diff) ? payload.data.diff : []);
  if (!Array.isArray(rows) || !rows.length) throw new Error('东方财富行业板块资金流为空');
  const sectors: SectorPulse[] = rows
    .map((row: Record<string, unknown>) => ({
      code: String(row.f12 || ''),
      name: String(row.f14 || ''),
      changePercent: asFiniteNumber(row.f3) || 0,
      mainNetInflow: asFiniteNumber(row.f62) || 0,
      mainNetRatio: asFiniteNumber(row.f184) || 0,
    }))
    .filter((row: SectorPulse) => row.code && row.name);
  const uniqueSectors = [...new Map(sectors.map((item) => [item.code, item])).values()];
  const byFlow = uniqueSectors.slice().sort((a, b) => b.mainNetInflow - a.mainNetInflow);
  const totalAbsFlow = sectors.reduce((sum, item) => sum + Math.abs(item.mainNetInflow), 0);
  const flowBalance = totalAbsFlow
    ? sectors.reduce((sum, item) => sum + item.mainNetInflow, 0) / totalAbsFlow
    : 0;

  return {
    url,
    total: Number(topPayload?.data?.total) || uniqueSectors.length,
    sampleSize: uniqueSectors.length,
    positiveRatio: (flowBalance + 1) / 2,
    flowBalance,
    leaders: byFlow.slice(0, 8),
    laggards: byFlow.slice(-6).reverse(),
  };
}

async function getResearchReportFeed() {
  const url = 'https://reportapi.eastmoney.com/report/list?pageSize=24&pageNo=1&qType=0&industryCode=*&orgCode=&code=&beginTime=&endTime=';
  const payload = await fetchJson(url);
  const rows = payload?.data;
  if (!Array.isArray(rows) || !rows.length) throw new Error('东方财富研报列表为空');
  const reports: ResearchReport[] = rows.flatMap((row: Record<string, unknown>) => {
    const id = String(row.infoCode || '');
    const title = String(row.title || '').trim();
    if (!id || !title) return [];
    const published = String(row.publishDate || '').trim();
    return [{
      id,
      title,
      stockCode: String(row.stockCode || ''),
      stockName: String(row.stockName || ''),
      institution: String(row.orgSName || row.orgName || ''),
      analysts: String(row.researcher || ''),
      publishedAt: published ? published.split(' ')[0] : undefined,
      rating: String(row.emRatingName || row.sRatingName || ''),
      industry: String(row.indvInduName || ''),
      epsThisYear: asFiniteNumber(row.predictThisYearEps),
      epsNextYear: asFiniteNumber(row.predictNextYearEps),
      url: `https://data.eastmoney.com/report/zw_stock.jshtml?infocode=${encodeURIComponent(id)}`,
    }];
  });
  return { url, reports };
}

const bitcoinHalvings = [
  { date: '2012-11-28', label: '第一次减半', blockReward: '50 → 25 BTC' },
  { date: '2016-07-09', label: '第二次减半', blockReward: '25 → 12.5 BTC' },
  { date: '2020-05-11', label: '第三次减半', blockReward: '12.5 → 6.25 BTC' },
  { date: '2024-04-20', label: '第四次减半', blockReward: '6.25 → 3.125 BTC' },
];

const bitcoinProjectedHalvings = [
  { date: '2028-04-17', label: '预计第五次减半', blockReward: '3.125 → 1.5625 BTC', estimated: true },
  { date: '2032-04-14', label: '预计第六次减半', blockReward: '1.5625 → 0.78125 BTC', estimated: true },
];

function buildBitcoinProjection(points: Array<{ time: string; value: number }>) {
  const dayMs = 24 * 60 * 60 * 1000;
  const latest = points[points.length - 1];
  const latestAt = Date.parse(`${latest.time}T00:00:00Z`);
  const horizonAt = Date.parse('2035-12-31T00:00:00Z');
  const yearMs = 365.25 * dayMs;
  const initialAnnualGrowth = 0.18;
  const growthDecay = 0.08;
  const trendAt = (timestamp: number) => {
    const years = Math.max(0, (timestamp - latestAt) / yearMs);
    const cumulativeGrowth = initialAnnualGrowth / growthDecay * (1 - Math.exp(-growthDecay * years));
    return latest.value * Math.exp(cumulativeGrowth);
  };
  const cycleAnchors = [
    { time: latestAt, adjustment: 0 },
    { time: Date.parse('2026-11-15T00:00:00Z'), adjustment: Math.log(0.68) },
    { time: Date.parse('2028-04-17T00:00:00Z'), adjustment: 0 },
    { time: Date.parse('2029-08-30T00:00:00Z'), adjustment: Math.log(1.45) },
    { time: Date.parse('2030-10-15T00:00:00Z'), adjustment: Math.log(0.72) },
    { time: Date.parse('2032-04-14T00:00:00Z'), adjustment: 0 },
    { time: Date.parse('2033-08-27T00:00:00Z'), adjustment: Math.log(1.32) },
    { time: Date.parse('2034-10-15T00:00:00Z'), adjustment: Math.log(0.82) },
    { time: horizonAt, adjustment: 0 },
  ].filter((anchor, index) => index === 0 || anchor.time > latestAt);
  const cycleAdjustmentAt = (timestamp: number) => {
    const endIndex = cycleAnchors.findIndex((anchor) => anchor.time >= timestamp);
    if (endIndex <= 0) return cycleAnchors[0].adjustment;
    const start = cycleAnchors[endIndex - 1];
    const end = cycleAnchors[endIndex];
    const progress = (timestamp - start.time) / Math.max(1, end.time - start.time);
    const eased = (1 - Math.cos(Math.PI * progress)) / 2;
    return start.adjustment + (end.adjustment - start.adjustment) * eased;
  };
  const maturePoints = points.filter((point) => point.time >= '2020-01-01');
  const matureReturns = maturePoints.slice(1).map((point, index) => (
    Math.log(point.value / maturePoints[index].value)
  ));
  const returnMean = matureReturns.reduce((sum, value) => sum + value, 0) / Math.max(1, matureReturns.length);
  let randomState = 0x5f3759df;
  const nextRandom = () => {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    return (randomState >>> 0) / 4294967296;
  };
  let sampledBlockStart = 0;
  let sampledBlockOffset = 14;
  let volatilityNoise = 0;
  const projectionValueAt = (timestamp: number, step: number) => {
    if (sampledBlockOffset >= 14) {
      sampledBlockStart = Math.floor(nextRandom() * Math.max(1, matureReturns.length - 14));
      sampledBlockOffset = 0;
    }
    const sampledReturn = matureReturns[sampledBlockStart + sampledBlockOffset] ?? 0;
    sampledBlockOffset += 1;
    const years = Math.max(0, (timestamp - latestAt) / yearMs);
    const volatilityScale = 0.58 * Math.exp(-0.045 * years);
    const shock = Math.max(-0.12, Math.min(0.12, sampledReturn - returnMean));
    volatilityNoise = Math.max(-0.24, Math.min(0.24, volatilityNoise * 0.965 + shock * volatilityScale));
    if (step === 0) volatilityNoise = 0;
    return Math.max(0.01, trendAt(timestamp) * Math.exp(cycleAdjustmentAt(timestamp) + volatilityNoise));
  };
  const projectionPoints = [{ time: latest.time, value: latest.value }];
  let step = 1;
  for (let timestamp = latestAt + dayMs; timestamp < horizonAt; timestamp += dayMs) {
    projectionPoints.push({
      time: new Date(timestamp).toISOString().slice(0, 10),
      value: round(projectionValueAt(timestamp, step), 2),
    });
    step += 1;
  }
  projectionPoints.push({ time: '2035-12-31', value: round(projectionValueAt(horizonAt, step), 2) });
  bitcoinProjectedHalvings.forEach((halving) => {
    const timestamp = Date.parse(`${halving.date}T00:00:00Z`);
    const existing = projectionPoints.find((point) => point.time === halving.date);
    if (!existing) projectionPoints.push({ time: halving.date, value: round(trendAt(timestamp) * Math.exp(cycleAdjustmentAt(timestamp)), 2) });
  });
  const sortedProjectionPoints = [...new Map(projectionPoints.map((point) => [point.time, point])).values()]
    .sort((left, right) => left.time.localeCompare(right.time));
  const horizonValue = trendAt(horizonAt) * Math.exp(cycleAdjustmentAt(horizonAt));
  const uncertainty = 0.5;
  return {
    horizon: '2035-12-31',
    model: '成熟市场增速衰减趋势 + 减半周期锚点 + 2020年以来真实日收益区块重采样',
    points: sortedProjectionPoints,
    futureHalvings: bitcoinProjectedHalvings,
    horizonScenario: {
      low: round(horizonValue * Math.exp(-uncertainty), 0),
      base: round(horizonValue, 0),
      high: round(horizonValue * Math.exp(uncertainty), 0),
    },
    assumptions: [
      '长期趋势锚定最新价格，假设年化中枢增速从约18%逐步衰减至2035年的约8%。',
      '未来两轮周期峰值仅取趋势中枢约1.45倍和1.32倍，回撤阶段取约0.72倍和0.82倍。',
      '曲线波动按2020年以来连续14日真实收益区块重采样，并逐年降低波动率；未纳入未来突发事件。',
    ],
    researchSources: [
      { label: 'Coinbase Institutional · Halving Supply, Demand and Statistics', url: 'https://www.coinbase.com/institutional/research-insights/research/monthly-outlook/monthly-outlook-mar-2024' },
      { label: 'Coinbase Institutional · Post-halving Patterns', url: 'https://www.coinbase.com/institutional/research-insights/research/monthly-outlook/monthly-outlook-apr-2024' },
      { label: 'Galaxy Research · Bitcoin Four-year Cycle Compression', url: 'https://www.galaxy.com/insights/research/bitcoin-four-year-cycle-where-is-the-bottom' },
      { label: 'CME Group · Bitcoin Halving and Market Maturity', url: 'https://www.cmegroup.com/insights/economic-research/2024/can-bitcoin-halving-emulate-searing-rallies-of-the-past.html' },
    ],
  };
}

async function getBitcoinCycleHistory() {
  const sourceUrl = 'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=PriceUSD&frequency=1d&start_time=2011-01-01&page_size=10000';
  const payload = JSON.parse(
    await fetchRoutedText(sourceUrl, 'proxy', 30000, 'application/json'),
  ) as { data?: Array<{ time?: string; PriceUSD?: string }> };
  const points = (payload.data || []).flatMap((row) => {
    const value = asFiniteNumber(row.PriceUSD);
    const time = String(row.time || '').slice(0, 10);
    return value !== undefined && value > 0 && /^\d{4}-\d{2}-\d{2}$/.test(time)
      ? [{ time, value: round(value, 4) }]
      : [];
  });
  if (points.length < 1_000) throw new Error('Coin Metrics 返回的比特币历史样本不足');
  return {
    generatedAt: new Date().toISOString(),
    source: { label: 'Coin Metrics Community API', url: sourceUrl },
    methodology: '价格为 Coin Metrics BTC PriceUSD 日度参考价；减半日期按比特币区块高度事件标注。图表默认采用线性价格轴，并提供对数轴作为长期周期观察工具。',
    points,
    halvings: bitcoinHalvings,
    projection: buildBitcoinProjection(points),
  };
}

const regionalContentQueries: Record<RegionalContentMode, { news: string; research: string }> = {
  hongkong: {
    news: '港股 OR 恒生指数 OR 恒生科技 市场',
    research: '港股 券商 研报 OR 评级 OR 目标价',
  },
  us: {
    news: '美股 OR 标普500 OR 纳斯达克 市场',
    research: '美股 券商 研报 OR 评级 OR 目标价',
  },
};

function googleNewsRssUrl(query: string) {
  const search = new URLSearchParams({ q: query, hl: 'zh-CN', gl: 'CN', ceid: 'CN:zh-Hans' });
  return `https://news.google.com/rss/search?${search.toString()}`;
}

function parseGoogleNewsItems(xml: string, label: string) {
  const sourceConfig: NewsSourceConfig = {
    id: `google-${label}`,
    label,
    category: 'finance',
    sourceWeight: 76,
    origin: 'foreign',
    route: 'proxy',
    url: 'https://news.google.com/',
    kind: 'rss',
  };
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  return blocks.slice(0, 18).map((block, index) => {
    const title = stripTags(pickXml(block, 'title'));
    const source = stripTags(pickXml(block, 'source')) || label;
    return enrichNewsItem({
      id: `regional-${label}-${index}-${title}`,
      title,
      url: decodeXml(pickXml(block, 'link')) || 'https://news.google.com/',
      source,
      origin: 'foreign',
      route: 'proxy',
      publishedAt: parseDate(pickXml(block, 'pubDate')),
      summary: stripTags(pickXml(block, 'description')).slice(0, 180),
    }, sourceConfig);
  }).filter((item) => item.title);
}

function inferPublicRating(title: string) {
  for (const rating of ['强烈推荐', '买入', '增持', '推荐', '持有', '中性', '减持', '卖出']) {
    if (title.includes(rating)) return rating;
  }
  return '公开研究';
}

function officialRegionalReports(mode: RegionalContentMode): ResearchReport[] {
  if (mode === 'hongkong') {
    return [
      {
        id: 'hkex-monthly-bulletin', title: '香港市场月报与成交统计', stockCode: '', stockName: '港股市场',
        institution: '香港交易所', analysts: '', rating: '市场研究', industry: '全市场',
        url: 'https://www.hkex.com.hk/Market-Data/Statistics/Consolidated-Reports/Monthly-Bulletin?sc_lang=zh-HK',
      },
      {
        id: 'hsi-index-insights', title: '恒生指数系列数据与指数研究', stockCode: '', stockName: '恒生指数',
        institution: '恒生指数公司', analysts: '', rating: '指数研究', industry: '全市场',
        url: 'https://www.hsi.com.hk/chi/indexes/all-indexes/hsi',
      },
    ];
  }
  return [
    {
      id: 'sp-market-attributes', title: 'U.S. Equities Market Attributes', stockCode: 'SPX', stockName: '标普500',
      institution: 'S&P Dow Jones Indices', analysts: '', rating: '市场研究', industry: '全市场',
      url: 'https://www.spglobal.com/spdji/en/commentary/article/us-equities-market-attributes',
    },
    {
      id: 'nasdaq-market-review', title: '美国市场月度回顾与展望', stockCode: 'NDX', stockName: '纳斯达克',
      institution: 'Nasdaq Market Intelligence Desk', analysts: '', rating: '市场研究', industry: '全市场',
      url: 'https://www.nasdaq.com/authors/market-intelligence-desk-team',
    },
  ];
}

async function getRegionalMarketContent(mode: RegionalContentMode) {
  const queries = regionalContentQueries[mode];
  const newsUrl = googleNewsRssUrl(queries.news);
  const researchUrl = googleNewsRssUrl(queries.research);
  const [newsText, researchText] = await Promise.all([
    fetchRoutedText(newsUrl, 'proxy', 16000),
    fetchRoutedText(researchUrl, 'proxy', 16000),
  ]);
  const news = parseGoogleNewsItems(newsText, mode === 'hongkong' ? '港股公开新闻' : '美股公开新闻');
  const publicResearch = parseGoogleNewsItems(researchText, mode === 'hongkong' ? '港股公开研报' : '美股公开研报')
    .slice(0, 10)
    .map((item, index): ResearchReport => ({
      id: `regional-report-${mode}-${index}`,
      title: item.title,
      stockCode: '',
      stockName: '',
      institution: item.source,
      analysts: '',
      publishedAt: item.publishedAt?.slice(0, 10),
      rating: inferPublicRating(item.title),
      industry: mode === 'hongkong' ? '港股' : '美股',
      url: item.url,
    }));
  return {
    market: mode,
    generatedAt: new Date().toISOString(),
    news: news.slice(0, 12),
    reports: [...officialRegionalReports(mode), ...publicResearch].slice(0, 12),
    sources: [
      { label: 'Google 新闻中文索引', url: newsUrl },
      ...(mode === 'hongkong'
        ? [{ label: '香港交易所公开统计', url: 'https://www.hkex.com.hk/Market-Data/Statistics/Consolidated-Reports/Monthly-Bulletin?sc_lang=zh-HK' }]
        : [{ label: 'S&P DJI 公开市场研究', url: 'https://www.spglobal.com/spdji/en/research-insights/' }]),
    ],
    note: '新闻与研报标题仅收录中文公开页面；点击后由原始发布方负责内容与访问权限。',
  };
}

async function resolveRegionalStock(mode: RegionalContentMode, query: string) {
  const heatmap = mode === 'hongkong'
    ? await getCachedHongKongMarketHeatmap()
    : await getCachedUsMarketHeatmap();
  const normalized = query.trim().toLowerCase().replace(/^0+/, '');
  return heatmap.stocks.find((stock) => (
    stock.code.toLowerCase() === query.trim().toLowerCase()
    || stock.code.toLowerCase().replace(/^0+/, '') === normalized
    || stock.name.toLowerCase().includes(query.trim().toLowerCase())
  ));
}

async function getInstitutionRating(mode: RegionalContentMode, rawQuery: string) {
  const query = rawQuery.trim();
  if (!query) throw new Error('请输入股票代码或公司名称');
  const stock = await resolveRegionalStock(mode, query);
  if (!stock) throw new Error(`未在${regionalValuationConfigs[mode].label}热力图样本中找到“${query}”`);

  if (mode === 'us') {
    const symbol = stock.code.replace('.', '-').toUpperCase();
    const [ratingsText, targetText] = await Promise.all([
      fetchRoutedText(`https://api.nasdaq.com/api/analyst/${encodeURIComponent(symbol)}/ratings`, 'proxy', 16000, 'application/json'),
      fetchRoutedText(`https://api.nasdaq.com/api/analyst/${encodeURIComponent(symbol)}/targetprice`, 'proxy', 16000, 'application/json'),
    ]);
    const ratings = JSON.parse(ratingsText)?.data || {};
    const targets = JSON.parse(targetText)?.data || {};
    const consensus = targets.consensusOverview || {};
    return {
      market: mode,
      symbol: stock.code,
      companyName: stock.name,
      price: stock.price,
      consensus: ratings.meanRatingType || targets.historicalConsensus?.at(-1)?.z?.consensus || '暂无共识',
      summary: ratings.ratingsSummary || 'Nasdaq 暂未提供评级摘要',
      analystCount: Number(String(ratings.ratingsSummary || '').match(/\d+/)?.[0] || 0),
      targetPrice: {
        low: asFiniteNumber(consensus.lowPriceTarget),
        average: asFiniteNumber(consensus.priceTarget),
        high: asFiniteNumber(consensus.highPriceTarget),
      },
      distribution: { buy: consensus.buy || 0, hold: consensus.hold || 0, sell: consensus.sell || 0 },
      brokers: Array.isArray(ratings.brokerNames) ? ratings.brokerNames.slice(0, 18) : [],
      reports: [],
      sourceLabel: 'Nasdaq Analyst Research / TipRanks',
      sourceUrl: `https://www.nasdaq.com/market-activity/stocks/${symbol.toLowerCase()}/analyst-research`,
      updatedAt: new Date().toISOString(),
      note: '这是公开分析师共识与目标价区间，不代表 SparkFlow 或 Nasdaq 的买卖建议。',
    };
  }

  const researchUrl = googleNewsRssUrl(`"${stock.name}" 券商 评级 目标价 港股`);
  const reports = parseGoogleNewsItems(
    await fetchRoutedText(researchUrl, 'proxy', 16000),
    `${stock.name}公开评级`,
  ).slice(0, 10).map((item) => ({
    id: item.id,
    title: item.title,
    institution: item.source,
    publishedAt: item.publishedAt?.slice(0, 10),
    rating: inferPublicRating(item.title),
    url: item.url,
  }));
  return {
    market: mode,
    symbol: stock.code,
    companyName: stock.name,
    price: stock.price,
    consensus: reports[0]?.rating || '暂无统一共识',
    summary: `已找到 ${reports.length} 条可回溯的中文公开评级或目标价报道。`,
    analystCount: reports.length,
    targetPrice: {},
    distribution: { buy: 0, hold: 0, sell: 0 },
    brokers: [...new Set(reports.map((item) => item.institution))],
    reports,
    sourceLabel: '中文公开评级报道索引',
    sourceUrl: researchUrl,
    updatedAt: new Date().toISOString(),
    note: '港股免费公开源缺少统一的分析师共识接口，因此仅展示可点击核验的评级报道，不拼接虚构目标价。',
  };
}

const bullishNewsKeywords = ['回购', '增持', '上调', '增长', '改善', '扩张', '降准', '降息', '支持', '突破', '中标', '盈利', '景气', '复苏', '创新高'];
const bearishNewsKeywords = ['减持', '下调', '亏损', '暴跌', '制裁', '调查', '处罚', '违约', '裁员', '衰退', '风险', '冲突', '关税', '通胀', '收紧'];
const marketNewsKeywords = ['股', '指数', '市场', '券商', '央行', '美联储', '利率', '财政', '政策', '监管', '基金', '融资', '并购', '芯片', '半导体', '能源', '地产', '消费', '出口'];

function getNewsSignal(item: NewsItem) {
  const text = `${item.title} ${item.summary || ''}`;
  const positive = bullishNewsKeywords.filter((keyword) => text.includes(keyword)).length;
  const negative = bearishNewsKeywords.filter((keyword) => text.includes(keyword)).length;
  return Math.max(-1, Math.min(1, (positive - negative) / Math.max(2, positive + negative)));
}

function getMarketNews(items: NewsItem[]) {
  return items
    .map((item) => ({
      item,
      relevance: marketNewsKeywords.filter((keyword) => `${item.title} ${item.summary || ''}`.includes(keyword)).length,
    }))
    .filter(({ item, relevance }) => item.category === 'finance' || relevance > 0)
    .sort((a, b) => b.relevance * 10 + b.item.weight - (a.relevance * 10 + a.item.weight))
    .slice(0, 18)
    .map(({ item }) => item);
}

function scoreResearchRating(rating: string) {
  if (rating.includes('买入') || rating.includes('强烈推荐')) return 75;
  if (rating.includes('增持') || rating.includes('推荐')) return 66;
  if (rating.includes('中性') || rating.includes('持有')) return 50;
  if (rating.includes('减持')) return 34;
  if (rating.includes('卖出')) return 24;
  return 48;
}

function buildMarketScores(
  indices: MarketIndexSnapshot[],
  sectors: Awaited<ReturnType<typeof getSectorPulse>> | undefined,
  reports: ResearchReport[],
  news: NewsItem[],
) {
  const weightedIndices = marketIndexConfigs.flatMap((config) => {
    const index = indices.find((item) => item.id === config.id);
    return index ? [{ index, weight: config.weight }] : [];
  });
  const availableWeight = weightedIndices.reduce((sum, item) => sum + item.weight, 0) || 1;
  const weightedChange = weightedIndices.reduce((sum, item) => sum + item.index.changePercent * item.weight, 0) / availableWeight;
  const directionalScore = clampScore(50 + Math.tanh(weightedChange / 2.4) * 38);
  const breadthIndices = indices.filter((item) => item.id === 'sse' || item.id === 'szse');
  const advancers = breadthIndices.reduce((sum, item) => sum + (item.advancers || 0), 0);
  const decliners = breadthIndices.reduce((sum, item) => sum + (item.decliners || 0), 0);
  const flat = breadthIndices.reduce((sum, item) => sum + (item.flat || 0), 0);
  const breadthTotal = advancers + decliners + flat;
  const breadthRatio = breadthTotal ? advancers / breadthTotal : 0.5;
  const breadthScore = clampScore(breadthRatio * 100);
  const marketScore = clampScore(directionalScore * 0.68 + breadthScore * 0.32);

  const positiveRatio = sectors?.positiveRatio ?? 0.5;
  const flowBalance = sectors?.flowBalance ?? 0;
  const flowScore = clampScore(50 + flowBalance * 35 + (positiveRatio - 0.5) * 30);

  const weightedNews = news.slice(0, 24);
  const newsWeight = weightedNews.reduce((sum, item) => sum + Math.max(item.weight, 1), 0) || 1;
  const newsSignal = weightedNews.reduce((sum, item) => sum + getNewsSignal(item) * Math.max(item.weight, 1), 0) / newsWeight;
  const newsScore = clampScore(50 + newsSignal * 36);

  const ratingScores = reports.map((item) => scoreResearchRating(item.rating));
  const ratingAverage = ratingScores.length ? ratingScores.reduce((sum, value) => sum + value, 0) / ratingScores.length : 50;
  const epsGrowthRows = reports
    .map((item) => item.epsThisYear && item.epsNextYear ? item.epsNextYear / item.epsThisYear - 1 : undefined)
    .filter((value): value is number => value !== undefined && Number.isFinite(value) && Math.abs(value) < 5);
  const epsGrowth = epsGrowthRows.length ? epsGrowthRows.reduce((sum, value) => sum + value, 0) / epsGrowthRows.length : 0;
  const earningsScore = clampScore(50 + Math.tanh(epsGrowth / 0.35) * 25);
  const researchScore = clampScore(ratingAverage * 0.72 + earningsScore * 0.28);

  const changes = indices.map((item) => item.changePercent);
  const meanChange = changes.length ? changes.reduce((sum, value) => sum + value, 0) / changes.length : 0;
  const dispersion = changes.length
    ? Math.sqrt(changes.reduce((sum, value) => sum + (value - meanChange) ** 2, 0) / changes.length)
    : 0;
  const extremeMove = changes.length ? Math.max(...changes.map(Math.abs)) : 0;
  const negativeNewsRatio = weightedNews.length ? weightedNews.filter((item) => getNewsSignal(item) < 0).length / weightedNews.length : 0;
  const riskScore = clampScore(
    84 - dispersion * 6 - Math.max(0, extremeMove - 3) * 4 - negativeNewsRatio * 18 - Math.max(0, 0.45 - breadthRatio) * 45,
  );

  const dimensions: ScoreDimension[] = [
    {
      id: 'market', label: '大盘趋势', score: marketScore, weight: 32,
      summary: `主要指数加权涨跌 ${weightedChange >= 0 ? '+' : ''}${weightedChange.toFixed(2)}%，A 股上涨家数占比 ${(breadthRatio * 100).toFixed(1)}%。`,
      evidence: indices.slice(0, 5).map((item) => `${item.name} ${item.changePercent >= 0 ? '+' : ''}${item.changePercent.toFixed(2)}%`),
    },
    {
      id: 'flow', label: '资金与板块', score: flowScore, weight: 22,
      summary: sectors ? `从 ${sectors.total} 个行业层级抽取流入/流出两端 ${sectors.sampleSize} 个样本，净流入强度 ${(positiveRatio * 100).toFixed(1)}%。` : '板块资金数据缺失，本项按中性处理。',
      evidence: sectors?.leaders.slice(0, 4).map((item) => `${item.name} ${item.changePercent >= 0 ? '+' : ''}${item.changePercent.toFixed(2)}%`) || [],
    },
    {
      id: 'news', label: '新闻催化', score: newsScore, weight: 18,
      summary: `基于 ${weightedNews.length} 条高权重中文新闻的规则化多空词与来源权重，净情绪 ${newsSignal >= 0 ? '+' : ''}${newsSignal.toFixed(2)}。`,
      evidence: weightedNews.slice(0, 4).map((item) => `${item.source}：${item.title}`),
    },
    {
      id: 'research', label: '机构研报', score: researchScore, weight: 13,
      summary: `最新 ${reports.length} 份券商研报评级均值 ${ratingAverage.toFixed(1)}，可比 EPS 预测隐含增速 ${(epsGrowth * 100).toFixed(1)}%。`,
      evidence: reports.slice(0, 4).map((item) => `${item.institution} / ${item.stockName} / ${item.rating || '未评级'}`),
    },
    {
      id: 'risk', label: '风险余量', score: riskScore, weight: 15,
      summary: `跨市场日涨跌离散度 ${dispersion.toFixed(2)}，极端单日波动 ${extremeMove.toFixed(2)}%，负面新闻占比 ${(negativeNewsRatio * 100).toFixed(1)}%。`,
      evidence: ['分数越高代表风险余量越充足', '剧烈上涨也会因追高风险扣分'],
    },
  ];
  const overall = clampScore(dimensions.reduce((sum, item) => sum + item.score * item.weight / 100, 0));
  return {
    overall,
    dimensions,
    metrics: { weightedChange, breadthRatio, advancers, decliners, flat, positiveRatio, flowBalance, newsSignal, ratingAverage, epsGrowth, dispersion, extremeMove },
  };
}

function buildInvestorLenses(scores: ReturnType<typeof buildMarketScores>): InvestorLens[] {
  const byId = Object.fromEntries(scores.dimensions.map((item) => [item.id, item.score])) as Record<string, number>;
  const lensScore = (...parts: Array<[number, number]>) => clampScore(parts.reduce((sum, [value, weight]) => sum + value * weight, 0));
  return [
    {
      id: 'duan', name: '段永平方法论', principle: '看懂生意、好价格、少做决定',
      score: lensScore([byId.risk, 0.45], [byId.research, 0.35], [byId.market, 0.2]), confidence: '低',
      read: '今天的市场环境只能判断出手难度，不能替代对单家公司商业模式与价格的研究。',
      watch: '等待能看懂、能长期持有且估值留有余地的公司；没有基本面数据时不把上涨当价值。',
    },
    {
      id: 'buffett', name: '巴菲特方法论', principle: '护城河、现金流、管理层、安全边际',
      score: lensScore([byId.risk, 0.5], [byId.research, 0.3], [byId.market, 0.2]), confidence: '低',
      read: '大盘与研报能提供环境线索，但护城河和内在价值仍需公司财报与估值数据确认。',
      watch: '优先核验自由现金流、资本回报率和估值，不因市场热度降低安全边际。',
    },
    {
      id: 'munger', name: '芒格方法论', principle: '反过来想、机会成本、避免愚蠢',
      score: lensScore([byId.risk, 0.62], [byId.flow, 0.18], [byId.news, 0.2]), confidence: '中',
      read: '风险余量和拥挤程度比单一利好更重要，先找会让判断失效的证据。',
      watch: '检查杠杆、流动性、估值过高和叙事拥挤四类失败路径。',
    },
    {
      id: 'druckenmiller', name: 'Druckenmiller 方法论', principle: '趋势、流动性、集中在高确信机会',
      score: lensScore([byId.market, 0.48], [byId.flow, 0.38], [byId.news, 0.14]), confidence: '高',
      read: '指数趋势与板块资金同向时信号更强，背离时降低仓位而不是争论。',
      watch: '观察领涨板块能否扩散、成交与资金是否连续两日确认。',
    },
    {
      id: 'soros', name: 'Soros 方法论', principle: '反身性、识别偏见、错了就改',
      score: lensScore([byId.market, 0.38], [byId.news, 0.34], [byId.flow, 0.28]), confidence: '中',
      read: '价格、新闻与资金互相强化时可能形成反身性，三者背离则代表叙事正在失速。',
      watch: '把当前主线写成可证伪假设，并设定价格与新闻两个失效条件。',
    },
    {
      id: 'ptj', name: 'Paul Tudor Jones 方法论', principle: '先控制损失，再谈收益',
      score: lensScore([byId.risk, 0.7], [byId.market, 0.18], [byId.flow, 0.12]), confidence: '高',
      read: '日内波动扩大时，综合分再高也不等于可以忽略仓位和止损。',
      watch: '按波动缩小单笔风险，避免在极端上涨日追高和在流动性转弱时加杠杆。',
    },
  ];
}

async function getMarketIntelligence() {
  const [indexResult, sectorResult, reportResult, newsResult] = await Promise.allSettled([
    getMarketIndexSnapshots(),
    getSectorPulse(),
    getResearchReportFeed(),
    getNewsFeed(),
  ]);
  const indices = indexResult.status === 'fulfilled' ? indexResult.value.indices : [];
  const sectors = sectorResult.status === 'fulfilled' ? sectorResult.value : undefined;
  const reports = reportResult.status === 'fulfilled' ? reportResult.value.reports : [];
  const newsFeed = newsResult.status === 'fulfilled' ? newsResult.value : undefined;
  const news = getMarketNews(newsFeed?.items || []);
  const scores = buildMarketScores(indices, sectors, reports, news);
  const verifiedCount = indices.filter((item) => item.validation.status === 'verified').length;
  const equityIndices = indices.filter((item) => item.market !== 'crypto');
  const cryptoIndices = indices.filter((item) => item.market === 'crypto');
  const newsSourceRatio = newsFeed?.sources.length
    ? newsFeed.sources.filter((item) => item.ok).length / newsFeed.sources.length
    : 0;
  const confidence = clampScore(
    (indices.length / (marketIndexConfigs.length + cryptoAssetConfigs.length)) * 30
      + (indices.length ? verifiedCount / indices.length : 0) * 15
      + (sectors ? 20 : 0)
      + (reports.length ? 15 : 0)
      + newsSourceRatio * 20,
  );
  const errors = [
    indexResult.status === 'rejected' ? `指数行情：${indexResult.reason instanceof Error ? indexResult.reason.message : String(indexResult.reason)}` : '',
    sectorResult.status === 'rejected' ? `板块资金：${sectorResult.reason instanceof Error ? sectorResult.reason.message : String(sectorResult.reason)}` : '',
    reportResult.status === 'rejected' ? `券商研报：${reportResult.reason instanceof Error ? reportResult.reason.message : String(reportResult.reason)}` : '',
    newsResult.status === 'rejected' ? `中文新闻：${newsResult.reason instanceof Error ? newsResult.reason.message : String(newsResult.reason)}` : '',
  ].filter(Boolean);
  const leadingSector = sectors?.leaders[0];
  const scoreLabel = scores.overall >= 72 ? '偏强' : scores.overall >= 58 ? '偏多' : scores.overall >= 42 ? '中性' : '偏弱';
  const stance = scores.overall >= 72 ? '趋势较强，分批确认' : scores.overall >= 58 ? '偏多观察，等待确认' : scores.overall >= 42 ? '中性，控制追涨' : '防守优先，降低暴露';
  const riskScore = scores.dimensions.find((item) => item.id === 'risk')?.score || 50;
  const sourceStates = [
    {
      id: 'indices', label: '主要指数实时行情',
      url: indexResult.status === 'fulfilled' ? indexResult.value.eastmoneyUrl : 'https://quote.eastmoney.com/center/',
      secondaryUrl: indexResult.status === 'fulfilled' ? indexResult.value.tencentUrl : 'https://stockapp.finance.qq.com/',
      provider: '东方财富 + 腾讯证券交叉验证', ok: equityIndices.length > 0,
      note: `${equityIndices.filter((item) => item.validation.status === 'verified').length}/${equityIndices.length} 个指数通过 0.25% 价格偏差校验`,
    },
    {
      id: 'crypto', label: '主要加密资产 24 小时行情',
      url: indexResult.status === 'fulfilled' ? indexResult.value.binanceUrl : 'https://www.binance.com/en/markets/overview',
      secondaryUrl: indexResult.status === 'fulfilled' ? indexResult.value.okxUrl : 'https://www.okx.com/markets/prices',
      provider: 'Binance + OKX 交叉验证', ok: cryptoIndices.length > 0,
      note: `${cryptoIndices.filter((item) => item.validation.status === 'verified').length}/${cryptoIndices.length} 个币种完成双源价格校验`,
    },
    {
      id: 'sectors', label: '行业板块与主力资金',
      url: sectorResult.status === 'fulfilled' ? sectorResult.value.url : 'https://data.eastmoney.com/bkzj/',
      provider: '东方财富', ok: Boolean(sectors), note: sectors ? `${sectors.total} 个行业层级，双端样本 ${sectors.sampleSize} 个` : '数据不可用',
    },
    {
      id: 'reports', label: '券商个股研报',
      url: reportResult.status === 'fulfilled' ? reportResult.value.url : 'https://data.eastmoney.com/report/stock.jshtml',
      provider: '东方财富 Choice 公开研报页', ok: reports.length > 0, note: `${reports.length} 份最新报告`,
    },
    {
      id: 'news', label: '中文财经与政策新闻',
      url: 'https://dedicated.wallstreetcn.com/rss.xml', provider: '华尔街见闻 / 中新财经 / 中国政府网等',
      ok: Boolean(newsFeed?.items.length), note: `${newsFeed?.items.length || 0} 条聚合，${Math.round(newsSourceRatio * 100)}% 新闻源在线`,
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    dataMode: confidence >= 78 ? 'live' : confidence >= 52 ? 'partial' : 'limited',
    confidence,
    confidenceLabel: confidence >= 82 ? '高' : confidence >= 62 ? '中' : '低',
    warning: errors.length ? '部分数据源失败，相关维度已按中性降级，评分置信度同步下调。' : '',
    errors,
    summary: {
      score: scores.overall,
      scoreLabel,
      stance,
      riskLevel: riskScore >= 68 ? '可控' : riskScore >= 48 ? '中等' : '偏高',
      headline: `${scoreLabel}：${leadingSector ? `${leadingSector.name}领涨资金风向` : '等待板块资金确认'}，A 股上涨家数占比 ${(scores.metrics.breadthRatio * 100).toFixed(1)}%。`,
      disclaimer: '本页是基于公开数据的研究辅助，不构成投资建议或收益承诺。',
    },
    indices,
    breadth: {
      advancers: scores.metrics.advancers,
      decliners: scores.metrics.decliners,
      flat: scores.metrics.flat,
      advanceRatio: scores.metrics.breadthRatio,
    },
    sectors: sectors ? {
      total: sectors.total,
      sampleSize: sectors.sampleSize,
      positiveRatio: sectors.positiveRatio,
      flowBalance: sectors.flowBalance,
      leaders: sectors.leaders,
      laggards: sectors.laggards,
    } : { total: 0, sampleSize: 0, positiveRatio: 0.5, flowBalance: 0, leaders: [], laggards: [] },
    reports,
    news,
    scores: scores.dimensions,
    lenses: buildInvestorLenses(scores),
    sources: sourceStates,
  };
}

let marketIntelligenceCache: { storedAt: number; data: Awaited<ReturnType<typeof getMarketIntelligence>> } | undefined;
let marketIntelligenceInFlight: Promise<Awaited<ReturnType<typeof getMarketIntelligence>>> | undefined;
let marketQuotesCache: { storedAt: number; data: Awaited<ReturnType<typeof getMarketIndexSnapshots>> } | undefined;
let marketQuotesInFlight: Promise<Awaited<ReturnType<typeof getMarketIndexSnapshots>>> | undefined;
let cryptoQuotesCache: { storedAt: number; data: Awaited<ReturnType<typeof getCryptoMarketSnapshots>> } | undefined;
let cryptoQuotesInFlight: Promise<Awaited<ReturnType<typeof getCryptoMarketSnapshots>>> | undefined;
let cryptoHeatmapUniverseCache: { storedAt: number; data: Awaited<ReturnType<typeof getCryptoMarketUniverse>> } | undefined;
let cryptoHeatmapUniverseInFlight: Promise<Awaited<ReturnType<typeof getCryptoMarketUniverse>>> | undefined;
let cryptoHeatmapCache: { storedAt: number; data: Awaited<ReturnType<typeof getCryptoMarketHeatmap>> } | undefined;
let cryptoHeatmapInFlight: Promise<Awaited<ReturnType<typeof getCryptoMarketHeatmap>>> | undefined;
let bitcoinCycleCache: { storedAt: number; data: Awaited<ReturnType<typeof getBitcoinCycleHistory>> } | undefined;
let bitcoinCycleInFlight: Promise<Awaited<ReturnType<typeof getBitcoinCycleHistory>>> | undefined;
let chinaHeatmapCache: { storedAt: number; data: Awaited<ReturnType<typeof getChinaMarketHeatmap>> } | undefined;
let chinaHeatmapInFlight: Promise<Awaited<ReturnType<typeof getChinaMarketHeatmap>>> | undefined;
let hongKongHeatmapCache: { storedAt: number; data: Awaited<ReturnType<typeof getHongKongMarketHeatmap>> } | undefined;
let hongKongHeatmapInFlight: Promise<Awaited<ReturnType<typeof getHongKongMarketHeatmap>>> | undefined;
let usHeatmapCache: { storedAt: number; data: Awaited<ReturnType<typeof getUsMarketHeatmap>> } | undefined;
let usHeatmapInFlight: Promise<Awaited<ReturnType<typeof getUsMarketHeatmap>>> | undefined;
let chinaValuationCache: { storedAt: number; data: Awaited<ReturnType<typeof getChinaValuationDashboard>> } | undefined;
let chinaValuationInFlight: Promise<Awaited<ReturnType<typeof getChinaValuationDashboard>>> | undefined;
const regionalValuationCache = new Map<RegionalValuationMode, { storedAt: number; data: Awaited<ReturnType<typeof getRegionalValuationDashboard>> }>();
const regionalValuationInFlight = new Map<RegionalValuationMode, Promise<Awaited<ReturnType<typeof getRegionalValuationDashboard>>>>();
const regionalContentCache = new Map<RegionalContentMode, { storedAt: number; data: Awaited<ReturnType<typeof getRegionalMarketContent>> }>();
const regionalContentInFlight = new Map<RegionalContentMode, Promise<Awaited<ReturnType<typeof getRegionalMarketContent>>>>();
let usMarketSystemCache: {
  storedAt: number;
  data: { state: 'normal' | 'halted' | 'unknown'; message: string; updatedAt: string; sourceUrl: string };
} | undefined;

async function getUsMarketSystemStatus() {
  const sourceUrl = 'https://www.nasdaqtrader.com/Trader.aspx?id=MarketSystemStatusToday';
  try {
    const html = await fetchText(sourceUrl, 12000);
    const text = stripTags(html);
    const sectionStart = text.indexOf('System Status Messages');
    const sectionEnd = text.indexOf('// override', sectionStart);
    const currentSection = sectionStart >= 0
      ? text.slice(sectionStart, sectionEnd > sectionStart ? sectionEnd : sectionStart + 900)
      : text.slice(0, 900);
    const halted = /market.?wide circuit breaker|trading (?:is |has been )?halted|operational(?:ly)? halted|market suspended/i.test(currentSection);
    const normal = /systems? (?:are|is) operating normally/i.test(currentSection);
    return {
      state: halted ? 'halted' as const : normal ? 'normal' as const : 'unknown' as const,
      message: halted
        ? 'Nasdaq 官方系统状态显示交易暂停或市场级熔断'
        : normal
          ? 'Nasdaq 系统运行正常'
          : '暂未取得明确的 Nasdaq 系统状态',
      updatedAt: new Date().toISOString(),
      sourceUrl,
    };
  } catch {
    return {
      state: 'unknown' as const,
      message: 'Nasdaq 系统状态暂时不可用',
      updatedAt: new Date().toISOString(),
      sourceUrl,
    };
  }
}

async function getCachedUsMarketSystemStatus() {
  const now = Date.now();
  if (usMarketSystemCache && now - usMarketSystemCache.storedAt < 30_000) {
    return usMarketSystemCache.data;
  }
  const data = await getUsMarketSystemStatus();
  usMarketSystemCache = { storedAt: Date.now(), data };
  return data;
}

async function getCachedMarketIntelligence() {
  const now = Date.now();
  if (marketIntelligenceCache && now - marketIntelligenceCache.storedAt < 45000) {
    return marketIntelligenceCache.data;
  }
  if (!marketIntelligenceInFlight) {
    marketIntelligenceInFlight = getMarketIntelligence()
      .then((data) => {
        marketIntelligenceCache = { storedAt: Date.now(), data };
        return data;
      })
      .finally(() => {
        marketIntelligenceInFlight = undefined;
      });
  }
  return marketIntelligenceInFlight;
}

async function getCachedMarketQuotes() {
  const now = Date.now();
  if (marketQuotesCache && now - marketQuotesCache.storedAt < 900) {
    return marketQuotesCache.data;
  }
  if (!marketQuotesInFlight) {
    marketQuotesInFlight = getMarketIndexSnapshots()
      .then((data) => {
        marketQuotesCache = { storedAt: Date.now(), data };
        return data;
      })
      .finally(() => {
        marketQuotesInFlight = undefined;
      });
  }
  return marketQuotesInFlight;
}

async function getCachedChinaValuationDashboard() {
  const now = Date.now();
  const expectedAnchorCount = bookValueIndexConfigs.length + 1;
  const cacheTtl = chinaValuationCache?.data.bookValueAnchors.length === expectedAnchorCount
    ? 15 * 60_000
    : 30_000;
  if (chinaValuationCache && now - chinaValuationCache.storedAt < cacheTtl) {
    return chinaValuationCache.data;
  }
  if (!chinaValuationInFlight) {
    chinaValuationInFlight = getChinaValuationDashboard()
      .then((data) => {
        chinaValuationCache = { storedAt: Date.now(), data };
        return data;
      })
      .finally(() => {
        chinaValuationInFlight = undefined;
      });
  }
  return chinaValuationInFlight;
}

async function getCachedRegionalValuationDashboard(mode: RegionalValuationMode) {
  const cached = regionalValuationCache.get(mode);
  if (cached && Date.now() - cached.storedAt < 30 * 60_000) return cached.data;
  const running = regionalValuationInFlight.get(mode);
  if (running) return running;
  const request = getRegionalValuationDashboard(mode)
    .then((data) => {
      regionalValuationCache.set(mode, { storedAt: Date.now(), data });
      return data;
    })
    .finally(() => regionalValuationInFlight.delete(mode));
  regionalValuationInFlight.set(mode, request);
  return request;
}

async function getCachedRegionalMarketContent(mode: RegionalContentMode) {
  const cached = regionalContentCache.get(mode);
  if (cached && Date.now() - cached.storedAt < 10 * 60_000) return cached.data;
  const running = regionalContentInFlight.get(mode);
  if (running) return running;
  const request = getRegionalMarketContent(mode)
    .then((data) => {
      regionalContentCache.set(mode, { storedAt: Date.now(), data });
      return data;
    })
    .finally(() => regionalContentInFlight.delete(mode));
  regionalContentInFlight.set(mode, request);
  return request;
}

type GlobalMacroRegion = 'global' | 'apac' | 'middleEast' | 'europe' | 'americas';
type InternationalMarketMode = 'japan' | 'korea' | 'india' | 'germany' | 'france' | 'uk';
type FullMarketMode = 'china' | 'hongkong' | 'us' | 'crypto' | InternationalMarketMode;

type GlobalMacroQuoteConfig = {
  id: string;
  name: string;
  symbol: string;
  market?: FullMarketMode;
  region: Exclude<GlobalMacroRegion, 'global'>;
  latitude: number;
  longitude: number;
  timezone: string;
  sessions: Array<[number, number]>;
  /** JavaScript weekday numbers in the exchange's local calendar (0 = Sunday). */
  tradingWeekdays?: number[];
  /** Full-day exchange closures in YYYY-MM-DD exchange-local format. */
  closedDates?: string[];
};

const globalMacroQuotes: GlobalMacroQuoteConfig[] = [
  { id: 'china', name: '上证综指', symbol: '000001.SS', market: 'china', region: 'apac', latitude: 31.23824, longitude: 121.50668, timezone: 'Asia/Shanghai', sessions: [[9.5, 11.5], [13, 15]], closedDates: getMarketHolidayDates('china') },
  { id: 'hongkong', name: '恒生指数', symbol: '^HSI', market: 'hongkong', region: 'apac', latitude: 22.28389, longitude: 114.15823, timezone: 'Asia/Hong_Kong', sessions: [[9.5, 12], [13, 16]], closedDates: getMarketHolidayDates('hongkong') },
  { id: 'japan', name: '日经225', symbol: '^N225', market: 'japan', region: 'apac', latitude: 35.6826, longitude: 139.7788, timezone: 'Asia/Tokyo', sessions: [[9, 11.5], [12.5, 15.5]], closedDates: getMarketHolidayDates('japan') },
  { id: 'korea', name: '韩国KOSPI', symbol: '^KS11', market: 'korea', region: 'apac', latitude: 37.5236, longitude: 126.92714, timezone: 'Asia/Seoul', sessions: [[9, 15.5]], closedDates: getMarketHolidayDates('korea') },
  { id: 'india', name: '印度NIFTY 50', symbol: '^NSEI', market: 'india', region: 'apac', latitude: 19.0602, longitude: 72.85978, timezone: 'Asia/Kolkata', sessions: [[9.25, 15.5]], closedDates: getMarketHolidayDates('india') },
  { id: 'australia', name: '澳洲ASX 200', symbol: '^AXJO', region: 'apac', latitude: -33.8679, longitude: 151.21016, timezone: 'Australia/Sydney', sessions: [[10, 16]] },
  { id: 'us', name: '标普500', symbol: '^GSPC', market: 'us', region: 'americas', latitude: 40.70707, longitude: -74.01118, timezone: 'America/New_York', sessions: [[9.5, 16]], closedDates: getMarketHolidayDates('us') },
  { id: 'nasdaq', name: '纳斯达克100', symbol: '^NDX', market: 'us', region: 'americas', latitude: 40.75628, longitude: -73.98586, timezone: 'America/New_York', sessions: [[9.5, 16]], closedDates: getMarketHolidayDates('us') },
  { id: 'vix', name: 'CBOE VIX', symbol: '^VIX', market: 'us', region: 'americas', latitude: 41.87662, longitude: -87.63954, timezone: 'America/Chicago', sessions: [[8.5, 15]], closedDates: getMarketHolidayDates('us') },
  { id: 'euro', name: 'Euro Stoxx 50', symbol: '^STOXX50E', region: 'europe', latitude: 50.11512, longitude: 8.67794, timezone: 'Europe/Berlin', sessions: [[9, 17.5]] },
  { id: 'germany', name: '德国DAX', symbol: '^GDAXI', market: 'germany', region: 'europe', latitude: 50.11512, longitude: 8.67794, timezone: 'Europe/Berlin', sessions: [[9, 17.5]], closedDates: getMarketHolidayDates('germany') },
  { id: 'france', name: '法国CAC 40', symbol: '^FCHI', market: 'france', region: 'europe', latitude: 48.89063, longitude: 2.24669, timezone: 'Europe/Paris', sessions: [[9, 17.5]], closedDates: getMarketHolidayDates('france') },
  { id: 'uk', name: '富时100', symbol: '^FTSE', market: 'uk', region: 'europe', latitude: 51.51504, longitude: -0.09908, timezone: 'Europe/London', sessions: [[8, 16.5]], closedDates: getMarketHolidayDates('uk') },
  { id: 'russia', name: '俄罗斯RTS', symbol: 'RTSI.ME', region: 'europe', latitude: 55.75583, longitude: 37.6173, timezone: 'Europe/Moscow', sessions: [[10, 18.75]] },
  {
    id: 'saudi',
    name: '沙特TASI',
    symbol: '^TASI.SR',
    region: 'middleEast',
    latitude: 24.68695,
    longitude: 46.68538,
    timezone: 'Asia/Riyadh',
    sessions: [[10, 15]],
    tradingWeekdays: [0, 1, 2, 3, 4],
    closedDates: [
      '2026-02-22',
      '2026-03-17', '2026-03-18', '2026-03-19', '2026-03-20', '2026-03-21', '2026-03-22', '2026-03-23',
      '2026-05-24', '2026-05-25', '2026-05-26', '2026-05-27', '2026-05-28', '2026-05-29', '2026-05-30',
      '2026-09-23',
    ],
  },
  { id: 'israel', name: '以色列TA-35', symbol: 'TA35.TA', region: 'middleEast', latitude: 32.06519, longitude: 34.77099, timezone: 'Asia/Jerusalem', sessions: [[9.75, 17.25]], tradingWeekdays: [1, 2, 3, 4, 5] },
  { id: 'south-africa', name: '南非JSE Top 40', symbol: '^J200.JO', region: 'middleEast', latitude: -26.1029, longitude: 28.05761, timezone: 'Africa/Johannesburg', sessions: [[9, 17]] },
  { id: 'nigeria', name: '尼日利亚NGX全股', symbol: 'NGX:ASI', region: 'middleEast', latitude: 6.44831, longitude: 3.3899, timezone: 'Africa/Lagos', sessions: [[9.5, 14.5]] },
  { id: 'latin-america', name: 'MSCI拉美（ETF代理）', symbol: 'LTAM.AS', region: 'americas', latitude: -23.5456, longitude: -46.634, timezone: 'America/Sao_Paulo', sessions: [[10, 17]] },
];

const globalMacroTickerConfigs = [
  { id: 'australia', sourceId: 'australia', name: '澳洲ASX 200', symbol: 'AXJO' },
  { id: 'japan', sourceId: 'japan', name: '日经225', symbol: 'N225' },
  { id: 'korea', sourceId: 'korea', name: '韩国KOSPI', symbol: 'KS11' },
  { id: 'china', sourceId: 'sse', name: '上证指数', symbol: '000001' },
  { id: 'shenzhen', sourceId: 'szse', name: '深证成指', symbol: '399001' },
  { id: 'chinext', sourceId: 'chinext', name: '创业板指', symbol: '399006' },
  { id: 'star50', sourceId: 'star50', name: '科创50', symbol: '000688' },
  { id: 'hongkong', sourceId: 'hsi', name: '恒生指数', symbol: 'HSI' },
  { id: 'hktech', sourceId: 'hstech', name: '恒生科技', symbol: 'HSTECH' },
  { id: 'india', sourceId: 'india', name: '印度NIFTY 50', symbol: 'NSEI' },
  { id: 'saudi', sourceId: 'saudi', name: '沙特TASI', symbol: 'TASI' },
  { id: 'germany', sourceId: 'germany', name: '德国DAX', symbol: 'DAX' },
  { id: 'france', sourceId: 'france', name: '法国CAC 40', symbol: 'CAC 40' },
  { id: 'uk', sourceId: 'uk', name: '英国富时100', symbol: 'FTSE 100' },
  { id: 'nasdaq', sourceId: 'nasdaq', name: '纳斯达克100', symbol: 'NDX' },
  { id: 'us', sourceId: 'sp500', name: '标普500', symbol: 'SPX' },
  { id: 'dow', sourceId: 'dow', name: '道琼斯', symbol: 'DJIA' },
  { id: 'vix', sourceId: 'vix', name: '芝加哥VIX', symbol: 'VIX' },
] as const;

type InternationalIndexConfig = {
  id: string;
  code: string;
  name: string;
  symbol: string;
  region: string;
  proxyFor?: string;
};

const internationalIndexConfigs: Record<InternationalMarketMode, InternationalIndexConfig[]> = {
  japan: [
    { id: 'nikkei225', code: 'N225', name: '日经225', symbol: '^N225', region: 'JP' },
    { id: 'topix', code: 'TOPIX', name: '东证指数', symbol: '1306.T', region: 'JP' },
    { id: 'jpx400', code: 'JPX400', name: 'JPX日经400', symbol: '1591.T', region: 'JP', proxyFor: 'JPX日经400 ETF' },
    { id: 'nikkei-etf', code: '1321', name: '日经225 ETF', symbol: '1321.T', region: 'JP' },
  ],
  korea: [
    { id: 'kospi', code: 'KS11', name: '韩国KOSPI', symbol: '^KS11', region: 'KR' },
    { id: 'kosdaq', code: 'KQ11', name: '韩国KOSDAQ', symbol: '^KQ11', region: 'KR' },
    { id: 'kospi200', code: 'KS200', name: 'KOSPI 200', symbol: '^KS200', region: 'KR' },
    { id: 'kospi200-etf', code: '069500', name: 'KOSPI 200 ETF', symbol: '069500.KS', region: 'KR' },
  ],
  india: [
    { id: 'nifty50', code: 'NSEI', name: '印度NIFTY 50', symbol: '^NSEI', region: 'IN' },
    { id: 'sensex', code: 'BSESN', name: '孟买SENSEX', symbol: '^BSESN', region: 'IN' },
    { id: 'niftybank', code: 'NSEBANK', name: 'NIFTY银行', symbol: '^NSEBANK', region: 'IN' },
    { id: 'niftyit', code: 'CNXIT', name: 'NIFTY信息技术', symbol: '^CNXIT', region: 'IN' },
  ],
  germany: [
    { id: 'dax', code: 'DAX', name: '德国DAX', symbol: '^GDAXI', region: 'DE' },
    { id: 'mdax', code: 'MDAX', name: '德国MDAX', symbol: '^MDAXI', region: 'DE' },
    { id: 'tecdax', code: 'TECDAX', name: '德国TecDAX', symbol: '^TECDAX', region: 'DE' },
    { id: 'sdax', code: 'SDAX', name: '德国SDAX', symbol: '^SDAXI', region: 'DE' },
  ],
  france: [
    { id: 'cac40', code: 'CAC40', name: '法国CAC 40', symbol: '^FCHI', region: 'FR' },
    { id: 'sbf120', code: 'SBF120', name: '法国SBF 120', symbol: '^SBF120', region: 'FR' },
    { id: 'cac-next20', code: 'CACNEXT20', name: 'CAC Next 20', symbol: '^CN20', region: 'FR' },
    { id: 'france-etf', code: 'EWQ', name: '法国市场ETF', symbol: 'EWQ', region: 'FR', proxyFor: 'MSCI France ETF' },
  ],
  uk: [
    { id: 'ftse100', code: 'FTSE100', name: '英国富时100', symbol: '^FTSE', region: 'GB' },
    { id: 'ftse250', code: 'FTSE250', name: '英国富时250', symbol: '^FTMC', region: 'GB' },
    { id: 'ftse-allshare', code: 'FTAS', name: '富时全股指数', symbol: '^FTAS', region: 'GB' },
    { id: 'uk-etf', code: 'EWU', name: '英国市场ETF', symbol: 'EWU', region: 'GB', proxyFor: 'MSCI United Kingdom ETF' },
  ],
};

const internationalOverviewCache = new Map<InternationalMarketMode, { storedAt: number; data: unknown }>();
const internationalOverviewInFlight = new Map<InternationalMarketMode, Promise<unknown>>();
const yahooIndexMarkets = new Set<InternationalMarketMode>(['japan', 'india', 'germany', 'france', 'uk']);

type NormalizedInternationalQuote = {
  symbol: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  updatedAt: string;
  marketState: string;
  provider: string;
  sourceUrl: string;
  marketCap?: number;
};

function naverKoreaStockCode(symbol: string) {
  return symbol.replace(/\.K[QS]$/i, '');
}

function naverPollingTimestamp(value: unknown) {
  const timestamp = asFiniteNumber(value);
  return timestamp && timestamp > 1_000_000_000_000
    ? new Date(timestamp).toISOString()
    : new Date().toISOString();
}

async function getNaverKoreaStockQuotes(symbols: readonly string[]) {
  const codes = [...new Set(symbols.map(naverKoreaStockCode).filter(Boolean))];
  if (!codes.length) return new Map<string, NormalizedInternationalQuote>();
  const search = new URLSearchParams({ query: `SERVICE_ITEM:${codes.join(',')}` });
  const requestUrl = `https://polling.finance.naver.com/api/realtime?${search.toString()}`;
  const payload = JSON.parse(await fetchFastMarketText(requestUrl, 5_000)) as Record<string, any>;
  const area = Array.isArray(payload?.result?.areas)
    ? payload.result.areas.find((item: Record<string, unknown>) => item?.name === 'SERVICE_ITEM')
    : undefined;
  const rows = Array.isArray(area?.datas) ? area.datas as Array<Record<string, unknown>> : [];
  const updatedAt = naverPollingTimestamp(payload?.result?.time);
  return new Map(rows.flatMap((row): Array<[string, NormalizedInternationalQuote]> => {
    const code = String(row.cd || '').trim();
    const price = asFiniteNumber(row.nv);
    const previousClose = asFiniteNumber(row.pcv ?? row.sv);
    if (!code || price === undefined || previousClose === undefined || previousClose <= 0) return [];
    const listedShares = asFiniteNumber(row.countOfListedStock);
    const change = price - previousClose;
    return [[`${code}.KS`, {
      symbol: `${code}.KS`,
      price,
      previousClose,
      change,
      changePercent: change / previousClose * 100,
      updatedAt,
      marketState: String(row.ms || 'UNKNOWN'),
      provider: 'Naver Finance · KRX 常规盘',
      sourceUrl: `https://finance.naver.com/item/main.naver?code=${encodeURIComponent(code)}`,
      marketCap: listedShares && listedShares > 0 ? price * listedShares : undefined,
    }]];
  }));
}

const naverKoreaIndexCodes: Record<string, string> = {
  kospi: 'KOSPI',
  kosdaq: 'KOSDAQ',
  kospi200: 'KPI200',
};

async function getNaverKoreaIndexQuote(config: InternationalIndexConfig): Promise<NormalizedInternationalQuote> {
  if (config.id === 'kospi200-etf') {
    const quote = (await getNaverKoreaStockQuotes([config.symbol])).get(config.symbol);
    if (!quote) throw new Error(`${config.name} 行情暂时不可用`);
    return quote;
  }
  const naverCode = naverKoreaIndexCodes[config.id];
  if (!naverCode) throw new Error(`${config.name} 暂无韩国常规盘适配器`);
  const search = new URLSearchParams({ query: `SERVICE_INDEX:${naverCode}` });
  const requestUrl = `https://polling.finance.naver.com/api/realtime?${search.toString()}`;
  const payload = JSON.parse(await fetchFastMarketText(requestUrl, 5_000)) as Record<string, any>;
  const area = Array.isArray(payload?.result?.areas)
    ? payload.result.areas.find((item: Record<string, unknown>) => item?.name === 'SERVICE_INDEX')
    : undefined;
  const row = Array.isArray(area?.datas) ? area.datas[0] as Record<string, any> : undefined;
  const priceRaw = asFiniteNumber(row?.nv);
  const price = priceRaw === undefined ? undefined : priceRaw / 100;
  const absoluteChange = Math.abs((asFiniteNumber(row?.cv) ?? 0) / 100);
  const directionCode = String(row?.rf || '3');
  const direction = directionCode === '5' ? 'FALLING' : directionCode === '2' ? 'RISING' : 'UNCHANGED';
  const change = direction === 'FALLING' ? -absoluteChange : direction === 'RISING' ? absoluteChange : 0;
  const previousClose = price === undefined ? undefined : price - change;
  if (price === undefined || previousClose === undefined || previousClose <= 0) throw new Error(`${config.name} 行情暂时不可用`);
  return {
    symbol: config.symbol,
    price,
    previousClose,
    change,
    changePercent: change / previousClose * 100,
    updatedAt: naverPollingTimestamp(payload?.result?.time),
    marketState: String(row?.ms || 'UNKNOWN'),
    provider: 'Naver Finance · KRX 常规盘',
    sourceUrl: `https://finance.naver.com/sise/sise_index.naver?code=${encodeURIComponent(naverCode)}`,
  };
}

type TradingViewRegionalMarket = Exclude<InternationalMarketMode, 'korea'> | 'australia' | 'saudi';

type TradingViewRegionalQuote = NormalizedInternationalQuote & {
  ticker: string;
  currency: string;
  exchange: string;
  updateMode: string;
  sourceDelaySeconds: number;
};

const tradingViewIndexTickers: Record<Exclude<InternationalMarketMode, 'korea'>, Record<string, string>> = {
  japan: {
    nikkei225: 'TVC:NI225',
    topix: 'TSE:TOPIX',
    jpx400: 'TSE:1591',
    'nikkei-etf': 'TSE:1321',
  },
  india: {
    nifty50: 'NSE:NIFTY',
    sensex: 'BSE:SENSEX',
    niftybank: 'NSE:BANKNIFTY',
    niftyit: 'NSE:CNXIT',
  },
  germany: {
    dax: 'XETR:DAX',
    mdax: 'XETR:MDAX',
    tecdax: 'XETR:TDXP',
    sdax: 'XETR:SDXP',
  },
  france: {
    cac40: 'EURONEXT:PX1',
    sbf120: 'EURONEXT:PX4',
    'cac-next20': 'EURONEXT:CN20',
    'france-etf': 'AMEX:EWQ',
  },
  uk: {
    ftse100: 'TVC:UKX',
    ftse250: 'FTSE:MCX',
    'ftse-allshare': 'FTSE:ASX',
    'uk-etf': 'AMEX:EWU',
  },
};

function tradingViewStockTicker(market: TradingViewRegionalMarket, symbol: string) {
  const rules: Record<TradingViewRegionalMarket, { exchange: string; suffix: string }> = {
    japan: { exchange: 'TSE', suffix: '.T' },
    india: { exchange: 'NSE', suffix: '.NS' },
    germany: { exchange: 'XETR', suffix: '.DE' },
    france: { exchange: 'EURONEXT', suffix: '.PA' },
    uk: { exchange: 'LSE', suffix: '.L' },
    australia: { exchange: 'ASX', suffix: '.AX' },
    saudi: { exchange: 'TADAWUL', suffix: '.SR' },
  };
  const rule = rules[market];
  let code = symbol.endsWith(rule.suffix) ? symbol.slice(0, -rule.suffix.length) : symbol;
  if (market === 'uk' && ['BP', 'NG', 'RR'].includes(code)) code += '.';
  return `${rule.exchange}:${code}`;
}

function tradingViewDelaySeconds(updateMode: string) {
  if (updateMode === 'streaming') return 0;
  const matched = updateMode.match(/_(\d+)$/);
  return matched ? Number(matched[1]) : 0;
}

const tradingViewRegionalLastGood = new Map<string, TradingViewRegionalQuote>();

async function getTradingViewRegionalQuotes(
  market: TradingViewRegionalMarket,
  tickers: readonly string[],
  scanner: TradingViewRegionalMarket | 'global' = market,
) {
  const uniqueTickers = [...new Set(tickers)];
  if (!uniqueTickers.length) return new Map<string, TradingViewRegionalQuote>();
  const requestUrl = `https://scanner.tradingview.com/${scanner}/scan`;
  const requestBody = JSON.stringify({
    symbols: { tickers: uniqueTickers, query: { types: [] } },
    columns: [
      'name', 'description', 'close', 'change', 'change_abs', 'market_cap_basic',
      'update_mode', 'current_session', 'timezone', 'currency', 'exchange',
    ],
  });
  const host = new URL(requestUrl).host;
  const preferredRoute = fastMarketRoutePreference.get(host) || 'direct';
  const routes: FetchRoute[] = preferredRoute === 'direct' ? ['direct', 'proxy'] : ['proxy', 'direct'];
  let payload: Record<string, any> | undefined;
  let lastError: unknown;
  for (const route of routes) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const init: RequestInit & { dispatcher?: any } = {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0 Safari/537.36',
          Accept: 'application/json,text/plain,*/*',
          'Content-Type': 'application/json',
          Origin: 'https://www.tradingview.com',
          Referer: 'https://www.tradingview.com/',
        },
        body: requestBody,
      };
      if (route === 'proxy') init.dispatcher = foreignProxyAgent;
      const response = await fetch(requestUrl, init);
      if (!response.ok) throw new Error(`TradingView HTTP ${response.status}`);
      payload = await response.json() as Record<string, any>;
      fastMarketRoutePreference.set(host, route);
      break;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  if (!payload) throw lastError instanceof Error ? lastError : new Error('区域行情暂时不可用');
  const rows = Array.isArray(payload.data) ? payload.data as Array<Record<string, any>> : [];
  const parsedQuotes = rows.flatMap((row): Array<[string, TradingViewRegionalQuote]> => {
    const ticker = String(row.s || '');
    const values = Array.isArray(row.d) ? row.d : [];
    const price = asFiniteNumber(values[2]);
    const change = asFiniteNumber(values[4]);
    if (!ticker || price === undefined || change === undefined) return [];
    const previousClose = price - change;
    if (previousClose <= 0) return [];
    const updateMode = String(values[6] || 'unknown');
    const sourceDelaySeconds = tradingViewDelaySeconds(updateMode);
    const exchange = String(values[10] || ticker.split(':')[0] || '');
    return [[ticker, {
      ticker,
      symbol: ticker,
      price,
      previousClose,
      change,
      changePercent: change / previousClose * 100,
      marketCap: asFiniteNumber(values[5]),
      updatedAt: new Date(Date.now() - sourceDelaySeconds * 1000).toISOString(),
      marketState: String(values[7] || 'UNKNOWN').toUpperCase(),
      provider: `TradingView · ${exchange || '区域交易所'}`,
      sourceUrl: `https://www.tradingview.com/symbols/${ticker.replace(':', '-')}/`,
      currency: String(values[9] || ''),
      exchange,
      updateMode,
      sourceDelaySeconds,
    }]];
  });
  parsedQuotes.forEach(([ticker, quote]) => tradingViewRegionalLastGood.set(ticker, quote));
  return new Map(uniqueTickers.flatMap((ticker) => {
    const quote = tradingViewRegionalLastGood.get(ticker);
    return quote ? [[ticker, quote] as const] : [];
  }));
}

async function getTradingViewRegionalQuotesResilient(
  market: TradingViewRegionalMarket,
  tickers: readonly string[],
  scanner: TradingViewRegionalMarket | 'global' = market,
) {
  const expectedCount = new Set(tickers).size;
  let quotes = await getTradingViewRegionalQuotes(market, tickers, scanner)
    .catch(() => new Map<string, TradingViewRegionalQuote>());
  if (quotes.size >= expectedCount) return quotes;
  await new Promise<void>((resolve) => setTimeout(resolve, 350));
  const retried = await getTradingViewRegionalQuotes(market, tickers, scanner)
    .catch(() => new Map<string, TradingViewRegionalQuote>());
  if (retried.size > quotes.size) quotes = retried;
  return quotes;
}

async function getInternationalMarketOverview(market: InternationalMarketMode) {
  const configs = internationalIndexConfigs[market];
  if (market === 'korea') {
    const settled = await Promise.allSettled(configs.map(async (config) => {
      const quote = await getNaverKoreaIndexQuote(config);
      return {
        id: config.id,
        code: config.code,
        name: config.name,
        region: config.region,
        market,
        proxyFor: config.proxyFor,
        price: quote.price,
        previousClose: quote.previousClose,
        change: quote.change,
        changePercent: quote.changePercent,
        updatedAt: quote.updatedAt,
        marketState: quote.marketState,
        sourceUrl: quote.sourceUrl,
        validation: { status: 'single-source', source: quote.provider, price: quote.price },
      };
    }));
    const indices = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    if (!indices.length) throw new Error('韩国市场指数行情暂时不可用');
    return {
      market,
      generatedAt: new Date().toISOString(),
      refreshIntervalMs: 5_000,
      source: 'Naver Finance · KRX 常规盘',
      quotePolicy: '仅使用韩国交易所常规盘现价与同盘口径昨收，不混入 NXT/盘后行情',
      indices,
    };
  }
  const regionalMarket = market as Exclude<InternationalMarketMode, 'korea'>;
  const preferYahooMarket = yahooIndexMarkets.has(market);
  const regionalTickers = configs.map((config) => tradingViewIndexTickers[regionalMarket][config.id]);
  const [regionalQuotes, yahooQuotes] = await Promise.all([
    preferYahooMarket
      ? Promise.resolve(new Map<string, TradingViewRegionalQuote>())
      : getTradingViewRegionalQuotesResilient(regionalMarket, regionalTickers, 'global'),
    getYahooFastQuotes(configs.map((item) => item.symbol)),
  ]);
  const regionalSettled = await Promise.allSettled(configs.map(async (config) => {
    const ticker = tradingViewIndexTickers[regionalMarket][config.id];
    const regionalQuote = regionalQuotes.get(ticker);
    const yahooQuote = yahooQuotes.get(config.symbol);
    const quote = preferYahooMarket
      ? yahooQuote || await getYahooMacroSnapshot(config.symbol)
      : regionalQuote || yahooQuote || await getYahooMacroSnapshot(config.symbol);
    const secondaryComparable = !(market === 'japan' && config.id === 'topix');
    const deviationPercent = secondaryComparable && regionalQuote && yahooQuote && yahooQuote.price > 0
      ? Math.abs(regionalQuote.price / yahooQuote.price - 1) * 100
      : undefined;
    const delayAwareTolerance = regionalQuote && regionalQuote.sourceDelaySeconds > 0 ? 1 : 0.35;
    return {
      id: config.id,
      code: config.code,
      name: config.name,
      region: config.region,
      market,
      proxyFor: config.proxyFor,
      price: quote.price,
      previousClose: 'previousClose' in quote ? quote.previousClose : quote.price - quote.change,
      change: quote.change,
      changePercent: quote.changePercent,
      updatedAt: quote.updatedAt,
      marketState: 'marketState' in quote ? quote.marketState : 'REGULAR',
      sourceDelaySeconds: 'sourceDelaySeconds' in quote ? quote.sourceDelaySeconds : undefined,
      sourceUrl: quote.sourceUrl,
      validation: {
        status: deviationPercent === undefined
          ? 'single-source'
          : deviationPercent <= delayAwareTolerance ? 'verified' : 'review',
        source: preferYahooMarket ? 'Yahoo Finance' : regionalQuote?.provider || 'Yahoo Finance Spark（降级）',
        price: quote.price,
        deviationPercent,
      },
    };
  }));
  const regionalIndices = regionalSettled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  if (regionalIndices.length !== configs.length) throw new Error('该市场核心指数行情不完整，保留最近一次完整快照');
  return {
    market,
    generatedAt: new Date().toISOString(),
    refreshIntervalMs: 5_000,
    source: preferYahooMarket ? 'Yahoo Finance' : 'TradingView 区域交易所行情 · Yahoo Finance 交叉校验',
    quotePolicy: preferYahooMarket
      ? '指数现价、昨收、涨跌与跳转链接均来自 Yahoo Finance；个股热力图数据源不受影响'
      : '现价、昨收和涨跌均来自同一交易时段；按数据授权明确标注实时或延迟',
    indices: regionalIndices,
  };
}

async function getCachedInternationalMarketOverview(market: InternationalMarketMode) {
  const cached = internationalOverviewCache.get(market);
  if (cached && Date.now() - cached.storedAt < 3_000) return cached.data;
  const running = internationalOverviewInFlight.get(market);
  if (running) return running;
  const request = getInternationalMarketOverview(market)
    .catch(async (error) => {
      if (cached) return cached.data;
      await new Promise<void>((resolve) => setTimeout(resolve, 400));
      return getInternationalMarketOverview(market).catch(() => { throw error; });
    })
    .then((data) => {
      internationalOverviewCache.set(market, { storedAt: Date.now(), data });
      return data;
    })
    .finally(() => internationalOverviewInFlight.delete(market));
  internationalOverviewInFlight.set(market, request);
  return request;
}

const globalMacroCommodities = [
  ['wti', 'WTI原油', 'CL=F'], ['brent', '布伦特原油', 'BZ=F'], ['gas', '天然气', 'NG=F'],
  ['gold', '黄金', 'GC=F'], ['silver', '白银', 'SI=F'], ['copper', '铜', 'HG=F'],
  ['bitcoin', '比特币', 'BTC-USD'], ['ethereum', '以太坊', 'ETH-USD'],
] as const;

type GlobalHeatmapConfig = { symbol: string; name: string; sector: string; weight: number };

const globalHeatmapConfigs: Record<string, GlobalHeatmapConfig[]> = {
  japan: [
    { symbol: '7203.T', name: '丰田汽车', sector: '汽车', weight: 15 }, { symbol: '8306.T', name: '三菱日联金融集团', sector: '金融', weight: 11 },
    { symbol: '6758.T', name: '索尼集团', sector: '科技', weight: 10 }, { symbol: '6501.T', name: '日立制作所', sector: '工业', weight: 9 },
    { symbol: '9983.T', name: '迅销集团（优衣库）', sector: '消费', weight: 9 }, { symbol: '6861.T', name: '基恩士', sector: '科技', weight: 8 },
    { symbol: '7974.T', name: '任天堂', sector: '消费', weight: 8 }, { symbol: '9984.T', name: '软银集团', sector: '科技', weight: 8 },
    { symbol: '8035.T', name: '东京电子', sector: '科技', weight: 7 }, { symbol: '6098.T', name: '瑞可利控股', sector: '服务', weight: 6 },
    { symbol: '4063.T', name: '信越化学工业', sector: '材料', weight: 6 }, { symbol: '4519.T', name: '中外制药', sector: '医疗健康', weight: 6 },
    { symbol: '8058.T', name: '三菱商事', sector: '综合商社', weight: 6 }, { symbol: '8316.T', name: '三井住友金融集团', sector: '金融', weight: 6 },
    { symbol: '8766.T', name: '东京海上控股', sector: '金融', weight: 5 }, { symbol: '9432.T', name: '日本电信电话', sector: '通信', weight: 5 },
    { symbol: '9433.T', name: 'KDDI', sector: '通信', weight: 5 }, { symbol: '6954.T', name: '发那科', sector: '工业', weight: 5 },
    { symbol: '7267.T', name: '本田汽车', sector: '汽车', weight: 5 }, { symbol: '7741.T', name: '豪雅', sector: '医疗健康', weight: 4 },
  ],
  korea: [
    { symbol: '005930.KS', name: '三星电子', sector: '科技', weight: 20 }, { symbol: '000660.KS', name: 'SK海力士', sector: '科技', weight: 14 },
    { symbol: '373220.KS', name: 'LG新能源', sector: '动力电池', weight: 10 }, { symbol: '005380.KS', name: '现代汽车', sector: '汽车', weight: 9 },
    { symbol: '207940.KS', name: '三星生物制剂', sector: '医疗健康', weight: 8 }, { symbol: '000270.KS', name: '起亚汽车', sector: '汽车', weight: 8 },
    { symbol: '068270.KS', name: '赛尔群', sector: '医疗健康', weight: 7 }, { symbol: '105560.KS', name: 'KB金融集团', sector: '金融', weight: 6 },
    { symbol: '035420.KS', name: '韩国纳维尔', sector: '互联网', weight: 6 }, { symbol: '035720.KS', name: '卡考', sector: '互联网', weight: 5 },
    { symbol: '006400.KS', name: '三星SDI', sector: '动力电池', weight: 5 }, { symbol: '051910.KS', name: 'LG化学', sector: '材料', weight: 5 },
    { symbol: '055550.KS', name: '新韩金融集团', sector: '金融', weight: 5 }, { symbol: '012330.KS', name: '现代摩比斯', sector: '汽车', weight: 5 },
    { symbol: '028260.KS', name: '三星物产', sector: '工业', weight: 4 }, { symbol: '066570.KS', name: 'LG电子', sector: '电子', weight: 4 },
    { symbol: '003550.KS', name: 'LG集团', sector: '工业', weight: 4 }, { symbol: '323410.KS', name: 'KakaoBank', sector: '金融科技', weight: 4 },
    { symbol: '096770.KS', name: 'SK创新', sector: '能源', weight: 4 }, { symbol: '034730.KS', name: 'SK集团', sector: '工业', weight: 4 },
  ],
  india: [
    { symbol: 'RELIANCE.NS', name: '信实工业', sector: '能源', weight: 16 }, { symbol: 'HDFCBANK.NS', name: 'HDFC银行', sector: '金融', weight: 14 },
    { symbol: 'BHARTIARTL.NS', name: '巴蒂电信', sector: '通信', weight: 11 }, { symbol: 'TCS.NS', name: '塔塔咨询服务', sector: '科技', weight: 11 },
    { symbol: 'ICICIBANK.NS', name: 'ICICI银行', sector: '金融', weight: 10 }, { symbol: 'SBIN.NS', name: '印度国家银行', sector: '金融', weight: 8 },
    { symbol: 'INFY.NS', name: '印孚瑟斯', sector: '科技', weight: 8 }, { symbol: 'LICI.NS', name: '印度人寿保险', sector: '金融', weight: 7 },
    { symbol: 'HINDUNILVR.NS', name: '印度联合利华', sector: '消费', weight: 6 }, { symbol: 'ITC.NS', name: 'ITC集团', sector: '消费', weight: 6 },
    { symbol: 'LT.NS', name: '拉森特博洛', sector: '工业', weight: 6 }, { symbol: 'BAJFINANCE.NS', name: '巴贾吉金融', sector: '金融', weight: 6 },
    { symbol: 'AXISBANK.NS', name: 'Axis银行', sector: '金融', weight: 5 }, { symbol: 'MARUTI.NS', name: '马鲁蒂铃木', sector: '汽车', weight: 5 },
    { symbol: 'SUNPHARMA.NS', name: '太阳制药', sector: '医疗健康', weight: 5 }, { symbol: 'M&M.NS', name: '马恒达集团', sector: '汽车', weight: 5 },
    { symbol: 'KOTAKBANK.NS', name: '柯达克银行', sector: '金融', weight: 4 }, { symbol: 'NTPC.NS', name: '印度国家电力', sector: '公用事业', weight: 4 },
    { symbol: 'TITAN.NS', name: '泰坦公司', sector: '消费', weight: 4 }, { symbol: 'ONGC.NS', name: '印度石油天然气公司', sector: '能源', weight: 4 },
  ],
  australia: [
    { symbol: 'BHP.AX', name: '必和必拓', sector: '材料', weight: 17 }, { symbol: 'CBA.AX', name: '澳大利亚联邦银行', sector: '金融', weight: 16 },
    { symbol: 'CSL.AX', name: 'CSL生物', sector: '医疗健康', weight: 10 }, { symbol: 'NAB.AX', name: '澳洲国民银行', sector: '金融', weight: 9 },
    { symbol: 'WBC.AX', name: '西太平洋银行', sector: '金融', weight: 8 }, { symbol: 'ANZ.AX', name: '澳新银行集团', sector: '金融', weight: 8 },
    { symbol: 'WES.AX', name: '西农集团', sector: '消费', weight: 7 }, { symbol: 'MQG.AX', name: '麦格理集团', sector: '金融', weight: 7 },
    { symbol: 'GMG.AX', name: '嘉民集团', sector: '房地产', weight: 6 }, { symbol: 'RIO.AX', name: '力拓', sector: '材料', weight: 6 },
  ],
  euro: [
    { symbol: 'ASML.AS', name: '阿斯麦', sector: '科技', weight: 17 }, { symbol: 'SAP.DE', name: '思爱普', sector: '科技', weight: 14 },
    { symbol: 'MC.PA', name: '路威酩轩', sector: '消费', weight: 12 }, { symbol: 'NOVO-B.CO', name: '诺和诺德', sector: '医疗健康', weight: 11 },
    { symbol: 'OR.PA', name: '欧莱雅', sector: '消费', weight: 8 }, { symbol: 'SIE.DE', name: '西门子', sector: '工业', weight: 8 },
    { symbol: 'TTE.PA', name: '道达尔能源', sector: '能源', weight: 8 }, { symbol: 'AIR.PA', name: '空中客车', sector: '工业', weight: 7 },
    { symbol: 'RMS.PA', name: '爱马仕', sector: '消费', weight: 6 }, { symbol: 'SU.PA', name: '施耐德电气', sector: '工业', weight: 6 },
  ],
  germany: [
    { symbol: 'SAP.DE', name: '思爱普', sector: '科技', weight: 16 }, { symbol: 'SIE.DE', name: '西门子', sector: '工业', weight: 13 },
    { symbol: 'ALV.DE', name: '安联保险', sector: '金融', weight: 12 }, { symbol: 'DTE.DE', name: '德国电信', sector: '通信', weight: 10 },
    { symbol: 'AIR.DE', name: '空中客车', sector: '工业', weight: 9 }, { symbol: 'BAS.DE', name: '巴斯夫', sector: '材料', weight: 8 },
    { symbol: 'BMW.DE', name: '宝马集团', sector: '汽车', weight: 8 }, { symbol: 'MBG.DE', name: '梅赛德斯-奔驰', sector: '汽车', weight: 8 },
    { symbol: 'MUV2.DE', name: '慕尼黑再保险', sector: '金融', weight: 8 }, { symbol: 'IFX.DE', name: '英飞凌', sector: '科技', weight: 8 },
    { symbol: 'VOW3.DE', name: '大众汽车', sector: '汽车', weight: 6 }, { symbol: 'ADS.DE', name: '阿迪达斯', sector: '消费', weight: 6 },
    { symbol: 'DBK.DE', name: '德意志银行', sector: '金融', weight: 5 }, { symbol: 'RHM.DE', name: '莱茵金属', sector: '工业', weight: 5 },
    { symbol: 'HEN3.DE', name: '汉高', sector: '消费', weight: 5 }, { symbol: 'BEI.DE', name: '拜尔斯道夫', sector: '消费', weight: 4 },
    { symbol: 'CON.DE', name: '大陆集团', sector: '汽车', weight: 4 }, { symbol: 'BAYN.DE', name: '拜耳', sector: '医疗健康', weight: 4 },
    { symbol: 'EOAN.DE', name: '意昂集团', sector: '公用事业', weight: 4 }, { symbol: 'MRK.DE', name: '默克集团', sector: '医疗健康', weight: 4 },
  ],
  france: [
    { symbol: 'MC.PA', name: '路威酩轩', sector: '消费', weight: 15 }, { symbol: 'OR.PA', name: '欧莱雅', sector: '消费', weight: 12 },
    { symbol: 'TTE.PA', name: '道达尔能源', sector: '能源', weight: 11 }, { symbol: 'AIR.PA', name: '空中客车', sector: '工业', weight: 11 },
    { symbol: 'RMS.PA', name: '爱马仕', sector: '消费', weight: 10 }, { symbol: 'SU.PA', name: '施耐德电气', sector: '工业', weight: 10 },
    { symbol: 'SAN.PA', name: '赛诺菲', sector: '医疗健康', weight: 9 }, { symbol: 'BNP.PA', name: '法国巴黎银行', sector: '金融', weight: 8 },
    { symbol: 'CS.PA', name: '安盛集团', sector: '金融', weight: 7 }, { symbol: 'EL.PA', name: '依视路陆逊梯卡', sector: '医疗健康', weight: 7 },
    { symbol: 'AI.PA', name: '液化空气集团', sector: '材料', weight: 6 }, { symbol: 'SAF.PA', name: '赛峰集团', sector: '工业', weight: 6 },
    { symbol: 'DG.PA', name: '万喜集团', sector: '工业', weight: 5 }, { symbol: 'ENGI.PA', name: '法国能源集团', sector: '公用事业', weight: 5 },
    { symbol: 'ACA.PA', name: '法国农业信贷银行', sector: '金融', weight: 5 }, { symbol: 'CAP.PA', name: '凯捷集团', sector: '科技', weight: 4 },
    { symbol: 'RI.PA', name: '保乐力加', sector: '消费', weight: 4 }, { symbol: 'DSY.PA', name: '达索系统', sector: '科技', weight: 4 },
    { symbol: 'KER.PA', name: '开云集团', sector: '消费', weight: 4 }, { symbol: 'HO.PA', name: '泰雷兹集团', sector: '工业', weight: 4 },
  ],
  uk: [
    { symbol: 'SHEL.L', name: '壳牌', sector: '能源', weight: 16 }, { symbol: 'AZN.L', name: '阿斯利康', sector: '医疗健康', weight: 14 },
    { symbol: 'HSBA.L', name: '汇丰控股', sector: '金融', weight: 13 }, { symbol: 'ULVR.L', name: '联合利华', sector: '消费', weight: 10 },
    { symbol: 'BP.L', name: '英国石油', sector: '能源', weight: 9 }, { symbol: 'GSK.L', name: '葛兰素史克', sector: '医疗健康', weight: 8 },
    { symbol: 'BATS.L', name: '英美烟草', sector: '消费', weight: 7 }, { symbol: 'REL.L', name: '励讯集团', sector: '服务', weight: 7 },
    { symbol: 'RIO.L', name: '力拓', sector: '材料', weight: 6 }, { symbol: 'LSEG.L', name: '伦敦证券交易所集团', sector: '金融', weight: 6 },
    { symbol: 'DGE.L', name: '帝亚吉欧', sector: '消费', weight: 5 }, { symbol: 'GLEN.L', name: '嘉能可', sector: '材料', weight: 5 },
    { symbol: 'NG.L', name: '英国国家电网', sector: '公用事业', weight: 5 }, { symbol: 'RR.L', name: '劳斯莱斯控股', sector: '工业', weight: 5 },
    { symbol: 'BARC.L', name: '巴克莱银行', sector: '金融', weight: 4 }, { symbol: 'NWG.L', name: '国民西敏集团', sector: '金融', weight: 4 },
    { symbol: 'LLOY.L', name: '劳埃德银行集团', sector: '金融', weight: 4 }, { symbol: 'AAL.L', name: '英美资源集团', sector: '材料', weight: 4 },
    { symbol: 'PRU.L', name: '保诚集团', sector: '金融', weight: 4 }, { symbol: 'VOD.L', name: '沃达丰', sector: '通信', weight: 4 },
  ],
  saudi: [
    { symbol: '2222.SR', name: '沙特阿美', sector: '能源', weight: 22 }, { symbol: '1120.SR', name: '拉吉希银行', sector: '金融', weight: 16 },
    { symbol: '2010.SR', name: '沙特基础工业', sector: '材料', weight: 11 }, { symbol: '1180.SR', name: '沙特国家银行', sector: '金融', weight: 10 },
    { symbol: '7010.SR', name: '沙特电信', sector: '通信', weight: 9 }, { symbol: '1211.SR', name: '马阿登矿业', sector: '材料', weight: 8 },
    { symbol: '1010.SR', name: '利雅得银行', sector: '金融', weight: 7 }, { symbol: '2280.SR', name: '阿尔玛瑞乳业', sector: '消费', weight: 6 },
    { symbol: '7020.SR', name: '莫比利电信', sector: '通信', weight: 5 }, { symbol: '7203.SR', name: '埃尔姆', sector: '科技', weight: 5 },
  ],
};

const globalHeatmapLogoDomains: Record<string, string> = {
  '7203.T': 'toyota-global.com',
  '8306.T': 'mufg.jp',
  '6758.T': 'sony.com',
  '6501.T': 'hitachi.com',
  '9983.T': 'fastretailing.com',
  '6861.T': 'keyence.com',
  '7974.T': 'nintendo.com',
  '9984.T': 'group.softbank',
  '8035.T': 'tel.com',
  '6098.T': 'recruit-holdings.com',
  '4063.T': 'shinetsu.co.jp', '4519.T': 'chugai-pharm.co.jp', '8058.T': 'mitsubishicorp.com', '8316.T': 'smfg.co.jp',
  '8766.T': 'tokiomarinehd.com', '9432.T': 'group.ntt', '9433.T': 'kddi.com', '6954.T': 'fanuc.co.jp',
  '7267.T': 'global.honda', '7741.T': 'hoya.com',
  '005930.KS': 'samsung.com',
  '000660.KS': 'skhynix.com',
  '373220.KS': 'lgensol.com',
  '005380.KS': 'hyundai.com',
  '207940.KS': 'samsungbiologics.com',
  '000270.KS': 'kia.com',
  '068270.KS': 'celltrion.com',
  '105560.KS': 'kbfng.com',
  '035420.KS': 'navercorp.com',
  '035720.KS': 'kakaocorp.com',
  '006400.KS': 'samsungsdi.com', '051910.KS': 'lgchem.com', '055550.KS': 'shinhangroup.com', '012330.KS': 'mobis.com',
  '028260.KS': 'samsungcnt.com', '066570.KS': 'lg.com', '003550.KS': 'lg.com', '323410.KS': 'kakaobank.com',
  '096770.KS': 'skinnovation.com', '034730.KS': 'sk.com',
  'RELIANCE.NS': 'ril.com',
  'HDFCBANK.NS': 'hdfcbank.com',
  'BHARTIARTL.NS': 'airtel.in',
  'TCS.NS': 'tcs.com',
  'ICICIBANK.NS': 'icicibank.com',
  'SBIN.NS': 'bank.sbi',
  'INFY.NS': 'infosys.com',
  'LICI.NS': 'licindia.in',
  'HINDUNILVR.NS': 'hul.co.in',
  'ITC.NS': 'itcportal.com',
  'LT.NS': 'larsentoubro.com', 'BAJFINANCE.NS': 'bajajfinserv.in', 'AXISBANK.NS': 'axisbank.com', 'MARUTI.NS': 'marutisuzuki.com',
  'SUNPHARMA.NS': 'sunpharma.com', 'M&M.NS': 'mahindra.com', 'KOTAKBANK.NS': 'kotak.com', 'NTPC.NS': 'ntpc.co.in',
  'TITAN.NS': 'titancompany.in', 'ONGC.NS': 'ongcindia.com',
  'BHP.AX': 'bhp.com',
  'CBA.AX': 'commbank.com.au',
  'CSL.AX': 'csl.com',
  'NAB.AX': 'nab.com.au',
  'WBC.AX': 'westpac.com.au',
  'ANZ.AX': 'anz.com.au',
  'WES.AX': 'wesfarmers.com.au',
  'MQG.AX': 'macquarie.com',
  'GMG.AX': 'goodman.com',
  'RIO.AX': 'riotinto.com',
  'ASML.AS': 'asml.com',
  'SAP.DE': 'sap.com',
  'MC.PA': 'lvmh.com',
  'NOVO-B.CO': 'novonordisk.com',
  'OR.PA': 'loreal.com',
  'SIE.DE': 'siemens.com',
  'ALV.DE': 'allianz.com',
  'DTE.DE': 'telekom.com',
  'AIR.DE': 'airbus.com',
  'BAS.DE': 'basf.com',
  'BMW.DE': 'bmwgroup.com',
  'MBG.DE': 'group.mercedes-benz.com',
  'MUV2.DE': 'munichre.com',
  'IFX.DE': 'infineon.com',
  'VOW3.DE': 'volkswagen-group.com', 'ADS.DE': 'adidas-group.com', 'DBK.DE': 'db.com', 'RHM.DE': 'rheinmetall.com',
  'HEN3.DE': 'henkel.com', 'BEI.DE': 'beiersdorf.com', 'CON.DE': 'continental.com', 'BAYN.DE': 'bayer.com',
  'EOAN.DE': 'eon.com', 'MRK.DE': 'merckgroup.com',
  'TTE.PA': 'totalenergies.com',
  'AIR.PA': 'airbus.com',
  'RMS.PA': 'hermes.com',
  'SU.PA': 'se.com',
  'SAN.PA': 'sanofi.com',
  'BNP.PA': 'group.bnpparibas',
  'CS.PA': 'axa.com',
  'EL.PA': 'essilorluxottica.com',
  'AI.PA': 'airliquide.com', 'SAF.PA': 'safran-group.com', 'DG.PA': 'vinci.com', 'ENGI.PA': 'engie.com',
  'ACA.PA': 'credit-agricole.com', 'CAP.PA': 'capgemini.com', 'RI.PA': 'pernod-ricard.com', 'DSY.PA': '3ds.com',
  'KER.PA': 'kering.com', 'HO.PA': 'thalesgroup.com',
  'SHEL.L': 'shell.com',
  'AZN.L': 'astrazeneca.com',
  'HSBA.L': 'hsbc.com',
  'ULVR.L': 'unilever.com',
  'BP.L': 'bp.com',
  'GSK.L': 'gsk.com',
  'BATS.L': 'bat.com',
  'REL.L': 'relx.com',
  'RIO.L': 'riotinto.com',
  'LSEG.L': 'lseg.com',
  'DGE.L': 'diageo.com', 'GLEN.L': 'glencore.com', 'NG.L': 'nationalgrid.com', 'RR.L': 'rolls-royce.com',
  'BARC.L': 'barclays.com', 'NWG.L': 'natwestgroup.com', 'LLOY.L': 'lloydsbankinggroup.com', 'AAL.L': 'angloamerican.com',
  'PRU.L': 'prudentialplc.com', 'VOD.L': 'vodafone.com',
  '2222.SR': 'aramco.com',
  '1120.SR': 'alrajhibank.com.sa',
  '2010.SR': 'sabic.com',
  '1180.SR': 'alahli.com',
  '7010.SR': 'stc.com.sa',
  '1211.SR': 'maaden.com.sa',
  '1010.SR': 'riyadbank.com',
  '2280.SR': 'almarai.com',
  '7020.SR': 'mobily.com.sa',
  '7203.SR': 'elm.sa',
};

const globalNewsQueries: Record<GlobalMacroRegion, Array<[string, string]>> = {
  global: [
    ['央行', '(美联储 OR 欧洲央行 OR 中国人民银行 OR 日本央行) (利率决议 OR 加息 OR 降息 OR 通胀) when:1d'],
    ['数据', '(CPI OR 非农 OR GDP OR PMI OR 通胀 OR 就业) (公布 OR 超预期 OR 低于预期 OR 经济) when:1d'],
    ['市场', '(全球股市 OR 美债 OR 美元 OR 原油) (暴跌 OR 暴涨 OR 熔断 OR 风险 OR 波动) when:1d'],
    ['政策', '(关税 OR 财政 OR 制裁 OR 监管 OR 贸易政策) (全球 OR 美国 OR 中国 OR 欧盟 OR 市场) when:1d'],
    ['地缘', '(战争 OR 冲突 OR 制裁 OR OPEC OR 霍尔木兹 OR 航运) (市场 OR 经济 OR 能源) when:1d'],
    ['灾害', '(地震 OR 台风 OR 洪水 OR 火灾) (经济 OR 供应链 OR 能源) when:1d'],
    ['快讯', '(美联储 OR 央行 OR 全球经济 OR 关税 OR 美债 OR 原油 OR 地缘冲突) when:1d'],
    ['国际', 'site:xinhuanet.com/world (美国 OR 欧洲 OR 中东 OR 国际) when:1d'],
    ['国际', 'site:world.people.com.cn (美国 OR 欧洲 OR 中东 OR 国际) when:1d'],
  ],
  apac: [['亚太', '(中国 OR 日本 OR 韩国 OR 印度 OR 澳洲) (央行 OR 股市 OR 通胀 OR 利率) when:1d'], ['地缘', '(亚太 OR 台海 OR 朝鲜半岛) (冲突 OR 制裁 OR 风险) when:1d']],
  middleEast: [['中东', '(中东 OR 以色列 OR 伊朗) (冲突 OR 原油 OR 制裁) when:1d'], ['能源', '(OPEC OR 原油 OR 霍尔木兹) (减产 OR 供应 OR 风险) when:1d']],
  europe: [['欧洲', '(欧洲央行 OR 欧元区 OR 英国央行) (利率 OR 通胀 OR 经济) when:1d'], ['地缘', '(欧洲 OR 俄乌) (冲突 OR 制裁 OR 能源) when:1d']],
  americas: [['美洲', '(美联储 OR 美国经济 OR 标普500) (利率 OR 通胀 OR 就业 OR 风险) when:1d'], ['财报', '(美股 OR 纳斯达克) (财报 OR 业绩 OR 指引) when:1d']],
};

const globalMacroCuratedNewsSources = newsSources.filter((source) => (
  ['wallstreetcn', 'chinanews-finance', 'chinanews-world', 'gov-cn'].includes(source.id)
));

const globalMacroFocusNewsSources: NewsSourceConfig[] = [
  ...newsSources.filter((source) => source.id === 'wallstreetcn'),
  {
    id: 'caixin-macro',
    label: '财新网',
    category: 'finance',
    sourceWeight: 92,
    origin: 'domestic',
    route: 'direct',
    url: 'https://news.google.com/rss/search?q=site%3Acaixin.com%20when%3A1d%20(%E7%BB%8F%E6%B5%8E%20OR%20%E9%87%91%E8%9E%8D%20OR%20%E5%B8%82%E5%9C%BA%20OR%20%E6%94%BF%E7%AD%96)&hl=zh-CN&gl=CN&ceid=CN%3Azh-Hans',
    kind: 'rss',
  },
];

type GlobalSessionParts = {
  date: string;
  weekday: number;
  minutes: number;
  time: string;
};

function getGlobalSessionParts(value: Date, timeZone: string): GlobalSessionParts {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    date,
    weekday: new Date(`${date}T12:00:00Z`).getUTCDay(),
    minutes: hour * 60 + minute,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

function shiftGlobalSessionDate(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days, 12)).toISOString().slice(0, 10);
}

function isGlobalTradingDate(config: GlobalMacroQuoteConfig, date: string) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const tradingWeekdays = config.tradingWeekdays || [1, 2, 3, 4, 5];
  return tradingWeekdays.includes(weekday) && !config.closedDates?.includes(date);
}

function zonedGlobalSessionTimeToUtc(date: string, decimalHour: number, timeZone: string) {
  const [year, month, day] = date.split('-').map(Number);
  const totalMinutes = Math.round(decimalHour * 60);
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const desiredLocalEpoch = Date.UTC(year, month - 1, day, hour, minute, 0);
  let candidateEpoch = desiredLocalEpoch;
  // Iteratively remove the zone offset. This also handles daylight-saving transitions.
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const actual = getGlobalSessionParts(new Date(candidateEpoch), timeZone);
    const [actualYear, actualMonth, actualDay] = actual.date.split('-').map(Number);
    const actualLocalEpoch = Date.UTC(
      actualYear,
      actualMonth - 1,
      actualDay,
      Math.floor(actual.minutes / 60),
      actual.minutes % 60,
      0,
    );
    const correction = desiredLocalEpoch - actualLocalEpoch;
    candidateEpoch += correction;
    if (correction === 0) break;
  }
  return new Date(candidateEpoch);
}

function findNextGlobalSessionOpen(config: GlobalMacroQuoteConfig, now: Date, localDate: string) {
  for (let dayOffset = 0; dayOffset < 15; dayOffset += 1) {
    const date = shiftGlobalSessionDate(localDate, dayOffset);
    if (!isGlobalTradingDate(config, date)) continue;
    for (const [start] of config.sessions) {
      const openAt = zonedGlobalSessionTimeToUtc(date, start, config.timezone);
      if (openAt.getTime() > now.getTime()) return openAt;
    }
  }
  return null;
}

function formatNextGlobalOpen(openAt: Date, config: GlobalMacroQuoteConfig, currentDate: string) {
  const next = getGlobalSessionParts(openAt, config.timezone);
  const prefix = next.date === currentDate
    ? '今日'
    : next.date === shiftGlobalSessionDate(currentDate, 1)
      ? '明日'
      : `${next.date.slice(5, 7)}/${next.date.slice(8, 10)}`;
  const weekday = new Intl.DateTimeFormat('zh-CN', { timeZone: config.timezone, weekday: 'short' }).format(openAt);
  return `${prefix} ${weekday} ${next.time.slice(0, 5)}`;
}

function globalSession(config: GlobalMacroQuoteConfig, now = new Date()) {
  const parts = getGlobalSessionParts(now, config.timezone);
  const tradingDate = isGlobalTradingDate(config, parts.date);
  const calendarMarket = config.market && config.market !== 'crypto'
    ? config.market as MarketCalendarId
    : undefined;
  const holidayName = calendarMarket ? getMarketHolidayName(calendarMarket, parts.date) : undefined;
  const halfDay = calendarMarket ? getMarketHalfDay(calendarMarket, parts.date) : undefined;
  const sessions = halfDay
    ? config.sessions.map(([start, end], index) => [
        start,
        index === config.sessions.length - 1 ? Math.min(end, halfDay.closeMinute / 60) : end,
      ] as [number, number])
    : config.sessions;
  const liveSessionIndex = tradingDate
    ? sessions.findIndex(([start, end]) => parts.minutes >= start * 60 && parts.minutes < end * 60)
    : -1;
  const live = liveSessionIndex >= 0;
  const nextOpen = live ? null : findNextGlobalSessionOpen(config, now, parts.date);
  const nextOpenAt = nextOpen?.toISOString();
  const nextOpenLabel = nextOpen ? formatNextGlobalOpen(nextOpen, config, parts.date) : undefined;
  const firstStart = sessions[0]?.[0] ?? 0;
  const lastEnd = sessions.at(-1)?.[1] ?? 24;
  const betweenSessions = tradingDate && sessions.some(([end], index) => {
    const following = sessions[index + 1];
    return Boolean(following && parts.minutes >= end * 60 && parts.minutes < following[0] * 60);
  });
  const pre = tradingDate && config.sessions.some(([start]) => parts.minutes >= start * 60 - 30 && parts.minutes < start * 60);
  const label = live
    ? '交易中'
    : pre
      ? '即将开盘'
      : !tradingDate
        ? holidayName ? '节假日休市' : '非交易日'
        : betweenSessions
          ? '盘中休市'
          : parts.minutes < firstStart * 60 ? '未开盘' : parts.minutes >= lastEnd * 60 ? '已收盘' : '休市';
  const detail = live
    ? halfDay?.name || (sessions.length > 1 && liveSessionIndex === 0 ? '上午连续交易' : '常规交易时段')
    : holidayName || (betweenSessions ? '等待下一交易时段' : halfDay && parts.minutes >= lastEnd * 60 ? `${halfDay.name}已收市` : '等待下一次开盘');
  return {
    label,
    tone: live ? 'live' as const : pre ? 'pre' as const : 'closed' as const,
    detail,
    timezone: config.timezone,
    localTime: parts.time,
    nextOpenAt,
    nextOpenLabel,
  };
}

const yahooMacroQuoteCache = new Map<string, Awaited<ReturnType<typeof readYahooMacroQuote>>>();

async function readYahooMacroQuote(symbol: string, range = '1mo') {
  const requestUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&events=history`;
  const text = await fetchExternalText(requestUrl, 13000, 'application/json,text/plain,*/*');
  const payload = JSON.parse(text) as Record<string, any>;
  const result = payload?.chart?.result?.[0];
  const times = Array.isArray(result?.timestamp) ? result.timestamp as number[] : [];
  const closes = Array.isArray(result?.indicators?.quote?.[0]?.close) ? result.indicators.quote[0].close as Array<number | null> : [];
  const history = times.flatMap((timestamp, index) => {
    const close = asFiniteNumber(closes[index]);
    return close !== undefined && close > 0 ? [{ time: new Date(timestamp * 1000).toISOString(), value: close }] : [];
  });
  const latest = history.at(-1);
  const prior = history.at(-2);
  if (!latest) throw new Error(`${symbol} 无可用报价`);
  return { price: latest.value, change: prior ? latest.value - prior.value : 0, changePercent: prior?.value ? (latest.value / prior.value - 1) * 100 : 0, updatedAt: latest.time, sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`, history };
}

async function getYahooMacroQuote(symbol: string, range = '1mo') {
  const cacheKey = `${symbol}:${range}`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const quote = await readYahooMacroQuote(symbol, range);
      yahooMacroQuoteCache.set(cacheKey, quote);
      return quote;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  const cached = yahooMacroQuoteCache.get(cacheKey);
  if (cached) return cached;
  throw lastError instanceof Error ? lastError : new Error(`${symbol} 行情暂时不可用`);
}

async function getYahooMacroSnapshot(symbol: string) {
  const requestUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d&events=history`;
  const text = await fetchExternalText(requestUrl, 13000, 'application/json,text/plain,*/*');
  const payload = JSON.parse(text) as Record<string, any>;
  const result = payload?.chart?.result?.[0];
  const meta = result?.meta;
  const price = asFiniteNumber(meta?.regularMarketPrice);
  const dailyCloses = Array.isArray(result?.indicators?.quote?.[0]?.close)
    ? (result.indicators.quote[0].close as unknown[]).flatMap((value) => {
        const close = asFiniteNumber(value);
        return close !== undefined && close > 0 ? [close] : [];
      })
    : [];
  const previous = dailyCloses.length >= 2
    ? dailyCloses[dailyCloses.length - 2]
    : asFiniteNumber(meta?.previousClose ?? meta?.chartPreviousClose);
  const timestamp = asFiniteNumber(meta?.regularMarketTime);
  if (price === undefined) throw new Error(`${symbol} 快照行情暂时不可用`);
  const updatedAt = timestamp ? new Date(timestamp * 1000).toISOString() : new Date().toISOString();
  return {
    price,
    change: previous === undefined ? 0 : price - previous,
    changePercent: previous ? (price / previous - 1) * 100 : 0,
    updatedAt,
    sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
    history: [{ time: updatedAt, value: price }],
  };
}

type YahooFastQuote = {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  updatedAt: string;
  sourceUrl: string;
};

const YAHOO_SPARK_BATCH_SIZE = 10;
const yahooFastQuoteLastGood = new Map<string, YahooFastQuote>();
let yahooFastQuoteRefreshInFlight: Promise<unknown> | undefined;
let yahooFastQuoteLastAttemptAt = 0;

async function getYahooFastQuotes(symbols: readonly string[]) {
  const uniqueSymbols = [...new Set(symbols)];
  const batches = Array.from(
    { length: Math.ceil(uniqueSymbols.length / YAHOO_SPARK_BATCH_SIZE) },
    (_, index) => uniqueSymbols.slice(index * YAHOO_SPARK_BATCH_SIZE, (index + 1) * YAHOO_SPARK_BATCH_SIZE),
  );
  const settled = await Promise.allSettled(batches.map(async (batch) => {
    const search = new URLSearchParams({
      symbols: batch.join(','),
      range: '5d',
      interval: '1d',
    });
    const requestUrl = `https://query1.finance.yahoo.com/v7/finance/spark?${search.toString()}`;
    const payload = JSON.parse(await fetchFastMarketText(requestUrl, 4500)) as Record<string, any>;
    const results = Array.isArray(payload?.spark?.result) ? payload.spark.result as Array<Record<string, any>> : [];
    return results.flatMap((entry): YahooFastQuote[] => {
      const symbol = String(entry?.symbol || '');
      const response = Array.isArray(entry?.response) ? entry.response[0] : undefined;
      const meta = response?.meta;
      const price = asFiniteNumber(meta?.regularMarketPrice);
      const dailyCloses = Array.isArray(response?.indicators?.quote?.[0]?.close)
        ? (response.indicators.quote[0].close as unknown[]).flatMap((value) => {
            const close = asFiniteNumber(value);
            return close !== undefined && close > 0 ? [close] : [];
          })
        : [];
      // 用最近两个日线收盘计算涨跌。Spark 的 chartPreviousClose 在少数国际股票上
      // 会误指向更早的公司行动锚点，造成十几个百分点的虚假跳变。
      const previous = dailyCloses.length >= 2
        ? dailyCloses[dailyCloses.length - 2]
        : asFiniteNumber(meta?.previousClose ?? meta?.chartPreviousClose);
      const timestamp = asFiniteNumber(meta?.regularMarketTime);
      if (!symbol || price === undefined) return [];
      return [{
        symbol,
        price,
        change: previous === undefined ? 0 : price - previous,
        changePercent: previous ? (price / previous - 1) * 100 : 0,
        updatedAt: timestamp ? new Date(timestamp * 1000).toISOString() : new Date().toISOString(),
        sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
      }];
    });
  }));

  settled.forEach((result) => {
    if (result.status !== 'fulfilled') return;
    result.value.forEach((quote) => yahooFastQuoteLastGood.set(quote.symbol, quote));
  });

  return new Map(uniqueSymbols.flatMap((symbol) => {
    const quote = yahooFastQuoteLastGood.get(symbol);
    return quote ? [[symbol, quote] as const] : [];
  }));
}

function refreshYahooFastQuotesInBackground(symbols: readonly string[]) {
  if (yahooFastQuoteRefreshInFlight || Date.now() - yahooFastQuoteLastAttemptAt < 30_000) return;
  yahooFastQuoteLastAttemptAt = Date.now();
  yahooFastQuoteRefreshInFlight = getYahooFastQuotes(symbols).finally(() => {
    yahooFastQuoteRefreshInFlight = undefined;
  });
}

const eastMoneyGlobalFastConfigs = [
  { id: 'korea', symbol: '^KS11', secid: '100.KS11' },
  { id: 'us', symbol: '^GSPC', secid: '100.SPX' },
  { id: 'dow', symbol: '^DJI', secid: '100.DJIA' },
] as const;

async function getEastMoneyGlobalFastQuotes() {
  const search = new URLSearchParams({
    fltt: '2',
    secids: eastMoneyGlobalFastConfigs.map((item) => item.secid).join(','),
    fields: 'f12,f14,f2,f3,f4,f124',
  });
  const sourceUrl = `https://push2.eastmoney.com/api/qt/ulist.np/get?${search.toString()}`;
  const payload = await fetchExternalJson(sourceUrl, 4_000) as Record<string, any>;
  const rows = Array.isArray(payload?.data?.diff) ? payload.data.diff as Array<Record<string, unknown>> : [];
  const byCode = new Map(rows.map((row) => [String(row.f12 || '').toUpperCase(), row]));
  return new Map(eastMoneyGlobalFastConfigs.flatMap((config) => {
    const code = config.secid.split('.').at(-1)?.toUpperCase() || '';
    const row = byCode.get(code);
    const price = asFiniteNumber(row?.f2);
    if (price === undefined) return [];
    const timestamp = asFiniteNumber(row?.f124);
    return [[config.id, {
      symbol: config.symbol,
      price,
      change: asFiniteNumber(row?.f4) ?? 0,
      changePercent: asFiniteNumber(row?.f3) ?? 0,
      updatedAt: timestamp ? new Date(timestamp * 1000).toISOString() : new Date().toISOString(),
      sourceUrl,
    }] as const];
  }));
}

async function getSinaFastAssetQuotes() {
  const configs = [
    { id: 'wti', code: 'hf_CL', symbol: 'CL=F' },
    { id: 'brent', code: 'hf_OIL', symbol: 'BZ=F' },
    { id: 'gold', code: 'hf_GC', symbol: 'GC=F' },
    { id: 'silver', code: 'hf_SI', symbol: 'SI=F' },
    { id: 'gas', code: 'hf_NG', symbol: 'NG=F' },
  ] as const;
  const sourceUrl = `https://hq.sinajs.cn/list=${configs.map((item) => item.code).join(',')},DINIW`;
  const text = await fetchText(sourceUrl, 2_500);
  const quotes = new Map<string, YahooFastQuote>();
  configs.forEach((config) => {
    const match = text.match(new RegExp(`var\\s+hq_str_${config.code}="([^"]*)"`));
    const fields = match?.[1]?.split(',') || [];
    const price = asFiniteNumber(fields[0]);
    const previous = asFiniteNumber(fields[7]);
    if (price === undefined) return;
    const updatedAt = fields[12] && fields[6]
      ? new Date(`${fields[12]}T${fields[6]}+08:00`).toISOString()
      : new Date().toISOString();
    quotes.set(config.id, {
      symbol: config.symbol,
      price,
      change: previous === undefined ? 0 : price - previous,
      changePercent: previous ? (price / previous - 1) * 100 : 0,
      updatedAt,
      sourceUrl: 'https://finance.sina.com.cn/futuremarket/',
    });
  });
  const dxyMatch = text.match(/var\s+hq_str_DINIW="([^"]*)"/);
  const dxyFields = dxyMatch?.[1]?.split(',') || [];
  const dxyPrice = asFiniteNumber(dxyFields[1]);
  const dxyPrevious = asFiniteNumber(dxyFields[3]);
  if (dxyPrice !== undefined) {
    quotes.set('dxy', {
      symbol: 'DX-Y.NYB',
      price: dxyPrice,
      change: dxyPrevious === undefined ? 0 : dxyPrice - dxyPrevious,
      changePercent: dxyPrevious ? (dxyPrice / dxyPrevious - 1) * 100 : 0,
      updatedAt: dxyFields[10] && dxyFields[0]
        ? new Date(`${dxyFields[10]}T${dxyFields[0]}+08:00`).toISOString()
        : new Date().toISOString(),
      sourceUrl: 'https://finance.sina.com.cn/money/forex/hq/DINIW.shtml',
    });
  }
  if (!quotes.size) throw new Error('新浪全球资产快照暂时不可用');
  return quotes;
}

async function getCoinGeckoFastCryptoQuotes() {
  const sourceUrl = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true';
  const payload = JSON.parse(await fetchFastMarketText(sourceUrl, 4_500)) as Record<string, Record<string, unknown>>;
  const configs = [{ id: 'bitcoin', symbol: 'BTC-USD' }, { id: 'ethereum', symbol: 'ETH-USD' }] as const;
  return new Map(configs.flatMap((config) => {
    const row = payload[config.id];
    const price = asFiniteNumber(row?.usd);
    if (price === undefined) return [];
    const timestamp = asFiniteNumber(row?.last_updated_at);
    const changePercent = asFiniteNumber(row?.usd_24h_change) ?? 0;
    return [[config.id, {
      symbol: config.symbol,
      price,
      change: price * changePercent / 100,
      changePercent,
      updatedAt: timestamp ? new Date(timestamp * 1000).toISOString() : new Date().toISOString(),
      sourceUrl: `https://www.coingecko.com/en/coins/${config.id}`,
    }] as const];
  }));
}

async function getBinanceFastCryptoQuotes() {
  const symbols = encodeURIComponent(JSON.stringify(['BTCUSDT', 'ETHUSDT']));
  const sourceUrl = `https://api.binance.com/api/v3/ticker/24hr?symbols=${symbols}`;
  const payload = JSON.parse(await fetchFastMarketText(sourceUrl, 3_500)) as Array<Record<string, unknown>>;
  if (!Array.isArray(payload)) throw new Error('Binance 加密行情格式无效');
  const configs = new Map<string, { id: string; symbol: string; marketUrl: string }>([
    ['BTCUSDT', { id: 'bitcoin', symbol: 'BTC-USD', marketUrl: 'https://www.binance.com/en/trade/BTC_USDT?type=spot' }],
    ['ETHUSDT', { id: 'ethereum', symbol: 'ETH-USD', marketUrl: 'https://www.binance.com/en/trade/ETH_USDT?type=spot' }],
  ]);
  const quotes = new Map<string, YahooFastQuote>();
  payload.forEach((row) => {
    const config = typeof row.symbol === 'string' ? configs.get(row.symbol) : undefined;
    const price = asFiniteNumber(row.lastPrice);
    if (!config || price === undefined) return;
    const change = asFiniteNumber(row.priceChange) ?? 0;
    const changePercent = asFiniteNumber(row.priceChangePercent)
      ?? ((asFiniteNumber(row.openPrice) || price) === 0 ? 0 : (price / (asFiniteNumber(row.openPrice) || price) - 1) * 100);
    const closeTime = asFiniteNumber(row.closeTime);
    quotes.set(config.id, {
      symbol: config.symbol,
      price,
      change,
      changePercent,
      updatedAt: closeTime ? new Date(closeTime).toISOString() : new Date().toISOString(),
      sourceUrl: config.marketUrl,
    });
  });
  if (!quotes.size) throw new Error('Binance 加密行情暂时不可用');
  return quotes;
}

async function getYahooFastCryptoQuotes() {
  const configs = [
    { id: 'bitcoin', symbol: 'BTC-USD' },
    { id: 'ethereum', symbol: 'ETH-USD' },
  ] as const;
  const bySymbol = await getYahooFastQuotes(configs.map((config) => config.symbol));
  const quotes = new Map(configs.flatMap((config) => {
    const quote = bySymbol.get(config.symbol);
    return quote ? [[config.id, quote] as const] : [];
  }));
  if (!quotes.size) throw new Error('Yahoo 加密行情暂时不可用');
  return quotes;
}

let fastCryptoLastGood = new Map<string, YahooFastQuote>();

function mergeFreshCryptoQuotes(incoming: Map<string, YahooFastQuote>) {
  const merged = new Map(fastCryptoLastGood);
  incoming.forEach((quote, id) => {
    const current = merged.get(id);
    const incomingTimestamp = new Date(quote.updatedAt).getTime();
    const currentTimestamp = current ? new Date(current.updatedAt).getTime() : Number.NEGATIVE_INFINITY;
    if (!current || !Number.isFinite(currentTimestamp) || incomingTimestamp >= currentTimestamp) {
      merged.set(id, quote);
    }
  });
  fastCryptoLastGood = merged;
  return new Map(merged);
}

async function getNgxAllShareQuote() {
  const sourceUrl = 'https://www.stockmarketnigeria.com/';
  const html = await fetchExternalText(sourceUrl, 18000, 'text/html,application/xhtml+xml,*/*');
  const indexMatch = html.match(/NGX All-Share Index[\s\S]{0,500}?market-card-value[^>]*>\s*([\d,]+(?:\.\d+)?)/i);
  const changeMatch = html.match(/ASI Daily Change[\s\S]{0,500}?market-card-value[^>]*>\s*([+-]?[\d,]+(?:\.\d+)?)[\s\S]{0,300}?market-card-change[^>]*>\s*([+-]?[\d.]+)%/i);
  const price = asFiniteNumber(indexMatch?.[1]?.replace(/,/g, ''));
  const change = asFiniteNumber(changeMatch?.[1]?.replace(/,/g, ''));
  const changePercent = asFiniteNumber(changeMatch?.[2]);
  if (price === undefined || changePercent === undefined) throw new Error('NGX 全股指数行情解析失败');
  const updatedMatch = html.match(/Last updated:\s*<strong>([^<]+)<\/strong>/i);
  const parsedUpdatedAt = updatedMatch?.[1] ? new Date(`${updatedMatch[1]} GMT+0100`) : null;
  const updatedAt = parsedUpdatedAt && !Number.isNaN(parsedUpdatedAt.getTime()) ? parsedUpdatedAt.toISOString() : new Date().toISOString();
  return {
    price,
    change: change ?? 0,
    changePercent,
    updatedAt,
    sourceUrl,
    history: [{ time: updatedAt, value: price }],
  };
}

function parseFredSeries(csv: string) {
  const rows = csv.trim().split(/\r?\n/).slice(1).map((line) => line.split(','));
  const values = rows.flatMap((row) => {
    const rawValue = row[1]?.trim();
    if (!rawValue || rawValue === '.') return [];
    const value = asFiniteNumber(rawValue);
    return row[0] && value !== undefined ? [{ time: `${row[0]}T00:00:00.000Z`, value }] : [];
  });
  return values;
}

const fredSeriesCache = new Map<string, { storedAt: number; values: Array<{ time: string; value: number }> }>();
const fredSeriesInFlight = new Map<string, Promise<Array<{ time: string; value: number }>>>();

function fredSeriesPageUrl(seriesId: string) {
  return `https://fred.stlouisfed.org/series/${encodeURIComponent(seriesId)}`;
}

function signedMetricChange(value: number, suffix: string, digits = 2) {
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}${suffix}`;
}

async function getFredSeries(seriesId: string) {
  const cached = fredSeriesCache.get(seriesId);
  if (cached && Date.now() - cached.storedAt < 5 * 60_000) return cached.values;
  const running = fredSeriesInFlight.get(seriesId);
  if (running) return running;
  const sourceUrl = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`;
  const request = (async () => {
    let csv: string;
    try {
      csv = await fetchRoutedText(sourceUrl, 'proxy', 18000, 'text/csv,text/plain,*/*');
    } catch {
      csv = await fetchRoutedText(sourceUrl, 'direct', 12000, 'text/csv,text/plain,*/*');
    }
    const values = parseFredSeries(csv);
    if (!values.length) throw new Error(`${seriesId} 无可用 FRED 数据`);
    fredSeriesCache.set(seriesId, { storedAt: Date.now(), values });
    return values;
  })().finally(() => fredSeriesInFlight.delete(seriesId));
  fredSeriesInFlight.set(seriesId, request);
  return request;
}

async function getFredMacroMetric(
  id: string,
  seriesIds: string[],
  label: string,
  display: (value: number) => string,
  transform?: (history: Array<{ time: string; value: number }>) => Array<{ time: string; value: number }>,
  formatChange?: (value: number) => string,
) {
  let lastError: unknown;
  for (const seriesId of seriesIds) {
    const sourceUrl = fredSeriesPageUrl(seriesId);
    try {
      const raw = await getFredSeries(seriesId);
      const history = transform ? transform(raw) : raw;
      const latest = history.at(-1);
      const previous = history.at(-2);
      if (!latest) throw new Error(`${label} 无可用 FRED 数据`);
      const change = previous ? latest.value - previous.value : null;
      return {
        id,
        label,
        value: latest.value,
        display: display(latest.value),
        change,
        changeDisplay: change !== null && formatChange ? formatChange(change) : undefined,
        updatedAt: latest.time,
        sourceUrl,
        status: 'delayed' as const,
        history: history.slice(-48),
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${label} 暂时不可用`);
}

function monthlyPercentChanges(values: Array<{ time: string; value: number }>) {
  const byMonth = new Map(values.map((item) => [item.time.slice(0, 7), item.value]));
  return values.flatMap((item) => {
    const date = new Date(item.time);
    date.setUTCMonth(date.getUTCMonth() - 1);
    const previous = byMonth.get(date.toISOString().slice(0, 7));
    return previous && previous > 0 ? [{ time: item.time, value: (item.value / previous - 1) * 100 }] : [];
  });
}

function yearlyPercentChanges(values: Array<{ time: string; value: number }>) {
  const byMonth = new Map(values.map((item) => [item.time.slice(0, 7), item.value]));
  return values.flatMap((item) => {
    const date = new Date(item.time);
    date.setUTCFullYear(date.getUTCFullYear() - 1);
    const previous = byMonth.get(date.toISOString().slice(0, 7));
    return previous && previous > 0 ? [{ time: item.time, value: (item.value / previous - 1) * 100 }] : [];
  });
}

async function getVixMacroMetric() {
  try {
    const quote = await getYahooMacroQuote('^VIX', '3mo');
    return {
      id: 'vix',
      label: 'VIX 波动率',
      value: quote.price,
      display: quote.price.toFixed(2),
      change: quote.change,
      updatedAt: quote.updatedAt,
      sourceUrl: quote.sourceUrl,
      status: 'live' as const,
      history: quote.history.slice(-48),
    };
  } catch {
    return getFredMacroMetric('vix', ['VIXCLS'], 'VIX 波动率', (value) => value.toFixed(2));
  }
}

async function getUsPpiMacroMetric(forceOfficial = false, waitForExpectation = false) {
  if (forceOfficial) return getBlsReleaseMacroMetric('ppi', true, waitForExpectation);
  try {
    return await getBlsReleaseMacroMetric('ppi', false, waitForExpectation);
  } catch {
    try {
      const official = await getBlsOfficialMacroMetricFromApi('ppi');
      const ppiMarketContext = await getPpiMarketContext(false).catch(() => undefined);
      return {
        ...official,
        stats: [
          { label: '环比', display: official.display },
          { label: '同比值', display: ppiMarketContext ? `${ppiMarketContext.actual > 0 ? '+' : ''}${ppiMarketContext.actual.toFixed(1)}%` : '待更新' },
          { label: '市场预期', display: ppiMarketContext ? `${ppiMarketContext.consensus > 0 ? '+' : ''}${ppiMarketContext.consensus.toFixed(1)}%` : '待更新' },
          { label: '前值', display: ppiMarketContext ? `${ppiMarketContext.previous > 0 ? '+' : ''}${ppiMarketContext.previous.toFixed(1)}%` : '待更新' },
        ],
      };
    } catch {
      const [yearly, monthly, ppiMarketContext] = await Promise.all([
        getFredMacroMetric('ppi', ['PPIFIS'], '美国 PPI 同比', (value) => `${value.toFixed(1)}%`, yearlyPercentChanges),
        getFredMacroMetric('ppi-mom', ['PPIFIS'], '美国 PPI 环比', (value) => `${value.toFixed(1)}%`, monthlyPercentChanges),
        getPpiMarketContext(false).catch(() => undefined),
      ]);
      return {
        ...yearly,
        stats: [
          { label: '环比', display: monthly.display },
          { label: '同比值', display: `${yearly.value > 0 ? '+' : ''}${yearly.value.toFixed(1)}%` },
          { label: '市场预期', display: ppiMarketContext ? `${ppiMarketContext.consensus > 0 ? '+' : ''}${ppiMarketContext.consensus.toFixed(1)}%` : '待更新' },
          { label: '前值', display: yearly.history.at(-2)?.value === undefined ? '待更新' : `${yearly.history.at(-2)!.value > 0 ? '+' : ''}${yearly.history.at(-2)!.value.toFixed(1)}%` },
        ],
      };
    }
  }
}

async function getUsCpiPceMacroMetric(forceOfficial = false) {
  const [cpi, pce] = forceOfficial
    ? await Promise.all([getBlsOfficialMacroMetric('cpi', true), getBeaPceMacroMetric(true)])
    : await Promise.all([
      getFredMacroMetric('us-cpi-mom', ['CPIAUCSL'], '美国 CPI 月率', (value) => `${value.toFixed(2)}%`, monthlyPercentChanges),
      getFredMacroMetric('us-pce-mom', ['PCEPI'], '美国 PCE 月率', (value) => `${value.toFixed(2)}%`, monthlyPercentChanges),
    ]);
  const updatedAt = [cpi.updatedAt, pce.updatedAt].filter(Boolean).sort().at(-1);
  return {
    id: 'cpi-pce',
    label: '美国 CPI / PCE 月率',
    value: cpi.value,
    display: `CPI ${cpi.display} / PCE ${pce.display}`,
    change: cpi.change,
    changeDisplay: cpi.change === null ? undefined : `CPI ${signedMetricChange(cpi.change, 'pct')}`,
    updatedAt,
    sourceUrl: cpi.sourceUrl,
    status: 'delayed' as const,
    history: cpi.history,
    parts: [
      { label: 'CPI', display: cpi.display, updatedAt: cpi.updatedAt },
      { label: 'PCE', display: pce.display, updatedAt: pce.updatedAt },
    ],
  };
}

async function getGscpiMetric() {
  const sourceUrl = 'https://www.newyorkfed.org/medialibrary/research/interactives/data/gscpi/gscpi_interactive_data.csv';
  const csv = await fetchExternalCsv(sourceUrl, 20000);
  const rows = csv.trim().split(/\r?\n/).map((line) => line.split(','));
  const latestVintageIndex = rows[0]?.length - 1;
  if (!latestVintageIndex || latestVintageIndex < 1) throw new Error('GSCPI 数据格式异常');
  const history = rows.slice(1).flatMap((row) => {
    const value = asFiniteNumber(row[latestVintageIndex]?.trim());
    const timestamp = Date.parse(row[0]?.trim() || '');
    return value !== undefined && Number.isFinite(timestamp)
      ? [{ time: new Date(timestamp).toISOString(), value }]
      : [];
  });
  const latest = history.at(-1);
  const previous = history.at(-2);
  if (!latest) throw new Error('GSCPI 暂无有效数据');
  return {
    id: 'gscpi',
    label: '供应链压力',
    value: latest.value,
    display: latest.value.toFixed(2),
    change: previous ? latest.value - previous.value : null,
    updatedAt: latest.time,
    sourceUrl,
    status: 'delayed' as const,
    history: history.slice(-48),
  };
}

const globalPmiConfigs = [
  { id: 'pmi-us', label: '美国 PMI', slug: 'united-states' },
  { id: 'pmi-china', label: '中国 PMI', slug: 'china' },
  { id: 'pmi-europe', label: '欧洲 PMI', slug: 'euro-area' },
  { id: 'pmi-japan', label: '日本 PMI', slug: 'japan' },
  { id: 'pmi-korea', label: '韩国 PMI', slug: 'south-korea' },
] as const;

type GlobalCpiMetric = {
  id: 'china-cpi' | 'us-cpi';
  label: string;
  value: number | null;
  display: string;
  change: number | null;
  expectation?: number;
  period: string;
  releasedAt?: string;
  updatedAt: string;
  source: string;
  sourceUrl: string;
  status: 'delayed' | 'unavailable';
  history: Array<{ time: string; value: number }>;
};

function signedDirectionValue(direction: string, value?: string) {
  if (direction === '持平') return 0;
  const parsed = asFiniteNumber(value);
  if (parsed === undefined) throw new Error('CPI 涨跌幅缺失');
  return direction === '下降' ? -Math.abs(parsed) : Math.abs(parsed);
}

function cpiPeriodTime(year: number, month: number) {
  return new Date(Date.UTC(year, month - 1, 1)).toISOString();
}

async function getChinaCpiMetric(): Promise<GlobalCpiMetric> {
  const listingUrl = 'https://www.stats.gov.cn/sj/zxfb/';
  const listingHtml = await fetchExternalText(listingUrl, 16000, 'text/html,application/xhtml+xml,*/*');
  const release = [...listingHtml.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ href: match[1], title: stripTags(match[2]) }))
    .find((item) => /20\d{2}年\d{1,2}月份居民消费价格同比/.test(item.title));
  if (!release) throw new Error('国家统计局最新 CPI 发布页未找到');

  const sourceUrl = new URL(release.href, listingUrl).toString();
  const html = await fetchExternalText(sourceUrl, 16000, 'text/html,application/xhtml+xml,*/*');
  const text = stripTags(html).replace(/\s+/g, ' ');
  const yearMonth = text.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月份/);
  const yoyMatch = text.match(/全国居民消费价格同比\s*(上涨|下降|持平)\s*([\d.]+)?\s*%?/);
  const momMatch = text.match(/(?:\d{1,2}\s*月份，?)?全国居民消费价格环比\s*(上涨|下降|持平)\s*([\d.]+)?\s*%?/);
  if (!yearMonth || !yoyMatch || !momMatch) throw new Error('国家统计局 CPI 页面数据格式异常');

  const year = Number(yearMonth[1]);
  const month = Number(yearMonth[2]);
  const yoy = signedDirectionValue(yoyMatch[1], yoyMatch[2]);
  const mom = signedDirectionValue(momMatch[1], momMatch[2]);
  const updatedAt = cpiPeriodTime(year, month);
  const releasePathDate = sourceUrl.match(/t(20\d{6})_/i)?.[1];
  const releasedAt = releasePathDate
    ? `${releasePathDate.slice(0, 4)}-${releasePathDate.slice(4, 6)}-${releasePathDate.slice(6, 8)}`
    : undefined;
  return {
    id: 'china-cpi',
    label: '中国 CPI',
    value: yoy,
    display: `${yoy > 0 ? '+' : ''}${yoy.toFixed(1)}%`,
    change: mom,
    period: `${year}年${month}月`,
    releasedAt,
    updatedAt,
    source: '国家统计局',
    sourceUrl,
    status: 'delayed',
    history: [{ time: updatedAt, value: yoy }],
  };
}

type BlsObservation = { year: number; month: number; value: number; time: string };
type BlsSeriesPayload = { seriesID?: string; data?: Array<{ year?: string; period?: string; value?: string }> };
type BlsMacroSnapshot = {
  storedAt: number;
  series: Record<string, BlsObservation[]>;
};

const BLS_MACRO_SERIES_IDS = ['WPSFD4', 'CUSR0000SA0', 'CUUR0000SA0', 'LNS14000000', 'CES0000000001'] as const;
const BLS_MACRO_CACHE_TTL_MS = 30 * 60_000;
let blsMacroSnapshotCache: BlsMacroSnapshot | undefined;
let blsMacroSnapshotInFlight: Promise<BlsMacroSnapshot> | undefined;

function parseBlsObservations(series: BlsSeriesPayload) {
  return (series.data || []).flatMap((row) => {
    const month = row.period?.match(/^M(0[1-9]|1[0-2])$/)?.[1];
    const year = Number(row.year);
    const value = asFiniteNumber(row.value);
    if (!month || !Number.isFinite(year) || value === undefined) return [];
    return [{ year, month: Number(month), value, time: cpiPeriodTime(year, Number(month)) }];
  }).sort((left, right) => left.time.localeCompare(right.time));
}

async function fetchBlsMacroSeriesBatch() {
  const currentYear = new Date().getUTCFullYear();
  const registrationKey = String(process.env.BLS_API_KEY || '').trim();
  const url = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';
  const body = JSON.stringify({
    seriesid: BLS_MACRO_SERIES_IDS,
    startyear: String(currentYear - 2),
    endyear: String(currentYear),
    ...(registrationKey ? { registrationkey: registrationKey } : {}),
  });
  let lastError: unknown;
  for (const route of ['direct', 'proxy'] as FetchRoute[]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), route === 'direct' ? 12_000 : 18_000);
    try {
      const init: RequestInit & { dispatcher?: any } = {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'User-Agent': 'SparkFlow/1.0 official macro release monitor',
          Accept: 'application/json,text/plain,*/*',
          'Content-Type': 'application/json',
        },
        body,
      };
      if (route === 'proxy') init.dispatcher = foreignProxyAgent;
      const response = await fetch(url, init);
      if (!response.ok) throw new Error(`BLS API HTTP ${response.status}`);
      const payload = await response.json() as {
        status?: string;
        message?: string[];
        Results?: { series?: BlsSeriesPayload[] };
      };
      if (payload.status !== 'REQUEST_SUCCEEDED' || !Array.isArray(payload.Results?.series)) {
        throw new Error(payload.message?.join('；') || 'BLS API 返回格式异常');
      }
      const series = Object.fromEntries(payload.Results.series.map((item) => [item.seriesID || '', parseBlsObservations(item)]));
      if (BLS_MACRO_SERIES_IDS.some((seriesId) => !series[seriesId]?.length)) throw new Error('BLS 官方宏观序列不完整');
      return { storedAt: Date.now(), series } satisfies BlsMacroSnapshot;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('BLS 官方宏观数据暂时不可用');
}

async function getBlsMacroSnapshot(forceRefresh = false) {
  if (!forceRefresh && blsMacroSnapshotCache && Date.now() - blsMacroSnapshotCache.storedAt < BLS_MACRO_CACHE_TTL_MS) {
    return blsMacroSnapshotCache;
  }
  if (blsMacroSnapshotInFlight) return blsMacroSnapshotInFlight;
  blsMacroSnapshotInFlight = fetchBlsMacroSeriesBatch()
    .then((snapshot) => {
      blsMacroSnapshotCache = snapshot;
      return snapshot;
    })
    .catch((error) => {
      if (blsMacroSnapshotCache) return blsMacroSnapshotCache;
      throw error;
    })
    .finally(() => {
      blsMacroSnapshotInFlight = undefined;
    });
  return blsMacroSnapshotInFlight;
}

type BlsReleaseReportSnapshot = {
  family: 'ppi' | 'cpi' | 'employment';
  period: string;
  sourceUrl: string;
  ppi?: number;
  ppiPrevious?: number;
  ppiYoy?: number;
  ppiPreviousYoy?: number;
  cpi?: number;
  cpiYoy?: number;
  unemployment?: number;
  unemploymentPrevious?: number;
  nonfarm?: number;
  nonfarmPrevious?: number;
  storedAt: number;
};
const blsReleaseReportCache = new Map<BlsReleaseReportSnapshot['family'], BlsReleaseReportSnapshot>();
const blsReleaseReportInFlight = new Map<BlsReleaseReportSnapshot['family'], Promise<BlsReleaseReportSnapshot>>();

type PpiMarketContext = {
  period: string;
  actual: number;
  previous: number;
  consensus: number;
  sourceUrl: string;
  storedAt: number;
};
let ppiMarketContextCache: PpiMarketContext | undefined;
let ppiMarketContextInFlight: Promise<PpiMarketContext> | undefined;

type NonfarmMarketContext = {
  period: string;
  actual: number;
  previous: number;
  consensus: number;
  sourceUrl: string;
  storedAt: number;
};
let nonfarmMarketContextCache: NonfarmMarketContext | undefined;
let nonfarmMarketContextInFlight: Promise<NonfarmMarketContext> | undefined;
let cpiMarketContextCache: NonfarmMarketContext | undefined;
let cpiMarketContextInFlight: Promise<NonfarmMarketContext> | undefined;
let unemploymentMarketContextCache: NonfarmMarketContext | undefined;
let unemploymentMarketContextInFlight: Promise<NonfarmMarketContext> | undefined;

function parsePercentCell(value: string) {
  const normalized = stripTags(value).replace(/&nbsp;|&#160;|%/gi, '').trim();
  return normalized ? asFiniteNumber(normalized) : undefined;
}

function parseThousandsCell(value: string) {
  const normalized = stripTags(value).replace(/&nbsp;|&#160;|,/gi, '').replace(/K\b/i, '').trim();
  return normalized ? asFiniteNumber(normalized) : undefined;
}

function fetchDirectHtml(url: string, timeoutMs = 8_000, redirects = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = httpsGet(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,*/*',
      },
    }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects < 3) {
        response.resume();
        const redirectedUrl = new URL(response.headers.location, url).toString();
        void fetchDirectHtml(redirectedUrl, timeoutMs, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode || 0}`));
        return;
      }
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      response.on('error', reject);
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('PPI 市场预期请求超时')));
    request.on('error', reject);
  });
}

async function fetchPpiMarketContext(): Promise<PpiMarketContext> {
  const sourceUrl = 'https://tradingeconomics.com/united-states/producer-prices-change';
  const html = await fetchDirectHtml(sourceUrl).catch(() => fetchFastMarketText(sourceUrl, 12_000));
  const rows = [...html.matchAll(/<tr[^>]*data-category=["']Producer Prices Change["'][^>]*>([\s\S]*?)<\/tr>/gi)];
  const released = rows.flatMap((rowMatch) => {
    const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
    const actual = parsePercentCell(cells[4] || '');
    const previous = parsePercentCell(cells[5] || '');
    const consensus = parsePercentCell(cells[6] || '');
    const date = stripTags(cells[0] || '').trim();
    if (!date || actual === undefined || previous === undefined || consensus === undefined) return [];
    return [{ date, actual, previous, consensus }];
  }).sort((left, right) => right.date.localeCompare(left.date));
  const latest = released[0];
  if (!latest) throw new Error('PPI 市场一致预期暂不可用');
  const releaseDate = new Date(`${latest.date}T00:00:00Z`);
  releaseDate.setUTCMonth(releaseDate.getUTCMonth() - 1);
  return {
    period: releaseDate.toISOString().slice(0, 7),
    actual: latest.actual,
    previous: latest.previous,
    consensus: latest.consensus,
    sourceUrl,
    storedAt: Date.now(),
  };
}

async function getPpiMarketContext(forceRefresh = false) {
  if (!forceRefresh && ppiMarketContextCache && Date.now() - ppiMarketContextCache.storedAt < BLS_MACRO_CACHE_TTL_MS) {
    return ppiMarketContextCache;
  }
  if (ppiMarketContextInFlight) return ppiMarketContextInFlight;
  ppiMarketContextInFlight = fetchPpiMarketContext()
    .then((context) => {
      ppiMarketContextCache = context;
      return context;
    })
    .catch((error) => {
      if (ppiMarketContextCache) return ppiMarketContextCache;
      throw error;
    })
    .finally(() => {
      ppiMarketContextInFlight = undefined;
    });
  return ppiMarketContextInFlight;
}

async function fetchNonfarmMarketContext(): Promise<NonfarmMarketContext> {
  const sourceUrl = 'https://tradingeconomics.com/united-states/non-farm-payrolls';
  const html = await fetchDirectHtml(sourceUrl).catch(() => fetchFastMarketText(sourceUrl, 12_000));
  const rows = [...html.matchAll(/<tr[^>]*data-category=["'][^"']*(?:Non Farm Payrolls|Nonfarm Payrolls)[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi)];
  const released = rows.flatMap((rowMatch) => {
    const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
    const actual = parseThousandsCell(cells[4] || '');
    const previous = parseThousandsCell(cells[5] || '');
    const consensus = parseThousandsCell(cells[6] || '');
    const date = stripTags(cells[0] || '').trim();
    if (!date || actual === undefined || previous === undefined || consensus === undefined) return [];
    return [{ date, actual, previous, consensus }];
  }).sort((left, right) => right.date.localeCompare(left.date));
  const latest = released[0];
  if (!latest) throw new Error('非农市场一致预期暂不可用');
  const releaseDate = new Date(`${latest.date}T00:00:00Z`);
  releaseDate.setUTCMonth(releaseDate.getUTCMonth() - 1);
  return {
    period: releaseDate.toISOString().slice(0, 7),
    actual: latest.actual,
    previous: latest.previous,
    consensus: latest.consensus,
    sourceUrl,
    storedAt: Date.now(),
  };
}

async function getNonfarmMarketContext(forceRefresh = false) {
  if (!forceRefresh && nonfarmMarketContextCache && Date.now() - nonfarmMarketContextCache.storedAt < BLS_MACRO_CACHE_TTL_MS) {
    return nonfarmMarketContextCache;
  }
  if (nonfarmMarketContextInFlight) return nonfarmMarketContextInFlight;
  nonfarmMarketContextInFlight = fetchNonfarmMarketContext()
    .then((context) => {
      nonfarmMarketContextCache = context;
      return context;
    })
    .catch((error) => {
      if (nonfarmMarketContextCache) return nonfarmMarketContextCache;
      throw error;
    })
    .finally(() => {
      nonfarmMarketContextInFlight = undefined;
    });
  return nonfarmMarketContextInFlight;
}

async function fetchCpiMarketContext(): Promise<NonfarmMarketContext> {
  const sourceUrl = 'https://tradingeconomics.com/united-states/inflation-cpi';
  const html = await fetchDirectHtml(sourceUrl).catch(() => fetchFastMarketText(sourceUrl, 12_000));
  const rows = [...html.matchAll(/<tr[^>]*data-category=["']Inflation Rate["'][^>]*>([\s\S]*?)<\/tr>/gi)]
    .filter((rowMatch) => /Inflation Rate YoY/i.test(rowMatch[1]));
  const htmlReleased = rows.flatMap((rowMatch) => {
    const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
    const actual = parsePercentCell(cells[4] || '');
    const previous = parsePercentCell(cells[5] || '');
    const consensus = parsePercentCell(cells[6] || '');
    const date = stripTags(cells[0] || '').trim();
    if (!date || actual === undefined || previous === undefined || consensus === undefined) return [];
    return [{ date, actual, previous, consensus }];
  });
  const markdownReleased = [...html.matchAll(/(\d{4}-\d{2}-\d{2})\s*\|\s*[^|\r\n]*\|\s*\|\s*[A-Za-z]{3}\s*\|\s*([-+]?\d+(?:\.\d+)?)%\s*\|\s*([-+]?\d+(?:\.\d+)?)%\s*\|\s*([-+]?\d+(?:\.\d+)?)%/g)]
    .map((match) => ({
      date: match[1],
      actual: Number(match[2]),
      previous: Number(match[3]),
      consensus: Number(match[4]),
    }));
  const released = [...htmlReleased, ...markdownReleased]
    .sort((left, right) => right.date.localeCompare(left.date));
  const latest = released[0];
  if (!latest) throw new Error('CPI 市场一致预期暂不可用');
  const releaseDate = new Date(`${latest.date}T00:00:00Z`);
  releaseDate.setUTCMonth(releaseDate.getUTCMonth() - 1);
  return {
    period: releaseDate.toISOString().slice(0, 7),
    actual: latest.actual,
    previous: latest.previous,
    consensus: latest.consensus,
    sourceUrl,
    storedAt: Date.now(),
  };
}

async function getCpiMarketContext(forceRefresh = false) {
  if (!forceRefresh && cpiMarketContextCache && Date.now() - cpiMarketContextCache.storedAt < BLS_MACRO_CACHE_TTL_MS) {
    return cpiMarketContextCache;
  }
  if (cpiMarketContextInFlight) return cpiMarketContextInFlight;
  cpiMarketContextInFlight = fetchCpiMarketContext()
    .then((context) => {
      cpiMarketContextCache = context;
      return context;
    })
    .catch((error) => {
      if (cpiMarketContextCache) return cpiMarketContextCache;
      throw error;
    })
    .finally(() => {
      cpiMarketContextInFlight = undefined;
    });
  return cpiMarketContextInFlight;
}

async function fetchUnemploymentMarketContext(): Promise<NonfarmMarketContext> {
  const sourceUrl = 'https://tradingeconomics.com/united-states/unemployment-rate';
  const html = await fetchDirectHtml(sourceUrl).catch(() => fetchFastMarketText(sourceUrl, 12_000));
  const rows = [...html.matchAll(/<tr[^>]*data-category=["']Unemployment Rate["'][^>]*>([\s\S]*?)<\/tr>/gi)]
    .filter((rowMatch) => /Unemployment Rate/i.test(rowMatch[1]));
  const htmlReleased = rows.flatMap((rowMatch) => {
    const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
    const actual = parsePercentCell(cells[4] || '');
    const previous = parsePercentCell(cells[5] || '');
    const consensus = parsePercentCell(cells[6] || '');
    const date = stripTags(cells[0] || '').trim();
    if (!date || actual === undefined || previous === undefined || consensus === undefined) return [];
    return [{ date, actual, previous, consensus }];
  });
  const markdownReleased = [...html.matchAll(/(\d{4}-\d{2}-\d{2})\s*\|\s*[^|\r\n]*\|\s*\|\s*[A-Za-z]{3}\s*\|\s*([-+]?\d+(?:\.\d+)?)%\s*\|\s*([-+]?\d+(?:\.\d+)?)%\s*\|\s*([-+]?\d+(?:\.\d+)?)%/g)]
    .map((match) => ({
      date: match[1],
      actual: Number(match[2]),
      previous: Number(match[3]),
      consensus: Number(match[4]),
    }));
  const latest = [...htmlReleased, ...markdownReleased]
    .sort((left, right) => right.date.localeCompare(left.date))[0];
  if (!latest) throw new Error('失业率市场一致预期暂不可用');
  const releaseDate = new Date(`${latest.date}T00:00:00Z`);
  releaseDate.setUTCMonth(releaseDate.getUTCMonth() - 1);
  return {
    period: releaseDate.toISOString().slice(0, 7),
    actual: latest.actual,
    previous: latest.previous,
    consensus: latest.consensus,
    sourceUrl,
    storedAt: Date.now(),
  };
}

async function getUnemploymentMarketContext(forceRefresh = false) {
  if (!forceRefresh && unemploymentMarketContextCache && Date.now() - unemploymentMarketContextCache.storedAt < BLS_MACRO_CACHE_TTL_MS) {
    return unemploymentMarketContextCache;
  }
  if (unemploymentMarketContextInFlight) return unemploymentMarketContextInFlight;
  unemploymentMarketContextInFlight = fetchUnemploymentMarketContext()
    .then((context) => {
      unemploymentMarketContextCache = context;
      return context;
    })
    .catch((error) => {
      if (unemploymentMarketContextCache) return unemploymentMarketContextCache;
      throw error;
    })
    .finally(() => {
      unemploymentMarketContextInFlight = undefined;
    });
  return unemploymentMarketContextInFlight;
}

function signedReleaseValue(direction: string, magnitude?: string) {
  const value = asFiniteNumber(magnitude) || 0;
  return /(decreased|declined|fell|falling|edged down)/i.test(direction) ? -value : value;
}

function parseBlsPpiPreviousYoy(raw: string, period: string) {
  const [year, month] = period.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return undefined;
  const previousMonth = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 2, 1)));
  const tableA = raw.match(/Table A\.[\s\S]*?(?:Intermediate Demand by Commodity Type|Table B\.)/i)?.[0] || raw;
  const htmlRows = [...tableA.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => stripTags(match[1]));
  const markdownRows = tableA.split(/\r?\n/).filter((line) => line.trim().startsWith('|'));
  const previousRow = [...htmlRows, ...markdownRows].find((row) => (
    new RegExp(`(?:^|\\|\\s*)${previousMonth}(?:\\b|\\()`, 'i').test(row)
  ));
  if (!previousRow) return undefined;
  const values = previousRow.match(/[-+]?\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || [];
  return values.length >= 2 ? values.at(-2) : undefined;
}

function findBlsTableRow(raw: string, tableStart: string, tableEnd: string, rowLabel: RegExp) {
  const section = raw.match(new RegExp(`${tableStart}[\\s\\S]*?${tableEnd}`, 'i'))?.[0] || raw;
  const htmlRows = [...section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((rowMatch) => (
    [...rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => stripTags(cell[1]).trim())
  ));
  const markdownRows = section.split(/\r?\n/)
    .filter((line) => line.trim().startsWith('|'))
    .map((line) => line.split('|').slice(1, -1).map((cell) => stripTags(cell).trim()));
  return [...htmlRows, ...markdownRows]
    .filter((cells) => rowLabel.test(cells[0] || ''))
    .sort((left, right) => right.length - left.length)[0];
}

function parseBlsEmploymentPrevious(raw: string) {
  const unemploymentRow = findBlsTableRow(raw, 'Table A-1\\.', 'Table A-2\\.', /^Unemployment rate$/i);
  const unemploymentValues = (unemploymentRow || []).slice(1).flatMap((cell) => {
    const value = asFiniteNumber(cell.replace(/,/g, '').match(/[-+]?\d+(?:\.\d+)?/)?.[0]);
    return value === undefined ? [] : [value];
  });

  const nonfarmRow = findBlsTableRow(raw, 'Table B-1\\.', 'Table B-2\\.', /^Total nonfarm$/i);
  const nonfarmValues = (nonfarmRow || []).slice(1).flatMap((cell) => {
    const value = asFiniteNumber(cell.replace(/,/g, '').match(/[-+]?\d+(?:\.\d+)?/)?.[0]);
    return value === undefined ? [] : [value];
  });
  const previousNonfarm = nonfarmValues.length >= 4
    ? nonfarmValues[nonfarmValues.length - 3] - nonfarmValues[nonfarmValues.length - 4]
    : undefined;

  return {
    unemploymentPrevious: unemploymentValues.length >= 2 ? unemploymentValues[unemploymentValues.length - 2] : undefined,
    nonfarmPrevious: previousNonfarm,
  };
}

async function fetchBlsReleaseReport(family: BlsReleaseReportSnapshot['family']): Promise<BlsReleaseReportSnapshot> {
  const sourceUrl = family === 'ppi'
    ? 'https://www.bls.gov/news.release/ppi.nr0.htm'
    : family === 'cpi'
      ? 'https://www.bls.gov/news.release/cpi.nr0.htm'
      : 'https://www.bls.gov/news.release/empsit.htm';
  let html: string;
  try {
    html = await fetchRoutedText(sourceUrl, 'direct', 1500, 'text/html,application/xhtml+xml,*/*');
  } catch {
    html = await fetchRoutedText(
      `https://r.jina.ai/http://www.bls.gov${new URL(sourceUrl).pathname}`,
      'proxy',
      8_000,
      'text/plain,text/markdown,*/*',
    );
  }
  const titlePeriod = html.match(/<title>[\s\S]*?-\s*(20\d{2})\s+M(0[1-9]|1[0-2])\s+Results/i);
  const text = stripTags(html).replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ');
  const headingPeriod = text.match(/(?:PRODUCER PRICE INDEXES|CONSUMER PRICE INDEX|EMPLOYMENT SITUATION)\s*[-—]\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})/i);
  if (!titlePeriod && !headingPeriod) throw new Error('BLS 新闻稿统计期无法识别');
  const period = titlePeriod
    ? `${titlePeriod[1]}-${titlePeriod[2]}`
    : `${headingPeriod![2]}-${String(monthNameToNumber(headingPeriod![1])).padStart(2, '0')}`;
  const base = { family, period, sourceUrl, storedAt: Date.now() };
  if (family === 'ppi') {
    const unchanged = /Producer Price Index for final demand was unchanged in [A-Za-z]+/i.test(text);
    const match = text.match(/Producer Price Index for final demand (increased|rose|advanced|decreased|declined|fell)(?:\s+(?:by\s+)?)?([\d.]+)\s*percent?\s+in\s+[A-Za-z]+/i);
    if (!unchanged && !match) throw new Error('BLS PPI 新闻稿数值无法识别');
    const previousMatch = text.match(/Final demand prices (edged down|decreased|declined|fell|rose|advanced|increased)\s+([\d.]+)\s*percent\s+in\s+[A-Za-z]+/i);
    const yoyMatch = text.match(/index for final demand (increased|rose|advanced|decreased|declined|fell)\s+([\d.]+)\s*percent\s+for the 12 months ended/i);
    if (!previousMatch || !yoyMatch) throw new Error('BLS PPI 前值或同比值无法识别');
    return {
      ...base,
      ppi: unchanged ? 0 : signedReleaseValue(match![1], match![2]),
      ppiPrevious: signedReleaseValue(previousMatch[1], previousMatch[2]),
      ppiYoy: signedReleaseValue(yoyMatch[1], yoyMatch[2]),
      ppiPreviousYoy: parseBlsPpiPreviousYoy(html, period),
    } satisfies BlsReleaseReportSnapshot;
  }
  if (family === 'cpi') {
    const unchanged = /Consumer Price Index for All Urban Consumers[^.]{0,100}?was unchanged/i.test(text);
    const match = text.match(/Consumer Price Index for All Urban Consumers[^.]{0,100}?(increased|rose|advanced|decreased|declined|fell)(?:\s+(?:by\s+)?)?([\d.]+)\s*percent?/i);
    if (!unchanged && !match) throw new Error('BLS CPI 新闻稿数值无法识别');
    const yoyMatch = text.match(/Over the last 12 months, the all items index (increased|rose|decreased|declined|fell)\s+([\d.]+)\s*percent/i);
    if (!yoyMatch) throw new Error('BLS CPI 新闻稿同比数值无法识别');
    return {
      ...base,
      cpi: unchanged ? 0 : signedReleaseValue(match![1], match![2]),
      cpiYoy: signedReleaseValue(yoyMatch[1], yoyMatch[2]),
    } satisfies BlsReleaseReportSnapshot;
  }
  const unemploymentMatch = text.match(/unemployment rate(?:,?\s+at|\s*\()\s*([\d.]+)\s*percent/i);
  const nonfarmMatch = text.match(/Total nonfarm payroll employment[\s\S]{0,120}?\(([-+]?\d[\d,]*)\)/i);
  const unemployment = asFiniteNumber(unemploymentMatch?.[1]);
  const nonfarmRaw = asFiniteNumber(nonfarmMatch?.[1]?.replace(/,/g, ''));
  if (unemployment === undefined || nonfarmRaw === undefined) throw new Error('BLS 就业新闻稿数值无法识别');
  const previous = parseBlsEmploymentPrevious(html);
  return {
    ...base,
    unemployment,
    unemploymentPrevious: previous.unemploymentPrevious,
    nonfarm: nonfarmRaw / 1000,
    nonfarmPrevious: previous.nonfarmPrevious,
  } satisfies BlsReleaseReportSnapshot;
}

async function getBlsReleaseReport(family: BlsReleaseReportSnapshot['family'], forceRefresh = false): Promise<BlsReleaseReportSnapshot> {
  const cached = blsReleaseReportCache.get(family);
  const cachedEmploymentIncomplete = family === 'employment'
    && cached
    && (cached.unemploymentPrevious === undefined || cached.nonfarmPrevious === undefined);
  if (!forceRefresh && !cachedEmploymentIncomplete && cached && Date.now() - cached.storedAt < BLS_MACRO_CACHE_TTL_MS) return cached;
  const running = blsReleaseReportInFlight.get(family);
  if (running) return running;
  const request = fetchBlsReleaseReport(family)
    .then((snapshot) => {
      blsReleaseReportCache.set(family, snapshot);
      return snapshot;
    })
    .catch((error) => {
      if (cached) return cached;
      throw error;
    })
    .finally(() => blsReleaseReportInFlight.delete(family));
  blsReleaseReportInFlight.set(family, request);
  return request;
}

async function getBlsReleaseMacroMetric(
  id: 'ppi' | 'cpi' | 'unemployment' | 'nonfarm',
  forceRefresh = false,
  waitForExpectation = false,
) {
  const family = id === 'ppi' ? 'ppi' : id === 'cpi' ? 'cpi' : 'employment';
  const report = await getBlsReleaseReport(family, forceRefresh);
  const ppiMarketContext = id === 'ppi'
    ? await (waitForExpectation
      ? getPpiMarketContext(forceRefresh)
      : Promise.race([
        getPpiMarketContext(forceRefresh),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 3_000)),
      ])).catch(() => undefined)
    : undefined;
  const nonfarmMarketContext = id === 'nonfarm'
    ? await Promise.race([
      getNonfarmMarketContext(forceRefresh),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 3_000)),
    ]).catch(() => undefined)
    : undefined;
  const unemploymentMarketContext = id === 'unemployment'
    ? await Promise.race([
      getUnemploymentMarketContext(forceRefresh),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 3_000)),
    ]).catch(() => undefined)
    : undefined;
  const validPpiMarketContext = id === 'ppi'
    && ppiMarketContext?.period === report.period
    && report.ppiYoy !== undefined
    && Math.abs(ppiMarketContext.actual - report.ppiYoy) < 0.051
      ? ppiMarketContext
      : undefined;
  const validNonfarmMarketContext = id === 'nonfarm'
    && nonfarmMarketContext?.period === report.period
    && report.nonfarm !== undefined
    && Math.abs(nonfarmMarketContext.actual - report.nonfarm) < 0.51
      ? nonfarmMarketContext
      : undefined;
  const validUnemploymentMarketContext = id === 'unemployment'
    && unemploymentMarketContext?.period === report.period
    && report.unemployment !== undefined
    && Math.abs(unemploymentMarketContext.actual - report.unemployment) < 0.051
      ? unemploymentMarketContext
      : undefined;
  const metricId = id === 'cpi' ? 'us-cpi-mom' : id;
  const labels = { ppi: '美国 PPI 月率', cpi: '美国 CPI 月率', unemployment: '美国失业率', nonfarm: '非农就业变动' };
  const existing = globalMacroMetricLastGood.get(id === 'cpi' ? 'cpi-pce' : id);
  const baseHistory: Array<{ time: string; value: number }> = Array.isArray(existing?.history) ? existing.history : [];
  const base = {
    id: metricId,
    label: labels[id],
    history: baseHistory,
  };
  const value = id === 'ppi'
    ? report.ppi
    : id === 'cpi'
      ? report.cpi
      : id === 'unemployment'
        ? report.unemployment
        : report.nonfarm;
  if (value === undefined) throw new Error('BLS 新闻稿缺少目标指标');
  const updatedAt = `${report.period}-01T00:00:00.000Z`;
  const previousValue = id === 'unemployment'
    ? report.unemploymentPrevious
    : id === 'nonfarm'
      ? report.nonfarmPrevious
      : undefined;
  const previousDate = new Date(updatedAt);
  previousDate.setUTCMonth(previousDate.getUTCMonth() - 1);
  const previousPeriod = previousDate.toISOString().slice(0, 7);
  const releaseHistory = previousValue === undefined
    ? [{ time: updatedAt, value }]
    : [{ time: `${previousPeriod}-01T00:00:00.000Z`, value: previousValue }, { time: updatedAt, value }];
  const history = [
    ...base.history.filter((item) => item.time.slice(0, 7) !== report.period && item.time.slice(0, 7) !== previousPeriod),
    ...releaseHistory,
  ]
    .sort((left, right) => left.time.localeCompare(right.time))
    .slice(-48);
  const previous = previousValue === undefined ? history.at(-2) : { value: previousValue };
  const change = previous ? value - previous.value : null;
  return {
    ...base,
    value,
    display: id === 'unemployment'
      ? `${value.toFixed(1)}%`
      : id === 'nonfarm'
        ? `${value > 0 ? '+' : ''}${Math.round(value)}K`
        : `${value.toFixed(2)}%`,
    change,
    changeDisplay: change === null
      ? undefined
      : id === 'nonfarm'
        ? `${change > 0 ? '+' : ''}${Math.round(change)}K`
        : signedMetricChange(change, 'pct'),
    updatedAt,
    sourceUrl: report.sourceUrl,
    source: '美国劳工统计局',
    status: 'delayed' as const,
    history,
    ...(id === 'ppi' ? {
      stats: [
        { label: '环比', display: `${report.ppi! > 0 ? '+' : ''}${report.ppi!.toFixed(1)}%` },
        { label: '同比值', display: `${report.ppiYoy! > 0 ? '+' : ''}${report.ppiYoy!.toFixed(1)}%` },
        { label: '市场预期', display: validPpiMarketContext?.consensus === undefined ? '待更新' : `${validPpiMarketContext.consensus > 0 ? '+' : ''}${validPpiMarketContext.consensus.toFixed(1)}%` },
        { label: '前值', display: report.ppiPreviousYoy === undefined
          ? (validPpiMarketContext?.previous === undefined ? '待更新' : `${validPpiMarketContext.previous > 0 ? '+' : ''}${validPpiMarketContext.previous.toFixed(1)}%`)
          : `${report.ppiPreviousYoy > 0 ? '+' : ''}${report.ppiPreviousYoy.toFixed(1)}%` },
      ],
    } : id === 'nonfarm' ? {
      stats: [
        { label: '实际', display: `${value > 0 ? '+' : ''}${Math.round(value)}K` },
        { label: '预期', display: validNonfarmMarketContext?.consensus === undefined
          ? '待更新'
          : `${validNonfarmMarketContext.consensus > 0 ? '+' : ''}${Math.round(validNonfarmMarketContext.consensus)}K` },
        { label: '前值', display: previousValue === undefined
          ? (validNonfarmMarketContext?.previous === undefined
            ? '待更新'
            : `${validNonfarmMarketContext.previous > 0 ? '+' : ''}${Math.round(validNonfarmMarketContext.previous)}K`)
          : `${previousValue > 0 ? '+' : ''}${Math.round(previousValue)}K` },
      ],
    } : id === 'unemployment' ? {
      stats: [
        { label: '实际', display: `${value.toFixed(1)}%` },
        { label: '预期', display: validUnemploymentMarketContext?.consensus === undefined
          ? '待更新'
          : `${validUnemploymentMarketContext.consensus.toFixed(1)}%` },
        { label: '前值', display: previousValue === undefined
          ? (validUnemploymentMarketContext?.previous === undefined
            ? '待更新'
            : `${validUnemploymentMarketContext.previous.toFixed(1)}%`)
          : `${previousValue.toFixed(1)}%` },
      ],
    } : {}),
  };
}

function buildBlsOfficialMetric(
  id: 'ppi' | 'cpi' | 'unemployment' | 'nonfarm',
  observations: BlsObservation[],
) {
  const sourceUrls = {
    ppi: 'https://www.bls.gov/ppi/',
    cpi: 'https://www.bls.gov/cpi/',
    unemployment: 'https://www.bls.gov/news.release/empsit.toc.htm',
    nonfarm: 'https://www.bls.gov/news.release/empsit.toc.htm',
  };
  const labels = {
    ppi: '美国 PPI 月率',
    cpi: '美国 CPI 月率',
    unemployment: '美国失业率',
    nonfarm: '非农就业变动',
  };
  const transformed = id === 'ppi' || id === 'cpi'
    ? monthlyPercentChanges(observations)
    : id === 'nonfarm'
      ? observations.slice(1).map((item, index) => ({ time: item.time, value: item.value - observations[index].value }))
      : observations.map(({ time, value }) => ({ time, value }));
  const latest = transformed.at(-1);
  const previous = transformed.at(-2);
  if (!latest) throw new Error(`${labels[id]} 官方序列缺少有效观测值`);
  const display = id === 'unemployment'
    ? `${latest.value.toFixed(1)}%`
    : id === 'nonfarm'
      ? `${Math.round(latest.value)} 千人`
      : `${latest.value.toFixed(2)}%`;
  const change = previous ? latest.value - previous.value : null;
  return {
    id: id === 'cpi' ? 'us-cpi-mom' : id,
    label: labels[id],
    value: latest.value,
    display,
    change,
    changeDisplay: change === null
      ? undefined
      : id === 'nonfarm'
        ? `${change > 0 ? '+' : ''}${Math.round(change)} 千人`
        : signedMetricChange(change, 'pct'),
    updatedAt: latest.time,
    sourceUrl: sourceUrls[id],
    source: '美国劳工统计局',
    status: 'delayed' as const,
    history: transformed.slice(-48),
  };
}

async function getBlsOfficialMacroMetricFromApi(id: 'ppi' | 'cpi' | 'unemployment' | 'nonfarm', forceRefresh = false) {
  const snapshot = await getBlsMacroSnapshot(forceRefresh);
  const seriesId = id === 'ppi'
    ? 'WPSFD4'
    : id === 'cpi'
      ? 'CUSR0000SA0'
      : id === 'unemployment'
        ? 'LNS14000000'
        : 'CES0000000001';
  return buildBlsOfficialMetric(id, snapshot.series[seriesId]);
}

async function getBlsOfficialMacroMetric(id: 'ppi' | 'cpi' | 'unemployment' | 'nonfarm', forceRefresh = false) {
  const releaseMetric = await getBlsReleaseMacroMetric(id, forceRefresh);
  if (!['unemployment', 'nonfarm'].includes(id)) return releaseMetric;
  const currentPeriod = releaseMetric.updatedAt?.slice(0, 7) || '';
  const previousDate = new Date(`${currentPeriod}-01T00:00:00.000Z`);
  previousDate.setUTCMonth(previousDate.getUTCMonth() - 1);
  const previousPeriod = previousDate.toISOString().slice(0, 7);
  if (releaseMetric.history.some((item) => item.time.slice(0, 7) === previousPeriod)) return releaseMetric;
  try {
    // Keep the current headline value on the BLS release and use the BLS API only to fill its prior observation.
    const apiMetric = await getBlsOfficialMacroMetricFromApi(id, forceRefresh);
    const previous = [...apiMetric.history]
      .reverse()
      .find((item) => item.time.slice(0, 7) < currentPeriod);
    if (!previous || releaseMetric.value === null || releaseMetric.value === undefined) return releaseMetric;
    const change = releaseMetric.value - previous.value;
    const currentPoint = { time: releaseMetric.updatedAt || `${currentPeriod}-01T00:00:00.000Z`, value: releaseMetric.value };
    const history = [
      ...apiMetric.history.filter((item) => item.time.slice(0, 7) < currentPeriod),
      currentPoint,
    ].slice(-48);
    return {
      ...releaseMetric,
      history,
      change,
      changeDisplay: id === 'nonfarm'
        ? `${change > 0 ? '+' : ''}${Math.round(change)}K`
        : signedMetricChange(change, 'pct'),
      ...(id === 'nonfarm' ? {
        stats: (releaseMetric.stats || []).map((stat) => stat.label === '前值'
          ? { ...stat, display: `${previous.value > 0 ? '+' : ''}${Math.round(previous.value)}K` }
          : stat),
      } : {}),
    };
  } catch {
    return releaseMetric;
  }
}

type BeaPceSnapshot = Awaited<ReturnType<typeof fetchBeaPceMacroMetric>> & { storedAt: number };
let beaPceSnapshotCache: BeaPceSnapshot | undefined;
let beaPceSnapshotInFlight: Promise<BeaPceSnapshot> | undefined;

function monthNameToNumber(monthName: string) {
  return ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
    .indexOf(monthName.toLowerCase()) + 1;
}

async function fetchBeaPceMacroMetric() {
  const landingUrl = 'https://www.bea.gov/data/personal-consumption-expenditures-price-index';
  const landingHtml = await fetchExternalText(landingUrl, 16000, 'text/html,application/xhtml+xml,*/*');
  const releaseHref = [...landingHtml.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ href: match[1], label: stripTags(match[2]) }))
    .find((item) => /Current Release/i.test(item.label))?.href;
  if (!releaseHref) throw new Error('BEA 当前 PCE 发布页未找到');
  const sourceUrl = new URL(releaseHref, landingUrl).toString();
  const releaseHtml = await fetchExternalText(sourceUrl, 16000, 'text/html,application/xhtml+xml,*/*');
  const text = stripTags(releaseHtml).replace(/\s+/g, ' ');
  const match = text.match(/From the preceding month, the PCE price index for ([A-Za-z]+) (increased|decreased|was unchanged)(?:\s+([\d.]+) percent)?/i);
  if (!match) throw new Error('BEA PCE 月率格式异常');
  const month = monthNameToNumber(match[1]);
  const year = asFiniteNumber(sourceUrl.match(/\/news\/(20\d{2})\//)?.[1]) || new Date().getUTCFullYear();
  const magnitude = asFiniteNumber(match[3]) || 0;
  const value = /decreased/i.test(match[2]) ? -magnitude : /unchanged/i.test(match[2]) ? 0 : magnitude;
  const updatedAt = cpiPeriodTime(year, month);
  return {
    id: 'us-pce-mom',
    label: '美国 PCE 月率',
    value,
    display: `${value.toFixed(2)}%`,
    change: null,
    updatedAt,
    sourceUrl,
    source: '美国经济分析局',
    status: 'delayed' as const,
    history: [{ time: updatedAt, value }],
  };
}

async function getBeaPceMacroMetric(forceRefresh = false) {
  if (!forceRefresh && beaPceSnapshotCache && Date.now() - beaPceSnapshotCache.storedAt < BLS_MACRO_CACHE_TTL_MS) {
    return beaPceSnapshotCache;
  }
  if (beaPceSnapshotInFlight) return beaPceSnapshotInFlight;
  beaPceSnapshotInFlight = fetchBeaPceMacroMetric()
    .then((metric) => {
      const snapshot = { ...metric, storedAt: Date.now() };
      beaPceSnapshotCache = snapshot;
      return snapshot;
    })
    .catch((error) => {
      if (beaPceSnapshotCache) return beaPceSnapshotCache;
      throw error;
    })
    .finally(() => {
      beaPceSnapshotInFlight = undefined;
    });
  return beaPceSnapshotInFlight;
}

async function getUsCpiMetricFromBlsReport(forceRefresh = false): Promise<GlobalCpiMetric> {
  const report = await getBlsReleaseReport('cpi', forceRefresh);
  if (report.cpi === undefined || report.cpiYoy === undefined) throw new Error('BLS CPI 新闻稿数据不完整');
  const [year, month] = report.period.split('-').map(Number);
  const updatedAt = cpiPeriodTime(year, month);
  const existing = globalCpiMetricLastGood.get('us-cpi');
  const marketContext = await Promise.race([
    getCpiMarketContext(forceRefresh),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 3_000)),
  ]).catch(() => undefined);
  const expectation = marketContext?.period === report.period
    && Math.abs(marketContext.actual - report.cpiYoy) < 0.051
      ? marketContext.consensus
      : undefined;
  let officialHistory = existing?.history || [];
  try {
    // Only use the BLS API to hydrate prior observations. The current core YoY remains the BLS release value below.
    officialHistory = (await getUsCpiMetricFromBls(forceRefresh)).history;
  } catch {
    // The release value remains authoritative even when the BLS history API is temporarily unavailable.
  }
  const history = [...officialHistory.filter((item) => item.time.slice(0, 7) !== report.period), { time: updatedAt, value: report.cpiYoy }]
    .sort((left, right) => left.time.localeCompare(right.time))
    .slice(-48);
  return {
    id: 'us-cpi',
    label: '美国 CPI',
    value: report.cpiYoy,
    display: `${report.cpiYoy > 0 ? '+' : ''}${report.cpiYoy.toFixed(1)}%`,
    change: report.cpi,
    expectation,
    period: `${year}年${month}月`,
    updatedAt,
    source: '美国劳工统计局',
    sourceUrl: report.sourceUrl,
    status: 'delayed',
    history,
  };
}

async function getUsCpiMetricFromBls(forceRefresh = false): Promise<GlobalCpiMetric> {
  const snapshot = await getBlsMacroSnapshot(forceRefresh);
  const unadjusted = snapshot.series.CUUR0000SA0;
  const adjusted = snapshot.series.CUSR0000SA0;
  const latest = unadjusted.at(-1);
  if (!latest) throw new Error('BLS 最新 CPI 数据缺失');
  const yearAgo = unadjusted.find((item) => item.year === latest.year - 1 && item.month === latest.month);
  const adjustedLatest = adjusted.find((item) => item.year === latest.year && item.month === latest.month);
  const adjustedLatestIndex = adjusted.findIndex((item) => item.time === adjustedLatest?.time);
  const adjustedPrevious = adjustedLatestIndex > 0 ? adjusted[adjustedLatestIndex - 1] : undefined;
  if (!yearAgo || !adjustedLatest || !adjustedPrevious || yearAgo.value <= 0 || adjustedPrevious.value <= 0) {
    throw new Error('BLS CPI 同比或环比基期数据缺失');
  }
  const yoy = (latest.value / yearAgo.value - 1) * 100;
  const mom = (adjustedLatest.value / adjustedPrevious.value - 1) * 100;
  const history = unadjusted.flatMap((item) => {
    const previousYear = unadjusted.find((candidate) => candidate.year === item.year - 1 && candidate.month === item.month);
    return previousYear && previousYear.value > 0
      ? [{ time: item.time, value: (item.value / previousYear.value - 1) * 100 }]
      : [];
  }).sort((left, right) => left.time.localeCompare(right.time));
  return {
    id: 'us-cpi',
    label: '美国 CPI',
    value: yoy,
    display: `${yoy > 0 ? '+' : ''}${yoy.toFixed(1)}%`,
    change: mom,
    period: `${latest.year}年${latest.month}月`,
    updatedAt: latest.time,
    source: '美国劳工统计局',
    sourceUrl: 'https://www.bls.gov/cpi/',
    status: 'delayed',
    history,
  };
}

async function getUsCpiMetricFromFred(): Promise<GlobalCpiMetric> {
  const [yoy, mom] = await Promise.all([
    getFredMacroMetric('us-cpi-yoy', ['CPIAUCSL'], '美国 CPI 同比', (value) => `${value.toFixed(1)}%`, yearlyPercentChanges),
    getFredMacroMetric('us-cpi-mom-card', ['CPIAUCSL'], '美国 CPI 环比', (value) => `${value.toFixed(1)}%`, monthlyPercentChanges),
  ]);
  const latestDate = new Date(yoy.updatedAt);
  return {
    id: 'us-cpi',
    label: '美国 CPI',
    value: yoy.value,
    display: `${yoy.value > 0 ? '+' : ''}${yoy.value.toFixed(1)}%`,
    change: mom.value,
    period: `${latestDate.getUTCFullYear()}年${latestDate.getUTCMonth() + 1}月`,
    updatedAt: yoy.updatedAt,
    source: '美国劳工统计局 · FRED',
    sourceUrl: 'https://fred.stlouisfed.org/series/CPIAUCSL',
    status: 'delayed',
    history: yoy.history,
  };
}

async function getUsCpiMetric(forceOfficial = false): Promise<GlobalCpiMetric> {
  if (forceOfficial) return getUsCpiMetricFromBlsReport(true);
  try {
    return await getUsCpiMetricFromBlsReport();
  } catch {
    return getUsCpiMetricFromBls();
  }
}

function pmiObservationTime(monthName: string) {
  const month = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
    .indexOf(monthName.toLowerCase());
  const now = new Date();
  if (month < 0) return now.toISOString();
  const year = month > now.getUTCMonth() ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  return new Date(Date.UTC(year, month, 1)).toISOString();
}

async function getGlobalPmiMetric(config: (typeof globalPmiConfigs)[number]) {
  const sourceUrl = `https://tradingeconomics.com/${config.slug}/manufacturing-pmi`;
  const html = await fetchExternalText(sourceUrl, 20000, 'text/html,application/xhtml+xml,*/*');
  const description = decodeXml(html.match(/<meta[^>]+id=["']metaDesc["'][^>]+content=["']([^"']+)["']/i)?.[1] || '');
  const changed = description.match(/(?:increased|decreased)\s+to\s+([\d.]+)\s+points\s+in\s+([A-Za-z]+).*?from\s+([\d.]+)\s+points/i);
  const unchanged = description.match(/remained\s+unchanged\s+at\s+([\d.]+)\s+points\s+in\s+([A-Za-z]+)/i);
  const currentValue = asFiniteNumber(changed?.[1] || unchanged?.[1]);
  const previousValue = asFiniteNumber(changed?.[3] || unchanged?.[1]);
  const monthName = changed?.[2] || unchanged?.[2];
  if (currentValue === undefined || previousValue === undefined || !monthName) {
    throw new Error(`${config.label} 页面数据格式异常`);
  }
  const updatedAt = pmiObservationTime(monthName);
  const previousDate = new Date(updatedAt);
  previousDate.setUTCMonth(previousDate.getUTCMonth() - 1);
  return {
    id: config.id,
    label: config.label,
    value: currentValue,
    display: currentValue.toFixed(2),
    change: currentValue - previousValue,
    updatedAt,
    sourceUrl,
    status: 'delayed' as const,
    history: [{ time: previousDate.toISOString(), value: previousValue }, { time: updatedAt, value: currentValue }],
  };
}

async function getEastmoneyMacroTickerCandidates(region: GlobalMacroRegion) {
  const search = new URLSearchParams({
    client: 'web',
    biz: 'web_724',
    fastColumn: '102',
    sortEnd: '',
    pageSize: '200',
    req_trace: String(Date.now()),
  });
  const url = `https://np-weblist.eastmoney.com/comm/web/getFastNewsList?${search.toString()}`;
  const payload = await fetchExternalJson(url, 16000) as { data?: { fastNewsList?: Array<Record<string, unknown>> } };
  const rows = payload.data?.fastNewsList;
  if (!Array.isArray(rows)) throw new Error('东方财富全球财经快讯数据为空');
  return rows.flatMap((row, index) => {
    const title = String(row.title || row.summary || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const shownAt = String(row.showTime || '').trim();
    const publishedAt = shownAt ? new Date(`${shownAt.replace(' ', 'T')}+08:00`).toISOString() : undefined;
    const code = String(row.code || '').trim();
    if (!title || !publishedAt) return [];
    return [{
      id: `eastmoney-${code || index}-${title}`,
      title,
      source: '东方财富',
      url: code ? `https://finance.eastmoney.com/a/${encodeURIComponent(code)}.html` : 'https://kuaixun.eastmoney.com/7_24.html',
      publishedAt,
      category: '快讯',
      region,
      sourceSignal: index < 25 ? 6 : index < 80 ? 3 : 0,
    }];
  });
}

async function getBaiduHotSearchMacroCandidates(region: GlobalMacroRegion) {
  const boardUrl = 'https://top.baidu.com/board?platform=pc&tab=realtime';
  const html = await fetchExternalText(boardUrl, 16000, 'text/html,application/xhtml+xml,*/*');
  const serialized = html.match(/<!--s-data:([\s\S]*?)-->/)?.[1];
  if (!serialized) throw new Error('百度热搜结构化榜单数据缺失');
  const payload = JSON.parse(serialized) as { data?: { cards?: Array<{ component?: string; content?: Array<Record<string, unknown>> }> } };
  const rows = payload.data?.cards?.find((card) => card.component === 'hotList')?.content;
  if (!Array.isArray(rows)) throw new Error('百度热搜榜单为空');
  const capturedAt = new Date().toISOString();
  const rankedRows = rows.filter((row) => !Boolean(row.isTop)).slice(0, 2);
  return rankedRows.flatMap((row, index) => {
    const title = String(row.word || row.query || '').trim();
    const description = String(row.desc || '').trim();
    const link = String(row.url || row.appUrl || row.rawUrl || boardUrl);
    const hotScore = Number(row.hotScore || 0);
    if (!title) return [];
    return [{
      id: `baidu-hot-${index}-${title}`,
      title,
      classificationText: `${title} ${description}`.trim(),
      source: '百度热搜',
      url: link,
      publishedAt: capturedAt,
      category: `热搜${index + 1}`,
      region,
      sourceSignal: 12,
      hotScore,
      forcedDisplay: true,
      baiduRank: index + 1,
      forcedOrder: index + 1,
    }];
  });
}

async function getSinaFocusTickerCandidates(region: GlobalMacroRegion) {
  const search = new URLSearchParams({
    page: '1',
    page_size: '20',
    zhibo_id: '152',
    tag_id: '9',
    dire: 'f',
    dpc: '1',
    pagesize: '20',
    type: '1',
  });
  const feedUrl = `https://zhibo.sina.com.cn/api/zhibo/feed?${search.toString()}`;
  const payload = await fetchExternalJson(feedUrl, 16000) as { result?: { data?: { feed?: { list?: Array<Record<string, unknown>> } } } };
  const rows = payload.result?.data?.feed?.list;
  if (!Array.isArray(rows)) throw new Error('新浪财经焦点快讯数据为空');
  const focusRows = rows.filter((row) => (
    Array.isArray(row.tag) && row.tag.some((tag) => {
      const value = tag as Record<string, unknown>;
      return String(value.id || '') === '9' || String(value.name || '') === '焦点';
    })
  )).slice(0, 3);
  return focusRows.flatMap((row, index) => {
    const content = stripTags(String(row.rich_text || ''));
    const title = content.match(/^【([^】]+)】/)?.[1]?.trim() || content.slice(0, 72).trim();
    const shownAt = String(row.create_time || '').trim();
    const publishedAt = shownAt ? new Date(`${shownAt.replace(' ', 'T')}+08:00`).toISOString() : undefined;
    const id = String(row.id || index);
    if (!title || !publishedAt) return [];
    return [{
      id: `sina-focus-${id}-${title}`,
      title,
      classificationText: content,
      source: '新浪财经',
      url: String(row.docurl || 'https://finance.sina.com.cn/7x24/'),
      publishedAt,
      category: `焦点${index + 1}`,
      region,
      sourceSignal: 12,
      forcedDisplay: true,
      sinaFocusRank: index + 1,
      forcedOrder: index + 3,
    }];
  });
}

async function getGlobalMacroTickerNews(region: GlobalMacroRegion) {
  const queries = globalNewsQueries[region];
  const domesticWorldSources = newsSources.filter((source) => source.id === 'chinanews-world');
  const [settled, domesticSettled, platformSettled] = await Promise.all([
    Promise.allSettled(queries.map(async ([category, query]) => {
      const url = googleNewsRssUrl(query);
      const xml = await fetchExternalText(url, 14000, 'application/rss+xml,application/xml,text/xml,*/*');
      return parseGoogleNewsItems(xml, `全球宏观·${category}`).slice(0, 18).map((item) => ({
        id: item.id,
        title: item.title.replace(/\s+-\s+[^-]{2,30}$/u, '').replace(/--国际\s*$/u, '').trim(),
        source: item.source,
        url: item.url,
        publishedAt: item.publishedAt,
        category,
        region,
      }));
    })),
    Promise.allSettled(domesticWorldSources.map(fetchNewsSource)),
    Promise.allSettled([
      getEastmoneyMacroTickerCandidates(region),
      getBaiduHotSearchMacroCandidates(region),
      getSinaFocusTickerCandidates(region),
    ]),
  ]);
  const domesticItems = domesticSettled
    .flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    .map((item) => ({
      id: `domestic-world-${item.id}`,
      title: item.title,
      source: item.source,
      url: item.url,
      publishedAt: item.publishedAt,
      category: '国际',
      region,
    }));
  const platformItems = platformSettled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  const impactRules = [
    { score: 92, test: /(紧急降息|紧急加息|意外降息|意外加息|利率决议|宣布制裁|战争爆发|发动袭击|停火协议|主权违约|银行挤兑|金融危机|熔断|资本管制|霍尔木兹.*关闭)/i },
    { score: 76, test: /(非农|消费者价格指数|\bCPI\b|\bGDP\b|\bPMI\b|通胀率|失业率|就业报告|央行|美联储|欧洲央行|中国人民银行|日本央行|关税|财政刺激|债务上限|OPEC|原油供应|制裁|战争|冲突|地震|台风|洪水|暴雨|龙卷|火山|供应链中断|总统|总理|大选|政变|导弹|空袭|枪击|爆炸|相撞|坠机|死亡人数|致\d+人?死亡|致\d+死|紧急状态|政府.*停摆|重大事故)/i },
    { score: 54, test: /(通胀|就业|债券|美债|美元|汇率|全球股市|标普500|纳斯达克|道指|原油|能源|航运|贸易|财政|货币政策|监管|选举|外交|峰会|联合国|北约|欧盟|疫情|灾害|系统性风险)/i },
    { score: 34, test: /(股市|指数|期货|黄金|铜|天然气|经济增长|经济衰退|市场波动)/i },
  ];
  const headlineRules = [
    { score: 100, test: /(紧急降息|紧急加息|主权违约|银行挤兑|金融危机|资本管制|核武器|核设施遇袭|霍尔木兹.*关闭)/i },
    { score: 96, test: /(美伊(?:冲突|战事)|俄乌(?:冲突|战争)|以伊(?:冲突|战争)|战争爆发|大规模空袭|发动袭击|停火协议|导弹袭击|宣布制裁)/i },
    { score: 94, test: /(利率决议|意外降息|意外加息|非农|消费者价格指数|\bCPI\b|\bGDP\b|\bPMI\b|通胀率|失业率|就业报告).{0,28}(公布|发布|上升|下降|增长|收缩|超预期|低于预期|\d)/i },
    { score: 92, test: /(重大关税|全面关税|债务上限|政府.*停摆|财政刺激|出口管制|重大制裁|OPEC.*(?:减产|增产)|原油供应中断|供应链中断|熔断|系统性风险)/i },
    { score: 90, test: /((?:总统|总理|首相).{0,18}(?:辞职|遇袭|当选|去世)|政变|政府倒台|爱国者.*导弹.*库存|导弹库存.*不足|战略武器)/i },
  ];
  const categoryRules = [
    ['央行', /(央行|美联储|欧洲央行|日本央行|中国人民银行|利率决议|加息|降息)/i],
    ['数据', /(非农|消费者价格指数|\bCPI\b|\bPPI\b|\bGDP\b|\bPMI\b|通胀率|失业率|就业报告)/i],
    ['地缘', /(战争|冲突|战事|袭击|遭袭|空袭|导弹|停火|制裁|霍尔木兹|海峡|谈判|外交|伊朗|核武|军队|军事)/i],
    ['政策', /(关税|财政刺激|债务上限|政府.*停摆|出口管制|监管|贸易政策)/i],
    ['市场', /(熔断|暴跌|暴涨|金融危机|银行挤兑|主权违约|原油|能源|全球股市|美债|美元)/i],
    ['灾害', /(地震|台风|洪水|暴雨|龙卷|火山|野火|火灾|海啸|坠机|重大事故)/i],
    ['政治', /(总统|总理|首相|大选|选举|政变|政府倒台|辞职|当选)/i],
    ['宏观', /(经济|增长|衰退|贸易|财政|就业|通胀|供应链|航运)/i],
  ] as const;
  const scopeTerms = [/(全球|世界经济|国际市场|国际社会)/i, /(美国|美军|美方|美媒|美联储|美债|美元)/i, /(中国|中国人民银行|人民币)/i, /(欧盟|欧元区|欧洲央行|欧洲)/i, /(日本|日本央行|日元)/i, /(俄罗斯|乌克兰|以色列|伊朗|中东|亚洲|非洲|拉美|联合国|北约)/i, /(加拿大|英国|法国|德国|意大利|西班牙|泰国|尼日尔|印度|韩国|朝鲜|澳大利亚|巴西|土耳其|沙特|南非)/i, /(央行|利率|通胀|就业|GDP|PMI|CPI|非农)/i, /(战争|冲突|制裁|关税|贸易|财政|外交|选举)/i, /(原油|能源|航运|供应链)/i];
  const newInformationTerms = /(宣布|决定|公布|发布|通过|签署|启动|暂停|上调|下调|超预期|低于预期|爆发|袭击|制裁|违约|熔断|中断|当选|辞职|达成|遇袭|坠毁)/i;
  const companyHeavyTerms = /(个股|股价|盘前|盘后|财报|业绩|营收|净利润|目标价|评级|融资|新品|公司宣布|上市公司|子公司|医美产品|产品获批|获得认证|LOF|ETF|停复牌|溢价风险)/i;
  const commentaryTerms = /(观点|评论|主播说|要闻汇总|盘点|复盘|解读|喊话|警告|预计|预测|预期|概率|押注|展望|前瞻|公布前|静待|或将|可能|分析|专家|好时机|建仓|称)/i;
  const humanInterestTerms = /((男孩|女孩|男子|女子|老人|游客|网红).{0,18}(被|遇|失踪|身亡|卷走|受伤|牺牲)|记者.{0,18}(雨水|吹得|睁不开眼))/i;
  const officialSources = /(Federal Reserve|美联储|欧洲央行|中国人民银行|日本央行|美国劳工统计局|BLS|国家统计局|财政部|商务部|国务院|World Bank|世界银行|IMF|国际货币基金组织|OPEC)/i;
  const trustedSources = /(新华社|新华网|人民日报|人民网|央视新闻|央视网|中央广播电视总台|中国新闻网|中新网|中新国际|澎湃新闻|第一财经|界面新闻|经济日报|中国日报网|参考消息|东方财富|百度热搜|新浪财经)/i;
  const topicRules = [
    ['inflation', /(CPI|消费者价格|通胀)/i],
    ['employment', /(非农|就业|失业)/i],
    ['central-bank', /(利率决议|加息|降息|央行|美联储)/i],
    ['trade-policy', /(关税|贸易政策|出口管制|财政刺激|债务上限)/i],
    ['geopolitics', /(战争|冲突|袭击|停火|制裁)/i],
    ['energy', /(OPEC|原油|能源|霍尔木兹)/i],
    ['market-risk', /(熔断|暴跌|暴涨|违约|银行挤兑|金融危机|系统性风险)/i],
    ['disaster', /(地震|台风|洪水|火灾|供应链中断)/i],
  ] as const;
  const now = Date.now();
  const dateKey = (value: number) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
  const today = dateKey(now);
  const preferredDomesticSources = /(新华社|新华网|人民日报|人民网|央视新闻|央视网|中央广播电视总台|中国新闻网|中新网|中新国际|澎湃新闻|第一财经|界面新闻|经济日报|中国日报网|参考消息|东方财富|百度热搜|新浪财经)/i;
  const excludedTickerSources = /(华尔街见闻|wallstreetcn|财联社|cls\.cn)/i;
  const normalizedTitle = (title: string) => title
    .replace(/\s+-\s+[^-]{2,30}$/u, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .toLowerCase();
  const titleBigrams = (title: string) => {
    const normalized = normalizedTitle(title);
    const grams = new Set<string>();
    for (let index = 0; index < normalized.length - 1; index += 1) grams.add(normalized.slice(index, index + 2));
    return grams;
  };
  const sameStory = (left: string, right: string) => {
    const leftGrams = titleBigrams(left);
    const rightGrams = titleBigrams(right);
    if (!leftGrams.size || !rightGrams.size) return false;
    const overlap = [...leftGrams].filter((gram) => rightGrams.has(gram)).length;
    const overlapRatio = overlap / Math.min(leftGrams.size, rightGrams.size);
    const leftNumbers = new Set(left.match(/\d+(?:\.\d+)?/g) || []);
    const rightNumbers = new Set(right.match(/\d+(?:\.\d+)?/g) || []);
    const sharedNumbers = [...leftNumbers].filter((value) => rightNumbers.has(value)).length;
    return overlapRatio >= 0.72 || (sharedNumbers >= 2 && overlapRatio >= 0.4);
  };
  const seen = new Set<string>();
  const searchItems = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  const forcedPlatformItems = platformItems.filter((item) => 'forcedDisplay' in item && item.forcedDisplay === true);
  const regularPlatformItems = platformItems.filter((item) => !('forcedDisplay' in item) || item.forcedDisplay !== true);
  const items = [...forcedPlatformItems, ...searchItems, ...domesticItems, ...regularPlatformItems]
    .flatMap((item) => {
      if (excludedTickerSources.test(item.source)) return [];
      if (!preferredDomesticSources.test(item.source)) return [];
      if (!item.publishedAt) return [];
      const forcedDisplay = 'forcedDisplay' in item && item.forcedDisplay === true;
      const publishedTime = new Date(item.publishedAt).getTime();
      if (!Number.isFinite(publishedTime) || publishedTime > now + 5 * 60_000 || (!forcedDisplay && dateKey(publishedTime) !== today)) return [];
      const ageHours = Math.max(0, (now - publishedTime) / 3_600_000);
      const key = normalizedTitle(item.title);
      if (!key || seen.has(key)) return [];
      seen.add(key);
      const semanticText = 'classificationText' in item ? String(item.classificationText || item.title) : item.title;
      const baseImpact = impactRules.find((rule) => rule.test.test(semanticText))?.score || 0;
      const scopeHits = scopeTerms.reduce((count, test) => count + (test.test(semanticText) ? 1 : 0), 0);
      const domesticPublicImpact = /(台风|洪水|暴雨|龙卷|火山|地震|海啸|央行|利率|通胀|CPI|PPI|GDP|PMI|非农|关税|财政|监管|供应链|能源|原油)/i.test(semanticText);
      const hasMacroScope = scopeHits > 0 || (/百度热搜/i.test(item.source) && domesticPublicImpact);
      const hasNewInformation = newInformationTerms.test(semanticText);
      const companyHeavy = companyHeavyTerms.test(semanticText);
      const commentaryOnly = commentaryTerms.test(semanticText) && !hasNewInformation;
      const official = officialSources.test(item.source);
      const trusted = trustedSources.test(item.source);
      const magnitude = Number(semanticText.match(/(\d(?:\.\d+)?)级地震/i)?.[1] || 0);
      const fatalities = Math.max(0, ...[...semanticText.matchAll(/(?:死亡人数(?:升至)?|造成|致)(\d+)(?:人死亡|人遇难|死)/gi)].map((match) => Number(match[1]) || 0));
      const severeDisasterScore = magnitude >= 7 || fatalities >= 50 ? 90 : 0;
      const headlineScore = Math.max(headlineRules.find((rule) => rule.test.test(semanticText))?.score || 0, severeDisasterScore);
      const sourceSignal = 'sourceSignal' in item ? Number(item.sourceSignal || 0) : 0;
      const baiduRank = 'baiduRank' in item ? Number(item.baiduRank || 0) : 0;
      const forcedOrder = 'forcedOrder' in item ? Number(item.forcedOrder || 0) : 0;
      const trendingMacroFloor = /(东方财富|百度热搜)/i.test(item.source) && baseImpact >= 54 && hasMacroScope ? 70 : 0;
      let importanceScore = forcedDisplay
        ? 102 - forcedOrder
        : Math.max(headlineScore, trendingMacroFloor, Math.min(100, baseImpact + Math.min(12, Math.max(0, scopeHits - 1) * 4) + (hasNewInformation ? 6 : 0) + sourceSignal));
      if (!forcedDisplay && companyHeavy && headlineScore < 90) return [];
      if (!forcedDisplay && /百度热搜/i.test(item.source) && humanInterestTerms.test(item.title) && headlineScore < 90) return [];
      if (!forcedDisplay && commentaryOnly && headlineScore < 90) importanceScore = Math.max(0, importanceScore - 14);
      if (!forcedDisplay && (importanceScore < 70 || !hasMacroScope)) return [];
      if (!official && !trusted) return [];
      const authorityScore = official ? 100 : /百度热搜/i.test(item.source) ? 68 : /东方财富/i.test(item.source) ? 80 : /新浪财经/i.test(item.source) ? 82 : trusted ? 84 : 58;
      const freshnessScore = Math.max(0, 100 - ageHours * (100 / 24));
      const rankScore = importanceScore * 0.65 + authorityScore * 0.1 + freshnessScore * 0.25;
      const importance = importanceScore >= 84 ? 'critical' as const : importanceScore >= 60 ? 'high' as const : 'medium' as const;
      const topic = forcedDisplay ? `forced-${forcedOrder}` : topicRules.find(([, test]) => test.test(semanticText))?.[0] || `${item.category}-${key.slice(0, 18)}`;
      const category = categoryRules.find(([, test]) => test.test(semanticText))?.[0] || '热点';
      return [{ ...item, category, ageHours, importanceScore, importance, rankScore, topic, forcedDisplay, baiduRank, forcedOrder }];
    })
    .sort((left, right) => right.rankScore - left.rankScore || right.importanceScore - left.importanceScore || left.ageHours - right.ageHours);
  const forcedStories = items
    .filter((item) => item.forcedDisplay)
    .sort((left, right) => left.forcedOrder - right.forcedOrder)
    .filter((item, index, rankedItems) => !rankedItems.slice(0, index).some((earlier) => sameStory(earlier.title, item.title)));
  const uniqueStories = items.filter((item, index, rankedItems) => {
    if (item.forcedDisplay) return forcedStories.some((forced) => forced.id === item.id);
    if (forcedStories.some((forced) => sameStory(forced.title, item.title))) return false;
    return !rankedItems.slice(0, index).some((earlier) => !earlier.forcedDisplay && sameStory(earlier.title, item.title));
  });
  const regularStories = uniqueStories.filter((item) => !item.forcedDisplay);
  const usedTopics = new Set<string>();
  const distinctTopics = regularStories.filter((item) => {
    if (usedTopics.has(item.topic)) return false;
    usedTopics.add(item.topic);
    return true;
  });
  const selectedIds = new Set(distinctTopics.map((item) => item.id));
  const rankedPool = [...distinctTopics, ...regularStories.filter((item) => !selectedIds.has(item.id))];
  const minimumTickerItems = 10;
  const requiredRegularItems = Math.max(0, minimumTickerItems - forcedStories.length);
  const activeThreshold = [90, 80, 70].find((threshold) => rankedPool.filter((item) => item.importanceScore >= threshold).length >= requiredRegularItems) || 70;
  const selected = [...forcedStories, ...rankedPool.filter((item) => item.importanceScore >= activeThreshold)].slice(0, 12);
  return selected.map(({ ageHours: _ageHours, rankScore: _rankScore, topic: _topic, ...item }) => item);
}

async function getGlobalMacroNews(region: GlobalMacroRegion, sources = globalMacroCuratedNewsSources) {
  const curatedSettled = await Promise.allSettled(sources.map(fetchNewsSource));
  if (!curatedSettled.some((result) => result.status === 'fulfilled')) {
    throw new Error('发布方 RSS 暂时全部不可用');
  }
  const sourcePriority = (source: string) => /(华尔街日报|Wall Street Journal)/i.test(source) ? 4
    : /财新/i.test(source) ? 3
      : /(经济时报|The Economic Times)/i.test(source) ? 2
        : 1;
  const curatedItems = curatedSettled.flatMap((result) => result.status === 'fulfilled' ? result.value : []).map((item) => ({
    id: `curated-${item.id}`,
    title: item.title.replace(/\s+-\s+(?:WSJ|The Wall Street Journal|The Economic Times|财新网|Caixin)\s*$/i, '').trim(),
    source: item.source,
    url: item.url,
    publishedAt: item.publishedAt,
    category: item.category === 'world' ? '国际' : item.category === 'livelihood' ? '政策' : '财经',
    region,
  })).sort((left, right) => sourcePriority(right.source) - sourcePriority(left.source)
    || new Date(right.publishedAt || 0).getTime() - new Date(left.publishedAt || 0).getTime());
  const impactRules = [
    { score: 92, test: /(紧急降息|紧急加息|意外降息|意外加息|利率决议|宣布制裁|战争爆发|发动袭击|停火协议|主权违约|银行挤兑|金融危机|熔断|资本管制|霍尔木兹.*关闭|emergency rate (?:cut|hike)|surprise rate (?:cut|hike)|sovereign default|bank run|financial crisis|capital controls)/i },
    { score: 76, test: /(非农|消费者价格指数|\bCPI\b|\bGDP\b|\bPMI\b|通胀率|失业率|就业报告|央行|美联储|欧洲央行|中国人民银行|日本央行|关税|财政刺激|债务上限|OPEC|原油供应|制裁|战争|冲突|地震|台风|洪水|供应链中断|nonfarm|inflation rate|unemployment|jobs report|central bank|Federal Reserve|\bFed\b|\bECB\b|\bPBOC\b|\bBOJ\b|tariff|fiscal stimulus|debt ceiling|oil supply|sanction|war|conflict|earthquake|flood|supply chain)/i },
    { score: 54, test: /(通胀|就业|债券|美债|美元|汇率|全球股市|标普500|纳斯达克|道指|原油|能源|航运|贸易|财政|货币政策|监管|选举|灾害|系统性风险|inflation|employment|jobs|Treasur(?:y|ies)|bond|dollar|currency|global stocks|S&P 500|Nasdaq|Dow Jones|crude oil|energy|shipping|trade|fiscal|monetary policy|regulation|election|systemic risk)/i },
    { score: 34, test: /(股市|指数|期货|黄金|铜|天然气|经济增长|经济衰退|市场波动|stocks?|equities|index|futures|gold|copper|natural gas|economic growth|recession|market volatility)/i },
  ];
  const scopeTerms = [/(全球|世界经济|国际市场|global|world economy|international markets?)/i, /(美国|美联储|美债|美元|United States|\bU\.S\.|Federal Reserve|\bFed\b|Treasur(?:y|ies)|dollar)/i, /(中国|中国人民银行|人民币|China|\bPBOC\b|yuan|renminbi)/i, /(欧盟|欧元区|欧洲央行|European Union|Eurozone|\bECB\b)/i, /(日本|日本央行|日元|Japan|\bBOJ\b|yen)/i, /(央行|利率|通胀|就业|GDP|PMI|CPI|非农|central bank|interest rates?|inflation|employment|jobs|nonfarm)/i, /(战争|冲突|制裁|关税|贸易|财政|war|conflict|sanction|tariff|trade|fiscal)/i, /(原油|能源|航运|供应链|crude oil|energy|shipping|supply chain)/i];
  const newInformationTerms = /(宣布|决定|公布|发布|通过|签署|启动|暂停|上调|下调|超预期|低于预期|爆发|袭击|制裁|违约|熔断|中断|会议纪要|利率决议|就业报告|通胀报告|数据显示|announce|decide|release|approve|sign|launch|pause|raise|lower|beat expectations|miss expectations|surge|attack|sanction|default|halt|minutes|rate decision|jobs report|inflation report|data show)/i;
  const dataReleaseTerms = /(CPI|PPI|GDP|PMI|非农|失业率|就业人数).{0,24}(同比|环比|上涨|下降|增长|收窄|扩大|录得|达到|降至|升至|为\s*[-+]?\d|[-+]?\d+(?:\.\d+)?%)/i;
  const companyHeavyTerms = /(个股|股价|盘前|盘后|财报|业绩|营收|净利润|目标价|评级|融资|新品|公司宣布|上市公司|回购|股东回报|净买入|打新|伯克希尔)/i;
  const commentaryTerms = /(观点|评论|喊话|警告|预计|预测|预期|概率|押注|展望|前瞻|公布前|静待|或将|可能|分析|专家|好时机|建仓|聚焦|解读|复盘|如何|摘要|认为|表示|日程|下周|本周|盘点|称|opinion|commentary|warns?|forecast|outlook|preview|may|might|analysis|expert|how to|week ahead)/i;
  const officialSources = /(Federal Reserve|美联储|欧洲央行|中国人民银行|日本央行|美国劳工统计局|BLS|国家统计局|财政部|商务部|国务院|World Bank|世界银行|IMF|国际货币基金组织|OPEC)/i;
  const trustedSources = /(新华社|人民日报|央视|中央广播电视总台|中国政府网|中国新闻网|澎湃新闻|界面新闻|21世纪经济报道|财联社|第一财经|华尔街见闻|财新|经济日报|经济时报|证券时报|上海证券报|路透|Reuters|Bloomberg|CNBC|Financial Times|Associated Press|AP News|BBC|日经|Nikkei|The Wall Street Journal|Wall Street Journal|华尔街日报|The Economic Times)/i;
  const topicRules = [
    ['inflation', /(CPI|消费者价格|通胀)/i],
    ['employment', /(非农|就业|失业)/i],
    ['central-bank', /(利率决议|加息|降息|央行|美联储)/i],
    ['trade-policy', /(关税|贸易政策|出口管制|财政刺激|债务上限)/i],
    ['geopolitics', /(战争|冲突|袭击|停火|制裁)/i],
    ['energy', /(OPEC|原油|能源|霍尔木兹)/i],
    ['market-risk', /(熔断|暴跌|暴涨|违约|银行挤兑|金融危机|系统性风险)/i],
    ['disaster', /(地震|台风|洪水|火灾|供应链中断)/i],
  ] as const;
  const topicLabels: Record<(typeof topicRules)[number][0], string> = {
    inflation: '数据',
    employment: '就业',
    'central-bank': '央行',
    'trade-policy': '政策',
    geopolitics: '地缘',
    energy: '能源',
    'market-risk': '市场',
    disaster: '灾害',
  };
  const now = Date.now();
  const dateKey = (value: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(value));
    const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
  const today = dateKey(now);
  const normalizedTitle = (title: string) => title
    .replace(/\s+-\s+[^-]{2,30}$/u, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .toLowerCase();
  const seen = new Set<string>();
  const seenTokenSets: Set<string>[] = [];
  const titleTokens = (title: string) => {
    const cleaned = title.toLowerCase().replace(/\s+-\s+[^-]{2,30}$/u, ' ');
    const words = cleaned.match(/[a-z0-9]{3,}|[\p{Script=Han}]/gu) || [];
    const tokens = new Set(words);
    const chinese = words.filter((word) => /\p{Script=Han}/u.test(word)).join('');
    for (let index = 0; index < chinese.length - 1; index += 1) tokens.add(chinese.slice(index, index + 2));
    return tokens;
  };
  const isNearDuplicate = (tokens: Set<string>) => seenTokenSets.some((previous) => {
    if (!tokens.size || !previous.size) return false;
    let intersection = 0;
    tokens.forEach((token) => { if (previous.has(token)) intersection += 1; });
    return intersection / Math.min(tokens.size, previous.size) >= 0.78;
  });
  const items = curatedItems
    .flatMap((item) => {
      if (!item.publishedAt) return [];
      const publishedTime = new Date(item.publishedAt).getTime();
      if (!Number.isFinite(publishedTime) || publishedTime > now + 5 * 60_000 || dateKey(publishedTime) !== today) return [];
      const ageHours = Math.max(0, (now - publishedTime) / 3_600_000);
      const key = normalizedTitle(item.title);
      const tokens = titleTokens(item.title);
      if (!key || seen.has(key) || isNearDuplicate(tokens)) return [];
      seen.add(key);
      seenTokenSets.push(tokens);
      const baseImpact = impactRules.find((rule) => rule.test.test(item.title))?.score || 0;
      const scopeHits = scopeTerms.reduce((count, test) => count + (test.test(item.title) ? 1 : 0), 0);
      const hasNewInformation = newInformationTerms.test(item.title) || dataReleaseTerms.test(item.title);
      const companyHeavy = companyHeavyTerms.test(item.title);
      const commentaryOnly = commentaryTerms.test(item.title) && !hasNewInformation;
      const official = officialSources.test(item.source);
      const trusted = trustedSources.test(item.source);
      let importanceScore = Math.min(100, baseImpact + Math.min(12, Math.max(0, scopeHits - 1) * 4) + (hasNewInformation ? 6 : 0));
      if (commentaryOnly) importanceScore = Math.max(0, importanceScore - 24);
      if (!official && !hasNewInformation) importanceScore = Math.min(importanceScore, 53);
      if (companyHeavy && !official) return [];
      if (importanceScore < 34 || scopeHits === 0) return [];
      if (!official && !trusted) return [];
      if (importanceScore < 54 && ageHours > 6) return [];
      const premiumSource = /(华尔街日报|Wall Street Journal|经济时报|The Economic Times|财新)/i.test(item.source);
      const authorityScore = official ? 100 : premiumSource ? 94 : trusted ? 84 : 58;
      const freshnessScore = Math.max(0, 100 - ageHours * 6);
      const rankScore = importanceScore * 0.72 + authorityScore * 0.16 + freshnessScore * 0.12;
      const importance = importanceScore >= 88 ? 'critical' as const : importanceScore >= 68 ? 'high' as const : 'medium' as const;
      const topic = topicRules.find(([, test]) => test.test(item.title))?.[0] || `${item.category}-${key.slice(0, 18)}`;
      const category = topic in topicLabels ? topicLabels[topic as keyof typeof topicLabels] : item.category;
      return [{ ...item, category, ageHours, importanceScore, importance, rankScore, topic }];
    })
    .sort((left, right) => right.rankScore - left.rankScore || right.importanceScore - left.importanceScore || left.ageHours - right.ageHours);
  const usedTopics = new Set<string>();
  const distinctTopics = items.filter((item) => {
    if (usedTopics.has(item.topic)) return false;
    usedTopics.add(item.topic);
    return true;
  });
  const selectedIds = new Set(distinctTopics.map((item) => item.id));
  const selected = [...distinctTopics, ...items.filter((item) => !selectedIds.has(item.id))].slice(0, 12);
  return selected.map(({ ageHours: _ageHours, rankScore: _rankScore, topic: _topic, ...item }) => item);
}

async function getWallstreetCnDailyNews(region: GlobalMacroRegion) {
  const source = newsSources.find((item) => item.id === 'wallstreetcn');
  if (!source) throw new Error('华尔街见闻新闻源未配置');
  const feedItems = await fetchNewsSource(source);
  const now = Date.now();
  const dateKey = (value: number) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
  const today = dateKey(now);
  const seen = new Set<string>();
  const importanceRules = [
    { score: 96, test: /(突发|紧急|意外降息|意外加息|利率决议|战争爆发|发动袭击|停火协议|主权违约|银行挤兑|金融危机|熔断|资本管制|重大制裁)/i },
    { score: 88, test: /(美联储|中国人民银行|欧洲央行|日本央行|央行).{0,18}(宣布|决定|降息|加息|维持|会议纪要)|(?:CPI|PPI|GDP|PMI|非农|失业率|就业).{0,24}(公布|同比|环比|增长|下降|升至|降至|高于|低于|超预期)/i },
    { score: 80, test: /(关税|财政刺激|债务上限|出口管制|监管新规|国务院|证监会|OPEC|原油供应|制裁|战争|冲突|供应链中断|霍尔木兹)/i },
    { score: 72, test: /(全球股市|美股|A股|港股|标普500|纳斯达克|道指|债券|美债|美元|人民币|黄金|原油|能源|航运|半导体|芯片|人工智能|AI)/i },
    { score: 62, test: /(财报|业绩|营收|净利润|并购|IPO|回购|融资|新产品|发布会)/i },
  ] as const;
  const newInformationTerms = /(宣布|决定|公布|发布|通过|签署|启动|暂停|上调|下调|超预期|低于预期|升至|降至|上涨|下跌|增长|下降|爆发|袭击|制裁|违约|熔断|中断)/i;
  const commentaryTerms = /(下周|本周|日程|前瞻|展望|热议|观点|评论|解读|复盘|认为|预计|预测|或将|可能|策略|战术)/i;
  const categoryFor = (title: string) => {
    if (/(央行|美联储|加息|降息|利率|货币政策)/i.test(title)) return '央行';
    if (/(战争|冲突|制裁|袭击|停火|中东|俄乌)/i.test(title)) return '地缘';
    if (/(CPI|PPI|GDP|PMI|非农|就业|失业|通胀)/i.test(title)) return '数据';
    if (/(关税|财政|监管|政策|法案)/i.test(title)) return '政策';
    if (/(股市|美股|港股|A股|债券|美债|美元|黄金|原油|市场)/i.test(title)) return '市场';
    return '财经';
  };
  return feedItems
    .flatMap((item) => {
      const publishedTime = new Date(item.publishedAt || '').getTime();
      if (!Number.isFinite(publishedTime) || publishedTime > now + 5 * 60_000 || dateKey(publishedTime) !== today) return [];
      const key = item.title.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
      if (!key || seen.has(key)) return [];
      seen.add(key);
      const text = item.title;
      const baseScore = importanceRules.find((rule) => rule.test.test(text))?.score || 52;
      const hasNewInformation = newInformationTerms.test(text);
      const informationBonus = hasNewInformation ? 5 : 0;
      const numberBonus = /\d+(?:\.\d+)?%|\d+(?:\.\d+)?万亿|\d+(?:\.\d+)?亿美元/i.test(text) ? 3 : 0;
      const commentaryPenalty = commentaryTerms.test(text) && !hasNewInformation ? 14 : 0;
      const importanceScore = Math.max(30, Math.min(100, baseScore + informationBonus + numberBonus - commentaryPenalty));
      const ageHours = Math.max(0, (now - publishedTime) / 3_600_000);
      const freshnessScore = Math.max(0, 100 - ageHours * 4.2);
      const rankScore = importanceScore * 0.76 + freshnessScore * 0.24;
      const importance = importanceScore >= 88 ? 'critical' as const : importanceScore >= 68 ? 'high' as const : 'medium' as const;
      return [{ item, publishedTime, importanceScore, importance, rankScore }];
    })
    .sort((left, right) => right.rankScore - left.rankScore
      || right.importanceScore - left.importanceScore
      || right.publishedTime - left.publishedTime)
    .slice(0, 20)
    .map(({ item, importanceScore, importance }) => ({
      id: `wallstreetcn-daily-${item.id}`,
      title: item.title,
      source: '华尔街见闻',
      url: item.url,
      publishedAt: item.publishedAt,
      category: categoryFor(item.title),
      region,
      importanceScore,
      importance,
    }));
}

type GlobalCalendarEvent = { id: string; date: string; time: string; title: string; source: string; url: string; kind: 'macro' | 'central-bank' | 'earnings'; importance: 'high' | 'medium' };

type OfficialMacroReleaseFamily = 'ppi' | 'cpi' | 'employment' | 'pce';
type OfficialMacroRelease = {
  id: string;
  family: OfficialMacroReleaseFamily;
  label: string;
  releaseAt: string;
  expectedPeriod: string;
  sourceUrl: string;
};
type MacroReleaseSyncPlan = {
  active: boolean;
  synced: boolean;
  pollAfterMs: number;
  release?: OfficialMacroRelease;
  nextRelease?: OfficialMacroRelease;
};

const OFFICIAL_MACRO_RELEASE_WINDOW_LEAD_MS = 2 * 60_000;
const OFFICIAL_MACRO_RELEASE_WINDOW_TAIL_MS = 30 * 60_000;
const OFFICIAL_MACRO_RELEASE_POLL_MS = 15_000;
const OFFICIAL_MACRO_NORMAL_POLL_MS = 5 * 60_000;
const officialMacroReleaseFallbacks: OfficialMacroRelease[] = [
  ['ppi-2026-08', 'ppi', '美国 PPI', '2026-08-13T12:30:00.000Z', '2026-07', 'https://www.bls.gov/ppi/'],
  ['pce-2026-08', 'pce', '美国 PCE', '2026-08-26T12:30:00.000Z', '2026-07', 'https://www.bea.gov/data/personal-consumption-expenditures-price-index'],
  ['employment-2026-09', 'employment', '美国就业报告', '2026-09-04T12:30:00.000Z', '2026-08', 'https://www.bls.gov/news.release/empsit.toc.htm'],
  ['ppi-2026-09', 'ppi', '美国 PPI', '2026-09-10T12:30:00.000Z', '2026-08', 'https://www.bls.gov/ppi/'],
  ['cpi-2026-09', 'cpi', '美国 CPI', '2026-09-11T12:30:00.000Z', '2026-08', 'https://www.bls.gov/cpi/'],
  ['pce-2026-09', 'pce', '美国 PCE', '2026-09-30T12:30:00.000Z', '2026-08', 'https://www.bea.gov/data/personal-consumption-expenditures-price-index'],
  ['employment-2026-10', 'employment', '美国就业报告', '2026-10-02T12:30:00.000Z', '2026-09', 'https://www.bls.gov/news.release/empsit.toc.htm'],
  ['cpi-2026-10', 'cpi', '美国 CPI', '2026-10-14T12:30:00.000Z', '2026-09', 'https://www.bls.gov/cpi/'],
  ['ppi-2026-10', 'ppi', '美国 PPI', '2026-10-15T12:30:00.000Z', '2026-09', 'https://www.bls.gov/ppi/'],
  ['pce-2026-10', 'pce', '美国 PCE', '2026-10-29T12:30:00.000Z', '2026-09', 'https://www.bea.gov/data/personal-consumption-expenditures-price-index'],
  ['employment-2026-11', 'employment', '美国就业报告', '2026-11-06T13:30:00.000Z', '2026-10', 'https://www.bls.gov/news.release/empsit.toc.htm'],
  ['cpi-2026-11', 'cpi', '美国 CPI', '2026-11-10T13:30:00.000Z', '2026-10', 'https://www.bls.gov/cpi/'],
  ['ppi-2026-11', 'ppi', '美国 PPI', '2026-11-13T13:30:00.000Z', '2026-10', 'https://www.bls.gov/ppi/'],
  ['pce-2026-11', 'pce', '美国 PCE', '2026-11-25T13:30:00.000Z', '2026-10', 'https://www.bea.gov/data/personal-consumption-expenditures-price-index'],
  ['employment-2026-12', 'employment', '美国就业报告', '2026-12-04T13:30:00.000Z', '2026-11', 'https://www.bls.gov/news.release/empsit.toc.htm'],
  ['cpi-2026-12', 'cpi', '美国 CPI', '2026-12-10T13:30:00.000Z', '2026-11', 'https://www.bls.gov/cpi/'],
  ['ppi-2026-12', 'ppi', '美国 PPI', '2026-12-15T13:30:00.000Z', '2026-11', 'https://www.bls.gov/ppi/'],
  ['pce-2026-12', 'pce', '美国 PCE', '2026-12-23T13:30:00.000Z', '2026-11', 'https://www.bea.gov/data/personal-consumption-expenditures-price-index'],
].map(([id, family, label, releaseAt, expectedPeriod, sourceUrl]) => ({
  id,
  family: family as OfficialMacroReleaseFamily,
  label,
  releaseAt,
  expectedPeriod,
  sourceUrl,
}));

let officialMacroDynamicScheduleCache: { storedAt: number; releases: OfficialMacroRelease[] } | undefined;
let officialMacroDynamicScheduleInFlight: Promise<OfficialMacroRelease[]> | undefined;

function zonedDateTimeToIso(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  let utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  for (let index = 0; index < 2; index += 1) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(utcGuess));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const representedUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute));
    utcGuess += Date.UTC(year, month - 1, day, hour, minute) - representedUtc;
  }
  return new Date(utcGuess).toISOString();
}

function expectedPeriodFromReleaseTitle(title: string) {
  const match = title.match(/(?:for\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})/i);
  if (!match) return '';
  return `${match[2]}-${String(monthNameToNumber(match[1])).padStart(2, '0')}`;
}

async function fetchBlsOfficialReleaseSchedule(): Promise<OfficialMacroRelease[]> {
  const sourceUrl = 'https://www.bls.gov/schedule/news_release/bls.ics';
  let ics: string;
  try {
    ics = await fetchRoutedText(sourceUrl, 'direct', 4000, 'text/calendar,text/plain,*/*');
  } catch {
    ics = await fetchRoutedText(sourceUrl, 'proxy', 6000, 'text/calendar,text/plain,*/*');
  }
  const unfolded = ics.replace(/\r?\n[ \t]/g, '');
  return [...unfolded.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g)].flatMap((eventMatch) => {
    const event = eventMatch[1];
    const summary = event.match(/\r?\nSUMMARY(?:;[^:]*)?:(.+)/i)?.[1]?.trim() || '';
    const family: OfficialMacroReleaseFamily | undefined = /Producer Price Index/i.test(summary)
      ? 'ppi'
      : /Consumer Price Index/i.test(summary)
        ? 'cpi'
        : /Employment Situation/i.test(summary)
          ? 'employment'
          : undefined;
    const start = event.match(/\r?\nDTSTART(?:;TZID=([^:]+))?:(\d{8})T(\d{4,6})/i);
    const expectedPeriod = expectedPeriodFromReleaseTitle(summary);
    if (!family || !start || !expectedPeriod) return [];
    const date = `${start[2].slice(0, 4)}-${start[2].slice(4, 6)}-${start[2].slice(6, 8)}`;
    const time = `${start[3].slice(0, 2)}:${start[3].slice(2, 4)}`;
    const sourceUrls: Record<Exclude<OfficialMacroReleaseFamily, 'pce'>, string> = {
      ppi: 'https://www.bls.gov/ppi/',
      cpi: 'https://www.bls.gov/cpi/',
      employment: 'https://www.bls.gov/news.release/empsit.toc.htm',
    };
    return [{
      id: `${family}-${date}`,
      family,
      label: family === 'ppi' ? '美国 PPI' : family === 'cpi' ? '美国 CPI' : '美国就业报告',
      releaseAt: zonedDateTimeToIso(date, time, start[1] || 'America/New_York'),
      expectedPeriod,
      sourceUrl: sourceUrls[family],
    }];
  });
}

async function fetchBeaOfficialReleaseSchedule(): Promise<OfficialMacroRelease[]> {
  const scheduleUrl = 'https://www.bea.gov/news/schedule/full';
  const html = await fetchExternalText(scheduleUrl, 16000, 'text/html,application/xhtml+xml,*/*');
  const currentYear = new Date().getUTCFullYear();
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap((rowMatch) => {
    const row = rowMatch[1];
    const title = stripTags(row.match(/<td\b[^>]*class=["'][^"']*release-title[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] || '');
    if (!/Personal Income and Outlays/i.test(title)) return [];
    const dateLabel = stripTags(row.match(/class=["']release-date["'][^>]*>([\s\S]*?)<\//i)?.[1] || '');
    const timeLabel = stripTags(row.match(/<small\b[^>]*>([\s\S]*?)<\/small>/i)?.[1] || '');
    const dateParts = dateLabel.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})/i);
    const timeParts = timeLabel.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    const expectedPeriod = expectedPeriodFromReleaseTitle(title);
    if (!dateParts || !timeParts || !expectedPeriod) return [];
    const month = monthNameToNumber(dateParts[1]);
    const hour = (Number(timeParts[1]) % 12) + (/PM/i.test(timeParts[3]) ? 12 : 0);
    const date = `${currentYear}-${String(month).padStart(2, '0')}-${String(Number(dateParts[2])).padStart(2, '0')}`;
    return [{
      id: `pce-${date}`,
      family: 'pce' as const,
      label: '美国 PCE',
      releaseAt: zonedDateTimeToIso(date, `${String(hour).padStart(2, '0')}:${timeParts[2]}`, 'America/New_York'),
      expectedPeriod,
      sourceUrl: 'https://www.bea.gov/data/personal-consumption-expenditures-price-index',
    }];
  });
}

function refreshOfficialMacroReleaseSchedule() {
  if (officialMacroDynamicScheduleInFlight) return officialMacroDynamicScheduleInFlight;
  officialMacroDynamicScheduleInFlight = Promise.allSettled([
    fetchBlsOfficialReleaseSchedule(),
    fetchBeaOfficialReleaseSchedule(),
  ]).then((results) => {
    const releases: OfficialMacroRelease[] = [];
    results.forEach((result) => {
      if (result.status === 'fulfilled') releases.push(...result.value);
    });
    officialMacroDynamicScheduleCache = { storedAt: Date.now(), releases };
    return releases;
  }).finally(() => {
    officialMacroDynamicScheduleInFlight = undefined;
  });
  return officialMacroDynamicScheduleInFlight;
}

function getOfficialMacroReleaseSchedule() {
  if (!officialMacroDynamicScheduleCache || Date.now() - officialMacroDynamicScheduleCache.storedAt > 6 * 60 * 60_000) {
    void refreshOfficialMacroReleaseSchedule();
  }
  const merged = [...officialMacroReleaseFallbacks, ...(officialMacroDynamicScheduleCache?.releases || [])];
  return [...new Map(merged.map((release) => [`${release.family}:${release.releaseAt}`, release])).values()]
    .sort((left, right) => left.releaseAt.localeCompare(right.releaseAt));
}

function latestOfficialMacroPeriod(family: OfficialMacroReleaseFamily) {
  if (family === 'pce') return beaPceSnapshotCache?.updatedAt?.slice(0, 7) || '';
  const reportFamily = family === 'employment' ? 'employment' : family;
  const reportPeriod = blsReleaseReportCache.get(reportFamily)?.period;
  if (reportPeriod) return reportPeriod;
  if (!blsMacroSnapshotCache) return '';
  const seriesIds = family === 'ppi'
    ? ['WPSFD4']
    : family === 'cpi'
      ? ['CUSR0000SA0']
      : ['LNS14000000', 'CES0000000001'];
  const periods = seriesIds.map((seriesId) => blsMacroSnapshotCache?.series[seriesId]?.at(-1)?.time.slice(0, 7) || '');
  return periods.every(Boolean) ? periods.sort().at(0) || '' : '';
}

function getMacroReleaseSyncPlan(now = Date.now()): MacroReleaseSyncPlan {
  const releases = getOfficialMacroReleaseSchedule();
  const activeRelease = releases.find((release) => {
    const releaseTime = new Date(release.releaseAt).getTime();
    return now >= releaseTime - OFFICIAL_MACRO_RELEASE_WINDOW_LEAD_MS
      && now <= releaseTime + OFFICIAL_MACRO_RELEASE_WINDOW_TAIL_MS;
  });
  const nextRelease = releases.find((release) => new Date(release.releaseAt).getTime() > now);
  if (activeRelease) {
    const synced = latestOfficialMacroPeriod(activeRelease.family) >= activeRelease.expectedPeriod;
    return {
      active: true,
      synced,
      pollAfterMs: synced ? OFFICIAL_MACRO_NORMAL_POLL_MS : OFFICIAL_MACRO_RELEASE_POLL_MS,
      release: activeRelease,
      nextRelease,
    };
  }
  const nextWindowAt = nextRelease
    ? new Date(nextRelease.releaseAt).getTime() - OFFICIAL_MACRO_RELEASE_WINDOW_LEAD_MS
    : Number.POSITIVE_INFINITY;
  return {
    active: false,
    synced: false,
    pollAfterMs: Math.max(OFFICIAL_MACRO_RELEASE_POLL_MS, Math.min(OFFICIAL_MACRO_NORMAL_POLL_MS, nextWindowAt - now)),
    nextRelease,
  };
}

const officialMacroEvents: GlobalCalendarEvent[] = [
  { id: 'nfp-2026-09', date: '2026-09-04', time: '20:30', title: '美国非农就业报告', source: 'BLS', url: 'https://www.bls.gov/schedule/news_release/empsit.htm', kind: 'macro', importance: 'high' },
  { id: 'nfp-2026-10', date: '2026-10-02', time: '20:30', title: '美国非农就业报告', source: 'BLS', url: 'https://www.bls.gov/schedule/news_release/empsit.htm', kind: 'macro', importance: 'high' },
  { id: 'nfp-2026-11', date: '2026-11-06', time: '21:30', title: '美国非农就业报告', source: 'BLS', url: 'https://www.bls.gov/schedule/news_release/empsit.htm', kind: 'macro', importance: 'high' },
  { id: 'nfp-2026-12', date: '2026-12-04', time: '21:30', title: '美国非农就业报告', source: 'BLS', url: 'https://www.bls.gov/schedule/news_release/empsit.htm', kind: 'macro', importance: 'high' },
  { id: 'fomc-2026-09', date: '2026-09-16', time: '待定', title: 'FOMC 利率决议与经济预测', source: 'Federal Reserve', url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', kind: 'central-bank', importance: 'high' },
  { id: 'fomc-2026-10', date: '2026-10-28', time: '待定', title: 'FOMC 利率决议', source: 'Federal Reserve', url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', kind: 'central-bank', importance: 'high' },
  { id: 'fomc-2026-12', date: '2026-12-09', time: '待定', title: 'FOMC 利率决议与经济预测', source: 'Federal Reserve', url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', kind: 'central-bank', importance: 'high' },
  { id: 'fomc-2027-01', date: '2027-01-27', time: '待定', title: 'FOMC 利率决议', source: 'Federal Reserve', url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', kind: 'central-bank', importance: 'high' },
];

function parseMarketCap(value: unknown) {
  const parsed = Number(String(value || '').replace(/[$,]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function getUpcomingEarnings() {
  const dates: string[] = [];
  const cursor = new Date();
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (dates.length < 4) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const settled = await Promise.allSettled(dates.map(async (date) => {
    const url = `https://api.nasdaq.com/api/calendar/earnings?date=${date}`;
    const text = await fetchExternalText(url, 18000, 'application/json,text/plain,*/*');
    const payload = JSON.parse(text) as Record<string, any>;
    const rows = Array.isArray(payload?.data?.rows) ? payload.data.rows as Array<Record<string, unknown>> : [];
    return rows.sort((left, right) => parseMarketCap(right.marketCap) - parseMarketCap(left.marketCap)).slice(0, 2).map((row) => ({
      id: `earnings-${date}-${String(row.symbol || '')}`,
      date,
      time: row.time === 'time-pre-market' ? '盘前' : row.time === 'time-after-hours' ? '盘后' : '待定',
      title: `${String(row.symbol || '')} · ${String(row.name || '')} 财报`,
      source: 'Nasdaq',
      url: `https://www.nasdaq.com/market-activity/stocks/${String(row.symbol || '').toLowerCase()}/earnings`,
      kind: 'earnings' as const,
      importance: parseMarketCap(row.marketCap) >= 20_000_000_000 ? 'high' as const : 'medium' as const,
    }));
  }));
  return settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
}

const fedFundsMonthCodes = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'] as const;

function getFedFundsMeetingContract(meetingDate: string) {
  const date = new Date(`${meetingDate}T00:00:00Z`);
  return `ZQ${fedFundsMonthCodes[date.getUTCMonth()]}${String(date.getUTCFullYear()).slice(-2)}.CBT`;
}

function buildFedRateExpectation(
  futuresQuote: Awaited<ReturnType<typeof getYahooMacroQuote>>,
  currentRate: number,
  nextMeeting: GlobalCalendarEvent,
  contractSymbol: string,
) {
  const meetingDate = new Date(`${nextMeeting.date}T00:00:00Z`);
  const daysInMonth = new Date(Date.UTC(
    meetingDate.getUTCFullYear(),
    meetingDate.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  const decisionDay = meetingDate.getUTCDate();
  const daysAfterDecision = daysInMonth - decisionDay;
  if (daysAfterDecision <= 0) throw new Error('FOMC 会议日期无法用于月度期货加权');

  // ZQ settles to the calendar-month average EFFR. A meeting decision takes
  // effect the following day, so the current EFFR applies through that date.
  const monthlyAverageRate = 100 - futuresQuote.price;
  const impliedRate = (
    monthlyAverageRate * daysInMonth - currentRate * decisionDay
  ) / daysAfterDecision;
  const expectedMoveSteps = (impliedRate - currentRate) / 0.25;
  const lowerSteps = Math.floor(expectedMoveSteps);
  const upperSteps = Math.ceil(expectedMoveSteps);
  const upperProbability = upperSteps === lowerSteps ? 0 : expectedMoveSteps - lowerSteps;
  const outcomes = upperSteps === lowerSteps
    ? [{ steps: lowerSteps, probability: 1 }]
    : [
        { steps: lowerSteps, probability: 1 - upperProbability },
        { steps: upperSteps, probability: upperProbability },
      ];
  const percent = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 1000) / 10;
  const outcomeLabel = (steps: number) => {
    if (steps === 0) return '维持';
    return `${steps > 0 ? '加息' : '降息'} ${Math.abs(steps) * 25}bp`;
  };
  const hikeProbability = outcomes.reduce((sum, item) => sum + (item.steps > 0 ? item.probability : 0), 0);
  const cutProbability = outcomes.reduce((sum, item) => sum + (item.steps < 0 ? item.probability : 0), 0);

  return {
    meetingDate: nextMeeting.date,
    meetingLabel: nextMeeting.title,
    currentRate,
    impliedRate,
    monthlyAverageRate,
    expectedChangeBps: (impliedRate - currentRate) * 100,
    hikeProbability: percent(hikeProbability),
    cutProbability: percent(cutProbability),
    distribution: outcomes.map((item) => ({
      id: `outcome-${item.steps}`,
      label: outcomeLabel(item.steps),
      probability: percent(item.probability),
      direction: item.steps > 0 ? 'hike' as const : item.steps < 0 ? 'cut' as const : 'hold' as const,
    })),
    updatedAt: futuresQuote.updatedAt,
    sourceUrl: 'https://www.cmegroup.com/articles/2023/understanding-the-cme-group-fedwatch-tool-methodology.html',
    quoteSourceUrl: futuresQuote.sourceUrl,
    contractSymbol,
    method: '会议月 ZQ 日历加权估算',
    status: 'delayed' as const,
  };
}

const globalMacroMetricLastGood = new Map<string, any>();
const globalPmiMetricLastGood = new Map<string, Awaited<ReturnType<typeof getGlobalPmiMetric>>>();
const globalCpiMetricLastGood = new Map<GlobalCpiMetric['id'], GlobalCpiMetric>();

async function loadGlobalMarketsSection() {
  const quoteTaskFactories = globalMacroQuotes.map((config) => async () => {
    const quote = config.id === 'nigeria'
      ? await getNgxAllShareQuote()
      : config.id === 'russia'
        ? await getYahooMacroQuote(config.symbol).catch(() => getYahooMacroSnapshot(config.symbol))
        : await getYahooMacroQuote(config.symbol);
    const stale = Date.now() - new Date(quote.updatedAt).getTime() > 14 * 24 * 60 * 60 * 1000;
    const session = globalSession(config);
    return {
      id: config.id,
      name: config.name,
      symbol: config.symbol,
      market: config.market,
      region: config.region,
      latitude: config.latitude,
      longitude: config.longitude,
      session,
      quoteStale: stale,
      ...quote,
    };
  });
  const quoteRequest = (async () => {
    const results: PromiseSettledResult<Awaited<ReturnType<(typeof quoteTaskFactories)[number]>>>[] = [];
    for (let index = 0; index < quoteTaskFactories.length; index += 5) {
      results.push(...await Promise.allSettled(quoteTaskFactories.slice(index, index + 5).map((task) => task())));
    }
    return results;
  })();
  const tickerSnapshotRequest = Promise.allSettled([getEquityIndexSnapshots()]);
  const [quotes, tickerSnapshotResults, vtResult, soxResult] = await Promise.all([
    quoteRequest,
    tickerSnapshotRequest,
    Promise.allSettled([getYahooMacroQuote('VT', '3mo')]),
    Promise.allSettled([getYahooMacroQuote('^SOX', '3mo')]),
  ]);
  const items = quotes.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  const tickerSnapshots = tickerSnapshotResults[0]?.status === 'fulfilled'
    ? tickerSnapshotResults[0].value
    : { indices: [] as MarketIndexSnapshot[] };
  const tickerPool = new Map<string, { price: number; changePercent: number; updatedAt?: string; sourceUrl: string }>();
  items.forEach((item) => tickerPool.set(item.id, item));
  tickerSnapshots.indices.forEach((item) => tickerPool.set(item.id, item));
  const ticker = globalMacroTickerConfigs.flatMap((config) => {
    const quote = tickerPool.get(config.sourceId);
    return quote ? [{ id: config.id, name: config.name, symbol: config.symbol, price: quote.price, changePercent: quote.changePercent, updatedAt: quote.updatedAt, sourceUrl: quote.sourceUrl }] : [];
  });
  const soxQuote = soxResult[0]?.status === 'fulfilled' ? soxResult[0].value : null;
  const coreIndexConfigs = [
    { id: 'nasdaq', name: '纳斯达克100', symbol: '^NDX', quote: items.find((item) => item.id === 'nasdaq'), sourceUrl: 'https://finance.yahoo.com/quote/%5ENDX' },
    { id: 'sp500', name: '标普500', symbol: '^GSPC', quote: items.find((item) => item.id === 'us'), sourceUrl: 'https://finance.yahoo.com/quote/%5EGSPC' },
    { id: 'shanghai', name: '上证指数', symbol: '000001.SS', quote: items.find((item) => item.id === 'china'), sourceUrl: 'https://finance.yahoo.com/quote/000001.SS' },
    { id: 'sox', name: '费城半导体指数', symbol: '^SOX', quote: soxQuote || undefined, sourceUrl: 'https://finance.yahoo.com/quote/%5ESOX' },
  ] as const;
  const coreIndices = coreIndexConfigs.map((config) => ({
    id: config.id,
    name: config.name,
    symbol: config.symbol,
    price: config.quote?.price ?? null,
    changePercent: config.quote?.changePercent ?? null,
    updatedAt: config.quote?.updatedAt,
    sourceUrl: config.quote?.sourceUrl || config.sourceUrl,
    history: config.quote?.history?.slice(-22) || [],
    status: config.quote ? 'delayed' as const : 'unavailable' as const,
  }));

  return {
    generatedAt: new Date().toISOString(),
    quoteSource: 'Yahoo Finance + Stock Market Nigeria',
    global: vtResult[0]?.status === 'fulfilled'
      ? { id: 'vt', name: '全球股票 VT', symbol: 'VT', region: 'global' as const, latitude: 0, longitude: 0, session: { label: '全球市场代理', tone: 'unknown' as const }, ...vtResult[0].value }
      : null,
    ticker,
    coreIndices,
    markets: items,
  };
}

async function loadGlobalMacroMetricsSection(forceOfficial = false) {
  const withMacroTimeout = <T>(promise: Promise<T>, timeoutMs: number, label: string) => Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label}请求超时`)), timeoutMs)),
  ]);
  const macroTaskFactories: Array<() => Promise<any>> = [
    () => getUsPpiMacroMetric(forceOfficial),
    () => getVixMacroMetric(),
    async () => {
      const quote = await getYahooMacroQuote('DX-Y.NYB');
      return {
        id: 'dxy',
        label: '美元指数',
        value: quote.price,
        display: quote.price.toFixed(2),
        change: quote.changePercent,
        updatedAt: quote.updatedAt,
        sourceUrl: quote.sourceUrl,
        status: 'live' as const,
        history: quote.history.slice(-48),
      };
    },
    () => getFredMacroMetric('us10y', ['DGS10'], '美国10年期国债收益率', (value) => `${value.toFixed(2)}%`),
    () => getFredMacroMetric('ust2y10y', ['T10Y2Y'], '美债 2Y-10Y 利差', (value) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`),
    () => getFredMacroMetric('fedfunds', ['DFF', 'FEDFUNDS'], '联邦基金利率', (value) => `${value.toFixed(2)}%`),
    () => getGscpiMetric(),
    () => getUsCpiPceMacroMetric(forceOfficial),
    () => getBlsOfficialMacroMetric('unemployment', forceOfficial).catch(() => (
      getFredMacroMetric(
        'unemployment',
        ['UNRATE'],
        '美国失业率',
        (value) => `${value.toFixed(1)}%`,
        undefined,
        (value) => signedMetricChange(value, 'pct'),
      )
    )),
    () => getBlsOfficialMacroMetric('nonfarm', forceOfficial).catch(() => (
      getFredMacroMetric(
        'nonfarm',
        ['PAYEMS'],
        '非农就业变动',
        (value) => `${Math.round(value)} 千人`,
        (values) => values.slice(1).map((item, index) => ({ time: item.time, value: item.value - values[index].value })),
        (value) => `${value > 0 ? '+' : ''}${Math.round(value)} 千人`,
      )
    )),
  ];
  const macroRequest = Promise.allSettled(macroTaskFactories.map((task) => withMacroTimeout(task(), 18_000, '宏观指标')));
  const nextMeeting = officialMacroEvents.find((event) => (
    event.kind === 'central-bank' && new Date(`${event.date}T23:59:59Z`).getTime() >= Date.now()
  ));
  const fedFundsContract = nextMeeting ? getFedFundsMeetingContract(nextMeeting.date) : null;
  const fedFundsFutureRequest = fedFundsContract
    ? Promise.allSettled([withMacroTimeout(getYahooMacroQuote(fedFundsContract, '1mo'), 10_000, '联邦基金期货')])
    : Promise.resolve([] as PromiseSettledResult<Awaited<ReturnType<typeof getYahooMacroQuote>>>[]);
  const cpiRequest = Promise.allSettled([
    withMacroTimeout(getChinaCpiMetric(), 15_000, '中国 CPI'),
    withMacroTimeout(getUsCpiMetric(forceOfficial), 15_000, '美国 CPI'),
  ]);
  const [macro, fedFundsFuture, cpiResults] = await Promise.all([macroRequest, fedFundsFutureRequest, cpiRequest]);
  const macroMetricIds = ['ppi', 'vix', 'dxy', 'us10y', 'ust2y10y', 'fedfunds', 'gscpi', 'cpi-pce', 'unemployment', 'nonfarm'];
  const macroMetricLabels = ['美国 PPI 月率', 'VIX 波动率', '美元指数', '美国10年期国债收益率', '美债 2Y-10Y 利差', '联邦基金利率', '供应链压力', '美国 CPI / PCE 月率', '美国失业率', '非农就业变动'];
  const macroMetrics = macro.map((result, index) => {
    const metricId = macroMetricIds[index];
    if (result.status === 'fulfilled') {
      globalMacroMetricLastGood.set(metricId, result.value);
      return result.value;
    }
    const lastGood = globalMacroMetricLastGood.get(metricId);
    if (lastGood) return lastGood;
    const fallbackSourceUrls: Record<string, string> = {
      ppi: fredSeriesPageUrl('PPIFIS'),
      vix: fredSeriesPageUrl('VIXCLS'),
      dxy: 'https://finance.yahoo.com/quote/DX-Y.NYB',
      us10y: fredSeriesPageUrl('DGS10'),
      ust2y10y: fredSeriesPageUrl('T10Y2Y'),
      fedfunds: fredSeriesPageUrl('DFF'),
      gscpi: 'https://www.newyorkfed.org/research/policy/gscpi',
      'cpi-pce': fredSeriesPageUrl('CPIAUCSL'),
      unemployment: fredSeriesPageUrl('UNRATE'),
      nonfarm: fredSeriesPageUrl('PAYEMS'),
    };
    return { id: metricId, label: macroMetricLabels[index], value: null, display: '待更新', change: null, sourceUrl: fallbackSourceUrls[metricId] || 'https://fred.stlouisfed.org/', status: 'unavailable' as const, history: [] };
  });
  const fedFundsMetric = macroMetrics.find((item) => item.id === 'fedfunds');
  const fedRateExpectation = nextMeeting && fedFundsContract && fedFundsFuture[0]?.status === 'fulfilled' && fedFundsMetric?.value !== null && fedFundsMetric?.value !== undefined
    ? buildFedRateExpectation(fedFundsFuture[0].value, fedFundsMetric.value, nextMeeting, fedFundsContract)
    : null;

  const cpiFallbacks: GlobalCpiMetric[] = [
    { id: 'china-cpi', label: '中国 CPI', value: null, display: '待更新', change: null, period: '等待数据', updatedAt: '', source: '国家统计局', sourceUrl: 'https://www.stats.gov.cn/sj/zxfb/', status: 'unavailable', history: [] },
    { id: 'us-cpi', label: '美国 CPI', value: null, display: '待更新', change: null, period: '等待数据', updatedAt: '', source: '美国劳工统计局', sourceUrl: 'https://www.bls.gov/cpi/', status: 'unavailable', history: [] },
  ];
  const cpi = cpiResults.map((result, index) => {
    const fallback = cpiFallbacks[index];
    if (result.status === 'fulfilled') {
      globalCpiMetricLastGood.set(result.value.id, result.value);
      return result.value;
    }
    return globalCpiMetricLastGood.get(fallback.id) || fallback;
  });

  const releasePlan = getMacroReleaseSyncPlan();
  return {
    generatedAt: new Date().toISOString(),
    macro: macroMetrics,
    cpi,
    fedRateExpectation,
    releaseSync: {
      active: releasePlan.active,
      synced: releasePlan.synced,
      pollAfterMs: releasePlan.pollAfterMs,
      checkedAt: new Date().toISOString(),
      release: releasePlan.release,
      nextRelease: releasePlan.nextRelease,
    },
  };
}

async function loadOfficialMacroReleasePatch() {
  const before = getMacroReleaseSyncPlan();
  const macro: Array<Record<string, unknown>> = [];
  const cpi: GlobalCpiMetric[] = [];
  if (before.active && !before.synced && before.release) {
    if (before.release.family === 'ppi') {
      macro.push(await getBlsOfficialMacroMetric('ppi', true));
    } else if (before.release.family === 'cpi') {
      const [metric, card] = await Promise.all([
        getBlsOfficialMacroMetric('cpi', true),
        getUsCpiMetric(true),
      ]);
      const currentComposite = globalMacroMetricLastGood.get('cpi-pce');
      macro.push(currentComposite
        ? {
          ...currentComposite,
          value: metric.value,
          display: String(currentComposite.display).replace(/CPI\s+[^/]+\//, `CPI ${metric.display} /`),
          change: metric.change,
          changeDisplay: metric.changeDisplay ? `CPI ${metric.changeDisplay}` : undefined,
          updatedAt: metric.updatedAt,
          sourceUrl: metric.sourceUrl,
          history: metric.history,
        }
        : metric);
      cpi.push(card);
    } else if (before.release.family === 'employment') {
      macro.push(...await Promise.all([
        getBlsOfficialMacroMetric('unemployment', true),
        getBlsOfficialMacroMetric('nonfarm', true),
      ]));
    } else {
      macro.push(await getUsCpiPceMacroMetric(true));
    }
  }
  macro.forEach((metric) => {
    if (typeof metric.id === 'string') globalMacroMetricLastGood.set(metric.id, metric);
  });
  cpi.forEach((metric) => globalCpiMetricLastGood.set(metric.id, metric));
  const after = getMacroReleaseSyncPlan();
  return {
    generatedAt: new Date().toISOString(),
    macro,
    cpi,
    releaseSync: {
      active: after.active,
      synced: after.synced,
      pollAfterMs: after.pollAfterMs,
      checkedAt: new Date().toISOString(),
      release: after.release,
      nextRelease: after.nextRelease,
    },
  };
}

async function loadGlobalPmiSection() {
  const pmiRequest = (async () => {
    const results: PromiseSettledResult<Awaited<ReturnType<typeof getGlobalPmiMetric>>>[] = [];
    for (const config of globalPmiConfigs) {
      results.push(...await Promise.allSettled([getGlobalPmiMetric(config)]));
    }
    return results;
  })();
  const pmi = await pmiRequest;
  return {
    generatedAt: new Date().toISOString(),
    pmi: pmi.map((result, index) => {
      const config = globalPmiConfigs[index];
      if (result.status === 'fulfilled') {
        globalPmiMetricLastGood.set(config.id, result.value);
        return result.value;
      }
      return globalPmiMetricLastGood.get(config.id) || { id: config.id, label: config.label, value: null, display: '待更新', change: null, sourceUrl: `https://tradingeconomics.com/${config.slug}/manufacturing-pmi`, status: 'unavailable' as const, history: [] };
    }),
  };
}

async function loadGlobalCommoditiesSection() {
  const taskFactories = globalMacroCommodities.map(([id, label, symbol]) => async () => {
    const quote = await getYahooMacroQuote(symbol);
    return { id, label, value: quote.price, display: new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(quote.price), change: quote.changePercent, updatedAt: quote.updatedAt, sourceUrl: quote.sourceUrl, status: 'live' as const, history: quote.history.slice(-24) };
  });
  const commodities: PromiseSettledResult<Awaited<ReturnType<(typeof taskFactories)[number]>>>[] = [];
  for (let index = 0; index < taskFactories.length; index += 4) {
    commodities.push(...await Promise.allSettled(taskFactories.slice(index, index + 4).map((task) => task())));
  }
  return {
    generatedAt: new Date().toISOString(),
    commodities: commodities.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []),
  };
}

const GLOBAL_MACRO_FAST_QUOTE_CADENCE_MS = 4_000;
const GLOBAL_MACRO_FAST_QUOTE_CACHE_TTL_MS = 3_000;

function fastQuoteStatus(updatedAt?: string) {
  const timestamp = updatedAt ? new Date(updatedAt).getTime() : Number.NaN;
  return Number.isFinite(timestamp) && Date.now() - timestamp <= 20 * 60_000
    ? 'live' as const
    : 'delayed' as const;
}

function fastQuoteDisplay(value: number) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
}

function createBudgetedFastQuoteSource<T>(loader: () => Promise<T>, initialBudgetMs = 2_500) {
  let data: T | undefined;
  let inFlight: Promise<T | undefined> | undefined;
  let lastError: string | undefined;
  const start = () => {
    if (!inFlight) {
      inFlight = loader()
        .then((value) => {
          data = value;
          lastError = undefined;
          return value;
        })
        .catch((error) => {
          lastError = error instanceof Error ? error.message : String(error);
          return data;
        })
        .finally(() => {
          inFlight = undefined;
        });
    }
    return inFlight;
  };

  return async () => {
    const startedAt = Date.now();
    const request = start();
    if (data !== undefined) return { data, latencyMs: 0, error: lastError };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), initialBudgetMs);
    });
    const value = await Promise.race([request, timeout]);
    if (timer) clearTimeout(timer);
    return { data: value ?? data, latencyMs: Date.now() - startedAt, error: lastError };
  };
}

const readFastEquitySource = createBudgetedFastQuoteSource(() => getEquityIndexSnapshots());
const readFastGlobalIndexSource = createBudgetedFastQuoteSource(() => getEastMoneyGlobalFastQuotes());
const readFastAssetSource = createBudgetedFastQuoteSource(() => getSinaFastAssetQuotes());
const readFastCryptoYahooSource = createBudgetedFastQuoteSource(() => getYahooFastCryptoQuotes());
const readFastCryptoBinanceSource = createBudgetedFastQuoteSource(() => getBinanceFastCryptoQuotes());
const readFastCryptoCoinGeckoSource = createBudgetedFastQuoteSource(() => getCoinGeckoFastCryptoQuotes());

async function readFastCryptoSource() {
  const startedAt = Date.now();
  const results = await Promise.all([
    readFastCryptoYahooSource(),
    readFastCryptoBinanceSource(),
    readFastCryptoCoinGeckoSource(),
  ]);
  results.forEach((result) => {
    if (result.data?.size) mergeFreshCryptoQuotes(result.data);
  });
  const errors = results.flatMap((result) => result.error ? [result.error] : []);
  return {
    data: fastCryptoLastGood.size ? new Map(fastCryptoLastGood) : undefined,
    latencyMs: Date.now() - startedAt,
    error: fastCryptoLastGood.size ? undefined : errors.join('；') || '加密行情暂时不可用',
  };
}

async function loadGlobalMacroFastQuotes() {
  const yahooMarketIds = new Set(['japan', 'india', 'germany', 'france', 'uk']);
  const yahooMarketSymbols = globalMacroQuotes
    .filter((item) => yahooMarketIds.has(item.id))
    .map((item) => item.symbol);
  const yahooSymbols = [
    ...globalMacroQuotes.map((item) => item.symbol),
    ...globalMacroCommodities.map(([, , symbol]) => symbol),
    'VT',
    '^SOX',
    '^TNX',
    'DX-Y.NYB',
  ];
  refreshYahooFastQuotesInBackground(yahooSymbols);
  const [equityResult, globalIndexResult, assetResult, cryptoResult, yahooMarketQuotes] = await Promise.all([
    readFastEquitySource(),
    readFastGlobalIndexSource(),
    readFastAssetSource(),
    readFastCryptoSource(),
    getYahooFastQuotes(yahooMarketSymbols),
  ]);
  const yahoo = new Map(yahooFastQuoteLastGood);
  yahooMarketQuotes.forEach((quote, symbol) => yahoo.set(symbol, quote));
  const equitySnapshots = equityResult.data?.indices || [];
  const globalIndexQuotes: Map<string, YahooFastQuote> = globalIndexResult.data || new Map();
  const assetQuotes: Map<string, YahooFastQuote> = assetResult.data || new Map();
  const cryptoQuotes: Map<string, YahooFastQuote> = cryptoResult.data || new Map();
  const equityById = new Map(equitySnapshots.map((item) => [item.id, item]));
  const marketEquityIds = new Map([
    ['china', 'sse'],
    ['hongkong', 'hsi'],
    ['us', 'sp500'],
  ]);

  const markets = globalMacroQuotes.flatMap((config) => {
    const equityId = marketEquityIds.get(config.id);
    const quote = yahooMarketIds.has(config.id)
      ? yahoo.get(config.symbol)
      : (equityId ? equityById.get(equityId) : undefined)
        || globalIndexQuotes.get(config.id)
        || yahoo.get(config.symbol);
    if (!quote) return [];
    return [{
      id: config.id,
      name: config.name,
      symbol: config.symbol,
      market: config.market,
      region: config.region,
      latitude: config.latitude,
      longitude: config.longitude,
      session: globalSession(config),
      price: quote.price,
      changePercent: quote.changePercent,
      updatedAt: quote.updatedAt,
      sourceUrl: quote.sourceUrl,
      history: [],
    }];
  });
  const marketById = new Map(markets.map((item) => [item.id, item]));
  const tickerPool = new Map<string, { price: number; changePercent: number; updatedAt?: string; sourceUrl: string }>();
  markets.forEach((item) => tickerPool.set(item.id, item));
  equitySnapshots.forEach((item) => tickerPool.set(item.id, item));
  const ticker = globalMacroTickerConfigs.flatMap((config) => {
    const quote = tickerPool.get(config.sourceId);
    return quote ? [{
      id: config.id,
      name: config.name,
      symbol: config.symbol,
      price: quote.price,
      changePercent: quote.changePercent,
      updatedAt: quote.updatedAt,
      sourceUrl: quote.sourceUrl,
    }] : [];
  });

  const coreSources = [
    { id: 'nasdaq', name: '纳斯达克100', symbol: '^NDX', quote: equityById.get('nasdaq') || marketById.get('nasdaq'), sourceUrl: 'https://finance.yahoo.com/quote/%5ENDX' },
    { id: 'sp500', name: '标普500', symbol: '^GSPC', quote: equityById.get('sp500') || marketById.get('us'), sourceUrl: 'https://finance.yahoo.com/quote/%5EGSPC' },
    { id: 'shanghai', name: '上证指数', symbol: '000001.SS', quote: equityById.get('sse') || marketById.get('china'), sourceUrl: 'https://finance.yahoo.com/quote/000001.SS' },
    { id: 'sox', name: '费城半导体指数', symbol: '^SOX', quote: equityById.get('sox') || yahoo.get('^SOX'), sourceUrl: 'https://finance.yahoo.com/quote/%5ESOX' },
  ] as const;
  const coreIndices = coreSources.map((config) => ({
    id: config.id,
    name: config.name,
    symbol: config.symbol,
    price: config.quote?.price ?? null,
    changePercent: config.quote?.changePercent ?? null,
    updatedAt: config.quote?.updatedAt,
    sourceUrl: config.quote?.sourceUrl || config.sourceUrl,
    history: [],
    status: config.quote ? fastQuoteStatus(config.quote.updatedAt) : 'unavailable' as const,
  }));

  const vixQuote = marketById.get('vix');
  const dxyQuote = assetQuotes.get('dxy') || yahoo.get('DX-Y.NYB');
  const us10yQuote = yahoo.get('^TNX');
  const macro = [
    vixQuote ? {
      id: 'vix', label: 'VIX 波动率', value: vixQuote.price, display: vixQuote.price.toFixed(2),
      change: yahoo.get('^VIX')?.change ?? null, updatedAt: vixQuote.updatedAt, sourceUrl: vixQuote.sourceUrl,
      status: fastQuoteStatus(vixQuote.updatedAt), history: [],
    } : null,
    dxyQuote ? {
      id: 'dxy', label: '美元指数', value: dxyQuote.price, display: dxyQuote.price.toFixed(2),
      change: dxyQuote.changePercent, updatedAt: dxyQuote.updatedAt, sourceUrl: dxyQuote.sourceUrl,
      status: fastQuoteStatus(dxyQuote.updatedAt), history: [],
    } : null,
    us10yQuote ? {
      id: 'us10y', label: '美国10年期国债收益率', value: us10yQuote.price, display: `${us10yQuote.price.toFixed(2)}%`,
      change: us10yQuote.change, updatedAt: us10yQuote.updatedAt, sourceUrl: us10yQuote.sourceUrl,
      status: fastQuoteStatus(us10yQuote.updatedAt), history: [],
    } : null,
  ].filter((item) => item !== null);

  const commodities = globalMacroCommodities.flatMap(([id, label, symbol]) => {
    const quote = cryptoQuotes.get(id) || assetQuotes.get(id) || yahoo.get(symbol);
    if (!quote) return [];
    return [{
      id,
      label,
      value: quote.price,
      display: fastQuoteDisplay(quote.price),
      change: quote.changePercent,
      updatedAt: quote.updatedAt,
      sourceUrl: quote.sourceUrl,
      status: fastQuoteStatus(quote.updatedAt),
      history: [],
    }];
  });

  const vtQuote = yahoo.get('VT');
  const global = vtQuote ? {
    ...vtQuote,
    id: 'vt',
    name: '全球股票 VT',
    symbol: 'VT',
    region: 'global' as const,
    latitude: 0,
    longitude: 0,
    session: { label: '全球市场代理', tone: 'unknown' as const },
    history: [],
  } : null;

  return {
    generatedAt: new Date().toISOString(),
    cadenceMs: GLOBAL_MACRO_FAST_QUOTE_CADENCE_MS,
    coverage: {
      yahoo: yahoo.size,
      equities: equitySnapshots.length,
      globalIndices: globalIndexQuotes.size,
      assets: assetQuotes.size,
      crypto: cryptoQuotes.size,
      latencyMs: {
        yahoo: null,
        equities: equityResult.latencyMs,
        globalIndices: globalIndexResult.latencyMs,
        assets: assetResult.latencyMs,
        crypto: cryptoResult.latencyMs,
      },
      errors: {
        equities: equityResult.error,
        globalIndices: globalIndexResult.error,
        assets: assetResult.error,
        crypto: cryptoResult.error,
      },
    },
    global,
    ticker,
    markets,
    coreIndices,
    macro,
    commodities,
  };
}

type GlobalMacroFastQuotePayload = Awaited<ReturnType<typeof loadGlobalMacroFastQuotes>>;
let globalMacroFastQuoteCache: { storedAt: number; data: GlobalMacroFastQuotePayload } | undefined;
let globalMacroFastQuoteInFlight: Promise<GlobalMacroFastQuotePayload> | undefined;

async function refreshGlobalMacroFastQuotes() {
  if (!globalMacroFastQuoteInFlight) {
    globalMacroFastQuoteInFlight = loadGlobalMacroFastQuotes()
      .then((data) => {
        globalMacroFastQuoteCache = { storedAt: Date.now(), data };
        return data;
      })
      .catch((error) => {
        if (globalMacroFastQuoteCache) return globalMacroFastQuoteCache.data;
        throw error;
      })
      .finally(() => {
        globalMacroFastQuoteInFlight = undefined;
      });
  }
  return globalMacroFastQuoteInFlight;
}

async function getCachedGlobalMacroFastQuotes() {
  const now = Date.now();
  if (globalMacroFastQuoteCache && now - globalMacroFastQuoteCache.storedAt < GLOBAL_MACRO_FAST_QUOTE_CACHE_TTL_MS) {
    return globalMacroFastQuoteCache.data;
  }
  return refreshGlobalMacroFastQuotes();
}

async function loadGlobalNewsSection(region: GlobalMacroRegion) {
  const [wallstreetCnNews, internationalNews] = await Promise.all([
    getWallstreetCnDailyNews(region),
    getGlobalMacroTickerNews(region).catch(() => []),
  ]);
  const news = internationalNews;
  const focusNews = wallstreetCnNews.slice(0, 12);
  return { generatedAt: new Date().toISOString(), news, focusNews };
}

async function loadGlobalCalendarSection() {
  const earnings = await getUpcomingEarnings().catch(() => []);
  return {
    generatedAt: new Date().toISOString(),
    calendar: [...officialMacroEvents, ...earnings]
      .filter((event) => new Date(`${event.date}T23:59:59Z`).getTime() >= Date.now())
      .sort((left, right) => left.date.localeCompare(right.date) || (left.importance === 'high' ? -1 : 1))
      .slice(0, 12),
  };
}

const globalMacroSectionNames = ['markets', 'macro', 'pmi', 'commodities', 'news', 'calendar'] as const;
type GlobalMacroSectionName = (typeof globalMacroSectionNames)[number];

async function loadGlobalMacroSection(region: GlobalMacroRegion, section: GlobalMacroSectionName, forceOfficial = false) {
  if (section === 'markets') return loadGlobalMarketsSection();
  if (section === 'macro') return loadGlobalMacroMetricsSection(forceOfficial);
  if (section === 'pmi') return loadGlobalPmiSection();
  if (section === 'commodities') return loadGlobalCommoditiesSection();
  if (section === 'news') return loadGlobalNewsSection(region);
  return loadGlobalCalendarSection();
}

async function getGlobalMacroDashboard(region: GlobalMacroRegion) {
  const settled = await Promise.allSettled(globalMacroSectionNames.map((section) => getCachedGlobalMacroSection(region, section)));
  const merged = Object.assign({}, ...settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []));
  return {
    global: null,
    ticker: [],
    coreIndices: [],
    markets: [],
    macro: [],
    fedRateExpectation: null,
    pmi: [],
    cpi: [],
    commodities: [],
    news: [],
    calendar: [],
    ...merged,
    generatedAt: new Date().toISOString(),
  };
}

const globalMacroDashboardCache = new Map<GlobalMacroRegion, { storedAt: number; data: Awaited<ReturnType<typeof getGlobalMacroDashboard>> }>();
const globalMacroDashboardInFlight = new Map<GlobalMacroRegion, Promise<Awaited<ReturnType<typeof getGlobalMacroDashboard>>>>();
type GlobalMacroSectionPayload = Awaited<ReturnType<typeof loadGlobalMacroSection>>;
const globalMacroSectionCache = new Map<string, { storedAt: number; data: GlobalMacroSectionPayload }>();
const globalMacroSectionInFlight = new Map<string, Promise<GlobalMacroSectionPayload>>();
const globalMacroSectionCacheTtl: Record<GlobalMacroSectionName, number> = {
  markets: 30_000,
  macro: 60_000,
  pmi: 15 * 60_000,
  commodities: 30_000,
  news: 20_000,
  calendar: 5 * 60_000,
};
const globalMarketHeatmapCache = new Map<string, { storedAt: number; data: Awaited<ReturnType<typeof getGlobalMarketHeatmap>> }>();
const globalMarketHeatmapInFlight = new Map<string, Promise<Awaited<ReturnType<typeof getGlobalMarketHeatmap>>>>();

async function getCachedGlobalMacroSection(region: GlobalMacroRegion, section: GlobalMacroSectionName, forceOfficial = false) {
  const key = `${region}:${section}`;
  const cached = globalMacroSectionCache.get(key);
  const cachedMacroPayload = section === 'macro'
    ? cached?.data as { macro?: Array<{ id: string; history?: Array<{ time: string; value: number }> }>; cpi?: Array<{ id: string; history?: Array<{ time: string; value: number }> }> }
    : undefined;
  const cachedMacro = cachedMacroPayload?.macro || [];
  const cachedCpi = cachedMacroPayload?.cpi || [];
  const missingOfficialContext = section === 'macro' && Boolean(cached) && (
    ['unemployment', 'nonfarm'].some((id) => {
      const metric = cachedMacro.find((item) => item.id === id);
      return !metric || !Array.isArray(metric.history) || metric.history.length < 2;
    })
    || (() => {
      const metric = cachedCpi.find((item) => item.id === 'us-cpi');
      return !metric || !Array.isArray(metric.history) || metric.history.length < 2;
    })()
  );
  if (!forceOfficial && !missingOfficialContext && cached && Date.now() - cached.storedAt < globalMacroSectionCacheTtl[section]) return cached.data;
  const running = globalMacroSectionInFlight.get(key);
  if (running) return running;

  const request = loadGlobalMacroSection(region, section, forceOfficial)
    .then((data) => {
      globalMacroSectionCache.set(key, { storedAt: Date.now(), data });
      return data;
    })
    .catch((error) => {
      if (cached) return cached.data;
      throw error;
    })
    .finally(() => globalMacroSectionInFlight.delete(key));
  globalMacroSectionInFlight.set(key, request);
  return request;
}

type GlobalCompanyLogoCacheEntry = {
  storedAt: number;
  contentType: string;
  data: Buffer;
};

const globalCompanyLogoCache = new Map<string, GlobalCompanyLogoCacheEntry>();
const globalCompanyLogoInFlight = new Map<string, Promise<GlobalCompanyLogoCacheEntry>>();
const GLOBAL_COMPANY_LOGO_CACHE_MS = 7 * 24 * 60 * 60 * 1000;

async function fetchGlobalCompanyLogo(symbol: string) {
  const domain = globalHeatmapLogoDomains[symbol];
  if (!domain) throw new Error('未配置公司 Logo');
  const cached = globalCompanyLogoCache.get(domain);
  if (cached && Date.now() - cached.storedAt < GLOBAL_COMPANY_LOGO_CACHE_MS) return cached;
  const running = globalCompanyLogoInFlight.get(domain);
  if (running) return running;

  const request = (async () => {
    const sourceUrls = [
      `https://unavatar.io/${encodeURIComponent(domain)}?fallback=false`,
      `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(`https://${domain}`)}&sz=128`,
    ];
    let lastError: unknown;
    for (const sourceUrl of sourceUrls) {
      for (const route of ['direct', 'proxy'] as FetchRoute[]) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8_000);
        try {
          const init: RequestInit & { dispatcher?: any } = {
            signal: controller.signal,
            headers: {
              'User-Agent': 'SparkFlow/1.0 global market heatmap',
              Accept: 'image/avif,image/webp,image/svg+xml,image/png,image/*,*/*;q=0.8',
            },
          };
          if (route === 'proxy') init.dispatcher = foreignProxyAgent;
          const response = await fetch(sourceUrl, init);
          if (!response.ok) throw new Error(`Logo HTTP ${response.status}`);
          const contentType = (response.headers.get('content-type') || 'image/png').split(';')[0].trim();
          if (!contentType.startsWith('image/')) throw new Error('Logo 响应不是图片');
          const data = Buffer.from(await response.arrayBuffer());
          if (!data.length || data.length > 1_500_000) throw new Error('Logo 图片大小异常');
          const entry = { storedAt: Date.now(), contentType, data };
          globalCompanyLogoCache.set(domain, entry);
          return entry;
        } catch (error) {
          lastError = error;
        } finally {
          clearTimeout(timer);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('公司 Logo 暂时不可用');
  })().finally(() => globalCompanyLogoInFlight.delete(domain));

  globalCompanyLogoInFlight.set(domain, request);
  return request;
}

async function getGlobalMarketHeatmap(market: string) {
  const configs = globalHeatmapConfigs[market];
  if (!configs) throw new Error('不支持的全球市场热力图');
  const isKorea = market === 'korea';
  const isTradingViewRegion = ['japan', 'india', 'germany', 'france', 'uk', 'australia', 'saudi'].includes(market);
  const regionalMarket = isTradingViewRegion ? market as TradingViewRegionalMarket : undefined;
  const regionalScanner = regionalMarket === 'australia' || regionalMarket === 'saudi' ? 'global' : regionalMarket;
  const koreaQuotes = isKorea
    ? await getNaverKoreaStockQuotes(configs.map((config) => config.symbol))
    : new Map<string, NormalizedInternationalQuote>();
  const regionalTickers = regionalMarket
    ? configs.map((config) => tradingViewStockTicker(regionalMarket, config.symbol))
    : [];
  const regionalQuotes = regionalMarket
    ? await getTradingViewRegionalQuotesResilient(regionalMarket, regionalTickers, regionalScanner)
    : new Map<string, TradingViewRegionalQuote>();
  const missingRegionalSymbols = regionalMarket
    ? configs
        .filter((config) => !regionalQuotes.has(tradingViewStockTicker(regionalMarket, config.symbol)))
        .map((config) => config.symbol)
    : configs.map((config) => config.symbol);
  const fastQuotes = isKorea
    ? new Map<string, YahooFastQuote>()
    : missingRegionalSymbols.length
      ? await getYahooFastQuotes(missingRegionalSymbols)
      : new Map<string, YahooFastQuote>();
  const settled = await Promise.allSettled(configs.map(async (config) => {
    const koreaQuote = koreaQuotes.get(config.symbol);
    const regionalTicker = regionalMarket ? tradingViewStockTicker(regionalMarket, config.symbol) : undefined;
    const regionalQuote = regionalTicker ? regionalQuotes.get(regionalTicker) : undefined;
    const fastQuote = fastQuotes.get(config.symbol);
    const quote = isKorea
      ? koreaQuote
      : isTradingViewRegion
        ? regionalQuote || fastQuote || await getYahooMacroSnapshot(config.symbol)
      : !fastQuote || Math.abs(fastQuote.changePercent) > 20
        ? await getYahooMacroSnapshot(config.symbol)
        : fastQuote;
    if (!quote) throw new Error(`${config.name} 常规盘行情暂时不可用`);
    const normalizedQuote = quote as YahooFastQuote & Partial<NormalizedInternationalQuote>;
    const actualMarketCap = asFiniteNumber(normalizedQuote.marketCap);
    return {
      id: `${market}-${config.symbol}`,
      ...config,
      code: config.symbol,
      industry: config.sector,
      marketCap: actualMarketCap && actualMarketCap > 0 ? actualMarketCap : config.weight,
      weight: config.weight,
      marketCapType: actualMarketCap && actualMarketCap > 0 ? 'actual' : 'representative-weight',
      logoUrl: `/stock-logos/global-${config.symbol.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.svg`,
      fallbackLogoUrl: globalHeatmapLogoDomains[config.symbol]
        ? `/api/global-company-logo?symbol=${encodeURIComponent(config.symbol)}`
        : undefined,
      price: quote.price,
      previousClose: normalizedQuote.previousClose ?? quote.price - quote.change,
      change: quote.change,
      changePercent: quote.changePercent,
      updatedAt: quote.updatedAt,
      marketState: normalizedQuote.marketState ?? 'REGULAR',
      quoteProvider: normalizedQuote.provider ?? 'Yahoo Finance Spark',
      sourceDelaySeconds: 'sourceDelaySeconds' in normalizedQuote
        ? asFiniteNumber(normalizedQuote.sourceDelaySeconds) ?? 0
        : 0,
      sourceUrl: quote.sourceUrl,
    };
  }));
  const stocks = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  if (!stocks.length) throw new Error('市场成分股行情暂时不可用');
  if ((isKorea || isTradingViewRegion) && stocks.filter((stock) => stock.marketCapType === 'actual').length !== configs.length) {
    throw new Error('区域市场行情不完整，保留最近一次完整快照');
  }
  const marketConfig = globalMacroQuotes.find((config) => config.id === market);
  const session = marketConfig ? globalSession(marketConfig) : { label: '行情状态未知', tone: 'closed' as const };
  const explicitDelays = stocks
    .map((stock) => asFiniteNumber(stock.sourceDelaySeconds))
    .filter((value): value is number => value !== undefined && value > 0);
  const latestQuoteMs = Math.max(...stocks.map((stock) => new Date(stock.updatedAt).getTime()).filter(Number.isFinite));
  const sourceDelaySeconds = explicitDelays.length
    ? Math.max(...explicitDelays)
    : Number.isFinite(latestQuoteMs) ? Math.max(0, Math.round((Date.now() - latestQuoteMs) / 1000)) : null;
  const quoteStatus = session.tone !== 'live'
    ? 'closed'
    : ['india', 'uk'].includes(market) || (sourceDelaySeconds !== null && sourceDelaySeconds > 90) ? 'delayed' : 'live';
  return {
    market,
    generatedAt: new Date().toISOString(),
    count: stocks.length,
    coverage: isKorea
      ? `${stocks.length} 家代表性龙头 · KRX 常规盘 · 真实总市值输入 · 可读性压缩面积`
      : isTradingViewRegion
        ? `${stocks.length} 家代表性龙头 · 区域交易所行情 · 实际总市值面积`
      : `${stocks.length} 家代表性龙头 · 行业分组 · 代表权重面积`,
    refreshIntervalMs: 3_000,
    quoteStatus,
    sourceDelaySeconds,
    session,
    source: isKorea
      ? 'Naver Finance · KRX 常规盘'
      : regionalMarket === 'india'
        ? 'TradingView · NSE 公开快照（Yahoo 降级）'
      : regionalMarket === 'uk'
        ? 'TradingView · LSE 公开快照（Yahoo 降级）'
      : regionalMarket === 'australia'
        ? 'TradingView · ASX（Yahoo 降级）'
        : regionalMarket === 'saudi'
          ? 'TradingView · TADAWUL（Yahoo 降级）'
          : isTradingViewRegion ? 'TradingView · 区域交易所行情（Yahoo 降级）' : 'Yahoo Finance Spark',
    sourceUrl: isKorea
      ? 'https://finance.naver.com/sise/'
      : regionalMarket === 'australia'
        ? 'https://www.tradingview.com/markets/stocks-australia/market-movers-large-cap/'
        : regionalMarket === 'saudi'
          ? 'https://www.tradingview.com/markets/stocks-saudi-arabia/market-movers-large-cap/'
          : isTradingViewRegion
            ? `https://www.tradingview.com/markets/stocks-${market}/market-movers-large-cap/`
      : marketConfig
      ? `https://finance.yahoo.com/quote/${encodeURIComponent(marketConfig.symbol)}`
      : 'https://finance.yahoo.com/markets/',
    industryMarketCaps: stocks.reduce<Record<string, number>>((result, stock) => {
      result[stock.industry] = (result[stock.industry] || 0) + stock.marketCap;
      return result;
    }, {}),
    weightMethod: isKorea
      ? '现价 × 上市股数（真实总市值）；热力图使用非线性压缩避免代表样本过度集中'
      : isTradingViewRegion ? '区域交易所基础总市值' : '代表性成分股静态权重代理',
    quotePolicy: isKorea
      ? '排除 NXT/盘后价格，仅展示韩国交易所常规盘口径'
      : market === 'india'
        ? '非 NSE 交易所直连逐笔行情；每 3 秒仅表示页面检查频率，实际更新可能受 TradingView 授权与缓存延迟影响'
      : market === 'uk'
        ? '非 LSE 交易所直连逐笔行情；每 3 秒仅表示页面检查频率，实际更新可能受 TradingView 授权与缓存延迟影响'
      : isTradingViewRegion
        ? '现价、昨收、涨跌和总市值来自同一区域行情快照；延迟按授权状态明确标注'
        : '同一数据源现价与昨收口径',
    stocks,
  };
}

const GLOBAL_MARKET_HEATMAP_CACHE_TTL_MS = 3_000;

async function getCachedGlobalMarketHeatmap(market: string) {
  const cached = globalMarketHeatmapCache.get(market);
  if (cached && Date.now() - cached.storedAt < GLOBAL_MARKET_HEATMAP_CACHE_TTL_MS) return cached.data;
  const running = globalMarketHeatmapInFlight.get(market);
  if (running) return running.catch(() => {
    if (cached) return cached.data;
    throw new Error('市场成分股行情暂时不可用');
  });
  const request = getGlobalMarketHeatmap(market)
    .catch(async (error) => {
      if (cached) return cached.data;
      await new Promise<void>((resolve) => setTimeout(resolve, 400));
      return getGlobalMarketHeatmap(market).catch(() => { throw error; });
    })
    .then((data) => {
      globalMarketHeatmapCache.set(market, { storedAt: Date.now(), data });
      return data;
    })
    .finally(() => globalMarketHeatmapInFlight.delete(market));
  globalMarketHeatmapInFlight.set(market, request);
  return request;
}

async function getCachedGlobalMacroDashboard(region: GlobalMacroRegion) {
  const now = Date.now();
  const cached = globalMacroDashboardCache.get(region);
  if (cached && now - cached.storedAt < 45_000) return cached.data;
  const running = globalMacroDashboardInFlight.get(region);
  if (!running) {
    const request = getGlobalMacroDashboard(region).then((data) => {
      globalMacroDashboardCache.set(region, { storedAt: Date.now(), data });
      return data;
    }).finally(() => { globalMacroDashboardInFlight.delete(region); });
    globalMacroDashboardInFlight.set(region, request);
    return request;
  }
  return running;
}

async function getCachedCryptoMarketSnapshots() {
  const now = Date.now();
  if (cryptoQuotesCache && now - cryptoQuotesCache.storedAt < 2_500) {
    return cryptoQuotesCache.data;
  }
  if (!cryptoQuotesInFlight) {
    cryptoQuotesInFlight = getCryptoMarketSnapshots()
      .then((data) => {
        cryptoQuotesCache = { storedAt: Date.now(), data };
        return data;
      })
      .finally(() => {
        cryptoQuotesInFlight = undefined;
      });
  }
  return cryptoQuotesInFlight;
}

async function getCachedChinaMarketHeatmap() {
  const now = Date.now();
  if (chinaHeatmapCache && now - chinaHeatmapCache.storedAt < 2500) {
    return chinaHeatmapCache.data;
  }
  if (!chinaHeatmapInFlight) {
    chinaHeatmapInFlight = getChinaMarketHeatmap()
      .then((data) => {
        chinaHeatmapCache = { storedAt: Date.now(), data };
        return data;
      })
      .finally(() => {
        chinaHeatmapInFlight = undefined;
      });
  }
  return chinaHeatmapInFlight;
}

async function getCachedHongKongMarketHeatmap() {
  const now = Date.now();
  if (hongKongHeatmapCache && now - hongKongHeatmapCache.storedAt < 2500) {
    return hongKongHeatmapCache.data;
  }
  if (!hongKongHeatmapInFlight) {
    hongKongHeatmapInFlight = getHongKongMarketHeatmap()
      .then((data) => {
        hongKongHeatmapCache = { storedAt: Date.now(), data };
        return data;
      })
      .finally(() => {
        hongKongHeatmapInFlight = undefined;
      });
  }
  return hongKongHeatmapInFlight;
}

async function getCachedUsMarketHeatmap() {
  const now = Date.now();
  if (usHeatmapCache && now - usHeatmapCache.storedAt < 2500) {
    return usHeatmapCache.data;
  }
  if (!usHeatmapInFlight) {
    usHeatmapInFlight = getUsMarketHeatmap()
      .then((data) => {
        usHeatmapCache = { storedAt: Date.now(), data };
        return data;
      })
      .finally(() => {
        usHeatmapInFlight = undefined;
      });
  }
  return usHeatmapInFlight;
}

function getAgeDays(dateString?: string) {
  if (!dateString) return undefined;
  const time = new Date(dateString).getTime();
  if (!Number.isFinite(time)) return undefined;
  return Math.max(0, Math.floor((Date.now() - time) / 86400000));
}

function freshnessLabel(ageDays?: number) {
  if (ageDays === undefined) return '未知日期';
  if (ageDays <= 14) return '最新';
  if (ageDays <= 30) return '近期';
  return '过期';
}

function withFreshness(source: Omit<MarketSource, 'ageDays' | 'freshnessLabel'>): MarketSource {
  const ageDays = getAgeDays(source.latestDate);
  return { ...source, ageDays, freshnessLabel: freshnessLabel(ageDays) };
}

function readLocalJson(relativePath: string) {
  const filePath = path.join(allWeatherDataDir, relativePath);
  if (!existsSync(filePath)) throw new Error(`Missing local data: ${relativePath}`);
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function getLocalNasdaqDrawdownSource(): MarketSource {
  const payload = readLocalJson(path.join('candles', 'nasdaq-1d.json'));
  const candles = Array.isArray(payload.candles) ? payload.candles : [];
  const latest = candles.at(-1);
  const peak = candles.reduce((max: number, candle: { adjClose?: number; close?: number }) => {
    const value = Number(candle.adjClose ?? candle.close);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);
  const latestValue = Number(latest?.adjClose ?? latest?.close);
  const drawdown = peak > 0 && Number.isFinite(latestValue) ? latestValue / peak - 1 : 0;

  return withFreshness({
    label: '本地 QQQ 日线回撤计算',
    url: 'public/allweather/data/candles/nasdaq-1d.json',
    latestDate: latest?.date,
    summary: `QQQ 本地日线最新日期 ${latest?.date || '未知'}，相对样本内最高复权价回撤 ${formatPercent(drawdown)}。这是纳指深度回撤进攻规则的核心触发指标。`,
  });
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
}

function getReturnSince(points: PricePoint[], months: number) {
  const latest = points.at(-1);
  if (!latest) return Number.NaN;
  const cutoff = new Date(latest.date);
  cutoff.setMonth(cutoff.getMonth() - months);
  const start =
    points
      .slice()
      .reverse()
      .find((point) => new Date(point.date).getTime() <= cutoff.getTime()) || points[0];
  return start?.close > 0 ? latest.close / start.close - 1 : Number.NaN;
}

function getMaxDrawdown(points: PricePoint[], months: number) {
  const latest = points.at(-1);
  if (!latest) return Number.NaN;
  const cutoff = new Date(latest.date);
  cutoff.setMonth(cutoff.getMonth() - months);
  const scoped = points.filter((point) => new Date(point.date).getTime() >= cutoff.getTime());
  let peak = 0;
  let drawdown = 0;
  scoped.forEach((point) => {
    peak = Math.max(peak, point.close);
    if (peak > 0) drawdown = Math.min(drawdown, point.close / peak - 1);
  });
  return drawdown;
}

function getAnnualizedVol(points: PricePoint[], months: number) {
  const latest = points.at(-1);
  if (!latest) return Number.NaN;
  const cutoff = new Date(latest.date);
  cutoff.setMonth(cutoff.getMonth() - months);
  const scoped = points.filter((point) => new Date(point.date).getTime() >= cutoff.getTime());
  const returns = scoped
    .slice(1)
    .map((point, index) => point.close / scoped[index].close - 1)
    .filter(Number.isFinite);
  if (returns.length < 2) return Number.NaN;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(12);
}

function getLocalAssetSignals() {
  const configs = [
    { id: 'sp500', label: '标普500', ticker: 'SPY' },
    { id: 'nasdaq', label: '纳指100', ticker: 'QQQ' },
    { id: 'bond', label: '长期美债', ticker: 'TLT' },
    { id: 'gold', label: '黄金', ticker: 'GLD' },
  ];
  const assets = configs.reduce<Record<string, AssetSignal>>((acc, config) => {
    const payload = readLocalJson(path.join('candles', `${config.id}-1mo.json`));
    const points: PricePoint[] = (Array.isArray(payload.candles) ? payload.candles : [])
      .map((candle: { date?: string; adjClose?: number; close?: number }) => ({
        date: String(candle.date),
        close: Number(candle.adjClose ?? candle.close),
      }))
      .filter((point: PricePoint) => point.date && Number.isFinite(point.close));
    const latest = points.at(-1);
    const peak = points.reduce((max, point) => Math.max(max, point.close), 0);
    acc[config.id] = {
      label: config.label,
      ticker: config.ticker,
      latestDate: latest?.date,
      return6m: getReturnSince(points, 6),
      return1y: getReturnSince(points, 12),
      return3y: getReturnSince(points, 36),
      drawdownFromPeak: peak > 0 && latest ? latest.close / peak - 1 : Number.NaN,
      maxDrawdown3y: getMaxDrawdown(points, 36),
      vol1y: getAnnualizedVol(points, 12),
    };
    return acc;
  }, {});
  const latestDate = Object.values(assets)
    .map((asset) => asset.latestDate)
    .filter(Boolean)
    .sort()
    .at(-1);

  return { latestDate, assets };
}

function getLocalAssetPerformanceSource(signals = getLocalAssetSignals()): MarketSource {
  const rows = Object.values(signals.assets).map(
    (asset) =>
      `${asset.label}(${asset.ticker})：最新月 ${asset.latestDate || '未知'}，6个月 ${formatPercent(asset.return6m)}，1年 ${formatPercent(asset.return1y)}，3年 ${formatPercent(asset.return3y)}，当前相对高点回撤 ${formatPercent(asset.drawdownFromPeak)}，3年最大回撤 ${formatPercent(asset.maxDrawdown3y)}，近1年波动 ${formatPercent(asset.vol1y)}`,
  );

  return withFreshness({
    label: '本地多资产 6M/1Y/3Y 表现摘要',
    url: 'public/allweather/data/candles/*-1mo.json',
    latestDate: signals.latestDate,
    summary: rows.join('；'),
  });
}

async function getChinaBondPerformanceSource(): Promise<MarketSource> {
  const url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.511010&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=101&fqt=1&beg=20200101&end=20500101';
  const payload = await fetchJson(url);
  const klines = payload?.data?.klines;
  if (!Array.isArray(klines) || !klines.length) throw new Error('东方财富中国国债 ETF 历史数据为空');
  const points: PricePoint[] = klines
    .map((line: string) => {
      const [date, , close] = line.split(',');
      return { date, close: Number(close) };
    })
    .filter((point: PricePoint) => point.date && Number.isFinite(point.close));
  const latest = points.at(-1);

  return withFreshness({
    label: '东方财富中国国债 ETF 历史表现',
    url,
    latestDate: latest?.date,
    summary: `国债ETF(511010) 最新月 ${latest?.date || '未知'}，6个月 ${formatPercent(getReturnSince(points, 6))}，1年 ${formatPercent(getReturnSince(points, 12))}，3年 ${formatPercent(getReturnSince(points, 36))}，3年最大回撤 ${formatPercent(getMaxDrawdown(points, 36))}，近1年波动 ${formatPercent(getAnnualizedVol(points, 12))}。该数据用于辅助判断人民币国债/防守资产环境，不直接替代 TLT 目标仓位。`,
  });
}

async function getEastmoneyQuotesSource(): Promise<MarketSource> {
  const symbols = ['105.SPY', '105.QQQ', '105.TLT', '105.GLD'];
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${symbols.join(',')}&fields=f12,f14,f2,f3,f4,f6,f13,f124`;
  const payload = await fetchJson(url);
  const list = payload?.data?.diff;
  if (!Array.isArray(list) || !list.length) throw new Error('东方财富返回空行情');
  const quotes: Record<string, QuotePoint> = {};
  const summaries = list.map((item: Record<string, unknown>) => {
    const time = Number(item.f124);
    const date = time ? new Date(time * 1000).toISOString().slice(0, 10) : '未知日期';
    const ticker = String(item.f12 || '').toUpperCase();
    const price = Number(item.f2);
    if (ticker && Number.isFinite(price)) {
      quotes[ticker] = {
        price,
        changePercent: Number(item.f3),
        date,
      };
    }
    return `${item.f14 || item.f12}: ${date} 最新 ${item.f2}，涨跌幅 ${item.f3}%`;
  });
  const latestTime = Math.max(...list.map((item: Record<string, unknown>) => Number(item.f124) || 0));

  return withFreshness({
    label: '东方财富美股 ETF 行情',
    url,
    latestDate: latestTime ? new Date(latestTime * 1000).toISOString().slice(0, 10) : undefined,
    summary: summaries.join('；'),
    quotes,
  });
}

async function getSinaUsQuotesSource(): Promise<MarketSource> {
  const symbols = ['gb_spy', 'gb_qqq', 'gb_tlt', 'gb_gld'];
  const url = `https://hq.sinajs.cn/list=${symbols.join(',')}`;
  const text = await fetchText(url);
  const quotes: Record<string, QuotePoint> = {};
  const summaries: string[] = [];
  const tickerMap: Record<string, string> = {
    gb_spy: 'SPY',
    gb_qqq: 'QQQ',
    gb_tlt: 'TLT',
    gb_gld: 'GLD',
  };

  text.split(/;\s*/).forEach((line) => {
    const match = line.match(/hq_str_(gb_[a-z]+)="([^"]*)"/i);
    if (!match) return;
    const ticker = tickerMap[match[1].toLowerCase()];
    const fields = match[2].split(',');
    const price = Number(fields[1]);
    const changePercent = Number(fields[2]);
    const date = fields[3]?.slice(0, 10);
    if (!ticker || !Number.isFinite(price)) return;
    quotes[ticker] = { price, changePercent, date };
    summaries.push(`${ticker}: ${date || '未知日期'} 最新 ${price}，涨跌幅 ${Number.isFinite(changePercent) ? `${changePercent}%` : '缺失'}`);
  });

  if (!summaries.length) throw new Error('新浪美股 ETF 行情为空');
  const latestDate = Object.values(quotes)
    .map((quote) => quote.date)
    .filter(Boolean)
    .sort()
    .at(-1);

  return withFreshness({
    label: '新浪财经美股 ETF 行情',
    url,
    latestDate,
    summary: summaries.join('；'),
    quotes,
  });
}

async function getTencentUsQuotesSource(): Promise<MarketSource> {
  const symbols = ['usSPY', 'usQQQ', 'usTLT', 'usGLD'];
  const url = `https://qt.gtimg.cn/q=${symbols.join(',')}`;
  const text = await fetchText(url);
  const quotes: Record<string, QuotePoint> = {};
  const summaries: string[] = [];

  text.split(/;\s*/).forEach((line) => {
    const match = line.match(/v_us([A-Z]+)="([^"]*)"/);
    if (!match) return;
    const ticker = match[1].toUpperCase();
    const fields = match[2].split('~');
    const price = Number(fields[3]);
    const date = fields[30]?.slice(0, 10);
    const changePercent = Number(fields[32]);
    if (!Number.isFinite(price)) return;
    quotes[ticker] = { price, changePercent, date };
    summaries.push(`${ticker}: ${date || '未知日期'} 最新 ${price}，涨跌幅 ${Number.isFinite(changePercent) ? `${changePercent}%` : '缺失'}`);
  });

  if (!summaries.length) throw new Error('腾讯美股 ETF 行情为空');
  const latestDate = Object.values(quotes)
    .map((quote) => quote.date)
    .filter(Boolean)
    .sort()
    .at(-1);

  return withFreshness({
    label: '腾讯证券美股 ETF 行情',
    url,
    latestDate,
    summary: summaries.join('；'),
    quotes,
  });
}

function getQuoteCrossValidationSource(sources: MarketSource[]): MarketSource {
  const tickers = ['SPY', 'QQQ', 'TLT', 'GLD'];
  const summaries = tickers.map((ticker) => {
    const observations = sources
      .filter((source) => !source.error && source.quotes?.[ticker] && typeof source.ageDays === 'number' && source.ageDays <= 30)
      .map((source) => ({
        label: source.label,
        price: source.quotes![ticker].price,
        date: source.quotes![ticker].date || source.latestDate,
      }))
      .filter((item) => Number.isFinite(item.price));
    if (observations.length < 2) {
      return `${ticker}: 可交叉验证来源不足（${observations.length} 个），只作参考`;
    }
    const prices = observations.map((item) => item.price);
    const avg = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const deviation = avg > 0 ? (Math.max(...prices) - Math.min(...prices)) / avg : Number.NaN;
    const dateSet = [...new Set(observations.map((item) => item.date).filter(Boolean))].join('/');
    return `${ticker}: ${observations.length} 源交叉验证，价格偏差 ${formatPercent(deviation)}，日期 ${dateSet || '未知'}，${deviation <= 0.003 ? '通过' : '需人工复核'}`;
  });
  const latestDate = sources
    .filter((source) => !source.error && source.quotes)
    .map((source) => source.latestDate)
    .filter(Boolean)
    .sort()
    .at(-1);

  return withFreshness({
    label: '国内多源行情交叉验证',
    url: '新浪财经 + 腾讯证券 + 东方财富',
    latestDate,
    summary: summaries.join('；'),
  });
}

async function getFredRatesSource(): Promise<MarketSource> {
  const url = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10,DGS2,DFII10';
  const csv = await fetchExternalCsv(url, 18000);
  const rows = csv.trim().split(/\r?\n/).slice(1);
  const latest = rows
    .map((line) => line.split(','))
    .reverse()
    .find((row) => row.length >= 4 && row[1] !== '.' && row[2] !== '.');
  if (!latest) throw new Error('FRED 返回空利率数据');
  const tenYear = Number(latest[1]);
  const twoYear = Number(latest[2]);
  const realTenYear = Number(latest[3]);
  const curve = Number.isFinite(tenYear) && Number.isFinite(twoYear) ? tenYear - twoYear : Number.NaN;

  return withFreshness({
    label: 'FRED 美国利率曲线',
    url,
    latestDate: latest[0],
    summary: `10Y ${tenYear.toFixed(2)}%，2Y ${twoYear.toFixed(2)}%，10Y-2Y ${curve.toFixed(2)}pct，10Y TIPS 实际利率 ${Number.isFinite(realTenYear) ? `${realTenYear.toFixed(2)}%` : '缺失'}。`,
  });
}

async function getMarketContext() {
  const localAssetSignals = getLocalAssetSignals();
  const tasks = [
    getEastmoneyQuotesSource(),
    getSinaUsQuotesSource(),
    getTencentUsQuotesSource(),
    getFredRatesSource(),
    Promise.resolve(getLocalNasdaqDrawdownSource()),
    Promise.resolve(getLocalAssetPerformanceSource(localAssetSignals)),
    getChinaBondPerformanceSource(),
  ];
  const settled = await Promise.allSettled(tasks);
  const labels = [
    '东方财富美股 ETF 行情',
    '新浪财经美股 ETF 行情',
    '腾讯证券美股 ETF 行情',
    'FRED 美国利率曲线',
    '本地 QQQ 日线回撤计算',
    '本地多资产 6M/1Y/3Y 表现摘要',
    '东方财富中国国债 ETF 历史表现',
  ];
  const sources: MarketSource[] = settled.map((result, index) =>
    result.status === 'fulfilled'
      ? result.value
      : {
          label: labels[index],
          url: '见数据源配置',
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        },
  );
  const validationSource = getQuoteCrossValidationSource(sources);
  sources.push(validationSource);
  const successful = sources.filter((source) => !source.error);
  const fresh = successful.filter((source) => typeof source.ageDays === 'number' && source.ageDays <= 30);
  const promptText = successful
    .map((source) => `【${source.label}】${source.summary || '无摘要'}（${source.freshnessLabel || '未知日期'}${source.latestDate ? `，日期 ${source.latestDate}` : ''}）`)
    .join('\n');

  return {
    generatedAt: new Date().toISOString(),
    sourceCount: successful.length,
    freshSourceCount: fresh.length,
    warning: fresh.length === 0 ? '没有最近 30 天内的外部数据源，AI 必须降低结论置信度。' : '',
    sources,
    promptText,
    strategySignals: {
      assets: localAssetSignals.assets,
      latestDate: localAssetSignals.latestDate,
    },
  };
}

async function callAiAnalysis(body: {
  provider?: string;
  baseUrl?: string;
  protocol?: string;
  apiKey?: string;
  model?: string;
  prompt?: string;
  useProxy?: boolean;
}) {
  if (!body.baseUrl || !body.apiKey || !body.model || !body.prompt) {
    throw new Error('缺少 baseUrl、apiKey、model 或 prompt');
  }
  const baseUrl = body.baseUrl.replace(/\/+$/, '');
  const protocol = body.protocol === 'responses' ? 'responses' : 'chat';
  const endpoint = protocol === 'responses' ? `${baseUrl}/responses` : `${baseUrl}/chat/completions`;
  const requestBody =
    protocol === 'responses'
      ? {
          model: body.model,
          input: body.prompt,
          temperature: 0.2,
        }
      : {
          model: body.model,
          messages: [{ role: 'user', content: body.prompt }],
          temperature: 0.2,
        };

  const init: RequestInit & { dispatcher?: any } = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${body.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  };
  if (body.useProxy) init.dispatcher = foreignProxyAgent;
  const response = await fetch(endpoint, init);
  const payload = (await response.json().catch(() => ({}))) as any;
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `AI 接口返回 HTTP ${response.status}`);
  }

  if (protocol === 'responses') {
    const text =
      payload.output_text ||
      payload.output
        ?.flatMap((item: { content?: Array<{ text?: string }> }) => item.content || [])
        .map((item: { text?: string }) => item.text)
        .filter(Boolean)
        .join('\n');
    return text || '模型没有返回文本。';
  }

  return payload.choices?.[0]?.message?.content || '模型没有返回文本。';
}

const aiProviderDefaults: Record<string, { label: string; baseUrl: string; protocol: 'chat' | 'responses'; useProxy: boolean }> = {
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    protocol: 'chat',
    useProxy: true,
  },
  zhipu: {
    label: '智谱',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    protocol: 'chat',
    useProxy: false,
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    protocol: 'chat',
    useProxy: false,
  },
  qwen: {
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    protocol: 'chat',
    useProxy: false,
  },
  custom: {
    label: '自定义',
    baseUrl: '',
    protocol: 'chat',
    useProxy: false,
  },
};

function getAiRequestBody(body: any) {
  const provider = String(body.provider || 'openai');
  const defaults = aiProviderDefaults[provider] || aiProviderDefaults.custom;
  return {
    provider,
    baseUrl: String(body.baseUrl || defaults.baseUrl),
    protocol: body.protocol === 'responses' ? 'responses' : defaults.protocol,
    apiKey: String(body.apiKey || ''),
    model: String(body.model || ''),
    prompt: String(body.prompt || ''),
    useProxy: typeof body.useProxy === 'boolean' ? body.useProxy : defaults.useProxy,
  };
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function isVibeTradingServer(baseUrl: string, timeoutMs = 700) {
  try {
    const response = await fetchWithTimeout(`${baseUrl}/live`, {}, timeoutMs);
    if (!response.ok) return false;
    const payload = (await response.json().catch(() => ({}))) as { status?: string };
    return payload.status === 'healthy';
  } catch {
    return false;
  }
}

async function discoverVibeTradingServer() {
  const explicitUrl = String(process.env.VIBE_TRADING_URL || '').replace(/\/+$/, '');
  let recordedUrl = '';
  if (existsSync(vibePortFile)) {
    const recordedPort = Number.parseInt(readFileSync(vibePortFile, 'utf8').trim(), 10);
    if (Number.isInteger(recordedPort) && recordedPort > 0 && recordedPort <= 65535) {
      recordedUrl = `http://127.0.0.1:${recordedPort}`;
    }
  }

  const preferred = [cachedVibeBaseUrl, explicitUrl, recordedUrl].filter(Boolean);
  for (const baseUrl of preferred) {
    if (await isVibeTradingServer(baseUrl)) {
      cachedVibeBaseUrl = baseUrl;
      return baseUrl;
    }
  }
  return '';
}

function canListenOnPort(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = createNetServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailableVibePort() {
  for (const port of vibePortRange) {
    if (await canListenOnPort(port)) return port;
  }
  throw new Error('8899-8999 端口均被占用，无法启动 Vibe-Trading 研究引擎');
}

async function startVibeTradingServer() {
  const executable = process.platform === 'win32'
    ? path.join(vibeTradingRoot, '.venv', 'Scripts', 'vibe-trading.exe')
    : path.join(vibeTradingRoot, '.venv', 'bin', 'vibe-trading');
  if (!existsSync(executable)) {
    throw new Error(`仓库内研究运行时尚未安装，请先执行 npm run research:setup：${executable}`);
  }

  const port = await findAvailableVibePort();
  await mkdir(sparkflowStateDir, { recursive: true });
  const stdoutFd = openSync(path.join(sparkflowStateDir, 'vibe-server.log'), 'a');
  const stderrFd = openSync(path.join(sparkflowStateDir, 'vibe-server.err.log'), 'a');
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(executable, ['serve', '--host', '127.0.0.1', '--port', String(port)], {
      cwd: vibeTradingRoot,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', stdoutFd, stderrFd],
      env: {
        ...process.env,
        HTTP_PROXY: process.env.HTTP_PROXY || foreignProxyUrl,
        HTTPS_PROXY: process.env.HTTPS_PROXY || foreignProxyUrl,
        ALL_PROXY: process.env.ALL_PROXY || foreignProxyUrl,
        NO_PROXY: process.env.NO_PROXY || 'localhost,127.0.0.1,::1',
      },
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
  let spawnError: Error | null = null;
  child.once('error', (error) => {
    spawnError = error;
  });
  child.unref();

  const baseUrl = `http://127.0.0.1:${port}`;
  await Promise.all([
    writeFile(vibePortFile, String(port), 'ascii'),
    writeFile(vibePidFile, String(child.pid || ''), 'ascii'),
  ]);

  for (let attempt = 0; attempt < 360; attempt += 1) {
    if (await isVibeTradingServer(baseUrl, 1000)) {
      cachedVibeBaseUrl = baseUrl;
      return baseUrl;
    }
    if (spawnError || child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  child.kill();
  await Promise.allSettled([unlink(vibePortFile), unlink(vibePidFile)]);
  if (spawnError) throw spawnError;
  if (child.exitCode !== null) {
    throw new Error(`Vibe-Trading 启动进程已退出，退出码：${child.exitCode}`);
  }
  throw new Error(`Vibe-Trading 已启动，但 ${baseUrl} 在 180 秒内未就绪`);
}

async function ensureVibeTradingServer() {
  const discovered = await discoverVibeTradingServer();
  if (discovered) return discovered;
  if (!vibeStartupPromise) {
    vibeStartupPromise = startVibeTradingServer().finally(() => {
      vibeStartupPromise = null;
    });
  }
  return vibeStartupPromise;
}

async function readVibeError(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as { detail?: string; message?: string };
  return payload.detail || payload.message || `Vibe-Trading 返回 HTTP ${response.status}`;
}

async function requestVibeJson<T>(baseUrl: string, pathname: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error(await readVibeError(response));
  return (await response.json()) as T;
}

function validateVibeSessionId(value: unknown) {
  const sessionId = String(value || '');
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(sessionId)) {
    throw new Error('Vibe-Trading 会话 ID 无效');
  }
  return sessionId;
}

async function syncVibeLlmSettings(baseUrl: string, body: any) {
  const ai = getAiRequestBody(body);
  const hasKey = Boolean(ai.apiKey.trim());
  const hasModel = Boolean(ai.model.trim());
  if (hasKey !== hasModel) throw new Error('请同时填写 AI API Key 和模型名称');

  if (hasKey && hasModel) {
    const provider = ai.provider === 'custom' ? 'openai' : ai.provider;
    return requestVibeJson<{
      provider: string;
      model_name: string;
      api_key_configured: boolean;
      api_key_required: boolean;
    }>(baseUrl, '/settings/llm', {
      method: 'PUT',
      body: JSON.stringify({
        provider,
        model_name: ai.model,
        base_url: ai.baseUrl,
        api_key: ai.apiKey,
        temperature: 0,
        timeout_seconds: 180,
        max_retries: 2,
        reasoning_effort: '',
      }),
    });
  }

  const settings = await requestVibeJson<{
    provider: string;
    model_name: string;
    api_key_configured: boolean;
    api_key_required: boolean;
  }>(baseUrl, '/settings/llm');
  if (settings.api_key_required && !settings.api_key_configured) {
    throw new Error('研究引擎尚未配置模型，请从右上角头像进入“设置”填写 API Key 和模型');
  }
  return settings;
}

async function prepareVibeResearchSession(body: any) {
  const baseUrl = await ensureVibeTradingServer();
  const settings = await syncVibeLlmSettings(baseUrl, body);
  const prompt = String(body.prompt || '').trim();
  if (!prompt) throw new Error('研究问题不能为空');
  if (prompt.length > 5000) throw new Error('研究问题不能超过 5000 个字符');

  let sessionId = String(body.sessionId || '');
  let reused = false;
  if (sessionId) {
    sessionId = validateVibeSessionId(sessionId);
    try {
      await requestVibeJson(baseUrl, `/sessions/${encodeURIComponent(sessionId)}`);
      reused = true;
    } catch {
      sessionId = '';
    }
  }

  if (!sessionId) {
    const session = await requestVibeJson<{ session_id: string }>(baseUrl, '/sessions', {
      method: 'POST',
      body: JSON.stringify({ title: prompt.slice(0, 50) }),
    });
    sessionId = session.session_id;
  }

  return {
    sessionId,
    reused,
    provider: settings.provider,
    model: settings.model_name,
    baseUrl,
  };
}

async function proxyVibeEventStream(req: any, res: any, sessionId: string, resumeEventId?: string) {
  const baseUrl = await ensureVibeTradingServer();
  const controller = new AbortController();
  req.once('close', () => controller.abort());
  const headerEventId = Array.isArray(req.headers['last-event-id'])
    ? req.headers['last-event-id'][0]
    : req.headers['last-event-id'];
  const lastEventId = String(headerEventId || resumeEventId || '').trim();
  const upstream = await fetch(
    `${baseUrl}/sessions/${encodeURIComponent(validateVibeSessionId(sessionId))}/events?replay=active`,
    {
      signal: controller.signal,
      headers: lastEventId ? { 'Last-Event-ID': lastEventId } : {},
    },
  );
  if (!upstream.ok || !upstream.body) throw new Error(await readVibeError(upstream));

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  try {
    for await (const chunk of upstream.body as any) {
      if (res.destroyed) break;
      res.write(Buffer.from(chunk));
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    if (!res.writableEnded) res.end();
  }
}

function sanitizeFileName(value: string) {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function getSafeFolder(folder?: string) {
  return String(folder || '')
    .split(/[\\/]+/)
    .map((segment) => sanitizeFileName(segment))
    .filter(Boolean);
}

async function writeObsidianNote(body: { vaultPath?: string; folder?: string; title?: string; markdown?: string }) {
  if (!body.vaultPath || !body.markdown) {
    throw new Error('缺少 Obsidian vaultPath 或 markdown');
  }

  const vaultRoot = path.resolve(String(body.vaultPath));
  if (!existsSync(vaultRoot)) {
    throw new Error(`Obsidian vault 不存在：${vaultRoot}`);
  }

  const date = new Date().toISOString().slice(0, 10);
  const title = sanitizeFileName(body.title || `星图情报 ${date}`) || `星图情报 ${date}`;
  const folderParts = getSafeFolder(body.folder);
  const targetDir = path.resolve(vaultRoot, ...folderParts);
  const targetPath = path.resolve(targetDir, `${date} ${title}.md`);
  const relative = path.relative(vaultRoot, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Obsidian 写入路径必须位于 vault 内');
  }

  await mkdir(targetDir, { recursive: true });
  await writeFile(targetPath, body.markdown, 'utf8');
  return { path: targetPath, relativePath: relative };
}

async function getCachedCryptoHeatmapUniverse() {
  const now = Date.now();
  if (cryptoHeatmapUniverseCache && now - cryptoHeatmapUniverseCache.storedAt < 60_000) {
    return cryptoHeatmapUniverseCache.data;
  }
  if (!cryptoHeatmapUniverseInFlight) {
    cryptoHeatmapUniverseInFlight = getCryptoMarketUniverse()
      .then((data) => {
        cryptoHeatmapUniverseCache = { storedAt: Date.now(), data };
        return data;
      })
      .finally(() => {
        cryptoHeatmapUniverseInFlight = undefined;
      });
  }
  return cryptoHeatmapUniverseInFlight;
}

async function getCachedCryptoMarketHeatmap() {
  const now = Date.now();
  if (cryptoHeatmapCache && now - cryptoHeatmapCache.storedAt < 2_500) {
    return cryptoHeatmapCache.data;
  }
  if (!cryptoHeatmapInFlight) {
    cryptoHeatmapInFlight = getCryptoMarketHeatmap()
      .then((data) => {
        cryptoHeatmapCache = { storedAt: Date.now(), data };
        return data;
      })
      .finally(() => {
        cryptoHeatmapInFlight = undefined;
      });
  }
  return cryptoHeatmapInFlight;
}

async function getCachedBitcoinCycleHistory() {
  if (bitcoinCycleCache && Date.now() - bitcoinCycleCache.storedAt < 6 * 60 * 60_000) {
    return bitcoinCycleCache.data;
  }
  if (!bitcoinCycleInFlight) {
    bitcoinCycleInFlight = getBitcoinCycleHistory()
      .then((data) => {
        bitcoinCycleCache = { storedAt: Date.now(), data };
        return data;
      })
      .finally(() => {
        bitcoinCycleInFlight = undefined;
      });
  }
  return bitcoinCycleInFlight;
}

const globalMacroFastQuoteSubscribers = new Set<any>();
let globalMacroFastQuoteBroadcastTimer: ReturnType<typeof setInterval> | undefined;
let globalMacroFastQuoteBroadcastInFlight: Promise<void> | undefined;

function stopGlobalMacroFastQuoteBroadcastIfIdle() {
  if (globalMacroFastQuoteSubscribers.size || !globalMacroFastQuoteBroadcastTimer) return;
  clearInterval(globalMacroFastQuoteBroadcastTimer);
  globalMacroFastQuoteBroadcastTimer = undefined;
}

function broadcastGlobalMacroFastQuotes(forceRefresh = false) {
  if (globalMacroFastQuoteBroadcastInFlight) return globalMacroFastQuoteBroadcastInFlight;
  globalMacroFastQuoteBroadcastInFlight = (forceRefresh ? refreshGlobalMacroFastQuotes() : getCachedGlobalMacroFastQuotes())
    .then((payload) => {
      const message = `data: ${JSON.stringify(payload)}\n\n`;
      globalMacroFastQuoteSubscribers.forEach((subscriber) => {
        try {
          subscriber.write(message);
        } catch {
          globalMacroFastQuoteSubscribers.delete(subscriber);
        }
      });
    })
    .catch((error) => {
      const message = `event: quote-error\ndata: ${JSON.stringify({ message: error instanceof Error ? error.message : '行情暂时不可用' })}\n\n`;
      globalMacroFastQuoteSubscribers.forEach((subscriber) => {
        try {
          subscriber.write(message);
        } catch {
          globalMacroFastQuoteSubscribers.delete(subscriber);
        }
      });
    })
    .finally(() => {
      globalMacroFastQuoteBroadcastInFlight = undefined;
      stopGlobalMacroFastQuoteBroadcastIfIdle();
    });
  return globalMacroFastQuoteBroadcastInFlight;
}

function subscribeToGlobalMacroFastQuotes(_req: any, res: any) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write('retry: 3000\n: connected\n\n');
  globalMacroFastQuoteSubscribers.add(res);

  const unsubscribe = () => {
    globalMacroFastQuoteSubscribers.delete(res);
    stopGlobalMacroFastQuoteBroadcastIfIdle();
  };
  res.on('close', unsubscribe);

  if (!globalMacroFastQuoteBroadcastTimer) {
    globalMacroFastQuoteBroadcastTimer = setInterval(
      () => void broadcastGlobalMacroFastQuotes(true),
      GLOBAL_MACRO_FAST_QUOTE_CADENCE_MS,
    );
  }
  void broadcastGlobalMacroFastQuotes();
}

function allWeatherApiPlugin() {
  return {
    name: 'sparkflow-allweather-api',
    configureServer(server: ViteDevServer) {
      // Warm the slow consensus page without delaying the first dashboard response.
      void getPpiMarketContext(false).catch(() => undefined);
      server.middlewares.use(async (req, res, next) => {
        try {
          const url = new URL(req.url || '/', 'http://127.0.0.1');
          if (url.pathname === '/api/market-context') {
            sendJson(res, 200, await getMarketContext());
            return;
          }

          if (url.pathname === '/api/news-feed') {
            sendJson(res, 200, await getNewsFeed());
            return;
          }

          if (url.pathname === '/api/global-macro-quotes') {
            res.setHeader('Cache-Control', 'no-store');
            sendJson(res, 200, await getCachedGlobalMacroFastQuotes());
            return;
          }

          if (url.pathname === '/api/global-macro-stream') {
            subscribeToGlobalMacroFastQuotes(req, res);
            return;
          }

          if (url.pathname === '/api/global-macro-release-sync') {
            res.setHeader('Cache-Control', 'no-store');
            sendJson(res, 200, await loadOfficialMacroReleasePatch());
            return;
          }

          if (url.pathname === '/api/global-macro-ppi-expectation') {
            res.setHeader('Cache-Control', 'no-store');
            sendJson(res, 200, {
              generatedAt: new Date().toISOString(),
              macro: [await getUsPpiMacroMetric(false, true)],
            });
            return;
          }

          if (url.pathname === '/api/global-macro-dashboard') {
            const region = String(url.searchParams.get('region') || 'global');
            if (!['global', 'apac', 'middleEast', 'europe', 'americas'].includes(region)) {
              sendJson(res, 400, { error: '不支持的全球市场区域' });
              return;
            }
            const section = String(url.searchParams.get('section') || '');
            const forceOfficial = section === 'macro' && url.searchParams.get('fresh') === '1';
            if (section && !globalMacroSectionNames.includes(section as GlobalMacroSectionName)) {
              sendJson(res, 400, { error: '不支持的数据分区' });
              return;
            }
            sendJson(
              res,
              200,
              section
                ? await getCachedGlobalMacroSection(region as GlobalMacroRegion, section as GlobalMacroSectionName, forceOfficial)
                : await getCachedGlobalMacroDashboard(region as GlobalMacroRegion),
            );
            return;
          }

          if (url.pathname === '/api/global-market-heatmap') {
            const market = String(url.searchParams.get('market') || '');
            if (!globalHeatmapConfigs[market]) {
              sendJson(res, 400, { error: '不支持的全球市场热力图' });
              return;
            }
            res.setHeader('Cache-Control', 'no-store');
            sendJson(res, 200, await getCachedGlobalMarketHeatmap(market));
            return;
          }

          if (url.pathname === '/api/international-market-overview') {
            const market = String(url.searchParams.get('market') || '') as InternationalMarketMode;
            if (!Object.prototype.hasOwnProperty.call(internationalIndexConfigs, market)) {
              sendJson(res, 400, { error: '不支持的国际股票市场' });
              return;
            }
            res.setHeader('Cache-Control', 'no-store');
            sendJson(res, 200, await getCachedInternationalMarketOverview(market));
            return;
          }

          if (url.pathname === '/api/global-company-logo') {
            const symbol = String(url.searchParams.get('symbol') || '');
            if (!globalHeatmapLogoDomains[symbol]) {
              res.statusCode = 404;
              res.setHeader('Cache-Control', 'no-store');
              res.end();
              return;
            }
            try {
              const logo = await fetchGlobalCompanyLogo(symbol);
              res.statusCode = 200;
              res.setHeader('Content-Type', logo.contentType);
              res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
              res.end(logo.data);
            } catch {
              res.statusCode = 404;
              res.setHeader('Cache-Control', 'no-store');
              res.end();
            }
            return;
          }

          if (url.pathname === '/api/market-intelligence') {
            sendJson(res, 200, await getCachedMarketIntelligence());
            return;
          }

          if (url.pathname === '/api/market-quotes') {
            const quotes = await getCachedMarketQuotes();
            sendJson(res, 200, {
              generatedAt: new Date().toISOString(),
              indices: quotes.indices,
              source: '东方财富 + 腾讯证券',
            });
            return;
          }

          if (url.pathname === '/api/china-market-heatmap') {
            sendJson(res, 200, await getCachedChinaMarketHeatmap());
            return;
          }

          if (url.pathname === '/api/crypto-market-heatmap') {
            sendJson(res, 200, await getCachedCryptoMarketHeatmap());
            return;
          }

          if (url.pathname === '/api/bitcoin-cycle-history') {
            sendJson(res, 200, await getCachedBitcoinCycleHistory());
            return;
          }

          if (url.pathname === '/api/china-valuation-temperature') {
            sendJson(res, 200, await getCachedChinaValuationDashboard());
            return;
          }

          if (url.pathname === '/api/valuation-temperature') {
            const market = String(url.searchParams.get('market') || 'china');
            if (market === 'china') {
              sendJson(res, 200, await getCachedChinaValuationDashboard());
              return;
            }
            if (!['hongkong', 'us', 'japan', 'korea', 'india', 'germany', 'france', 'uk'].includes(market)) {
              sendJson(res, 400, { error: '不支持的股票估值市场' });
              return;
            }
            sendJson(res, 200, await getCachedRegionalValuationDashboard(market as RegionalValuationMode));
            return;
          }

          if (url.pathname === '/api/regional-market-content') {
            const market = String(url.searchParams.get('market') || '');
            if (market !== 'hongkong' && market !== 'us') {
              sendJson(res, 400, { error: '仅支持港股和美股市场内容' });
              return;
            }
            sendJson(res, 200, await getCachedRegionalMarketContent(market));
            return;
          }

          if (url.pathname === '/api/institution-rating') {
            const market = String(url.searchParams.get('market') || '');
            const query = String(url.searchParams.get('query') || '');
            if (market !== 'hongkong' && market !== 'us') {
              sendJson(res, 400, { error: '机构评级目前支持港股和美股' });
              return;
            }
            sendJson(res, 200, await getInstitutionRating(market, query));
            return;
          }

          if (url.pathname === '/api/hong-kong-market-heatmap') {
            sendJson(res, 200, await getCachedHongKongMarketHeatmap());
            return;
          }

          if (url.pathname === '/api/us-market-heatmap') {
            sendJson(res, 200, await getCachedUsMarketHeatmap());
            return;
          }

          if (url.pathname === '/api/us-market-system-status') {
            sendJson(res, 200, await getCachedUsMarketSystemStatus());
            return;
          }

          if (url.pathname === '/api/backtest-prices') {
            sendJson(res, 200, readLocalJson('backtest-prices.json'));
            return;
          }

          if (url.pathname === '/api/candles') {
            const asset = String(url.searchParams.get('asset') || '').replace(/[^a-z0-9-]/gi, '');
            const timeframe = String(url.searchParams.get('timeframe') || '').replace(/[^a-z0-9-]/gi, '');
            sendJson(res, 200, readLocalJson(path.join('candles', `${asset}-${timeframe}.json`)));
            return;
          }

          if (url.pathname === '/api/vibe/status' && req.method === 'GET') {
            const baseUrl = await ensureVibeTradingServer();
            const settings = await requestVibeJson<{
              provider: string;
              model_name: string;
              api_key_configured: boolean;
            }>(baseUrl, '/settings/llm');
            sendJson(res, 200, {
              status: 'ready',
              baseUrl,
              provider: settings.provider,
              model: settings.model_name,
              apiKeyConfigured: settings.api_key_configured,
            });
            return;
          }

          if (url.pathname === '/api/vibe/research/session' && req.method === 'POST') {
            const body = JSON.parse(await getRequestBody(req));
            sendJson(res, 200, await prepareVibeResearchSession(body));
            return;
          }

          if (url.pathname === '/api/vibe/research/sessions' && req.method === 'GET') {
            const baseUrl = await ensureVibeTradingServer();
            sendJson(res, 200, await requestVibeJson(baseUrl, '/sessions?limit=50'));
            return;
          }

          if (url.pathname === '/api/vibe/research/message' && req.method === 'POST') {
            const body = JSON.parse(await getRequestBody(req));
            const sessionId = validateVibeSessionId(body.sessionId);
            const prompt = String(body.prompt || '').trim();
            if (!prompt) throw new Error('研究问题不能为空');
            if (prompt.length > 5000) throw new Error('研究问题不能超过 5000 个字符');
            const baseUrl = await ensureVibeTradingServer();
            const result = await requestVibeJson<{ message_id: string; attempt_id: string }>(
              baseUrl,
              `/sessions/${encodeURIComponent(sessionId)}/messages`,
              { method: 'POST', body: JSON.stringify({ content: prompt }) },
            );
            sendJson(res, 200, { ...result, sessionId });
            return;
          }

          if (url.pathname === '/api/vibe/research/messages' && req.method === 'GET') {
            const sessionId = validateVibeSessionId(url.searchParams.get('sessionId'));
            const baseUrl = await ensureVibeTradingServer();
            sendJson(
              res,
              200,
              await requestVibeJson(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/messages`),
            );
            return;
          }

          if (url.pathname === '/api/vibe/research/cancel' && req.method === 'POST') {
            const body = JSON.parse(await getRequestBody(req));
            const sessionId = validateVibeSessionId(body.sessionId);
            const baseUrl = await ensureVibeTradingServer();
            sendJson(
              res,
              200,
              await requestVibeJson(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/cancel`, { method: 'POST' }),
            );
            return;
          }

          if (url.pathname === '/api/vibe/research/events' && req.method === 'GET') {
            await proxyVibeEventStream(
              req,
              res,
              String(url.searchParams.get('sessionId') || ''),
              String(url.searchParams.get('lastEventId') || ''),
            );
            return;
          }

          if (url.pathname === '/api/ai-analysis' && req.method === 'POST') {
            const body = JSON.parse(await getRequestBody(req));
            sendJson(res, 200, { text: await callAiAnalysis(body) });
            return;
          }

          if (url.pathname === '/api/ai-chat' && req.method === 'POST') {
            const body = getAiRequestBody(JSON.parse(await getRequestBody(req)));
            sendJson(res, 200, { text: await callAiAnalysis(body), provider: body.provider, model: body.model });
            return;
          }

          if (url.pathname === '/api/obsidian-note' && req.method === 'POST') {
            const body = JSON.parse(await getRequestBody(req));
            sendJson(res, 200, await writeObsidianNote(body));
            return;
          }

        } catch (error) {
          if (res.headersSent) {
            if (!res.writableEnded) res.end();
            return;
          }
          sendJson(res, 500, {
            error: 'request_failed',
            detail: error instanceof Error ? error.message : String(error),
          });
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), allWeatherApiPlugin()],
  server: {
    watch: {
      ignored: [
        '**/services/vibe-trading/.venv/**',
        '**/services/vibe-trading/agent/runs/**',
        '**/services/vibe-trading/agent/sessions/**',
        '**/services/vibe-trading/agent/uploads/**',
      ],
    },
  },
});
