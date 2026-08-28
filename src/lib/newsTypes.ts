export type NewsCategory = 'tech' | 'finance' | 'society' | 'livelihood' | 'world';

export type NewsDelivery = 'official-rss' | 'google-news' | 'custom-rss' | 'third-party' | 'community-rss' | 'official-daily';
export type CustomNewsSubscription = { id: string; label: string; url: string; category: NewsCategory; origin: 'domestic' | 'foreign' };

export type NewsItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  category: NewsCategory;
  categoryLabel: string;
  origin: 'domestic' | 'foreign';
  route: 'direct' | 'proxy';
  publishedAt?: string;
  summary?: string;
  heat: number;
  importance: number;
  recency: number;
  weight: number;
  weightLabel: string;
  sourceId?: string;
  sourceOrder?: number;
  sourceRank?: number;
  sourceRankLabel?: string;
  sourceHeat?: string;
  discussionUrl?: string;
  observedAt?: string;
  stale?: boolean;
  delivery?: NewsDelivery;
  providerName?: string;
  boardObservedAt?: string;
  todayOnly?: boolean;
  ranking?: { version: string; importanceReasons: string[]; heatBasis: string; recencyBasis: string };
  appearances?: NewsAppearance[];
};

export type NewsFeed = {
  generatedAt: string;
  proxy: string;
  rankingVersion?: string;
  categories: Array<{
    id: NewsCategory;
    label: string;
    count: number;
    topWeight: number;
    averageWeight: number;
  }>;
  sources: Array<{
    id: string;
    label: string;
    category: NewsCategory;
    categoryLabel: string;
    origin: 'domestic' | 'foreign';
    route: 'direct' | 'proxy';
    proxy?: string;
    ok: boolean;
    count: number;
    error?: string;
    stale?: boolean;
    fetchedAt?: string;
    homepage?: string;
    rankingKind?: string;
    delivery?: NewsDelivery;
    note?: string;
    custom?: boolean;
    feedUrl?: string;
    providerName?: string;
    todayOnly?: boolean;
    emptyMessage?: string;
  }>;
  items: NewsItem[];
};

export type NewsAppearance = Omit<NewsItem, 'id' | 'appearances'>;
