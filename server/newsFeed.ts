import { fetch, ProxyAgent } from 'undici';
import type { NewsAppearance, NewsCategory, NewsDelivery, NewsFeed, NewsItem } from '../src/lib/newsTypes';

export type NewsSource = {
  id: string;
  label: string;
  category: NewsCategory;
  sourceWeight: number;
  origin: 'domestic' | 'foreign';
  route: 'direct' | 'proxy';
  url: string;
  kind: string;
  homepage?: string;
  rankingKind?: string;
  mixed?: boolean;
  delivery?: NewsDelivery;
  note?: string;
  maxAgeHours?: number;
  publisherDomain?: string;
  custom?: boolean;
  providerName?: string;
  todayOnly?: boolean;
  emptyMessage?: string;
  trendRegion?: 'worldwide' | 'united-states';
  trendFilter?: 'chinese';
};
type Candidate = Partial<NewsItem> & Pick<NewsItem, 'title' | 'url'>;
type Transport = (source: NewsSource) => Promise<{ text: string; route: 'direct' | 'proxy' }>;

export const NEWS_RANKING_VERSION = 'signals-v4';
export const NEWS_CATEGORY_LABELS: Record<NewsCategory, string> = {
  tech: '科技 / AI', finance: '金融 / 商业', society: '社会', livelihood: '民生 / 政策', world: '国际'
};

