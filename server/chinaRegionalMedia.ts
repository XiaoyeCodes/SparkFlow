import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ChinaProvinceOfficialItem } from '../src/data/chinaProvinceEconomy.ts';

export type RegionalNewsCategory = '民生' | '财经' | '文旅' | '社会' | '热点' | '政务';
export type RegionalNewsItem = ChinaProvinceOfficialItem & { category?: RegionalNewsCategory; sourceKind?: 'media' | 'government' };
export type RegionalMediaSource = { name: string; url: string; domain: string };
// Editorial newsrooms, not government press-release feeds. Mainland regions
// also use CNS's regional editions linked from https://www.chinanews.com.cn/.
const editions: Record<string, [string, string, string?]> = {
  北京市: ['北京日报', 'https://www.bjd.com.cn/', 'bj'],
  天津市: ['北方网', 'http://news.enorth.com.cn/', 'tj'],
  河北省: ['河北新闻网', 'https://www.hebnews.cn/', 'heb'],
  山西省: ['黄河新闻网', 'https://www.sxgov.cn/', 'sx'],
  内蒙古自治区: ['内蒙古新闻网', 'https://www.nmgnews.com.cn/', 'nmg'],
  辽宁省: ['东北新闻网', 'https://www.nen.com.cn/', 'ln'],
  吉林省: ['中国吉林网', 'https://www.cnjiwang.com/', 'jl'],
  黑龙江省: ['东北网', 'https://heilongjiang.dbw.cn/', 'hlj'],
  上海市: ['新民网', 'https://www.xinmin.cn/', 'sh'],
  江苏省: ['中国江苏网', 'https://jsnews.jschina.com.cn/', 'js'],
  浙江省: ['浙江在线', 'https://zjnews.zjol.com.cn/', 'zj'],
  安徽省: ['中安在线', 'https://ah.anhuinews.com/', 'ah'],
  福建省: ['东南网', 'https://fjnews.fjsen.com/', 'fj'],
  江西省: ['大江网', 'https://jiangxi.jxnews.com.cn/', 'jx'],
  山东省: ['大众网', 'https://sd.dzwww.com/', 'sd'],
  河南省: ['大河网', 'https://news.dahe.cn/', 'ha'],
  湖北省: ['荆楚网', 'https://www.cnhubei.com/hbxw/index.html', 'hb'],
  湖南省: ['红网', 'https://hn.rednet.cn/', 'hn'],
  广东省: ['南方网', 'https://news.southcn.com/', 'gd'],
  广西壮族自治区: ['广西新闻网', 'https://www.gxnews.com.cn/', 'gx'],
  海南省: ['南海网', 'https://www.hinews.cn/', 'hi'],
  重庆市: ['华龙网', 'https://www.cqnews.net/', 'cq'],
  四川省: ['四川新闻网', 'https://www.newssc.org/', 'sc'],
  贵州省: ['多彩贵州网', 'https://www.gog.cn/', 'gz'],
  云南省: ['云南网', 'https://www.yunnan.cn/', 'yn'],
  西藏自治区: ['中国西藏新闻网', 'https://www.xzxw.com/'],
  陕西省: ['西部网', 'http://news.cnwest.com/', 'shx'],
  甘肃省: ['中国甘肃网', 'https://www.gscn.com.cn/', 'gs'],
  青海省: ['青海新闻网', 'https://www.qhnews.com/', 'qh'],
  宁夏回族自治区: ['宁夏新闻网', 'https://www.nxnews.net/', 'nx'],
  新疆维吾尔自治区: ['天山网', 'https://www.ts.cn/', 'xj'],
  香港特别行政区: ['香港电台', 'https://news.rthk.hk/rthk/ch/component/k2/index.htm'],
  澳门特别行政区: ['澳门日报', 'https://www.macaodaily.com/'],
  台湾省: ['中央社', 'https://www.cna.com.tw/list/ahel.aspx'],
};
const rootDomain = (url: string) => {
  const host = new URL(url).hostname;
  return host.split('.').slice(/\.(?:com|net|org)\.(?:cn|hk|tw)$/.test(host) ? -3 : -2).join('.');
};
export const REGIONAL_MEDIA_SOURCES: Record<string, RegionalMediaSource[]> = Object.fromEntries(
  Object.entries(editions).map(([region, [name, url, cns]]) => [region, [
    { name, url, domain: rootDomain(url) },
    ...(cns ? [{ name: `中新网·${region.replace(/省|市$/, '')}`, url: `https://www.${cns}.chinanews.com.cn/`, domain: 'chinanews.com.cn' }] : []),
  ]]),
);
for (const [region, url] of [
  ['香港特别行政区', 'https://www.chinanews.com.cn/dwq/'],
  ['澳门特别行政区', 'https://channel.chinanews.com.cn/u/dwq-ga.shtml'],
  ['台湾省', 'https://channel.chinanews.com.cn/u/gn-la.shtml'],
]) {
  REGIONAL_MEDIA_SOURCES[region].push({ name: '中国新闻网', url, domain: 'chinanews.com.cn' });
}
const mediaDomains = new Set(Object.values(REGIONAL_MEDIA_SOURCES).flat().map(source => source.domain));
mediaDomains.add('chinanews.com'); // Alternate article domain linked by CNS editions.
export function isRegionalMediaHost(host: string) {
  return !/^(?:bbs|blog|forum|passport|login)\./i.test(host) && [...mediaDomains].some(base => host === base || host.endsWith(`.${base}`));
}
export const shortRegionName = (name: string) => name.replace(/(?:壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区|省|市|县|区)$/, '');

