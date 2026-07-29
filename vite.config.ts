import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import path from 'node:path';
import { ProxyAgent } from 'undici';
import { defineConfig, type ViteDevServer } from 'vite';

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
  price: number;
  changePercent: number;
  marketCap: number;
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
  return blocks.slice(0, 12).map((block, index) => {
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
  const xml = await fetchRoutedText(source.url, source.route);
  return parseRssItems(xml, source);
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

const cryptoAssetConfigs = [
  { id: 'bitcoin', symbol: 'BTC', binance: 'BTCUSDT', name: '比特币' },
  { id: 'ethereum', symbol: 'ETH', binance: 'ETHUSDT', name: '以太坊' },
  { id: 'binancecoin', symbol: 'BNB', binance: 'BNBUSDT', name: 'BNB' },
  { id: 'solana', symbol: 'SOL', binance: 'SOLUSDT', name: 'Solana' },
  { id: 'ripple', symbol: 'XRP', binance: 'XRPUSDT', name: 'XRP' },
  { id: 'dogecoin', symbol: 'DOGE', binance: 'DOGEUSDT', name: 'Dogecoin' },
];

function asFiniteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function round(value: number, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

async function getEquityIndexSnapshots() {
  const eastmoneyUrl = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${marketIndexConfigs
    .map((item) => item.secid)
    .join(',')}&fields=f12,f14,f2,f3,f4,f6,f104,f105,f106,f124`;
  const tencentUrl = `https://qt.gtimg.cn/q=${marketIndexConfigs.map((item) => item.tencent).join(',')}`;
  const [eastmoneyResult, tencentResult] = await Promise.allSettled([fetchJson(eastmoneyUrl), fetchText(tencentUrl)]);
  if (eastmoneyResult.status === 'rejected') throw eastmoneyResult.reason;

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

  const rows = eastmoneyResult.value?.data?.diff;
  if (!Array.isArray(rows) || !rows.length) throw new Error('东方财富主要指数行情为空');
  const byCode = new Map(rows.map((row: Record<string, unknown>) => [String(row.f12 || '').toUpperCase(), row]));
  const indices: MarketIndexSnapshot[] = marketIndexConfigs.flatMap((config) => {
    const code = config.secid.split('.').at(-1)?.toUpperCase() || '';
    const row = byCode.get(code) as Record<string, unknown> | undefined;
    const price = asFiniteNumber(row?.f2);
    if (!row || price === undefined) return [];
    const tencent = tencentQuotes.get(config.tencent.toLowerCase());
    const preferTencent = config.region === 'US' && tencent !== undefined;
    const livePrice = preferTencent ? tencent.price : price;
    const liveChange = preferTencent ? tencent.change ?? asFiniteNumber(row.f4) ?? 0 : asFiniteNumber(row.f4) ?? 0;
    const liveChangePercent = preferTencent
      ? tencent.changePercent ?? asFiniteNumber(row.f3) ?? 0
      : asFiniteNumber(row.f3) ?? 0;
    const deviationPercent = tencent ? Math.abs(tencent.price - price) / Math.max(price, 0.0001) * 100 : undefined;
    const timestamp = asFiniteNumber(row.f124);
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
      turnover: asFiniteNumber(row.f6),
      advancers: asFiniteNumber(row.f104),
      decliners: asFiniteNumber(row.f105),
      flat: asFiniteNumber(row.f106),
      updatedAt: preferTencent ? new Date().toISOString() : timestamp ? new Date(timestamp * 1000).toISOString() : undefined,
      sourceUrl: preferTencent ? tencentUrl : eastmoneyUrl,
      validation: {
        status: deviationPercent === undefined ? 'single-source' : deviationPercent <= 0.25 ? 'verified' : 'review',
        source: preferTencent ? '东方财富' : tencent ? '腾讯证券' : '未取得第二来源',
        price: preferTencent ? price : tencent?.price,
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
  const baseUrl = 'https://push2delay.eastmoney.com/api/qt/clist/get?pz=100&po=1&np=1&fltt=2&invt=2&fid=f20&fs=m:116+t:3&fields=f12,f14,f2,f3,f20,f100,f124';
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
  const baseUrl = 'https://push2delay.eastmoney.com/api/qt/clist/get?pz=100&po=1&np=1&fltt=2&invt=2&fid=f20&fs=m:105,m:106&fields=f12,f13,f14,f2,f3,f20,f100,f124';
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
let chinaHeatmapCache: { storedAt: number; data: Awaited<ReturnType<typeof getChinaMarketHeatmap>> } | undefined;
let chinaHeatmapInFlight: Promise<Awaited<ReturnType<typeof getChinaMarketHeatmap>>> | undefined;
let hongKongHeatmapCache: { storedAt: number; data: Awaited<ReturnType<typeof getHongKongMarketHeatmap>> } | undefined;
let hongKongHeatmapInFlight: Promise<Awaited<ReturnType<typeof getHongKongMarketHeatmap>>> | undefined;
let usHeatmapCache: { storedAt: number; data: Awaited<ReturnType<typeof getUsMarketHeatmap>> } | undefined;
let usHeatmapInFlight: Promise<Awaited<ReturnType<typeof getUsMarketHeatmap>>> | undefined;
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
  const csv = await fetchText(url);
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

function allWeatherApiPlugin() {
  return {
    name: 'sparkflow-allweather-api',
    configureServer(server: ViteDevServer) {
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