// Public endpoints verified against the linked aggregator and publisher pages.
// RSS/editorial order is NOT advertised as a hot-list rank.
export const ADDITIONAL_NEWS_SOURCES: NewsSource[] = [
  { id: 'readhub', label: 'Readhub 24 小时热榜', category: 'tech', sourceWeight: 76, origin: 'domestic', route: 'direct', url: 'https://readhub.cn/hot', kind: 'readhub', rankingKind: '24 小时热榜', mixed: true },
  { id: 'weibo', label: '微博热搜', category: 'society', sourceWeight: 45, origin: 'domestic', route: 'direct', url: 'https://weibo.com/ajax/side/hotSearch', homepage: 'https://s.weibo.com/top/summary', kind: 'weibo', rankingKind: '热搜榜', mixed: true },
  { id: 'v2ex', label: 'V2EX 热门', category: 'tech', sourceWeight: 50, origin: 'domestic', route: 'proxy', url: 'https://www.v2ex.com/api/topics/hot.json', homepage: 'https://www.v2ex.com/?tab=hot', kind: 'v2ex', rankingKind: '热门榜', mixed: true },
  { id: 'hackernews', label: 'Hacker News', category: 'tech', sourceWeight: 64, origin: 'foreign', route: 'proxy', url: 'https://news.ycombinator.com/', kind: 'hackernews', rankingKind: '首页榜' },
  { id: 'github-trending', label: 'GitHub Trending', category: 'tech', sourceWeight: 60, origin: 'foreign', route: 'direct', url: 'https://github.com/trending?since=daily', kind: 'github', rankingKind: '日榜' },
  { id: 'huggingface', label: 'Hugging Face 论文', category: 'tech', sourceWeight: 72, origin: 'foreign', route: 'proxy', url: 'https://huggingface.co/api/daily_papers', homepage: 'https://huggingface.co/papers', kind: 'huggingface' },
  { id: 'tencent', label: '腾讯新闻早报', category: 'world', sourceWeight: 70, origin: 'domestic', route: 'direct', url: 'https://i.news.qq.com/web_backend/v2/getTagInfo?tagId=aEWqxLtdgmQ%3D', homepage: 'https://news.qq.com/', kind: 'tencent', mixed: true },
  { id: 'sspai', label: '少数派', category: 'tech', sourceWeight: 62, origin: 'domestic', route: 'direct', url: 'https://sspai.com/feed', kind: 'rss' },
  { id: 'infoq-cn', label: 'InfoQ 中文', category: 'tech', sourceWeight: 70, origin: 'domestic', route: 'direct', url: 'https://www.infoq.cn/feed.xml', kind: 'rss' },
  { id: 'zhihu', label: '知乎热榜', category: 'society', sourceWeight: 50, origin: 'domestic', route: 'direct', url: 'https://60s.viki.moe/v2/zhihu', homepage: 'https://www.zhihu.com/hot', kind: 'zhihu', delivery: 'third-party', providerName: '60s API', rankingKind: '问题热榜', mixed: true,
    note: '知乎问题热榜 · 通过第三方 60s API 聚合，非官方直连；按返回榜单保留名次与原始热度，发布时间为问题创建时间，可能存在缓存延迟。' },
  { id: 'reddit', label: 'Reddit 热门', category: 'society', sourceWeight: 48, origin: 'foreign', route: 'proxy', url: 'https://www.reddit.com/r/popular/hot/.rss?limit=30', homepage: 'https://www.reddit.com/r/popular/hot/', kind: 'reddit', delivery: 'community-rss', rankingKind: 'Popular · Hot', mixed: true,
    note: 'Reddit r/popular 的 Hot 排序 · 官方 RSS，保留返回顺序与帖子发布时间；这不是当天 Top 得票榜。RSS 不提供票数，不虚构点赞数。' },
  { id: 'x-trends', label: 'X（推特）趋势', category: 'society', sourceWeight: 42, origin: 'foreign', route: 'proxy', url: 'https://trends24.in/', homepage: 'https://trends24.in/', kind: 'x-trends', trendRegion: 'worldwide', delivery: 'third-party', providerName: 'Trends24', rankingKind: '全球趋势快照', mixed: true,
    note: '第三方 Trends24 的 Worldwide 最新时间片，非 X 官方直连或你的个性化趋势。采样时间不等于话题发布时间；仅提供话题及 X 搜索链接。超过 4 小时的快照视为过期。' },
  { id: 'x-trends-us', label: 'X 美国榜', category: 'society', sourceWeight: 42, origin: 'foreign', route: 'proxy', url: 'https://trends24.in/united-states/', homepage: 'https://trends24.in/united-states/', kind: 'x-trends', trendRegion: 'united-states', delivery: 'third-party', providerName: 'Trends24', rankingKind: '美国趋势快照', mixed: true,
    note: '第三方 Trends24 · 固定 United States 地区，不随 VPN 节点或个人账号变化。保留最新时间片前 30 名及原始热度，非 X 官方直连；采样时间不等于发布时间，超过 4 小时不展示。' },
  { id: 'x-trends-zh', label: 'X 中文话题（筛选）', category: 'society', sourceWeight: 42, origin: 'foreign', route: 'proxy', url: 'https://trends24.in/', homepage: 'https://trends24.in/', kind: 'x-trends', trendRegion: 'worldwide', trendFilter: 'chinese', delivery: 'third-party', providerName: 'Trends24', rankingKind: '全球原榜 · 中文筛选', mixed: true,
    emptyMessage: '最新全球趋势前 50 名中暂无匹配的中文话题。这不代表 X 上没有中文讨论；筛选不会用日文或旧榜补位。',
    note: '从 Trends24 全球最新时间片前 50 名筛选中文候选，最多展示 30 条，保留全球原榜名次（可能不连续）。按简繁体特征和中文关键词保守筛选，排除含日文假名或韩文的话题；短词可能漏判或误判。不是中国地区榜，也不是完整中文热榜；超过 4 小时不展示。' },
  { id: 'aibase', label: 'aibase', category: 'tech', sourceWeight: 70, origin: 'domestic', route: 'direct', url: 'https://news.aibase.cn/daily', homepage: 'https://news.aibase.cn/daily', kind: 'aibase', delivery: 'official-daily', todayOnly: false,
    emptyMessage: '来源暂未提供可核验的日报，请稍后刷新。',
    note: '始终展示最新已发布的一期 AI 日报：今天未发布则显示最近一期，周末或停更也不清空。保留实际发布时间与原文链接，不混入普通资讯或热门推荐。' },
  ...[
    ['nyt-world', '纽约时报 · 国际', 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', 'https://www.nytimes.com/section/world', 'world'],
    ['bbc-top', 'BBC · 头条', 'https://feeds.bbci.co.uk/news/rss.xml', 'https://www.bbc.com/news', 'world'],
    ['bbc-world', 'BBC · 国际', 'https://feeds.bbci.co.uk/news/world/rss.xml', 'https://www.bbc.com/news/world', 'world'],
    ['bbc-chinese', 'BBC · 中文', 'https://feeds.bbci.co.uk/zhongwen/simp/rss.xml', 'https://www.bbc.com/zhongwen/simp', 'world'],
    ['bloomberg', '彭博社 · 市场', 'https://feeds.bloomberg.com/markets/news.rss', 'https://www.bloomberg.com/markets', 'finance'],
    ['guardian-world', '卫报 · 国际', 'https://www.theguardian.com/world/rss', 'https://www.theguardian.com/world', 'world'],
    ['aljazeera', '半岛电视台', 'https://www.aljazeera.com/xml/rss/all.xml', 'https://www.aljazeera.com/', 'world'],
    ['france24', 'France 24', 'https://www.france24.com/en/rss', 'https://www.france24.com/en/', 'world']
  ].map(([id, label, url, homepage, category]): NewsSource => ({
    id, label, url, homepage, category: category as NewsCategory, sourceWeight: 78,
    origin: 'foreign', route: 'proxy', kind: 'feed', delivery: 'official-rss', maxAgeHours: 24,
    note: '官方 RSS · 最近 24 小时；保留原文及订阅顺序，未提供热榜名次。文章全文可能需要订阅。'
  })),
  ...[['wsj', '华尔街日报', 'wsj.com'], ['reuters', '路透社', 'reuters.com']].map(([id, label, domain]): NewsSource => ({
    id, label, category: 'world', sourceWeight: 78, origin: 'foreign', route: 'proxy', kind: 'feed',
    url: 'https://news.google.com/rss/search?q=' + encodeURIComponent('site:' + domain + ' when:1d') + '&hl=en-US&gl=US&ceid=US%3Aen',
    homepage: 'https://www.' + domain, delivery: 'google-news', publisherDomain: domain, maxAgeHours: 24,
    note: (id === 'wsj' ? '旧官方 RSS 实测停留在 2025 年。' : '') + '通过 Google News 检索最近 24 小时的该媒体报道，非官方直连；可能收录不全或有延迟。链接经 Google 跳转，全文仍受媒体订阅限制。'
  }))
];

export function cleanNewsText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
      const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, (entity) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' }[entity] || entity))
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function safeNewsUrl(value: unknown, base?: string) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.replace(/&amp;/g, '&'), base);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

export function validNewsDate(value: unknown, now = Date.now()): string | undefined {
  if (!value) return undefined;
  const raw = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : String(value);
  const time = new Date(raw).getTime();
  return Number.isFinite(time) && time > 0 && time <= now + 5 * 60_000 ? new Date(time).toISOString() : undefined;
}