// Reuse the bundled administrative names, not economic values. Retain a compact
// name-only index so the collector does not hold another copy of the dataset.
type RegionName = { name: string; level: string; parentProvinceCode: string; parentCityCode?: string };
const regionNames: Record<string, RegionName> = (() => {
  try {
    const data = JSON.parse(readFileSync(resolve(process.cwd(), 'src/data/chinaRegionalEconomy.json'), 'utf8'));
    return Object.fromEntries(Object.entries(data.records as Record<string, RegionName>).map(([code, row]) => [code,
      { name: row.name, level: row.level, parentProvinceCode: row.parentProvinceCode, parentCityCode: row.parentCityCode }]));
  } catch { return {}; } // Missing optional geography must narrow, never broaden, matches.
})();
const provinceCodes: Record<string, string> = Object.fromEntries(Object.keys(editions).map((name, i) => [name,
  ['11','12','13','14','15','21','22','23','31','32','33','34','35','36','37','41','42','43','44','45','46','50','51','52','53','54','61','62','63','64','65','81','82','71'][i] + '0000']));

type Geography = { region: string; province: string; level: string; adcode?: string };
const termCache = new Map<string, string[]>();
export function regionalNewsTerms(query: Geography) {
  const key = `${query.province}:${query.level}:${query.region}`;
  if (termCache.has(key)) return termCache.get(key)!;
  const names = [query.region, shortRegionName(query.region)];
  if (query.level === 'province') {
    names.push(...Object.values(regionNames).filter(row => row.parentProvinceCode === provinceCodes[query.province] && row.name !== '市辖区')
      .flatMap(row => [row.name, ...(row.level === 'city' ? [shortRegionName(row.name)] : [])]));
  }
  // Keep full names for ambiguous counties (e.g. 鼓楼区), not bare “鼓楼”.
  if (query.level === 'county' && shortRegionName(query.region).length < 3) names.splice(1, 1);
  if (query.province === '台湾省') names.push('臺灣', '台灣');
  if (query.province === '澳门特别行政区') names.push('澳門');
  const terms = [...new Set(names)].filter(name => name.length >= 2);
  if (termCache.size >= 100) termCache.delete(termCache.keys().next().value!);
  termCache.set(key, terms); return terms;
}
export function matchesRegionalNews(title: string, query: Geography, source: RegionalMediaSource) {
  if (/习近平|習近平|总书记|總書記|国务院|國務院|外交部|特朗普|普京|联合国|聯合國/.test(title)) return false;
  // A regional edition is not proof of locality: national/international stories
  // syndicated onto it still need the selected region in the actual headline.
  if (!regionalNewsTerms(query).some(name => title.includes(name))) return false;
  if (query.level === 'county') {
    const homonyms = Object.values(regionNames).filter(row => row.name === query.region);
    if (homonyms.length > 1) {
      const parent = regionNames[query.adcode || '']?.parentCityCode;
      const city = parent ? regionNames[parent]?.name : undefined;
      // Provincial newsrooms disambiguate inter-province duplicates. Duplicates
      // within a province require the parent city named in the headline as well.
      if (homonyms.filter(row => row.parentProvinceCode === provinceCodes[query.province]).length > 1
        && (!city || !title.includes(shortRegionName(city)))) return false;
    }
  }
  return REGIONAL_MEDIA_SOURCES[query.province]?.some(candidate => candidate.url === source.url) || false;
}
export function regionalNewsCategory(title: string): RegionalNewsCategory {
  if (/热搜|熱搜|热议|熱議|刷屏|爆火|走红|走紅|网红|網紅/.test(title)) return '热点';
  if (/召开|召開|会议|會議|书记|書記|调研|調研|部署|常委|党组|黨組|政协|政協|人大|会见|會見|座谈|座談|党委|黨委|警示教育|廉政|党建|黨建|主题党日|主题教育|校庆|校慶|大学.*周年|大學.*周年/.test(title)) return '政务';
  if (/文旅|旅游|旅遊|游客|遊客|景区|景區|博物馆|博物館|非遗|非遺|演唱会|演唱會|音乐节|音樂節|艺术节|藝術節|文化|展览|展覽|考古|赛事|賽事|公开赛|公開賽|美食|夜游|夜经济|夜經濟|古韵|古韻/.test(title)) return '文旅';
  if (/就业|就業|招聘|教育|学校|學校|大学|大學|中学|中學|小学|小學|入学|入學|医疗|醫療|医院|醫院|医保|醫保|养老|養老|社保|住房|公租房|供水|停水|电费|公交|地铁|地鐵|出行|民生|菜价|菜價|开学|開學|托育/.test(title)) return '民生';
  if (/财经|財經|经济|經濟|产业|產業|企业|企業|投资|投資|消费|消費|出口|外贸|外貿|电商|電商|金融|营收|營收|融资|融資|科创|科技|上市|GDP|增长|增長|开工|投产|楼市|房价/.test(title)) return '财经';
  return '社会';
}
export function rankDiverseRegionalNews(items: RegionalNewsItem[], now: number): RegionalNewsItem[] {
  const titles = new Set<string>(), urls = new Set<string>();
  const ranked = items.filter(item => {
    const title = item.title.replace(/[\s\p{P}\p{S}]/gu, '');
    if (item.fallback || titles.has(title) || urls.has(item.url)) return false;
    const age = item.publishedAt ? now - Date.parse(item.publishedAt) : Infinity;
    if (!Number.isFinite(age) || age < -86_400_000 || age > 45 * 86_400_000) return false;
    titles.add(title); urls.add(item.url); return true;
  }).map(item => {
    const category = item.category || regionalNewsCategory(item.title);
    const ageDays = Math.max(0, (now - Date.parse(item.publishedAt!)) / 86_400_000);
    const emergency = ageDays <= 3 && /应急响应|重大事故|地震|紧急疏散|暴雨红色|重大灾害|公共卫生事件/.test(item.title);
    return { ...item, category, importanceScore: (emergency ? 1000 : 0) + (category === '政务' ? 0 : 100)
      + (item.sourceKind === 'media' ? 30 : 0) + (/重大|首次|突破|开通|获批/.test(item.title) ? 20 : 0) + Math.max(0, 45 - ageDays) };
  }).sort((a, b) => b.importanceScore - a.importanceScore || (b.publishedAt || '').localeCompare(a.publishedAt || ''));
  // Reserve variety in the first screen; retain emergency priority. This is an
  // editorial importance mix, not an invented social-platform heat ranking.
  const first: typeof ranked = ranked.filter(item => item.importanceScore >= 1000).slice(0, 6);
  for (const category of ['民生', '财经', '文旅', '热点', '社会'] as const) {
    const candidate = ranked.find(item => item.category === category && !first.includes(item));
    if (candidate && first.length < 6) first.push(candidate);
  }
  for (const item of ranked) if (!first.includes(item) && first.length < 6) first.push(item);
  first.sort((a, b) => b.importanceScore - a.importanceScore);
  return [...first, ...ranked.filter(item => !first.includes(item))].slice(0, 18);
}
