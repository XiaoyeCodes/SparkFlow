import { officialText } from './chinaOfficialSources.ts';
import type { ChinaGdpSnapshot, ChinaGdpYear } from '../src/lib/chinaGdpTypes.ts';

export const GDP_LIST_URL = 'https://www.stats.gov.cn/sj/tjgb/ndtjgb/qgndtjgb/';
type Reader = (url: string) => Promise<string>;

export function gdpBulletins(html: string) {
  const years = new Map<number, {year: number; sourceUrl: string}>();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = officialText(match[2]);
    if (!/^20\d{2}年$/.test(title)) continue;
    const url = new URL(match[1], GDP_LIST_URL);
    if (url.hostname !== 'www.stats.gov.cn' || !/^https?:$/.test(url.protocol)) continue;
    const year = Number(title.slice(0, 4));
    years.set(year, {year, sourceUrl: url.href});
  }
  return [...years.values()].sort((a, b) => b.year - a.year).slice(0, 5).reverse();
}

export function parseGdpBulletin(html: string, year: number, sourceUrl: string): ChinaGdpYear {
  const text = officialText(html);
  if (!text.includes(`${year}年国民经济和社会发展统计公报`)) throw new Error('GDP 公报年份不符');
  const match = text.match(/(?:全年)?国内生产总值(?:\[\d+\]|[（(]GDP[）)])*([\d.]+)亿元[，,](?:按(?:不变|可比)价格计算[，,])?比上年(增长|下降)([\d.]+)%/);
  if (!match) throw new Error('GDP 公报字段缺失');
  const value = Number(match[1]) / 10_000;
  const growth = Number(match[3]) * (match[2] === '下降' ? -1 : 1);
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(growth)) throw new Error('GDP 数值无效');
  return {year, value, growth, sourceUrl};
}

export function createChinaGdpService(read: Reader, clock = Date.now) {
  let cache: ChinaGdpSnapshot | undefined;
  let pending: Promise<ChinaGdpSnapshot> | undefined;
  let newestYear = 0;
  return async () => {
    if (cache && clock() < Date.parse(cache.nextCheckAt)) return cache;
    if (pending) return pending;
    pending = (async () => {
      try {
        const articles = gdpBulletins(await read(GDP_LIST_URL));
        const local = new Date(clock() + 8 * 3600_000);
        const year = local.getUTCFullYear();
        // Annual bulletins normally arrive in late February. No old-year chart labelled current after February.
        const expectedYear = year - (local.getUTCMonth() < 2 ? 2 : 1);
        if (articles.length !== 5 || articles.some((item, i) => item.year >= year || (i > 0 && item.year !== articles[i - 1].year + 1))
          || articles[4].year < expectedYear || articles[4].year < newestYear) throw new Error('最新年度公报待发布或数据不完整');
        const years = await Promise.all(articles.map(async item => parseGdpBulletin(await read(item.sourceUrl), item.year, item.sourceUrl)));
        newestYear = years[4].year;
        const checked = clock();
        cache = {status:'current', years, checkedAt: new Date(checked).toISOString(), validUntil: new Date(checked + 3600_000).toISOString(), nextCheckAt: new Date(checked + 3600_000).toISOString()};
      } catch {
        const checked = clock();
        cache = {status:'unavailable', years:[], checkedAt:new Date(checked).toISOString(), validUntil:new Date(checked).toISOString(), nextCheckAt:new Date(checked + 60_000).toISOString()};
      }
      return cache;
    })().finally(() => { pending = undefined; });
    return pending;
  };
}
