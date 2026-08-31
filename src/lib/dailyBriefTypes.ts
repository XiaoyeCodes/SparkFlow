export type DailyBriefSlot = "morning" | "midday" | "evening";

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
  tone: "calm" | "balanced" | "cautious" | "risk";
  highlights: string[];
  risks: string[];
  watchlist: string[];
  portfolioNotes: string[];
  assessment?: DailyBriefAssessment;
};

export type DailyBriefAssessment = {
  rating: "积极" | "中性偏积极" | "中性" | "中性偏谨慎" | "谨慎";
  score: number;
  confidence: "低" | "中" | "高";
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
  kind: "flows";
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
  kind: "performance";
  generatedAt: string;
  startDate: string;
  series: DailyBriefPerformanceSeries[];
  sources: Array<{ label: string; url: string; detail: string }>;
  errors: string[];
};

export type DailyBriefVisualSeries = {
  symbol: "MAG7" | "BTC";
  name: string;
  color: string;
  changePercent: number | null;
  points: DailyBriefChartPoint[];
};

export type DailyBriefEditorialMetric = {
  value: number | null;
  display: string;
  label?: string;
  change?: number | null;
  note?: string;
  status: "live" | "delayed" | "unavailable";
  source: string;
  sourceUrl: string;
};

export type DailyBriefEditorialComponent = {
  id: string;
  label: string;
  value: number | null;
  color: string;
};

export type DailyBriefEditorialEvent = {
  id: string;
  date: string;
  time: string;
  title: string;
  source: string;
  url: string;
};

export type DailyBriefAssetGroup = {
  id: "defensive" | "technology" | "crypto";
  label: string;
  eyebrow: string;
  description: string;
  items: DailyBriefUpstreamQuote[];
};

export type DailyBriefEditorialSnapshot = {
  generatedAt: string;
  issue: number;
  sentiment: {
    cryptoFearGreed: DailyBriefEditorialMetric;
    stockFearGreed: DailyBriefEditorialMetric;
    vix: DailyBriefEditorialMetric;
    mvrvZScore: DailyBriefEditorialMetric;
    lthSupplyRatio: DailyBriefEditorialMetric;
    sopr: DailyBriefEditorialMetric;
    stockComponents: DailyBriefEditorialComponent[];
    cryptoHistory: DailyBriefChartPoint[];
  };
  signals: {
    top: number | null;
    bottom: number | null;
    coverage: number;
    methodology: string;
  };
  indices: DailyBriefUpstreamQuote[];
  stocks: DailyBriefUpstreamQuote[];
  crypto: DailyBriefUpstreamQuote[];
  assetGroups: DailyBriefAssetGroup[];
  onchain: {
    sopr: DailyBriefEditorialMetric;
    lthSopr: DailyBriefEditorialMetric;
    wma200Multiple: DailyBriefEditorialMetric;
    puellMultiple: DailyBriefEditorialMetric;
    fundingRate: DailyBriefEditorialMetric;
    openInterest: DailyBriefEditorialMetric;
    dominance: DailyBriefEditorialMetric;
  };
  marketSeries: DailyBriefVisualSeries[];
  events: DailyBriefEditorialEvent[];
};

export type DailyBriefSourceStatus = {
  id: string;
  label: string;
  ok: boolean;
  stale?: boolean;
  fetchedAt?: string;
  detail?: string;
};

export type DailyBriefUpstreamQuote = {
  symbol: string;
  name: string;
  price: number | null;
  changePercent: number | null;
  marketState?: string;
  display?: string;
  sourceUrl?: string;
  history?: DailyBriefChartPoint[];
};

export type DailyBriefDay1Snapshot = {
  fetchedAt: string;
  sourceUrl: string;
  analysis: {
    macroAnalysis: string;
    cryptoAnalysis: string;
    actionSuggestions: string;
    topNews: Array<{
      title: string;
      tag?: string;
      summary?: string;
      action?: string;
      source?: string;
      url?: string;
    }>;
    generatedAt?: string;
    dataTimestamp?: string;
  };
};

export type DailyBriefSnapshot = {
  version: 10;
  date: string;
  slot: DailyBriefSlot;
  generatedAt: string;
  updatedAt: string;
  summaryMode: "ai" | "rules";
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
  editorial?: DailyBriefEditorialSnapshot;
  day1?: DailyBriefDay1Snapshot;
};

export type DailyBriefResponse = {
  snapshot: DailyBriefSnapshot;
  cache: {
    hit: boolean;
    key: string;
    generated: boolean;
    stale?: boolean;
  };
};
