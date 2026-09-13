import { latestOfficialArticle, officialLists, officialText, parseOfficialLinks } from './chinaOfficialSources.ts';
import type { FisherMode, FisherObservation, FisherSnapshot } from '../src/lib/chinaFisherTypes.ts';

export const CPI_CALENDAR_URL = 'https://www.stats.gov.cn/sj/fbrc/bnxxfb/';
export const DEPOSIT_LIST_URL = 'https://www.bankofchina.com/fimarkets/lilv/fd31/';
type Reader = (url: string) => Promise<string>;
const MINUTE = 60_000;
const iso = (time: number) => new Date(time).toISOString();
const month = (year: number, index: number) => new Date(Date.UTC(year, index, 1)).toISOString().slice(0, 7);
const shanghaiDate = (period: string, day: number, time: string) => Date.parse(`${period}-${String(day).padStart(2, '0')}T${time}:00+08:00`);

// Parse the current official calendar, not a fixed "CPI is always on the 9th" assumption.
export function parseCpiCalendar(html: string) {
  const year = Number(officialText(html).match(/(20\d{2})年国家统计局主要统计信息发布日程表/)?.[1]);
  const rows = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map(match => match[0]);
  const index = rows.findIndex(row => officialText(row).includes('居民消费价格指数月度报告'));
  if (!year || index < 0) throw new Error('统计局发布日程暂无法核实');
  const cells = [...rows[index].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(match => officialText(match[1]));
  const days = cells.slice(-12).map(cell => Number(cell.match(/^(\d{1,2})\//)?.[1]));
  const times = [...(rows[index + 1] || '').matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    .map(match => officialText(match[1])).filter(cell => /^\d{1,2}:\d{2}$/.test(cell));
  if (days.length !== 12 || times.length !== 12 || days.some(day => !day || day > 31)) throw new Error('统计局发布日程格式变化');
  return days.map((day, i) => ({ period: month(year, i - 1), at: shanghaiDate(month(year, i), day, times[i].padStart(5, '0')) }));
}

export async function readDepositObservation(read: Reader): Promise<FisherObservation> {
  const articles = parseOfficialLinks(await read(DEPOSIT_LIST_URL), DEPOSIT_LIST_URL)
    .flatMap(article => {
      const date = article.title.match(/^人民币存款利率表[（(]?(20\d{2}-\d{2}-\d{2})/);
      return date ? [{ ...article, date: date[1] }] : [];
    }).sort((a, b) => b.date.localeCompare(a.date));
  const article = articles[0];
  if (!article) throw new Error('中国银行最新存款利率表暂无法核实');
  const html = await read(article.url);
  const title = officialText(html).match(/人民币存款利率表[（(]?(20\d{2}-\d{2}-\d{2})/)?.[1];
  if (title !== article.date) throw new Error('存款利率表版本不一致');
  const section = html.split('1.整存整取')[1]?.split('2.零存整取')[0];
  if (!section) throw new Error('整存整取存款口径暂无法核实');
  const rows = [...section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(row => [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => officialText(cell[1])));
  const rate = rows.find(row => row[0] === '一年')?.[1]?.replace(/[%％]$/, '');
  if (!rate || !/^\d+(?:\.\d+)?$/.test(rate) || +rate > 30) throw new Error('一年期整存整取利率字段异常');
  return {value: +rate, period: article.date.slice(0, 7), publishedAt: article.date, source: '中国银行', sourceUrl: article.url};
}

export async function readFisherObservation(kind: 'nominal' | 'inflation', read: Reader): Promise<FisherObservation> {
  const article = await latestOfficialArticle(kind === 'nominal' ? officialLists.lpr : officialLists.statistics,
    kind === 'nominal' ? /公布贷款市场报价利率.*公告/ : /^20\d{2}年\d{1,2}月份居民消费价格/, read);
  let value: number;
  let publishedAt: string;
  if (kind === 'nominal') {
    const match = article.text.match(/(?:为[：:]|[，,；;：:])1年期LPR为([\d.]+)[%％]/i);
    const date = article.title.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日/);
    if (!match || !date) throw new Error('央行 LPR 公告字段暂无法核实');
    value = Number(match[1]);
    publishedAt = `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}`;
    if (value < 0 || value > 30) throw new Error('LPR 数值异常');
  } else {
    // National headline YoY only; never substitute monthly, urban or core CPI.
    const match = article.text.match(/全国居民消费价格同比(上涨|下降|持平)([\d.]+)?[%％]?/);
    if (!match || !article.releasedAt || (match[1] !== '持平' && !match[2])) throw new Error('统计局全国 CPI 同比字段暂无法核实');
    value = match[1] === '持平' ? 0 : Number(match[2]) * (match[1] === '下降' ? -1 : 1);
    publishedAt = article.releasedAt;
    if (value <= -100 || value > 100) throw new Error('CPI 数值异常');
  }
  if (!Number.isFinite(value)) throw new Error('官方数据格式变化');
  return { value, period: article.period, publishedAt, source: kind === 'nominal' ? '中国人民银行' : '国家统计局', sourceUrl: article.url };
}

export function evaluateFisher(nominal: FisherObservation, inflation: FisherObservation,
  calendar: ReturnType<typeof parseCpiCalendar>, now: number, mode: FisherMode = 'loan'): FisherSnapshot {
  const local = new Date(now + 8 * 60 * MINUTE);
  const year = local.getUTCFullYear();
  const index = local.getUTCMonth();
  const lprBoundary = shanghaiDate(month(year, index), 20, '09:00');
  // Start rechecking conservatively on the 20th. A holiday extension never makes an old rate look new.
  const expectedLpr = month(year, index - (now < lprBoundary ? 1 : 0));
  const thisMonthCpi = calendar.find(row => row.period === month(year, index - 1));
  const expectedCpiPeriod = month(year, index - (thisMonthCpi && now >= thisMonthCpi.at ? 1 : 2));
  const nextCpi = calendar.find(row => row.at > now);
  const calendarCoversNow = calendar.some(row => new Date(row.at + 8 * 60 * MINUTE).getUTCFullYear() === year);
  const nextLpr = now < lprBoundary ? lprBoundary : shanghaiDate(month(year, index + 1), 20, '09:00');
  const nextRelease = Math.min(nextCpi?.at || shanghaiDate(month(year + 1, 0), 1, '00:00'), mode === 'loan' ? nextLpr : Infinity);
  const futureDate = nominal.publishedAt > iso(now + 8 * 60 * MINUTE).slice(0, 10)
    || inflation.publishedAt > iso(now + 8 * 60 * MINUTE).slice(0, 10)
    || nominal.period > month(year, index) || inflation.period >= month(year, index);
  const current = calendarCoversNow && !!thisMonthCpi && !futureDate
    && (mode === 'deposit' || nominal.period >= expectedLpr) && inflation.period >= expectedCpiPeriod;
  const nextCheck = Math.min(now + (current ? 5 : 1) * MINUTE, nextRelease);
  return {
    mode,
    status: current ? 'current' : 'pending',
    realRate: current ? Math.round((nominal.value - inflation.value) * 100) / 100 : null,
    nominal, inflation, checkedAt: iso(now), validUntil: iso(Math.min(now + 5 * MINUTE, nextRelease)),
    nextCheckAt: iso(nextCheck), nextReleaseAt: iso(nextRelease),
    message: current ? '官方最新发布 · 近似估算' : !calendarCoversNow ? '新年度发布日程待核实，暂不展示估算值'
      : mode === 'loan' ? '本期官方数据待确认，暂不展示旧值；LPR 节假日顺延' : '本期官方数据待确认，暂不展示旧值',
  };
}

export function createChinaFisherService(read: Reader, clock = Date.now) {
  const caches = new Map<FisherMode, FisherSnapshot>();
  const requests = new Map<FisherMode, Promise<FisherSnapshot>>();
  return async function getSnapshot(mode: FisherMode = 'loan') {
    let cache = caches.get(mode);
    const now = clock();
    if (cache && now < Date.parse(cache.nextCheckAt)) return cache;
    if (requests.has(mode)) return requests.get(mode)!;
    const pending = (async () => {
      try {
        const [nominal, inflation, calendar] = await Promise.all([
          mode === 'loan' ? readFisherObservation('nominal', read) : readDepositObservation(read),
          readFisherObservation('inflation', read), read(CPI_CALENDAR_URL).then(parseCpiCalendar),
        ]);
        // Never accept a CDN/list regression, even when it still falls within the expected period.
        if ((cache?.nominal && nominal.publishedAt < cache.nominal.publishedAt) || (cache?.inflation && inflation.period < cache.inflation.period)) {
          throw new Error('官方发布版本回退，等待重新核实');
        }
        cache = evaluateFisher(nominal, inflation, calendar, clock(), mode);
      } catch {
        const checked = clock();
        cache = { mode, status: 'unavailable', realRate: null, nominal: cache?.nominal || null, inflation: cache?.inflation || null,
          checkedAt: iso(checked), validUntil: iso(checked), nextCheckAt: iso(checked + MINUTE), nextReleaseAt: null,
          message: '官方来源或发布日程暂不可核实，1 分钟后自动重试' };
      }
      caches.set(mode, cache);
      return cache;
    })().finally(() => { requests.delete(mode); });
    requests.set(mode, pending);
    return pending;
  };
}
