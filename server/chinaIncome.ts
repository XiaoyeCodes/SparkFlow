import { officialText, parseOfficialLinks } from './chinaOfficialSources.ts';
import type { IncomeReport, IncomeSnapshot } from '../src/lib/chinaIncomeTypes.ts';

const LIST = 'https://www.stats.gov.cn/sj/zxfb/';
export const INCOME_CALENDAR = 'https://www.stats.gov.cn/sj/fbrc/bnxxfb/';
type Reader = (url: string) => Promise<string>;
type Release = { period: string; at: number };
// Source-backed fallback verified on 2026-09-13, never labelled as an online check.
export const VERIFIED_INCOME_REPORT: IncomeReport = {
  period:'2026-06', label:'2026 年上半年', publishedAt:'2026-07-15',
  sourceUrl:'https://www.stats.gov.cn/xxgk/sjfb/zxfb2020/202607/t20260715_1964129.html',
  groups:[{label:'全国',amount:22981,nominal:5.2,real:4.2},{label:'城镇',amount:30126,nominal:4.4,real:3.4},{label:'农村',amount:12699,nominal:6.4,real:5.5}],
  sources:[{label:'工资性收入',amount:13298,growth:5.3,share:57.9},{label:'经营净收入',amount:3628,growth:6.5,share:15.8},{label:'财产净收入',amount:1845,growth:1.1,share:8},{label:'转移净收入',amount:4210,growth:5.8,share:18.3}],
  median:19036,medianGrowth:4.7,medianRatio:82.8,
};
// NBS 2026 release calendar, fallback only when the live calendar is unavailable.
const VERIFIED_CALENDAR: Release[] = [
  {period:'2025-12',at:Date.parse('2026-01-19T10:00:00+08:00')},
  {period:'2026-03',at:Date.parse('2026-04-16T10:00:00+08:00')},
  {period:'2026-06',at:Date.parse('2026-07-15T10:00:00+08:00')},
  {period:'2026-09',at:Date.parse('2026-10-19T10:00:00+08:00')},
];
export function parseIncomeCalendar(html: string): Release[] {
  const year = Number(officialText(html).match(/(20\d{2})年国家统计局主要统计信息发布日程表/)?.[1]);
  const rows = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map(m=>m[0]);
  const index = rows.findIndex(row=>officialText(row).includes('全国居民收支情况季度报告'));
  if (!year || index < 0) throw new Error('收入发布日程待核实');
  const cells = [...rows[index].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m=>officialText(m[1])).slice(-12);
  const times = [...(rows[index+1] || '').matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m=>officialText(m[1])).filter(t=>/^\d{1,2}:\d{2}$/.test(t));
  const periods = [`${year-1}-12`,`${year}-03`,`${year}-06`,`${year}-09`];
  if (times.length !== 4 || cells.length !== 12) throw new Error('收入发布日程格式变化');
  return [0,3,6,9].map((month,i)=>{
    const day = Number(cells[month].match(/^(\d{1,2})\//)?.[1]);
    if (!day || day>31) throw new Error('收入发布日期缺失');
    return {period:periods[i],at:Date.parse(`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}T${times[i].padStart(5,'0')}:00+08:00`)};
  });
}
export function incomePeriod(title: string) {
  const m = title.match(/^(20\d{2})年(一季度|上半年|前三季度|全年)?居民收入和消费支出情况$/);
  return m ? {period:`${m[1]}-${m[2] === '一季度' ? '03' : m[2] === '上半年' ? '06' : m[2] === '前三季度' ? '09' : '12'}`,label:`${m[1]} 年${m[2] || '全年'}`} : null;
}
export function parseIncomeReport(html: string, title: string, sourceUrl: string, publishedAt: string): IncomeReport {
  const period = incomePeriod(title);
  if (!period) throw new Error('收入报告周期不明');
  const text = officialText(html).replace(/[（(][^（）()]*[）)]/g,'');
  if (!text.includes(title)) throw new Error('收入报告标题与正文版本不符');
  const income = text.split('二、居民消费支出情况')[0];
  const signed = (direction: string, value: string) => Number(value) * (direction==='下降' ? -1 : 1);
  const groups = ['全国','城镇','农村'].map(label=>{
    const m = income.match(new RegExp(`${label}居民人均可支配收入(\\d+)元[，,](?:比上年同期|比上年)?(?:名义)?(增长|下降)([\\d.]+)%[，,]扣除价格因素[，,]实际(增长|下降)([\\d.]+)%`));
    if (!m) throw new Error(`${label}收入字段缺失`);
    return {label,amount:+m[1],nominal:signed(m[2],m[3]),real:signed(m[4],m[5])};
  });
  const sources = ['工资性收入','经营净收入','财产净收入','转移净收入'].map(label=>{
    const m = income.match(new RegExp(`人均${label}(\\d+)元[，,](增长|下降)([\\d.]+)%[，,]占可支配收入的比重为([\\d.]+)%`));
    if (!m) throw new Error(`${label}字段缺失`);
    return {label,amount:+m[1],growth:signed(m[2],m[3]),share:+m[4]};
  });
  const median = income.match(/全国居民人均可支配收入中位数(\d+)元[，,](增长|下降)([\d.]+)%[，,]中位数是平均数的([\d.]+)%/);
  if (!median) throw new Error('收入中位数字段缺失');
  const report = {...period,publishedAt,sourceUrl,groups,sources,median:+median[1],medianGrowth:signed(median[2],median[3]),medianRatio:+median[4]};
  const numbers = [...groups.flatMap(row=>[row.amount,row.nominal,row.real]),...sources.flatMap(row=>[row.amount,row.growth,row.share]),report.median,report.medianGrowth,report.medianRatio];
  if (numbers.some(n=>!Number.isFinite(n)) || groups.some(row=>row.amount<=0) || sources.some(row=>row.amount<0 || row.share<0 || row.share>100)) throw new Error('收入数据格式无效');
  if (Math.abs(sources.reduce((n,row)=>n+row.amount,0)-groups[0].amount)>4 || Math.abs(sources.reduce((n,row)=>n+row.share,0)-100)>.3
    || Math.abs(report.median/groups[0].amount*100-report.medianRatio)>.2) throw new Error('收入口径不一致');
  return report;
}
export async function latestIncomeReport(read: Reader): Promise<IncomeReport> {
  for (let page=0;page<6;page++) {
    const url = LIST+(page ? `index_${page}.html` : '');
    const links = parseOfficialLinks(await read(url),url);
    if (!links.length) throw new Error('统计局栏目暂不可读取');
    const articles = links.filter(a=>incomePeriod(a.title)).sort((a,b)=>incomePeriod(b.title)!.period.localeCompare(incomePeriod(a.title)!.period));
    if (!articles.length) continue;
    const a = articles[0];
    if (!a.publishedAt) throw new Error('收入发布时间缺失');
    return parseIncomeReport(await read(a.url),a.title,a.url,a.publishedAt.slice(0,10));
  }
  throw new Error('未发现本期收入报告');
}
export function incomeValidity(report: IncomeReport, calendar: Release[], now: number) {
  const year = new Date(now+8*3600_000).getUTCFullYear();
  const thisYear = calendar.filter(row=>new Date(row.at+8*3600_000).getUTCFullYear()===year);
  const due = thisYear.filter(row=>row.at<=now);
  const expected = due.length ? due[due.length-1].period : `${year-1}-09`;
  const next = thisYear.find(row=>row.at>now)?.at || Date.parse(`${year+1}-01-01T00:00:00+08:00`);
  const asOf = new Date(now+8*3600_000).toISOString().slice(0,10);
  return {valid:thisYear.length===4 && report.period>=expected && report.publishedAt<=asOf && report.period<asOf.slice(0,7),next};
}
export function createChinaIncomeService(read: Reader, clock=Date.now) {
  let lastGood = VERIFIED_INCOME_REPORT;
  let calendar = VERIFIED_CALENDAR;
  let cache: IncomeSnapshot | undefined;
  let pending: Promise<IncomeSnapshot> | undefined;
  return async () => {
    if (cache && clock()<Date.parse(cache.nextCheckAt)) return cache;
    if (pending) return pending;
    pending = (async()=>{
      const results = await Promise.allSettled([latestIncomeReport(read),read(INCOME_CALENDAR).then(parseIncomeCalendar)]);
      let verified = results.every(r=>r.status==='fulfilled');
      const result = results[0];
      if (result.status==='fulfilled') {
        if (result.value.period>=lastGood.period && result.value.publishedAt<=new Date(clock()+8*3600_000).toISOString().slice(0,10)) lastGood=result.value;
        else verified=false;
      }
      if (results[1].status==='fulfilled') calendar=results[1].value;
      const now = clock();
      const validity = incomeValidity(lastGood,calendar,now);
      const next = Math.min(now+(verified ? 15 : 1)*60_000,validity.next);
      cache={status:validity.valid ? verified ? 'current' : 'snapshot' : 'unavailable',report:validity.valid ? lastGood : null,checkedAt:new Date(now).toISOString(),validUntil:new Date(Math.min(now+15*60_000,validity.next)).toISOString(),nextCheckAt:new Date(next).toISOString()};
      return cache;
    })().finally(()=>{pending=undefined;});
    return pending;
  };
}