// RSS/Atom metadata only. Never execute HTML, expand XML entities or fetch article bodies.
export function parseSyndication(text: string, source: NewsSource): Candidate[] {
  const encoding = text.match(/<\?xml\b[^>]*encoding=["']([^"']+)["']/i)?.[1];
  if (encoding && !/^(utf-8|utf8|us-ascii)$/i.test(encoding)) throw new Error('此入口仅支持 UTF-8 编码的 RSS/Atom');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('不支持包含 DTD 或外部实体的订阅');
  if (!/<(?:rss|feed|rdf:RDF)\b/i.test(text)) {
    if (/安全检测|captcha|checking your browser|access denied/i.test(text)) throw new Error('安全验证拦截：返回验证页面，未返回 RSS/Atom');
    throw new Error('返回内容不是 RSS/Atom 订阅');
  }
  if (!/<\/(?:rss|feed|rdf:RDF)>/i.test(text) && !/<feed\b[^>]*\/>/i.test(text)) throw new Error('RSS/Atom 内容不完整');
  const tag = (block: string, name: string) => block.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + name + '>', 'i'))?.[1] || '';
  const attr = (block: string, name: string) => block.match(new RegExp('\\b' + name + '\\s*=\\s*(["\'])([\\s\\S]*?)\\1', 'i'))?.[2] || '';
  const blocks = text.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) || [];
  return blocks.slice(0, 200).flatMap((block, index) => {
    const links = block.match(/<link\b[^>]*>/gi) || [];
    const alternate = links.find((link) => attr(link, 'href') && (!attr(link, 'rel') || attr(link, 'rel') === 'alternate') && (!attr(link, 'type') || /html/i.test(attr(link, 'type'))));
    const url = safeNewsUrl(cleanNewsText(alternate ? attr(alternate, 'href') : tag(block, 'link')), source.url);
    let title = cleanNewsText(tag(block, 'title'));
    if (!url || !title) return [];
    if (source.publisherDomain) {
      const sourceTag = block.match(/<source\b[^>]*>/i)?.[0] || '';
      const publisherUrl = safeNewsUrl(attr(sourceTag, 'url'));
      const host = publisherUrl ? new URL(publisherUrl).hostname : '';
      if (host !== source.publisherDomain && !host.endsWith('.' + source.publisherDomain)) return [];
      const suffix = ' - ' + cleanNewsText(tag(block, 'source'));
      if (title.endsWith(suffix)) title = title.slice(0, -suffix.length);
    }
    return [{ title, url, sourceOrder: index + 1,
      publishedAt: cleanNewsText(tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || tag(block, 'dc:date')) || undefined,
      summary: source.delivery === 'google-news' ? undefined : cleanNewsText(tag(block, 'description') || tag(block, 'summary') || tag(block, 'content:encoded') || tag(block, 'content')).slice(0, 280)
    }];
  });
}

