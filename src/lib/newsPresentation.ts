import type { NewsCategory, NewsItem } from './newsTypes';

export type NewsSortMode = 'weight' | 'time' | 'heat' | 'importance' | 'source';
export type NewsCategoryFilter = 'all' | NewsCategory;

export const newsCategories: Array<[NewsCategoryFilter, string]> = [
  ['all', '全部'],
  ['tech', '科技 / AI'],
  ['finance', '金融 / 商业'],
  ['society', '社会'],
  ['livelihood', '民生 / 政策'],
  ['world', '国际']
];

export const newsSortOptions: Array<[NewsSortMode, string]> = [
  ['weight', '综合权重'],
  ['time', '时间最新'],
  ['heat', '热度优先'],
  ['importance', '重要程度'],
  ['source', '原榜顺序']
];

export function getNewsCategory(value: string | null): NewsCategoryFilter {
  return newsCategories.find(([id]) => id === value)?.[0] ?? 'all';
}

export function newsTimestamp(value?: string) {
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

export function newsDayKey(value: number | string) {
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp + 8 * 3600_000).toISOString().slice(0, 10) : '';
}

export function newsForSource(items: NewsItem[], source = 'all', now = Date.now()): NewsItem[] {
  const day = newsDayKey(now);
  const isToday = (item: Pick<NewsItem, 'todayOnly' | 'publishedAt'>) => !item.todayOnly || Boolean(item.publishedAt && newsDayKey(item.publishedAt) === day);
  const current = items.flatMap((item) => {
    if (!item.appearances?.length) return isToday(item) ? [item] : [];
    const appearances = item.appearances.filter(isToday);
    if (!appearances.length) return [];
    const lead = appearances.find((entry) => entry.sourceId === item.sourceId) || appearances[0];
    return [{ ...item, ...lead, appearances }];
  });
  if (source === 'all') return current;
  return current.flatMap((item) => {
    const matches = (entry: Pick<NewsItem, 'sourceId' | 'origin' | 'delivery'>) => source === 'international'
      ? entry.origin === 'foreign' && ['official-rss', 'google-news', 'custom-rss'].includes(entry.delivery || '')
      : entry.sourceId === source;
    const appearance = item.appearances?.find(matches);
    if (appearance) return [{ ...item, ...appearance, id: `${item.id}-${source}` }];
    return matches(item) ? [item] : [];
  });
}

function sortByDiversifiedWeight(items: NewsItem[]) {
  const pending = [...items];
  const sourceCounts = new Map<string, number>();
  const result: NewsItem[] = [];
  while (pending.length) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let index = 0; index < pending.length; index += 1) {
      const item = pending[index];
      const source = item.sourceId || item.source || '__unknown__';
      const priorCount = sourceCounts.get(source) || 0;
      const diversityPenalty = priorCount < 2 ? 0 : Math.min(22, 6 + (priorCount - 2) * 4);
      const score = item.weight - diversityPenalty;
      const best = pending[bestIndex];
      if (
        score > bestScore ||
        (score === bestScore && item.weight > best.weight) ||
        (score === bestScore && item.weight === best.weight && newsTimestamp(item.publishedAt) > newsTimestamp(best.publishedAt))
      ) {
        bestIndex = index;
        bestScore = score;
      }
    }
    const [next] = pending.splice(bestIndex, 1);
    const source = next.sourceId || next.source || '__unknown__';
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
    result.push(next);
  }
  return result;
}

export function selectNewsItems(items: NewsItem[], category: NewsCategoryFilter, sort: NewsSortMode, source = 'all', now = Date.now()) {
  const filtered = newsForSource(items, source, now).filter((item) => category === 'all' || item.category === category);
  if (sort === 'weight' && source === 'all') return sortByDiversifiedWeight(filtered);
  return filtered.sort((a, b) => {
    const timeDifference = newsTimestamp(b.publishedAt) - newsTimestamp(a.publishedAt);
    if (sort === 'source') {
      const sourceDifference = (a.sourceId || a.source).localeCompare(b.sourceId || b.source, 'zh-CN');
      return sourceDifference || (a.sourceRank ?? a.sourceOrder ?? Infinity) - (b.sourceRank ?? b.sourceOrder ?? Infinity) || timeDifference;
    }
    if (sort === 'time') return timeDifference || b.weight - a.weight;
    if (sort === 'heat') return b.heat - a.heat || b.weight - a.weight || timeDifference;
    if (sort === 'importance') return b.importance - a.importance || b.weight - a.weight || timeDifference;
    return b.weight - a.weight || timeDifference;
  });
}

export function newsPriority(weight: number) {
  return weight >= 78 ? 'high' : weight >= 58 ? 'mid' : 'low';
}

export function newsCategoryCounts(items: NewsItem[]) {
  return newsCategories.map(([id, label]) => ({
    id,
    label,
    count: id === 'all' ? items.length : items.filter((item) => item.category === id).length
  }));
}

export function formatNewsTime(value?: string) {
  const timestamp = newsTimestamp(value);
  if (!timestamp) return '时间待核验';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(timestamp);
}

export function formatNewsSync(value: string | undefined, now: number) {
  const timestamp = newsTimestamp(value);
  if (!timestamp) return '尚未同步';
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1440)} 天前`;
}
