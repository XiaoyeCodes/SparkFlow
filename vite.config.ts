import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ProxyAgent } from 'undici';
import { defineConfig, type ViteDevServer } from 'vite';

const rootDir = process.cwd();
const allWeatherDataDir = path.join(rootDir, 'public', 'allweather', 'data');
const foreignProxyUrl = 'http://127.0.0.1:7890';
const foreignProxyAgent = new ProxyAgent(foreignProxyUrl);

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
});