function categoryFor(title: string, fallback: NewsCategory): NewsCategory {
  if (/医保|社保|住房|养老|教育|学校|就业|薪酬|裁员|减员|应届生|发改委|国务院|气象|台风|地震|洪水|灾害|救援/.test(title)) return 'livelihood';
  if (/美联储|央行|利率|财政|股市|IPO|财报|融资|并购|收购|营收|利润|证券|退市|汇率|金融|比特币/i.test(title)) return 'finance';
  if (/人工智能|大模型|芯片|半导体|机器人|软件|开源|科技|苹果|手机|阿里|腾讯|字节|\bAI\b|LLM|GPT|Claude|Gemini|DeepSeek|OpenAI|Anthropic|NVIDIA|GitHub/i.test(title)) return 'tech';
  if (/战争|制裁|外交|总统|首相|联合国|欧盟|军事/.test(title)) return 'world';
  return fallback;
}
const score = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function scoreNews(candidate: Candidate, source: NewsSource, now = Date.now()): NewsItem {
  const title = cleanNewsText(candidate.title);
  const summary = cleanNewsText(candidate.summary).slice(0, 280);
  const text = title + ' ' + summary;
  const category = source.mixed ? categoryFor(title, 'society') : candidate.category || source.category;
  const publishedAt = validNewsDate(candidate.publishedAt, now);
  const observedAt = validNewsDate(candidate.observedAt, now) || new Date(now).toISOString();
  const sourceRank = Number.isInteger(candidate.sourceRank) && candidate.sourceRank! > 0 ? candidate.sourceRank : undefined;
  const reasons = ['来源基准 ' + source.sourceWeight];
  let impact = 35;
  if (/降息|加息|央行|美联储|财政|监管|制裁|战争|通胀|GDP|CPI|医保|社保|就业|地震|台风|洪水|救援|\b(inflation|central bank|earthquake|federal reserve|interest rates?|rate cuts?|rate hikes?|sanctions?|war|ceasefire|tariffs?|elections?|unemployment|floods?|hurricanes?|regulation)\b/i.test(text)) {
    impact += 35; reasons.push('涉及宏观政策或公共影响');
  }
  if (/发布|实施|通过|批准|公布|财报|并购|收购|开源|上线|破获|预警|\b(launch|release|acquir|announc|approv|enact|merger|earnings)\w*/i.test(title)) {
    impact += 18; reasons.push('标题包含具体事件或发布');
  }
  if (/大模型|芯片|半导体|算力|机器人|人工智能|\b(AI|LLM|agent|model|paper|research)\b/i.test(text)) {
    impact += 12; reasons.push('科技或产业进展');
  }
  let importance = score(source.sourceWeight * 0.35 + score(impact) * 0.65);
  if (/预测|预计|有望|据悉|传闻|知情人士|爆料|可能|研究机构.{0,18}将|料将|或将|\b(rumor|reportedly|may|could)\b/i.test(title)) {
    importance = Math.min(importance, 58); reasons.push('预测或未证实信息，重要程度上限 58');
  }
  if (/观点|解读|评论|专栏|自曝|建议|如何|怎么看|警告：|\b(opinion|why|how to)\b/i.test(title)) {
    importance = Math.min(importance, 65); reasons.push('观点或解读，重要程度上限 65');
  }
  if (/综艺|明星|演唱会|粉丝|恋情|景甜|王俊凯|票房|电影|电视剧|娱乐|文娱|八卦/.test(title)) {
    importance = Math.min(importance, 42); reasons.push('娱乐话题，重要程度上限 42');
  }
  if (['weibo', 'v2ex', 'zhihu', 'reddit'].includes(source.id) || source.kind === 'x-trends') reasons.push('社区线索需核验，热度不代表可信度');
  const heat = sourceRank ? score(100 * Math.exp(-(sourceRank - 1) / 20)) : score(candidate.heat || 0);
  const recency = publishedAt ? score(100 * Math.exp(-Math.max(0, now - Date.parse(publishedAt)) / 36e5 / 36)) : 0;
  const hasHeat = Boolean(sourceRank || candidate.sourceHeat);
  // No invented publication time or popularity: renormalize only the available dimensions.
  const denominator = 0.55 + (publishedAt ? 0.25 : 0) + (hasHeat ? 0.2 : 0);
  let weight = score((importance * 0.55 + (publishedAt ? recency * 0.25 : 0) + (hasHeat ? heat * 0.2 : 0)) / denominator);
  if (!publishedAt) { weight = Math.max(0, weight - 8); reasons.push('缺少发布时间，综合权重扣 8 分'); }
  if (candidate.stale) weight = Math.max(0, weight - 10);
  return {
    ...candidate,
    id: candidate.id || source.id + '-' + encodeURIComponent(candidate.url),
    title, summary, url: safeNewsUrl(candidate.url, source.url), category,
    categoryLabel: NEWS_CATEGORY_LABELS[category], source: source.label, sourceId: source.id,
    origin: source.origin, route: candidate.route || source.route, publishedAt, observedAt, delivery: source.delivery,
    providerName: source.providerName, todayOnly: source.todayOnly,
    sourceRank, sourceRankLabel: sourceRank ? source.rankingKind : undefined,
    heat, importance, recency, weight,
    weightLabel: weight >= 78 ? '高优先' : weight >= 58 ? '值得看' : weight >= 38 ? '观察' : '低噪',
    ranking: {
      version: NEWS_RANKING_VERSION, importanceReasons: reasons,
      heatBasis: sourceRank ? '原榜名次归一化；原始名次保留' : hasHeat ? '来源内热度归一化' : '来源未提供热度，不计入综合权重',
      recencyBasis: publishedAt ? '使用来源提供的发布时间' : '发布时间待核验，不以抓取时间替代'
    }
  };
}

// Parse the public server-rendered hydration data as JSON, never execute page scripts.
export function parseReadhub(html: string): Candidate[] {
  let stream = '';
  for (const match of html.matchAll(/self\.__next_f\.push\((.*?)\)<\/script>/gs)) {
    try { const chunk = JSON.parse(match[1]); if (chunk[0] === 1 && typeof chunk[1] === 'string') stream += chunk[1]; } catch { /* not a data chunk */ }
  }
  let rows: any[] | undefined;
  function visit(value: any, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 30 || rows) return;
    if (Array.isArray(value.queryKey) && value.queryKey.length === 1 && value.queryKey[0] === 'hot-topics') {
      const data = value.state?.data?.data?.items;
      if (Array.isArray(data)) rows = data;
      return;
    }
    for (const child of Object.values(value)) visit(child, depth + 1);
  }
  for (const line of stream.split('\n')) {
    const data = line.match(/^[\da-f]+:(\{.*|\[.*)$/i);
    if (data) { try { visit(JSON.parse(data[1])); } catch { /* non-JSON RSC row */ } }
  }
  if (!rows?.length) throw new Error('Readhub 24 小时榜结构不可用，未用周榜替代');
  return rows.slice(0, 30).map((row, index) => ({
    title: row.title, url: 'https://readhub.cn/topic/' + encodeURIComponent(row.id),
    publishedAt: row.publishDate, sourceRank: index + 1, sourceOrder: index + 1
  })).filter((_, index) => typeof rows![index].id === 'string' && Boolean(rows![index].id));
}

export function beijingNewsDay(value: number | string) {
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp + 8 * 3600_000).toISOString().slice(0, 10) : '';
}

