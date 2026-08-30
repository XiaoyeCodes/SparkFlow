export type DailyBriefSlot = 'morning' | 'evening';

export type DailyBriefMarket = {
  id: string;
  name: string;
  symbol: string;
  value: number | null;
  display: string;
  changePercent: number | null;
  updatedAt?: string;
  sourceUrl?: string;
  status?: string;
};

export type DailyBriefNews = {
  id: string;
  title: string;
  source: string;
  category: string;
  publishedAt?: string;
  summary?: string;
  weight: number;
  url: string;
};

export type DailyBriefPosition = {
  symbol: string;
  name?: string;
  securityType?: string;
  currency?: string;
  quantity: number | null;
  averageCost: number | null;
};

export type DailyBriefSummary = {
  headline: string;
  regime: string;
  tone: 'calm' | 'balanced' | 'cautious' | 'risk';
  highlights: string[];
  risks: string[];
  watchlist: string[];
  portfolioNotes: string[];
  assessment?: DailyBriefAssessment;
};

export type DailyBriefAssessment = {
  rating: '积极' | '中性偏积极' | '中性' | '中性偏谨慎' | '谨慎';
  score: number;
  confidence: '低' | '中' | '高';
  rationale: string;
  advice: Array<{
    label: string;
    detail: string;
  }>;
  disclaimer: string;
};

export type DailyBriefChartPoint = {
  time: string;
  value: number;
};

export type DailyBriefFlowDetails = {
  kind: 'flows';
  generatedAt: string;
  price: DailyBriefChartPoint[];
  activity: DailyBriefChartPoint[];
  etfFlows: DailyBriefChartPoint[];
  metrics: {
    btcPrice: number | null;
    btc30dChange: number | null;
    activity30dChange: number | null;
    etfLatest: number | null;
    etf7d: number | null;
  };
  sources: Array<{ label: string; url: string; detail: string }>;
  errors: string[];
};

export type DailyBriefPerformanceSeries = {
  symbol: string;
  name: string;
  color: string;
  multiple: number | null;
  points: DailyBriefChartPoint[];
  maxDrawdown: number | null;
  drawdownPeak?: string;
  drawdownTrough?: string;
  recovered: boolean;
};

export type DailyBriefPerformanceDetails = {
  kind: 'performance';
  generatedAt: string;
  startDate: string;
  series: DailyBriefPerformanceSeries[];
  sources: Array<{ label: string; url: string; detail: string }>;
  errors: string[];
};

export type DailyBriefSourceStatus = {
  id: string;
  label: string;
  ok: boolean;
  stale?: boolean;
  fetchedAt?: string;
  detail?: string;
};

export type DailyBriefSnapshot = {
  version: 1;
  date: string;
  slot: DailyBriefSlot;
  generatedAt: string;
  updatedAt: string;
  summaryMode: 'ai' | 'rules';
  summary: DailyBriefSummary;
  markets: DailyBriefMarket[];
  macro: DailyBriefMarket[];
  news: DailyBriefNews[];
  portfolio: {
    connected: boolean;
    syncedAt?: string;
    positions: DailyBriefPosition[];
    detail?: string;
  };
  sources: DailyBriefSourceStatus[];
  errors: string[];
};

export type DailyBriefResponse = {
  snapshot: DailyBriefSnapshot;
  cache: {
    hit: boolean;
    key: string;
    generated: boolean;
  };
};
