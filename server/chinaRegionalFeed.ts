import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { Agent, fetch as request } from 'undici';
import { CHINA_PROVINCE_ECONOMY, rankChinaOfficialNews, type ChinaProvinceOfficialItem } from '../src/data/chinaProvinceEconomy.ts';
import { REGIONAL_MEDIA_SOURCES, isRegionalMediaHost, matchesRegionalNews, rankDiverseRegionalNews, regionalNewsCategory, shortRegionName, type RegionalMediaSource, type RegionalNewsItem } from './chinaRegionalMedia.ts';

type Page = { url: string; html: string };
export const REGIONAL_GOVERNMENT_PORTALS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(CHINA_PROVINCE_ECONOMY).map(([name, profile]) => [name, profile.governmentUrl])),
  香港特别行政区: 'https://www.info.gov.hk/gia/general/ctoday.htm',
  澳门特别行政区: 'https://www.gov.mo/zh-hans/news/',
  台湾省: 'https://www.ey.gov.tw/',
};
export type RegionalFeedQuery = { region: string; province: string; level: 'province' | 'city' | 'county'; adcode?: string };
export type RegionalFeed = {
  province: string; region: string; level: string; portalUrl?: string; generatedAt: string;
  policies: ChinaProvinceOfficialItem[]; news: RegionalNewsItem[];
  sourceStatus: 'live' | 'partial' | 'unavailable' | 'cached'; errors: string[];
};
const provincialSeeds: Record<string, string[]> = {
  湖北省: ['https://www.hubei.gov.cn/zwgk/hbyw/hbywqb/', 'https://www.hubei.gov.cn/zfwj/ezf/', 'https://rst.hubei.gov.cn/zfxxgk/zc/qtzdgkwj/'],
  山东省: ['http://www.shandong.gov.cn/', 'http://fgw.shandong.gov.cn/'], 广西壮族自治区: ['http://www.gxzf.gov.cn/'],
  甘肃省: ['https://ydyl.gansu.gov.cn/gsydyl/fzzc/gszc/', 'https://ydyl.gansu.gov.cn/gsydyl/fzzc/gszc/index_2.html', 'https://ydyl.gansu.gov.cn/gsydyl/fzzc/gszc/index_3.html'],
  青海省: ['http://www.qinghai.gov.cn/'],
  湖南省: ['http://www.hunan.gov.cn/'], 江西省: ['http://www.jiangxi.gov.cn/'],
  上海市: ['https://www.shanghai.gov.cn/nw12344/index.html'],
  吉林省: ['https://www.jl.gov.cn/szyw/jlyw/'], 海南省: ['https://www.hainan.gov.cn/hainan/'],
  香港特别行政区: ['https://www.info.gov.hk/gia/rss/general_zh.xml'],
  澳门特别行政区: ['https://govinfohub.gcs.gov.mo/api/rss/n/zh-hans'],
  台湾省: ['https://www.ey.gov.tw/Page/A2EC1FEF9BC39AD0', 'https://www.ey.gov.tw/Page/B6EC7D1F2A2186F3'],
};
const cityPortals: Record<string, string> = {
  '411300': 'https://www.nanyang.gov.cn/', '410500': 'https://www.anyang.gov.cn/', '410526': 'https://www.hnhx.gov.cn/',
};
const citySeeds: Record<string, string[]> = {
  '411300': ['https://www.nanyang.gov.cn/xwzx/nyyw/', 'https://www.nanyang.gov.cn/zwxxgk/qtfdxx/zfwj/'],
  '410526': ['https://www.hnhx.gov.cn/portal/zwgk/A0002index_1.htm', 'https://www.hnhx.gov.cn/portal/index.htm'],
};
const plain = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&#(x[\da-f]+|\d+);/gi, (_, n: string) => {
  const point = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
  return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
}).replace(/&(?:nbsp|ensp|emsp);/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&(?:apos|#39);/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/[\s\u200b\ufeff]+/g, ' ').trim();
const normalizedTitle = (title: string) => title.replace(/^(主题|简介|解读)[:：]\s*/, '').replace(/[\s\p{P}\p{S}]+/gu, '');
const domain = (url: string) => {
  const host = new URL(url).hostname;
  return /(?:^|\.)gov\.mo$/.test(host) ? 'gov.mo' : host.split('.').slice(-3).join('.');
};
export function regionalGovernmentUrl(input: string, base?: string): URL {
  const url = new URL(input, base);
  if (!['http:', 'https:'].includes(url.protocol) || !/(?:\.gov\.cn|\.gov\.hk|(?:^|\.)gov\.mo|\.gov\.tw)$/.test(url.hostname) || url.username || url.password
    || url.port || url.href.length > 2048) throw new Error('仅允许公开政府门户地址');
  url.hash = '';
  return url;
}
export function regionalNewsSourceUrl(input: string, base?: string): URL {
  try { return regionalGovernmentUrl(input, base); } catch { /* Check registered editorial sources separately. */ }
  const url = new URL(input, base);
  if (!['http:', 'https:'].includes(url.protocol) || !isRegionalMediaHost(url.hostname) || url.username || url.password || url.port || url.href.length > 2048) throw new Error('未登记的地方新闻来源');
  url.hash = ''; return url;
}
function links(page: Page, validate = regionalGovernmentUrl) {
  const html = page.html.replace(/<!--[\s\S]*?-->/g, '');
  const anchors = [...html.matchAll(/<a\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/a>/gi)].flatMap(match => {
    const href = match[1].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href || /^(?:#|javascript:)/i.test(href)) return [];
    let url: URL;
    try { url = validate(plain(href), page.url); } catch { return []; }
    const title = plain(match[1].match(/\btitle\s*=\s*["']([^"']+)["']/i)?.[1]
      || match[2].match(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1] || match[2]);
    const tail = html.slice(match.index! + match[0].length, match.index! + match[0].length + 180).split(/<\/li>|<a\b/i)[0];
    return [{ title, url: url.href, context: plain(match[0] + tail) }];
  });
  // Some provincial portals publish article arrays in the HTML, then render
  // links with JavaScript. Read literal JSON only; never execute remote scripts.
  for (const start of [...html.matchAll(/\[\s*\{\s*"/g)].slice(0, 40)) {
    let depth = 0, quoted = false, escaped = false;
    for (let i = start.index!; i < html.length; i++) {
      const char = html[i];
      if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
      if (char === '"') quoted = true;
      if (char === '[' || char === '{') depth++;
      if (char === ']' || char === '}') depth--;
      if (depth !== 0) continue;
      try {
        const rows = JSON.parse(html.slice(start.index, i + 1));
        for (const row of rows) {
          const target = row.url || (typeof row.urls === 'string' ? JSON.parse(row.urls)?.pc : row.urls?.pc);
          if (typeof row.title !== 'string' || typeof target !== 'string') continue;
          try { anchors.push({ title: plain(row.title), url: validate(target, page.url).href, context: `${row.pubDate || row.pubtime || ''} ${plain(row.title)}` }); } catch { /* Not an allowed article. */ }
        }
      } catch { /* Not a literal article array. */ }
      break;
    }
  }
  for (const match of page.html.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const field = (name: string) => match[1].match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') || '';
    try {
      const title = plain(field('title')), date = new Date(field('pubDate'));
      anchors.push({title,url:validate(plain(field('link')),page.url).href,context:`${Number.isFinite(date.getTime()) ? date.toISOString().slice(0,10) : ''} ${title}`});
    } catch { /* Malformed RSS entries are not articles. */ }
  }
  return anchors;
}

export function discoverRegionalPortalCandidates(html: string, region: string, base: string): string[] {
  // Search results may wrap destination URLs in Bing's base64 redirect. Decode
  // the destination without requesting the redirect service or trusting it.
  const decoded = html.replace(/href=(["'])(https?:\/\/[^"']+)\1/gi, (full, quote: string, value: string) => {
    try {
      const url = new URL(plain(value));
      if (/(^|\.)bing\.com$/.test(url.hostname) && url.pathname === '/ck/a') {
        const encoded = url.searchParams.get('u') || '';
        if (encoded.startsWith('a1')) return `href=${quote}${regionalGovernmentUrl(Buffer.from(encoded.slice(2), 'base64url').toString('utf8')).href}${quote}`;
      }
    } catch { /* Invalid or non-government destination. */ }
    return full;
  });
  const short = region.replace(/(?:自治州|自治县|市|县|区)$/, '');
  return links({ html: decoded, url: base }).filter(link => (link.title === short || link.title.includes(region))
    && !articlePath.test(link.url)).map(link => new URL(link.url).origin + '/');
}
const policyWords = /政策|通知|通告|意见|办法|方案|规划|条例|规章|决定|措施|细则|公告|批复|印发|規劃|條例|辦法|計劃|計畫|法規|修正|施政|規例|修訂/;
const articlePath = /(?:\/20\d{12,}\/|\/20\d{2}[/-]?\d{2}[/-]\d{2}|t\d{8}_\d+|(?:\d{6,}|[a-f\d-]{20,})\.(?:s?html?)|\/news\/\d+\/|\/Page\/[A-F\d]+\/[A-F\d]+|content[_/-]|article[_/-]|[?&](?:id|contentid|articleid)=)/i;
const nationalPath = /\/(?:szyw\/zyyw|gwy|gwyxx|gwywj|zyyw|zgyw|rdgz|tt1|ywtj|sy_1\/zyyw)\//i;
const newsWords = /召开|会议|发布|调研|推进|部署|发展|建设|经济|民生|产业|项目|就业|教育|医疗|交通|科技|农业|生态|增长|开工|投产|签约|突破|获批|防汛|安全|消费|發展|經濟|產業|會議|舉行|醫療|就業|宣布|出席/;
function publishedDate(text: string, url: string): string | undefined {
  // Some paths repeat the year (/2026/2026-09-11/...). Use valid month/day
  // ranges so an earlier non-date substring cannot hide the real timestamp.
  const pattern = /(20\d{2})[年./-]?(0?[1-9]|1[0-2])[月./-](0?[1-9]|[12]\d|3[01])(?!\d)/g;
  for (const m of [...text.matchAll(pattern), ...url.matchAll(pattern), ...url.matchAll(/(20\d{2})(0[1-9]|1[0-2])([012]\d|3[01])/g)]) {
    const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    if (Number.isFinite(Date.parse(date)) && new Date(date).toISOString().startsWith(date)) return date;
  }
}
export function parseRegionalArticles(region: string, page: Page): { policies: ChinaProvinceOfficialItem[]; news: ChinaProvinceOfficialItem[] } {
  const result: { policies: ChinaProvinceOfficialItem[]; news: ChinaProvinceOfficialItem[] } = { policies: [], news: [] };
  const localName = region.replace(/(?:壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区|省|市)$/, '');
  const source = plain(page.html.match(/<meta\s+[^>]*name=["']SiteName["'][^>]*content=["']([^"']+)/i)?.[1]
    || page.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || `${region}政府网站`).split(/[-_—|]/).filter(Boolean).at(-1)?.trim() || `${region}政府网站`;
  for (const link of links(page)) {
    if (domain(link.url) !== domain(page.url) || link.title.length < 10 || link.title.length > 180 || !articlePath.test(link.url)) continue;
    if (/^(?:关于本站|网站|政府信息公开指南|政府信息公开目录|无障碍|适老化)|(?:网站工作年度报表|依申请公开|网站地图|联系我们|隐私声明|申请指南|办事指南)$|提案.*(?:答复|答覆)|建议.*答复|建议办理|提案办理/.test(link.title) || /\/(?:hdjl|zmhd|xxgkzn)\//i.test(link.url)) continue;
    const local = link.title.includes(localName);
    if (!local && (nationalPath.test(new URL(link.url).pathname) || /国务院|中共中央|总书记|国家主席/.test(link.title))) continue;
    const item: ChinaProvinceOfficialItem = { id: createHash('sha1').update(link.url).digest('hex').slice(0, 16),
      title: link.title, source, url: link.url, publishedAt: publishedDate(link.context, link.url) };
    const isPolicy = policyWords.test(link.title) && !/召开|会议|调研|新闻发布会|政策解读|图解|一图读懂/.test(link.title);
    if (isPolicy) result.policies.push(item);
    else if (newsWords.test(link.title) || local || /(?:要闻|新闻|动态|新聞|動態)/.test(page.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')) result.news.push(item);
  }
  return result;
}
export function rankRegionalArticles(items: ChinaProvinceOfficialItem[], mode: 'policy' | 'news', now = Date.now()) {
  const seenTitles = new Set<string>(), seenUrls = new Set<string>();
  const unique = items.filter(item => {
    const title = normalizedTitle(item.title), url = item.url.replace(/^http:/, 'https:').replace(/\?.*$/, '');
    if (item.fallback || seenTitles.has(title) || seenUrls.has(url)) return false;
    const age = item.publishedAt ? now - Date.parse(item.publishedAt) : 0;
    if (age < -86_400_000 || age > (mode === 'news' ? 120 : 730) * 86_400_000) return false;
    seenTitles.add(title); seenUrls.add(url); return true;
  });
  return rankChinaOfficialNews(unique, unique.length).map(item => ({ ...item,
    importanceScore: (item.importanceScore || 0) + (/任免|职务|人事/.test(item.title) ? -1800 : 0),
  })).sort((a, b) => (b.importanceScore || 0) - (a.importanceScore || 0)
    || (Date.parse(b.publishedAt || '') || 0) - (Date.parse(a.publishedAt || '') || 0)).slice(0, 18);
}
function discoverSections(page: Page, mode: 'policy' | 'news') {
  const pattern = mode === 'policy' ? /政策文件|政府文件|办公厅文件|办公文件|规范性文件|政策发布|政策法规|通知公告|最新文件|政务公开|政府信息公开/
    : /(?:要闻|新闻|政务动态|今日|本地|市情|省情)/;
  return links(page).filter(link => link.title.length < 24 && pattern.test(link.title) && domain(link.url) === domain(page.url)
    && !articlePath.test(link.url) && !nationalPath.test(new URL(link.url).pathname) && !/国务院|全国|中央/.test(link.title)).map(link => link.url);
}
const mediaArticlePath = /(?:20\d{2}[/-]?\d{2}[/-]?\d{2}|(?:\d{6,}|[a-f\d]{20,})\.(?:s?html?|aspx)|\/(?:content|article|detail|story|news)[_/-]|[?&](?:id|contentid|articleid|n)=)/i;
const mediaHostMatches = (url: string, source: RegionalMediaSource) => {
  const host = new URL(url).hostname;
  return host === source.domain || host.endsWith(`.${source.domain}`)
    || (source.domain === 'chinanews.com.cn' && (host === 'chinanews.com' || host.endsWith('.chinanews.com')));
};
export function parseRegionalMediaArticles(query: RegionalFeedQuery, source: RegionalMediaSource, page: Page): RegionalNewsItem[] {
  if (!mediaHostMatches(page.url, source)) return [];
  const meta = (name: string) => {
    for (const match of page.html.matchAll(/<meta\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>/gi)) {
      const key = match[1].match(/(?:name|property)=["']([^"']+)["']/i)?.[1];
      if (key?.toLowerCase() === name.toLowerCase()) return plain(match[1].match(/content=["']([^"']*)["']/i)?.[1] || '');
    }
    return '';
  };
  const candidates = links(page, regionalNewsSourceUrl);
  if (mediaArticlePath.test(page.url)) {
    const title = meta('og:title') || plain(page.html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '');
    const date = meta('article:published_time') || meta('publishdate') || meta('pubdate') || meta('date')
      || page.html.match(/"datePublished"\s*:\s*"([^"]+)"/i)?.[1] || '';
    if (title) candidates.push({ title, url: page.url, context: date });
  }
  return candidates.filter(link => mediaHostMatches(link.url, source) && mediaArticlePath.test(link.url)
    && link.title.length >= 10 && link.title.length <= 180 && !/广告|招商加盟|网站地图|版权声明|版权所有/.test(link.title)
    && matchesRegionalNews(link.title, query, source)).map(link => ({
      id: createHash('sha1').update(link.url).digest('hex').slice(0, 16), title: link.title, url: link.url,
      source: source.name, sourceKind: 'media', category: regionalNewsCategory(link.title), publishedAt: publishedDate(link.context, link.url),
    }));
}

function publicIpv4(address: string) {
  const [a, b, c] = address.split('.').map(Number);
  return a > 0 && a < 224 && ![10, 127].includes(a) && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31)
    && !(a === 192 && (b === 168 || b === 0)) && !(a === 100 && b >= 64 && b <= 127)
    && !(a === 198 && ([18, 19].includes(b) || (b === 51 && c === 100))) && !(a === 203 && b === 0 && c === 113);
}
export function decodeRegionalPage(raw: Uint8Array, contentType = '') {
  const head = Buffer.from(raw.subarray(0, 16_384)).toString('ascii');
  const encoding = contentType.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1]
    || head.match(/<meta\b[^>]*charset\s*=\s*["']?([^\s;"'>]+)/i)?.[1]
    || head.match(/<\?xml[^>]*encoding=["']([^"']+)/i)?.[1] || 'utf-8';
  return new TextDecoder(/^(?:gb2312|gbk|gb18030)$/i.test(encoding) ? 'gb18030' : 'utf-8').decode(raw);
}
// No cookies, local proxies, arbitrary ports, or unvalidated redirects. Pin DNS
// to public IPv4 addresses so a discovered government link cannot target the LAN.
export async function fetchRegionalGovernmentPage(input: string): Promise<Page> {
  return fetchRegionalSourcePage(input, regionalGovernmentUrl);
}
export async function fetchRegionalSourcePage(input: string, validate = regionalNewsSourceUrl): Promise<Page> {
  let url = validate(input);
  const signal = AbortSignal.timeout(10_000);
  for (let hop = 0; hop < 4; hop++) {
    let abort!: () => void;
    const records = await Promise.race([lookup(url.hostname, { family: 4, all: true }), new Promise<never>((_, reject) => {
      abort = () => reject(new Error('官网 DNS 查询超时'));
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    })]).finally(() => signal.removeEventListener('abort', abort));
    if (!records.length || records.some(row => !publicIpv4(row.address))) throw new Error('官网未解析到公开网络');
    const dispatcher = new Agent({ connect: { lookup: (_host, options, callback) => options.all ? callback(null, records) : callback(null, records[0].address, 4) } });
    try {
      const response = await request(url, { dispatcher, signal, redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 SparkFlow/1.0', Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'zh-CN,zh;q=0.9' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        url = validate(response.headers.get('location') || '', url.href); continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`官网 HTTP ${response.status}`); }
      const chunks: Uint8Array[] = []; let size = 0;
      for await (const chunk of response.body || []) { size += chunk.length; if (size > 2_000_000) throw new Error('官网页面过大'); chunks.push(chunk); }
      const raw = Buffer.concat(chunks);
      const html = decodeRegionalPage(raw, response.headers.get('content-type') || '');
      // Only redirect stubs, not navigation/accessibility click handlers inside
      // a complete portal page. Those handlers previously hijacked collection.
      const redirect = (!/<a\b/i.test(html) && html.length < 10_000 ? html.match(/(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i)?.[1] : undefined)
        || html.match(/http-equiv=["']refresh["'][^>]*content=["'][^;]+;\s*url=([^"']+)/i)?.[1];
      if (redirect) { url = validate(plain(redirect), url.href); continue; }
      return { url: url.href, html };
    } finally { await dispatcher.destroy(); }
  }
  throw new Error('官网重定向次数过多');
}

export function createChinaRegionalFeedService(options: { fetchPage?: (url: string) => Promise<Page>; search?: (query: string) => Promise<string>; now?: () => number; onError?: (error: unknown) => void } = {}) {
  const now = options.now || Date.now;
  const fetchPage = options.fetchPage || fetchRegionalSourcePage;
  const cache = new Map<string, { storedAt: number; retryAt: number; data: RegionalFeed }>();
  const pending = new Map<string, Promise<RegionalFeed>>();
  const pagePending = new Map<string, Promise<Page>>();
  const pageCache = new Map<string, { at: number; page: Page }>();
  let active = 0; const waiters: Array<() => void> = [];
  const read = (url: string) => {
    const fresh = pageCache.get(url);
    if (fresh && now() - fresh.at < 300_000) return Promise.resolve(fresh.page);
    if (!pagePending.has(url)) {
      const job = (async () => {
        if (active >= 4) await new Promise<void>(resolve => waiters.push(resolve)); else active++;
        try {
          let page: Page;
          try { page = await fetchPage(url); }
          catch { await new Promise(resolve => setTimeout(resolve, 300)); page = await fetchPage(url); }
          pageCache.delete(url);
          while (pageCache.size >= 40) pageCache.delete(pageCache.keys().next().value!);
          pageCache.set(url, { at: now(), page });
          return page;
        }
        finally { const next = waiters.shift(); if (next) next(); else active--; pagePending.delete(url); }
      })();
      pagePending.set(url, job);
    }
    return pagePending.get(url)!;
  };
  async function collectMedia(query: RegionalFeedQuery): Promise<RegionalNewsItem[]> {
    const sources = REGIONAL_MEDIA_SOURCES[query.province] || [];
    const stories: RegionalNewsItem[] = [];
    const initial = await Promise.all(sources.map(source => read(source.url).catch(() => null)));
    initial.forEach((page, index) => { if (page) stories.push(...parseRegionalMediaArticles(query, sources[index], page)); });
    const ready = rankDiverseRegionalNews(stories, now());
    // Most provinces already have a diverse first screen on their two media
    // indexes. Avoid slow extra category fetches when those suffice.
    if (ready.length >= 12 && new Set(ready.map(item => item.category)).size >= 3) return ready;
    await Promise.all(sources.map(async (source, index) => {
      const visited = new Set<string>();
      const pages: Page[] = [];
      const readSource = async (url: string) => {
        if (visited.has(url)) return;
        visited.add(url);
        const page = await read(url).catch(() => null);
        if (page && mediaHostMatches(page.url, source)) { pages.push(page); stories.push(...parseRegionalMediaArticles(query, source, page)); }
      };
      visited.add(source.url);
      if (initial[index]) pages.push(initial[index]!);
      const local = shortRegionName(query.region);
      const sections = pages.flatMap(page => links(page, regionalNewsSourceUrl)).filter(link => mediaHostMatches(link.url, source)
        && !mediaArticlePath.test(link.url) && link.title.length < 20
        && (link.title.includes(local) || /民生|财经|文旅|社会|热点|本地|市域|融媒|市州|地市|区县|基层/.test(link.title)))
        .sort((a, b) => Number(b.title.includes(local)) - Number(a.title.includes(local)));
      await Promise.all([...new Set(sections.map(link => link.url))].slice(0, 3).map(url => readSource(url)));
      // Search is discovery only. Titles/dates below come from the fetched
      // newsroom page, never from an unverified search snippet.
      if (options.search && rankDiverseRegionalNews(stories, now()).length < 6) {
        const term = query.level === 'county' ? query.region : shortRegionName(query.region);
        const html = await options.search(`"${term}" site:${source.domain}`).catch(() => '');
        const decoded = html.replace(/href=(["'])(https?:\/\/[^"']+)\1/gi, (full, quote: string, value: string) => {
          try {
            const url = new URL(plain(value)), encoded = url.searchParams.get('u') || '';
            if (/(^|\.)bing\.com$/.test(url.hostname) && url.pathname === '/ck/a' && encoded.startsWith('a1'))
              return `href=${quote}${regionalNewsSourceUrl(Buffer.from(encoded.slice(2), 'base64url').toString('utf8')).href}${quote}`;
          } catch { /* Untrusted destination. */ }
          return full;
        });
        const found = links({ url: source.url, html: decoded }, regionalNewsSourceUrl).filter(link => mediaHostMatches(link.url, source)
          && mediaArticlePath.test(link.url) && matchesRegionalNews(link.title, query, source));
        await Promise.all([...new Set(found.map(link => link.url))].slice(0, 6).map(url => readSource(url)));
      }
    }));
    return rankDiverseRegionalNews(stories, now());
  }
  async function portal(query: RegionalFeedQuery): Promise<string> {
    if (query.level === 'province') return REGIONAL_GOVERNMENT_PORTALS[query.province];
    const known = cityPortals[query.adcode || ''];
    const parent = REGIONAL_GOVERNMENT_PORTALS[query.province];
    const candidates: string[] = known ? [known] : [];
    if (!known) {
      const homepage = await read(parent).catch(() => null);
      if (homepage) candidates.push(...discoverRegionalPortalCandidates(homepage.html, query.region, parent));
      if (options.search) {
        const html = await options.search(`${query.region}人民政府 官网`).catch(() => '');
        candidates.push(...discoverRegionalPortalCandidates(html, query.region, parent));
      }
    }
    for (const candidate of [...new Set(candidates)].slice(0, 5)) {
      if (domain(candidate) === domain(parent)) continue;
      const page = await read(candidate).catch(() => null);
      const identity = page?.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
      if (page && new RegExp(`${query.region}(?:人民)?政府`).test(plain(identity))) return page.url;
    }
    throw new Error('未找到与所选行政区匹配的政府门户');
  }
  async function collect(query: RegionalFeedQuery): Promise<RegionalFeed> {
    const mediaJob = collectMedia(query).catch(() => [] as RegionalNewsItem[]);
    const portalUrl = await portal(query).catch(() => undefined);
    const seeds = query.level === 'province' ? provincialSeeds[query.province] || [] : citySeeds[query.adcode || ''] || [];
    const visited = new Set<string>(); const pages: Page[] = [];
    const getPages = async (urls: string[]) => {
      const targets = [...new Set(urls)].filter(url => !visited.has(url)).slice(0, 10 - visited.size);
      targets.forEach(url => visited.add(url));
      const results = await Promise.allSettled(targets.map(url => read(url)));
      pages.push(...results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []));
    };
    await getPages([...(portalUrl ? [portalUrl] : []), ...seeds]);
    let policies: ChinaProvinceOfficialItem[] = [], news: ChinaProvinceOfficialItem[] = [];
    const aggregate = () => {
      const parsed = pages.map(page => parseRegionalArticles(query.region, page));
      policies = rankRegionalArticles(parsed.flatMap(part => part.policies), 'policy', now());
      news = rankRegionalArticles(parsed.flatMap(part => part.news), 'news', now());
    };
    aggregate();
    for (let depth = 0; depth < 2 && (policies.length < 6 || news.length < 6) && visited.size < 10; depth++) {
      const policyUrls = policies.length < 6 ? pages.flatMap(page => discoverSections(page, 'policy')) : [];
      const newsUrls = news.length < 6 ? pages.flatMap(page => discoverSections(page, 'news')) : [];
      const interleaved = Array.from({ length: Math.max(policyUrls.length, newsUrls.length) }, (_, i) => [policyUrls[i], newsUrls[i]]).flat().filter(Boolean);
      await getPages(interleaved); aggregate();
    }
    const media = await mediaJob;
    news = rankDiverseRegionalNews([...media, ...news.map(item => ({ ...item, sourceKind: 'government' as const }))], now());
    const errors: string[] = [];
    if (policies.length < 6) errors.push(`政策已核验 ${policies.length}/6 条，部分来源暂不可达或条目不足`);
    if (news.length < 6) errors.push(`新闻已核验 ${news.length}/6 条，部分来源暂不可达或条目不足`);
    if (!media.length) errors.push('地方媒体暂未取得匹配报道，当前仅保留可核验的政务新闻');
    return { province: query.region, region: query.region, level: query.level, portalUrl, generatedAt: new Date(now()).toISOString(), policies, news,
      sourceStatus: !policies.length && !news.length ? 'unavailable' : errors.length ? 'partial' : 'live', errors };
  }
  return {
    async get(query: RegionalFeedQuery): Promise<RegionalFeed> {
      if (!Object.hasOwn(REGIONAL_GOVERNMENT_PORTALS, query.province) || !/^[\p{Script=Han}·]{2,30}$/u.test(query.region)
        || !['province', 'city', 'county'].includes(query.level) || (query.adcode && !/^\d{6}$/.test(query.adcode))
        || (query.level === 'province' && query.region !== query.province)) throw new Error('无效的行政区参数');
      const key = `${query.province}:${query.level}:${query.adcode || ''}:${query.region}`;
      const old = cache.get(key);
      if (old && now() < old.retryAt) return old.data;
      if (pending.has(key)) return pending.get(key)!;
      if (pending.size >= 40) throw new Error('地方资讯加载繁忙，请稍后重试');
      const job = collect(query).catch((error): RegionalFeed => {
        options.onError?.(error);
        return { province: query.region, region: query.region, level: query.level,
          generatedAt: new Date(now()).toISOString(), policies: [], news: [], sourceStatus: 'unavailable', errors: ['地方官网暂不可用，请稍后重试'] };
      }).then(data => {
        // One failed refresh must not destroy a recent successful region snapshot.
        const failed = data.sourceStatus === 'unavailable';
        const result: RegionalFeed = failed && old && now() - old.storedAt < 30 * 60_000 && old.data.news.length + old.data.policies.length > 0
          ? { ...old.data, sourceStatus: 'cached', errors: data.errors } : data;
        cache.delete(key);
        while (cache.size >= 100) cache.delete(cache.keys().next().value!);
        cache.set(key, { data: result, storedAt: result.sourceStatus === 'cached' ? old!.storedAt : now(), retryAt: now() + (data.sourceStatus === 'live' ? 600_000 : 30_000) });
        return result;
      }).finally(() => pending.delete(key));
      pending.set(key, job); return job;
    },
  };
}