function parseAibaseData(html: string, key: 'getDailyNews' | 'getDailyNewsDetail') {
  const script = html.match(/<script\b[^>]*id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!script) throw new Error('aibase 日报数据结构不可用');
  const values = JSON.parse(script[1]);
  if (!Array.isArray(values)) throw new Error('aibase 日报数据不是有效索引表');
  const read = (ref: unknown): any => {
    if (!Number.isInteger(ref) || Number(ref) < 0 || Number(ref) >= values.length) throw new Error('aibase 日报数据引用无效');
    return values[Number(ref)];
  };
  const unwrap = (value: any) => {
    for (let depth = 0; depth < 8 && Array.isArray(value) && ['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef'].includes(value[0]); depth++) value = read(value[1]);
    return value;
  };
  const root = unwrap(read(0));
  const data = unwrap(read(root?.data));
  const response = read(data?.[key]);
  if (read(response?.code) !== 200) throw new Error('aibase 日报返回失败');
  return { data: read(response?.data), read };
}

function aibaseDate(value: unknown, now: number) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return undefined;
  const date = validNewsDate(value.replace(' ', 'T') + '+08:00', now);
  return date && Date.parse(date) <= now ? date : undefined;
}

export function parseAibaseList(html: string, now = Date.now()): Candidate[] {
  const { data, read } = parseAibaseData(html, 'getDailyNews');
  const list = read(data?.list);
  if (!Array.isArray(list)) throw new Error('aibase 日报列表不可用');
  return list.flatMap((ref: unknown) => {
    const row = read(ref);
    const date = aibaseDate(read(row.createTime), now);
    const id = read(row.oid);
    const title = cleanNewsText(read(row.title));
    if (!date || !/^\d+$/.test(String(id)) || !title.startsWith('AI日报')) return [];
    return [{ id: 'aibase-' + id, title, url: 'https://news.aibase.cn/daily/' + id, publishedAt: date, sourceOrder: 1 }];
  }).sort((a: Candidate, b: Candidate) => Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!)).slice(0, 1);
}

export function parseAibaseDetail(html: string, daily: Candidate, now = Date.now()): Candidate[] {
  const { data, read } = parseAibaseData(html, 'getDailyNewsDetail');
  const date = aibaseDate(read(data.createTime), now);
  if (!date) throw new Error('aibase 日报正文发布时间无效或尚未发布');
  const title = cleanNewsText(read(data.title));
  if (!title.startsWith('AI日报')) throw new Error('aibase 返回的不是日报正文');
  const body = read(data.summary);
  if (typeof body !== 'string' || !body) throw new Error('aibase 日报正文暂不可用');
  const headings = [...body.matchAll(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi)]
    .map((match) => cleanNewsText(match[1])).filter((text) => /^\d+[、.．]/.test(text));
  const summary = headings.length ? headings.join('；') : cleanNewsText(read(data.description));
  return [{ ...daily, title, publishedAt: date, summary: summary.slice(0, 280) }];
}

function htmlAttribute(html: string, name: string) {
  const match = html.match(new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}

// Short Han-only names are shared with Japanese: require a positive Chinese cue,
// not merely the absence of kana. This is a conservative heuristic, not language detection.
function isLikelyChineseTopic(title: string) {
  if (!/\p{Script=Han}/u.test(title) || /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\uFF66-\uFF9F]/u.test(title)) return false;
  const chineseCharacters = /[这们吗说谁为与从让给还过对时个么网车东书买卖龙风门开关发觉见语气听讲请钱铁热搜应获奖刚经边爱湾艺视闻亿岁两该进连达动华实广办众难头乐兰這們嗎說為與從讓對麼賣關發覺體學實廣點應獎灣藝]/u;
  const chinesePhrases = /中文|中国|中國|台湾|台灣|臺灣|香港|北京|上海|深圳|广州|廣州|华语|華語|普通话|普通話|人工智能|大模型|人民币|人民幣|世界杯|演唱会|演唱會|早上好|大家好/u;
  return chineseCharacters.test(title) || chinesePhrases.test(title);
}

