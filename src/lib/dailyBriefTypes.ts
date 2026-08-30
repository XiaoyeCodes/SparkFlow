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
