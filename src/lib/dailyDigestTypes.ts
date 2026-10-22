export const DAILY_DIGESTS = [
  { id: 'jin10', name: '金十财经早餐', hour: 8, description: '全球财经原文 · 市场行情核验' },
  { id: 'daily60', name: '每日60秒', hour: 9, description: '每日新闻 · 官方农历 · 每日寄语' },
  { id: 'aibase', name: 'AIBase 日报', hour: 18, description: 'AI 动态 · 完整标题与原文提要' },
] as const;
export type DailyDigestId = typeof DAILY_DIGESTS[number]['id'];
export type DigestEdition = {
  schema: 1;
  id: DailyDigestId;
  editionDate: string;
  sourceDate: string;
  sourceUrl: string;
  generatedAt: string;
  revision: string;
  html: string;
  text: string;
  data: unknown;
  itemCount: number;
  quality: 'ready' | 'degraded';
  warnings: string[];
  generatorVersion?: number;
};
export type DigestSummary = {
  id: DailyDigestId;
  name: string;
  hour: number;
  dueDate: string;
  nextRunAt: string;
  state: 'empty' | 'generating' | 'ready' | 'stale' | 'waiting' | 'error';
  edition: Omit<DigestEdition, 'html' | 'text' | 'data'> | null;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  error: string | null;
};
export const DIGEST_MARKETS = [
  { id: 'COMP', name: '纳斯达克综合', symbol: '^IXIC', unit: '点', market: 'us' },
  { id: 'SPX', name: '标普500', symbol: '^GSPC', unit: '点', market: 'us' },
  { id: 'MAGS', name: '科技七巨头', symbol: 'MAGS', unit: 'USD', market: 'us' },
  { id: 'SSE', name: '上证指数', symbol: '000001', unit: '点', market: 'china' },
  { id: 'HSI', name: '恒生指数', symbol: 'HSI', unit: '点', market: 'hongkong' },
  { id: 'BTCUSD', name: '比特币现货', symbol: 'BTC/USD', unit: 'USD', market: 'crypto' },
  { id: 'XAUUSD', name: '现货黄金', symbol: 'XAU/USD', unit: 'USD/盎司', market: 'commodity' },
  { id: 'BRENT', name: '布伦特原油', symbol: 'OIL', unit: 'USD/桶', market: 'commodity' },
  { id: 'US10Y', name: '10年期美债', symbol: 'CMT 10Y', unit: '%', market: 'daily' },
] as const;
export type DigestMarketId = typeof DIGEST_MARKETS[number]['id'];
export type DigestMarketQuote = {
  id: DigestMarketId;
  price: number;
  previous: number;
  changePercent: number;
  changeBp?: number;
  quotedAt: string | null;
  observationDate?: string;
  checkedAt: string;
  source: string;
  sourceUrl: string;
  symbol: string;
  basis: string;
  instrument: string;
  delay: string;
  evidence: { sha256: string; fields: string };
};
export type DigestMarketRow = typeof DIGEST_MARKETS[number] & {
  quote: DigestMarketQuote | null;
  state: 'current' | 'cached' | 'unavailable';
  error: string | null;
};
export type DigestMarketSnapshot = {
  schema: 1;
  revision: string;
  checkedAt: string | null;
  nextRefreshAt: string | null;
  refreshing: boolean;
  available: number;
  rows: DigestMarketRow[];
};
export type DigestArticle = { id: DailyDigestId; revision: string; sourceDate: string; generatedAt: string; sourceUrl: string; data: unknown };
export type DigestIndex = { timezone: 'Asia/Shanghai'; serverTime: string; items: DigestSummary[]; markets?: DigestMarketSnapshot };