export function parseXTrends(html: string, now = Date.now(), options: { region?: NewsSource['trendRegion']; chineseOnly?: boolean } = {}): Candidate[] {
  if (options.region) {
    const heading = cleanNewsText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
    const regionName = options.region === 'united-states' ? 'United States' : 'Worldwide';
    if (!heading.startsWith(regionName + ' X (Twitter) Trends')) throw new Error('Trends24 榜单地区不匹配：预期 ' + regionName);
  }
  const cards = [...html.matchAll(/<h3\b([^>]*)>[\s\S]*?<\/h3>\s*<ol\b([^>]*)>([\s\S]*?)<\/ol>/gi)]
    .filter((match) => htmlAttribute(match[2], 'class').split(' ').includes('trend-card__list'))
    .map((match) => ({ at: validNewsDate(Number(htmlAttribute(match[1], 'data-timestamp')), now), body: match[3] }))
    .filter((card) => Boolean(card.at)).sort((a, b) => Date.parse(b.at!) - Date.parse(a.at!));
  const latest = cards[0];
  if (!latest) throw new Error('Trends24 最新趋势时间片不可用');
  if (now - Date.parse(latest.at!) > 4 * 3600_000) throw new Error('Trends24 趋势快照超过 4 小时，暂不展示过期榜单');
  const candidates = [...latest.body.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].slice(0, 50).flatMap((match, index) => {
    const link = match[1].match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
    const url = safeNewsUrl(link && htmlAttribute(link[1], 'href'));
    const title = cleanNewsText(link?.[2]);
    if (!title || !link || !url || !['twitter.com', 'x.com'].includes(new URL(url).hostname) || new URL(url).pathname !== '/search') return [];
    const count = match[1].match(/<span\b[^>]*class=["']?tweet-count\b[^>]*>([\s\S]*?)<\/span>/i)?.[1];
    return [{ title, url, sourceRank: index + 1, sourceOrder: index + 1,
      sourceHeat: cleanNewsText(count) || undefined, boardObservedAt: latest.at }];
  });
  if (!candidates.length) throw new Error('Trends24 时间片中没有有效话题，可能是页面结构变化');
  return (options.chineseOnly ? candidates.filter((item) => isLikelyChineseTopic(item.title)) : candidates).slice(0, 30);
}

export function parseAdditionalSource(source: NewsSource, text: string, now = Date.now()): Candidate[] {
  if (source.kind === 'feed') return parseSyndication(text, source);
  if (source.kind === 'aibase') return parseAibaseList(text, now);
  if (source.kind === 'x-trends') return parseXTrends(text, now, { region: source.trendRegion, chineseOnly: source.trendFilter === 'chinese' });
  if (source.kind === 'reddit') return parseSyndication(text, source).filter((item) => /^(?:www\.)?reddit\.com$/.test(new URL(item.url).hostname)).map((item) => ({
    ...item, sourceRank: item.sourceOrder, summary: undefined, discussionUrl: item.url
  }));
  if (source.kind === 'readhub') return parseReadhub(text);
  if (source.kind === 'hackernews') {
    const blocks = text.split(/<tr[^>]*class=["']athing[^"']*["'][^>]*>/i).slice(1);
    return blocks.slice(0, 30).flatMap((block, index) => {
      const titleLink = block.match(/class=["']titleline["'][^>]*>\s*<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
      if (!titleLink) return [];
      const discussion = block.match(/href=["'](item\?id=\d+)["']/)?.[1];
      const publishedAt = block.match(/class=["']age["'][^>]*title=["']([^"']+)["']/)?.[1];
      const points = cleanNewsText(block.match(/class=["']score["'][^>]*>([\s\S]*?)<\/span>/)?.[1]);
      const rank = Number(cleanNewsText(block.match(/class=["']rank["'][^>]*>([\s\S]*?)<\/span>/)?.[1]).replace('.', ''));
      return [{ title: cleanNewsText(titleLink[2]), url: safeNewsUrl(titleLink[1], source.url), discussionUrl: safeNewsUrl(discussion, source.url),
        publishedAt, sourceRank: rank || index + 1, sourceOrder: index + 1, sourceHeat: points ? points.replace('points', '积分') : undefined }];
    });
  }
  if (source.kind === 'github') {
    return [...text.matchAll(/<article[^>]*class=["'][^"']*Box-row[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi)].slice(0, 25).flatMap((match, index) => {
      const block = match[1];
      const link = block.match(/<h2[\s\S]*?<a[^>]*href=["']([^"']+)["']/)?.[1];
      if (!link) return [];
      const stars = cleanNewsText(block.match(/<a[^>]*href=["'][^"']+\/stargazers["'][^>]*>([\s\S]*?)<\/a>/)?.[1]);
      const today = cleanNewsText(block).match(/([\d,]+) stars today/)?.[1];
      return [{ title: link.replace(/^\//, ''), url: safeNewsUrl(link, source.url), summary: cleanNewsText(block.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1]),
        sourceRank: index + 1, sourceOrder: index + 1, sourceHeat: today ? today + ' 今日新增 Stars' : stars ? stars + ' 总 Stars' : undefined }];
    });
  }
  const json = JSON.parse(text);
  if (source.kind === 'zhihu') {
    if (json.code !== 200 || !Array.isArray(json.data)) throw new Error('知乎聚合热榜返回异常');
    return json.data.slice(0, 30).flatMap((row: any, index: number) => {
      const url = safeNewsUrl(row.link);
      if (!url || !/^(?:www\.)?zhihu\.com$/.test(new URL(url).hostname) || !/^\/question\/\d+\/?$/.test(new URL(url).pathname)) return [];
      return [{ title: row.title, url, summary: cleanNewsText(row.detail).slice(0, 280), publishedAt: validNewsDate(row.created_at, now),
        sourceRank: index + 1, sourceOrder: index + 1, sourceHeat: cleanNewsText(row.hot_value_desc) || undefined, discussionUrl: url }];
    });
  }
  if (source.kind === 'weibo') {
    if (json.ok !== 1 || !Array.isArray(json.data?.realtime)) throw new Error('微博热搜返回格式异常');
    return json.data.realtime.flatMap((row: any, index: number) => {
      if (row.is_ad || !row.word) return [];
      const rank = Number(row.realpos) || (Number.isInteger(row.rank) ? row.rank + 1 : index + 1);
      return [{ title: row.note || row.word, url: 'https://s.weibo.com/weibo?q=' + encodeURIComponent(row.word_scheme || row.word),
        sourceRank: rank, sourceOrder: index + 1, sourceHeat: row.num == null ? undefined : String(row.num) + ' 热度' }];
    }).slice(0, 30);
  }
  if (source.kind === 'v2ex') {
    if (!Array.isArray(json)) throw new Error('V2EX 热门返回格式异常');
    return json.slice(0, 20).map((row: any, index: number) => ({
      title: row.title, url: row.url, summary: cleanNewsText(row.content).slice(0, 240),
      publishedAt: validNewsDate(row.created), sourceRank: index + 1, sourceOrder: index + 1,
      sourceHeat: String(row.replies ?? 0) + ' 回复'
    }));
  }
  if (source.kind === 'huggingface') {
    if (!Array.isArray(json)) throw new Error('Hugging Face 每日论文返回格式异常');
    const maxVotes = Math.max(1, ...json.map((row: any) => Number(row.paper?.upvotes) || 0));
    return json.slice(0, 30).map((row: any, index: number) => ({
      title: row.paper?.title || row.title, url: 'https://huggingface.co/papers/' + encodeURIComponent(row.paper?.id),
      summary: row.paper?.summary || row.summary, publishedAt: row.paper?.publishedAt,
      sourceOrder: index + 1, sourceHeat: String(row.paper?.upvotes ?? 0) + ' 赞',
      heat: score(100 * Math.log1p(Number(row.paper?.upvotes) || 0) / Math.log1p(maxVotes))
    }));
  }
  if (source.kind === 'tencent') {
    const rows = json.data?.tabs?.[0]?.articleList;
    if (!Array.isArray(rows)) throw new Error('腾讯新闻早报返回格式异常');
    return rows.slice(0, 20).map((row: any, index: number) => ({
      title: row.title, url: row.url || row.link_info?.url,
      publishedAt: String(row.pub_time || row.publish_time || '').replace(' ', 'T') + '+08:00',
      summary: row.abstract || row.digest, sourceOrder: index + 1
    }));
  }
  throw new Error('未知新闻源类型');
}

function canonicalUrl(value: string) {
  const url = new URL(value);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^(f|from|spm|ref)$/i.test(key)) url.searchParams.delete(key);
  return url.host.replace(/^www\./, '') + url.pathname.replace(/\/$/, '') + url.search;
}
function appearanceOf(item: NewsItem): NewsAppearance {
  const { id: _id, appearances: _appearances, ...appearance } = item;
  return appearance;
}

export function mergeNewsItems(items: NewsItem[]): NewsItem[] {
  const byUrl = new Map<string, NewsItem>();
  const byTitle = new Map<string, NewsItem>();
  const merged: NewsItem[] = [];
  for (const item of [...items].sort((a, b) => Number(Boolean(a.stale)) - Number(Boolean(b.stale)) || b.weight - a.weight)) {
    if (!safeNewsUrl(item.url) || !item.title) continue;
    const key = canonicalUrl(item.url);
    const titleKey = item.title.toLowerCase().replace(/[\s\p{P}]/gu, '');
    const prior = byUrl.get(key) || (titleKey.length >= 12 ? byTitle.get(titleKey) : undefined);
    if (prior) {
      if (!prior.appearances!.some((entry) => entry.sourceId === item.sourceId)) prior.appearances!.push(appearanceOf(item));
      byUrl.set(key, prior);
      if (titleKey.length >= 12) byTitle.set(titleKey, prior);
    } else {
      const entry = { ...item, appearances: [appearanceOf(item)] };
      merged.push(entry); byUrl.set(key, entry);
      if (titleKey.length >= 12) byTitle.set(titleKey, entry);
    }
  }
  return merged.sort((a, b) => b.weight - a.weight || (Date.parse(b.publishedAt || '') || 0) - (Date.parse(a.publishedAt || '') || 0));
}

export function createNewsFeedService(
  legacySources: NewsSource[],
  loadRss: (source: NewsSource & { kind: 'rss' }) => Promise<NewsItem[]>,
  proxyUrl: string,
  options: { transport?: Transport; customTransport?: Transport; now?: () => number; additionalSources?: NewsSource[]; sourceTimeoutMs?: number } = {}
) {
  const sources = [...legacySources, ...(options.additionalSources ?? ADDITIONAL_NEWS_SOURCES)];
  const clock = options.now || Date.now;
  const proxy = options.transport ? undefined : new ProxyAgent(proxyUrl);
  const sourceCache = new Map<string, { items: Candidate[]; at: number; route: 'direct' | 'proxy' }>();
  const routePreference = new Map<string, 'direct' | 'proxy'>();
  let snapshot: NewsFeed | null = null;
  let snapshotAt = 0;
  let inFlight: Promise<NewsFeed> | null = null;
  const transport: Transport = options.transport || (async (source) => {
    const preferred = routePreference.get(source.id) || source.route;
    const routes: Array<'direct' | 'proxy'> = preferred === 'direct' ? ['direct', 'proxy'] : ['proxy', 'direct'];
    let lastError: unknown;
    for (const route of routes) {
      try {
        const response = await fetch(source.url, {
          signal: AbortSignal.timeout(route === 'direct' ? 4500 : 9000),
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SparkFlow/1.0)', Accept: 'application/json,text/html,*/*', Referer: new URL(source.url).origin + '/' },
          ...(route === 'proxy' ? { dispatcher: proxy } : {})
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const text = await response.text();
        if (text.length > 5_000_000) throw new Error('新闻响应过大');
        routePreference.set(source.id, route);
        return { text, route };
      } catch (error) { lastError = error; }
    }
    throw lastError instanceof Error ? lastError : new Error('新闻源连接失败');
  });

  async function collect(): Promise<NewsFeed> {
    // The global board and its Chinese filter must use exactly the same snapshot.
    const trendRequests = new Map<string, ReturnType<Transport>>();
    const loadTrends = (source: NewsSource) => {
      if (!trendRequests.has(source.url)) trendRequests.set(source.url, transport(source));
      return trendRequests.get(source.url)!;
    };
    const results = await Promise.all(sources.map(async (source) => {
      let error: string | undefined;
      let stale = false;
      let cached = sourceCache.get(source.id);
      try {
        const load = async () => {
          if (source.kind === 'rss') {
            const candidates = await loadRss(source as NewsSource & { kind: 'rss' });
            return { candidates, route: candidates[0]?.route || source.route };
          }
          const response = source.custom && options.customTransport ? await options.customTransport(source) : source.kind === 'x-trends' ? await loadTrends(source) : await transport(source);
          if (source.kind === 'aibase') {
            const daily = parseAibaseList(response.text, clock())[0];
            if (!daily) return { candidates: [], route: response.route };
            const detail = await transport({ ...source, url: daily.url });
            return { candidates: parseAibaseDetail(detail.text, daily, clock()), route: detail.route };
          }
          return { candidates: parseAdditionalSource(source, response.text, clock()), route: response.route };
        };
        let deadline: ReturnType<typeof setTimeout> | undefined;
        let loaded: Awaited<ReturnType<typeof load>>;
        try {
          loaded = await Promise.race([load(), new Promise<never>((_, reject) => {
            deadline = setTimeout(() => reject(new Error('新闻源响应超时')), options.sourceTimeoutMs ?? 20_000);
          })]);
        } finally { clearTimeout(deadline); }
        let { candidates } = loaded;
        const { route } = loaded;
        candidates = candidates.filter((item) => cleanNewsText(item.title) && safeNewsUrl(item.url, source.url));
        if (!candidates.length && !['feed', 'aibase', 'reddit'].includes(source.kind) && !(source.kind === 'x-trends' && source.trendFilter === 'chinese')) throw new Error('未获取到有效条目，可能是空源或页面结构变化');
        if (source.todayOnly) candidates = candidates.filter((item) => item.publishedAt && beijingNewsDay(item.publishedAt) === beijingNewsDay(clock()));
        if (source.maxAgeHours) candidates = candidates.filter((item) => {
          const date = validNewsDate(item.publishedAt, clock());
          return date && clock() - Date.parse(date) <= source.maxAgeHours! * 3600_000;
        });
        candidates = candidates.slice(0, source.id === 'wallstreetcn' ? 20 : 30);
        const at = clock();
        cached = { items: candidates.map((item, index) => ({ ...item, sourceOrder: item.sourceOrder ?? index + 1, observedAt: new Date(at).toISOString(), route })), at, route };
        sourceCache.set(source.id, cached);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        stale = Boolean(cached && clock() - cached.at <= 30 * 60_000);
        if (!stale) cached = undefined;
      }
      const items = (cached?.items || [])
        .filter((item) => !source.todayOnly || (item.publishedAt && beijingNewsDay(item.publishedAt) === beijingNewsDay(clock())))
        .filter((item) => source.kind !== 'x-trends' || (item.boardObservedAt && clock() - Date.parse(item.boardObservedAt) <= 4 * 3600_000))
        .filter((item) => !source.maxAgeHours || (validNewsDate(item.publishedAt, clock()) && clock() - Date.parse(item.publishedAt!) <= source.maxAgeHours * 3600_000))
        .map((item) => scoreNews({ ...item, stale }, source, clock()));
      return {
        items,
        status: {
          id: source.id, label: source.label, category: source.category, categoryLabel: NEWS_CATEGORY_LABELS[source.category],
          origin: source.origin, route: cached?.route || source.route, ok: !error, count: items.length,
          stale, error, fetchedAt: cached ? new Date(cached.at).toISOString() : undefined,
          homepage: source.homepage || source.url, rankingKind: source.rankingKind,
          delivery: source.delivery, note: source.note, custom: source.custom, feedUrl: source.kind === 'feed' ? source.url : undefined,
          providerName: source.providerName, todayOnly: source.todayOnly, emptyMessage: source.emptyMessage
        }
      };
    }));
    // A slower source can finish after midnight: enforce the daily window once more at response time.
    for (const result of results) {
      result.items = result.items.filter((item) => !item.todayOnly || (item.publishedAt && beijingNewsDay(item.publishedAt) === beijingNewsDay(clock())));
      result.status.count = result.items.length;
    }
    const items = mergeNewsItems(results.flatMap((result) => result.items));
    return {
      generatedAt: new Date(clock()).toISOString(), proxy: proxyUrl, rankingVersion: NEWS_RANKING_VERSION,
      items, sources: results.map((result) => result.status),
      categories: Object.entries(NEWS_CATEGORY_LABELS).map(([id, label]) => {
        const scoped = items.filter((item) => item.category === id);
        return { id: id as NewsCategory, label, count: scoped.length, topWeight: Math.max(0, ...scoped.map((item) => item.weight)),
          averageWeight: scoped.length ? Math.round(scoped.reduce((sum, item) => sum + item.weight, 0) / scoped.length) : 0 };
      })
    };
  }
  return async (force = false): Promise<NewsFeed> => {
    if (inFlight) return inFlight;
    // Cache shared by the news and market pages; explicit refresh has a 15s minimum interval.
    if (snapshot && beijingNewsDay(snapshotAt) === beijingNewsDay(clock()) && clock() - snapshotAt < (force ? 15_000 : 120_000)) return snapshot;
    inFlight = collect();
    try { snapshot = await inFlight; snapshotAt = clock(); return snapshot; }
    finally { inFlight = null; }
  };
}
