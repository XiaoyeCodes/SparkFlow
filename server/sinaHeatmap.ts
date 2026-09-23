import { SINA_HEATMAP_UNIVERSE, type SinaHeatmapMarket, type SinaUniverseStock } from './sinaHeatmapUniverse.ts';

type SinaQuote = {
  price: number;
  previousClose: number;
  changePercent: number;
  updatedAt: string;
};

const SINA_QUOTE_URL = 'https://hq.sinajs.cn/list=';

function quoteKey(market: SinaHeatmapMarket, code: string) {
  if (market === 'china') return `${code.startsWith('6') ? 'sh' : 'sz'}${code}`;
  if (market === 'hongkong') return `rt_hk${code.padStart(5, '0')}`;
  return `gb_${code.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
}

function quoteTime(date: string | undefined, time?: string) {
  const text = time ? `${date?.replaceAll('/', '-')}T${time}` : date?.replace(' ', 'T');
  if (!text || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text)) return undefined;
  const parsed = new Date(`${text}+08:00`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

function numeric(value: string | undefined) {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseQuote(market: SinaHeatmapMarket, payload: string): SinaQuote | undefined {
  const fields = payload.split(',');
  const price = numeric(fields[market === 'china' ? 3 : market === 'hongkong' ? 6 : 1]);
  const previousClose = market === 'china'
    ? numeric(fields[2])
    : market === 'hongkong'
      ? numeric(fields[3])
      : price !== undefined && numeric(fields[4]) !== undefined ? price - numeric(fields[4])! : undefined;
  if (price === undefined || price <= 0 || previousClose === undefined || previousClose <= 0) return undefined;
  const changePercent = market === 'us' ? numeric(fields[2]) : (price / previousClose - 1) * 100;
  if (changePercent === undefined || Math.abs(changePercent) > 60) return undefined;
  const updatedAt = market === 'china'
    ? quoteTime(fields[30], fields[31])
    : market === 'hongkong'
      ? quoteTime(fields[17], fields[18])
      : quoteTime(fields[3]);
  if (!updatedAt) return undefined;
  return { price, previousClose, changePercent, updatedAt };
}

function stockPage(market: SinaHeatmapMarket, stock: SinaUniverseStock) {
  const key = quoteKey(market, stock.code);
  if (market === 'china') return `https://finance.sina.com.cn/realstock/company/${key}/nc.shtml`;
  if (market === 'hongkong') return `https://stock.finance.sina.com.cn/hkstock/quotes/${stock.code}.html`;
  return `https://stock.finance.sina.com.cn/usstock/quotes/${encodeURIComponent(stock.code)}.html`;
}

export async function getSinaMarketHeatmap(
  market: SinaHeatmapMarket,
  fetchQuoteText: (url: string) => Promise<string>,
) {
  const universe = SINA_HEATMAP_UNIVERSE[market];
  const keys = universe.stocks.map((stock) => quoteKey(market, stock.code));
  const sourceUrl = `${SINA_QUOTE_URL}${keys.join(',')}`;
  const text = await fetchQuoteText(sourceUrl);
  const payloads = new Map<string, string>();
  for (const match of text.matchAll(/var\s+hq_str_([^=\s]+)="([^"]*)"\s*;/g)) payloads.set(match[1], match[2]);

  const stocks = universe.stocks.flatMap((stock) => {
    const quote = parseQuote(market, payloads.get(quoteKey(market, stock.code)) || '');
    if (!quote) return [];
    const marketCap = stock.referencePrice > 0
      ? stock.referenceMarketCap * quote.price / stock.referencePrice
      : stock.referenceMarketCap;
    return [{
      code: stock.code,
      name: stock.name,
      exchange: stock.exchange,
      price: quote.price,
      previousClose: quote.previousClose,
      change: quote.price - quote.previousClose,
      changePercent: quote.changePercent,
      marketCap,
      pe: stock.pe,
      pb: stock.pb,
      industry: stock.industry,
      updatedAt: quote.updatedAt,
      sourceUrl: stockPage(market, stock),
    }];
  });
  if (stocks.length < Math.ceil(universe.stocks.length * 0.95)) {
    throw new Error(`新浪财经行情不完整（${stocks.length}/${universe.stocks.length}）`);
  }

  const industryMarketCaps = stocks.reduce<Record<string, number>>((result, stock) => {
    result[stock.industry] = (result[stock.industry] || 0) + stock.marketCap;
    return result;
  }, {});
  const ages = stocks.map((stock) => Math.max(0, (Date.now() - Date.parse(stock.updatedAt)) / 1000))
    .filter((age) => Number.isFinite(age) && age <= 120)
    .sort((a, b) => a - b);
  const active = ages.length >= Math.ceil(stocks.length * 0.5);
  const sourceDelaySeconds = active && ages.length ? Math.round(ages[Math.floor(ages.length / 2)]) : null;

  return {
    generatedAt: new Date().toISOString(),
    count: stocks.length,
    coverage: `${market === 'china' ? 'A 股' : market === 'hongkong' ? '港股' : '美股'}基准名单 ${stocks.length} 家 · 行业和市值基准 ${universe.savedAt.slice(0, 10)}`,
    source: '新浪财经',
    sourceUrl,
    industryMarketCaps,
    quoteStatus: active ? 'delayed' as const : 'closed' as const,
    sourceDelaySeconds,
    quotePolicy: '新浪财经提供价格和涨跌幅；股票名单、行业和市值基准为本地快照。以股票报价时间判断时效。',
    refreshIntervalMs: 3_000,
    stocks,
  };
}
