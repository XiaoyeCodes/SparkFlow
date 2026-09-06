import type { NewsFeed, NewsItem } from '../newsTypes';

export const safeNewsUrl = (value: unknown) => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
};

export function parseNewsFeed(value: unknown): NewsFeed {
  if (!value || typeof value !== 'object') throw new Error('新闻响应格式无效');
  const raw = value as Partial<NewsFeed>;
  if (typeof raw.generatedAt !== 'string' || !Array.isArray(raw.items) || !Array.isArray(raw.sources)) throw new Error('新闻响应缺少证据字段');
  const items = raw.items.flatMap((item): NewsItem[] => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Partial<NewsItem>;
    if (typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.source !== 'string' || typeof row.category !== 'string') return [];
    return [{ ...row, url: safeNewsUrl(row.url) ?? '', summary: typeof row.summary === 'string' ? row.summary : undefined } as NewsItem];
  });
  return { ...raw, items, categories: Array.isArray(raw.categories) ? raw.categories : [], proxy: typeof raw.proxy === 'string' ? raw.proxy : '', sources: raw.sources } as NewsFeed;
}

export async function fetchNewsEvidence(signal: AbortSignal) {
  const response = await fetch('/api/news-feed', { signal });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error((payload as { detail?: string })?.detail || '新闻源不可用');
  return parseNewsFeed(payload);
}
