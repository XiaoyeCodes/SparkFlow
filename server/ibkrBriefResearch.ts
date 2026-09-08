import { isIP } from 'node:net';
import type { AccountSnapshot, Evidence, Holding } from '../src/lib/ibkr/workbenchTypes.ts';

export type BriefResearchResult = {
 analysisAsOf: string;
 evidence: Evidence[];
 coverage: { symbol: string; status: 'complete' | 'partial' | 'failed' | 'unsupported'; areas: string[]; gaps: string[] }[];
 gaps: string[];
};
type IO = { tool: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<any>; progress?: (detail: string) => Promise<void> };
type Target = { symbol: string; currency: string; assetType: string; name: string; queryName: string; fund: boolean; weight: number; areas: Set<string>; gaps: Set<string>; supported: boolean };
const issuerNames: Record<string, string> = { UL: 'Unilever', AAPL: 'Apple', AMD: 'Advanced Micro Devices', AMZN: 'Amazon', GOOG: 'Alphabet', GOOGL: 'Alphabet', KO: 'Coca-Cola', LLY: 'Eli Lilly', MCD: 'McDonald', MSFT: 'Microsoft', NVDA: 'NVIDIA', TSLA: 'Tesla', QQQ: 'Invesco QQQ' };
const DAY = 86_400_000;
const LIMITS = { duration: 240_000, callDuration: 40_000, calls: 120, searches: 36, reads: 48, sources: 64, content: 85_000, perSource: 4_800 };
const officialDomains: Record<string, string[]> = {
 AAPL: ['apple.com'], AMD: ['amd.com'], AMZN: ['amazon.com'], GOOG: ['abc.xyz', 'alphabet.com'], GOOGL: ['abc.xyz', 'alphabet.com'], KO: ['coca-colacompany.com'],
 LLY: ['lilly.com'], MCD: ['mcdonalds.com'], MSFT: ['microsoft.com'], NVDA: ['nvidia.com'], TSLA: ['tesla.com'], UL: ['unilever.com'], QQQ: ['invesco.com'], SPY: ['ssga.com'],
};
const domainsMatch = (host: string, domains: string[]) => domains.some(d => host === d || host.endsWith(`.${d}`));
function publicUrl(value: unknown): string {
 try {
  const u = new URL(String(value));
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (u.protocol !== 'https:' || u.username || u.password || !host.includes('.') || isIP(host) || host.startsWith('[') || /(?:^|\.)(?:localhost|local|internal)$/.test(host)) return '';
  // Research providers never need authenticated or signed URLs.
  if ([...u.searchParams.keys()].some(k => /^(?:token|api_?key|access_token|authorization|signature|password)$/i.test(k))) return '';
  u.hash = '';
  return u.href;
 } catch { return ''; }
}
function isPrimary(url: string, symbol = ''): boolean {
 const host = new URL(url).hostname.toLowerCase();
 return domainsMatch(host, ['sec.gov', 'federalreserve.gov', 'bls.gov', 'bea.gov', 'treasury.gov', 'census.gov', 'ecb.europa.eu', 'bankofengland.co.uk', 'boj.or.jp']) || domainsMatch(host, officialDomains[symbol] ?? []);
}
function originalMatches(target: Target | undefined, title: string, content: string, url?: string): boolean {
 const body = `${title}\n${content}`;
 if (!target) return /federal reserve|inflation|interest rate|employment|payroll|consumer price|gross domestic|economic|release schedule|FOMC|通胀|利率|美联储|经济|就业/i.test(body);
 const escaped = target.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
 const ticker = new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, target.symbol.length < 3 ? '' : 'i').test(body);
 const companyName = target.name.replace(/\s+(?:Inc\.?|Corporation|Corp\.?|plc|Company|Ltd\.?).*$/i, '').replace(/^The\s+/i, '').replace(/[,\s]+$/, '');
 const company = companyName.length >= 4 && companyName !== target.symbol && body.toLowerCase().includes(companyName.toLowerCase());
 // UL is Unilever; UL Solutions (ticker ULS) is a different issuer. Two-letter words alone never prove identity.
 if (target.symbol === 'UL' && !/\bunilever\b/i.test(body)) return false;
 if (target.symbol.length < 3 && !company && !(target.symbol === 'UL' && /\bunilever\b/i.test(body))) return false;
 const financial = /stock|share|fund|etf|revenue|earnings|quarter|invest|nasdaq|nyse|financial|dividend|capital|securities|股票|基金|营收|季度|财报|分红/i.test(body);
 const issuerAnnouncement = url && domainsMatch(new URL(url).hostname, officialDomains[target.symbol] ?? []) && /announce|launch|product|service|guidance|results|event|发布|产品|业绩/i.test(body);
 return (ticker || company) && Boolean(financial || issuerAnnouncement);
}
function publicationDate(value: any, content: string): string | null {
 const candidates = [value.publishedAt, value.published_at, value.publishedTime, value.datePublished];
 const marked = content.match(/(?:^|\n)\s*(?:Published(?:\s+(?:Time|on))?|发布时间|发布日期|Date Published)\s*[:：]\s*([^\n]{8,70})/i);
 if (marked) candidates.push(marked[1]);
 for (const candidate of candidates) {
  if (typeof candidate !== 'string' || !/(?:19|20)\d{2}/.test(candidate)) continue;
  const date = Date.parse(candidate.trim());
  if (Number.isFinite(date)) return new Date(date).toISOString();
 }
 return null;
}
function calendarWindow(content: string, asOf: number): boolean {
 const start = new Date(asOf).toISOString().slice(0, 10), end = new Date(asOf + 7 * DAY).toISOString().slice(0, 10);
 const dates = [...content.matchAll(/\b20\d{2}-\d{2}-\d{2}\b|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},?\s+20\d{2}\b/gi)];
 return dates.some(match => {
  const parsed = Date.parse(/^20\d{2}-/.test(match[0]) ? match[0] : `${match[0]} UTC`);
  if (!Number.isFinite(parsed)) return false;
  const day = new Date(parsed).toISOString().slice(0, 10);
  const context = content.slice(Math.max(0, match.index! - 160), match.index! + match[0].length + 260);
  return day >= start && day <= end && /upcoming|scheduled|will (?:host|participate|present|report)|conference|webcast|earnings call|ex.dividend|investor day|annual meeting|即将|发布会|财报电话|除息/i.test(context);
 });
}
function originalExcerpt(content: string, limit: number, area: string, asOf: number): string {
 if (content.length <= limit) return content;
 const markdownStart = content.indexOf('Markdown Content:');
 let start = markdownStart >= 0 ? markdownStart + 'Markdown Content:'.length : 0;
 if (/calendar|日历/.test(area)) {
  const year = new Date(asOf).getUTCFullYear();
  const yearSection = new RegExp(`(?:^|\\n)\\s*${year}\\s+(?:FOMC\\s+)?(?:Meetings|Meeting|Release|Economic|Calendar|Schedule)`, 'i').exec(content.slice(start));
  if (yearSection) start += yearSection.index;
  const month = new Date(asOf).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const date = new Date(asOf).toISOString().slice(0, 7);
  const match = new RegExp(`${month}\\s+(?:\\d{1,2}[, ]+)?${year}|${date}|${month}`, 'i').exec(content.slice(start));
  if (match && (!yearSection || match.index > limit - 400)) start += Math.max(0, match.index - 250);
 } else {
  // Skip long navigation menus while retaining one continuous piece of the actually read page.
  const body = content.slice(start);
  const paragraphs = [...body.matchAll(/[^\n]+(?:\n(?!\n)[^\n]+)*/g)];
  const substantive = paragraphs.find(p => p[0].length >= 180 && (p[0].match(/\]\(/g)?.length ?? 0) < 4 && /revenue|earnings|quarter|announce|inflation|employment|consumer price|federal|interest rate|营收|财报|利率|就业/i.test(p[0]));
  if (substantive) start += Math.max(0, substantive.index! - 200);
 }
 return content.slice(start, start + limit);
}
function fields(value: any, keys: string[]): Record<string, unknown> {
 const output: Record<string, unknown> = {};
 if (!value || typeof value !== 'object' || Array.isArray(value)) return output;
 for (const key of keys) if (value[key] !== undefined && value[key] !== null) output[key] = value[key];
 return output;
}
function numericFields(value: any, keys: string[]): Record<string, number> {
 const output: Record<string, number> = {};
 for (const [key, original] of Object.entries(fields(value, keys))) {
  const number = typeof original === 'object' && original !== null && 'raw' in original ? (original as { raw: unknown }).raw : original;
  if (typeof number === 'number' && Number.isFinite(number)) output[key] = number;
 }
 return output;
}
function profileContent(value: any): string {
 const data = fields(value, ['source', 'url', 'name', 'sector', 'industry', 'instrumentType', 'currency']);
 Object.assign(data, numericFields(value, ['regularMarketTime']));
 data.statistics = numericFields(value.statistics, ['trailingPE', 'forwardPE', 'trailingEps', 'forwardEps', 'priceToBook', 'enterpriseToRevenue', 'enterpriseToEbitda', 'lastFiscalYearEnd', 'mostRecentQuarter', 'earningsQuarterlyGrowth', 'beta', 'yield', 'annualReportExpenseRatio']);
 data.financials = { ...fields(value.financials, ['financialCurrency']), ...numericFields(value.financials, ['currentPrice', 'totalCash', 'totalDebt', 'totalRevenue', 'revenueGrowth', 'earningsGrowth', 'grossMargins', 'operatingMargins', 'profitMargins', 'returnOnEquity', 'freeCashflow', 'operatingCashflow']) };
 return JSON.stringify(data);
}
const safeResearchCode = (error: unknown): string => {
 const code = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
 return /^(?:(?:BRIEF_RESEARCH|TOOL|PUBLIC|SOURCE|AI|RESEARCH)_[A-Z0-9_]{1,80}|HTTP_[45]\d{2})$/.test(code) ? code : 'BRIEF_RESEARCH_SOURCE_FAILED';
};
function cachedProfile(evidence: Evidence, target: Target, asOf: number): any | undefined {
 try {
  const fetched = Date.parse(evidence.fetchedAt);
  const expectedUrl = `https://finance.yahoo.com/quote/${target.symbol}/profile/`;
  if (evidence.kind !== 'profile' || evidence.read !== true || evidence.symbols?.length !== 1 || evidence.symbols[0] !== target.symbol || publicUrl(evidence.url) !== expectedUrl || !Number.isFinite(fetched) || fetched > asOf || new Date(fetched).toISOString().slice(0, 10) !== new Date(asOf).toISOString().slice(0, 10) || !evidence.content || evidence.content.length > LIMITS.perSource) return;
  const value = JSON.parse(evidence.content);
  if (!value || typeof value !== 'object' || Array.isArray(value) || publicUrl(value.url) !== expectedUrl || (value.symbol && value.symbol !== target.symbol) || (value.currency && value.currency !== target.currency)) return;
  const finite = (item: unknown): boolean => typeof item === 'number' ? Number.isFinite(item) : item !== null && typeof item === 'object' ? Object.values(item).every(finite) : true;
  if (!finite(value)) return;
  const selected = JSON.parse(profileContent(value));
  if (!Object.values({ ...selected.statistics, ...selected.financials }).some(number => typeof number === 'number' && Number.isFinite(number))) return;
  return value;
 } catch { return; }
}
function targetFor(holding: Holding): Target {
 const symbol = holding.symbol.trim().toUpperCase();
 const type = (holding.assetType ?? 'STK').toUpperCase();
 const assetType = type === 'EQUITY' ? 'STK' : type;
 const name = typeof holding.name === 'string' && holding.name.trim() && holding.name !== symbol ? holding.name.trim() : issuerNames[symbol] ?? symbol;
 return { symbol, currency: holding.currency, assetType, name, queryName: issuerNames[symbol] ?? symbol, fund: /ETF|MUTUALFUND|FUND/i.test(holding.instrumentType ?? assetType), weight: Math.abs(Number(holding.marketValue) || 0), areas: new Set(), gaps: new Set(), supported: /^[A-Z0-9.\-^]{1,24}$/.test(symbol) && ['STK', 'ETF', 'FUND'].includes(assetType) };
}

/** Bounded public-data collection. Account values only determine local priority; no account record reaches a research tool. */
export async function prepareBriefResearch(snapshot: AccountSnapshot, io: IO, signal: AbortSignal, options: { analysisAsOf?: string; previousAsOf?: string | null; fallbackEvidence?: Evidence[] } = {}): Promise<BriefResearchResult> {
 const asOf = options.analysisAsOf ? Date.parse(options.analysisAsOf) : Date.now();
 if (!Number.isFinite(asOf)) throw new Error('BRIEF_RESEARCH_ASOF_INVALID');
 const analysisAsOf = new Date(asOf).toISOString();
 const start = Date.now();
 const controller = new AbortController();
 let timedOut = false;
 const cancel = () => controller.abort();
 signal.addEventListener('abort', cancel, { once: true });
 if (signal.aborted) cancel();
 const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, LIMITS.duration);
 const evidence: Evidence[] = [];
 const fedStatementLinks = new Set<string>();
 const gaps = new Set<string>();
 const targets = [...new Map(snapshot.positions.map(p => [p.symbol.trim().toUpperCase(), targetFor(p)])).values()].sort((a, b) => b.weight - a.weight);
 let calls = 0, searches = 0, reads = 0, characters = 0;
 const from = new Date(asOf - 7 * DAY).toISOString().slice(0, 10);
 const end = new Date(asOf + DAY).toISOString().slice(0, 10);
 const future = new Date(asOf + 7 * DAY).toISOString().slice(0, 10);
 const today = analysisAsOf.slice(0, 10);
 const check = () => {
  if (signal.aborted) throw new Error('BRIEF_RESEARCH_CANCELLED');
  if (timedOut || Date.now() - start >= LIMITS.duration) { timedOut = true; controller.abort(); throw new Error('BRIEF_RESEARCH_TIMEOUT'); }
 };
 const gap = (target: Target | undefined, detail: string) => { if (target) target.gaps.add(detail); else gaps.add(detail); };
 const tool = async (name: string, args: Record<string, unknown>): Promise<any> => {
  check();
  if (calls >= LIMITS.calls || (name === 'search' && searches >= LIMITS.searches) || (name === 'read' && reads >= LIMITS.reads)) throw new Error('BRIEF_RESEARCH_SOURCE_BUDGET');
  calls++; if (name === 'search') searches++; if (name === 'read') reads++;
  const request = new AbortController();
  const abort = () => request.abort();
  controller.signal.addEventListener('abort', abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
   const value = await Promise.race([
    io.tool(name, args, request.signal),
    new Promise<never>((_, reject) => {
     onAbort = () => reject(new Error(signal.aborted ? 'BRIEF_RESEARCH_CANCELLED' : timedOut ? 'BRIEF_RESEARCH_TIMEOUT' : 'BRIEF_RESEARCH_SOURCE_TIMEOUT'));
     request.signal.addEventListener('abort', onAbort, { once: true });
     timer = setTimeout(() => request.abort(), LIMITS.callDuration);
     if (request.signal.aborted) onAbort();
    }),
   ]);
   check();
   if (!value || value.status === 'error' || value.ok === false || value.error) throw new Error(safeResearchCode(value?.error));
   return value;
  } finally {
   if (timer) clearTimeout(timer);
   if (onAbort) request.signal.removeEventListener('abort', onAbort);
   controller.signal.removeEventListener('abort', abort);
  }
 };
 const add = (target: Target | undefined, kind: Evidence['kind'], url: string, title: string, content: string, publishedAt: string | null, query?: string, cached?: boolean, originalFetchedAt?: string): Evidence | undefined => {
  const validUrl = publicUrl(url);
  if (!validUrl || !content.trim()) return;
  const existing = evidence.find(e => e.url === validUrl && e.kind === kind && e.content === content);
  if (existing) { if (target && !existing.symbols.includes(target.symbol)) existing.symbols.push(target.symbol); return existing; }
  // Never slice structured JSON into an invalid record. Callers select complete raw fields/periods first.
  if (evidence.length >= LIMITS.sources || characters + content.length > LIMITS.content || content.length > LIMITS.perSource) { gap(target, '来源内容预算已用完，部分原文未纳入'); return; }
  const item: Evidence = { id: '', symbols: target ? [target.symbol] : [], kind, url: validUrl, title, content, summary: content.slice(0, 300), source: new URL(validUrl).hostname, publishedAt, fetchedAt: originalFetchedAt ?? new Date().toISOString(), read: true, primary: isPrimary(validUrl, target?.symbol), query, cached };
  evidence.push(item); characters += content.length;
  return item;
 };
 const acceptProfile = (target: Target, value: any, fallback?: Evidence): void => {
  const url = publicUrl(value.url);
  if (!url || !new URL(url).pathname.split('/').some(s => decodeURIComponent(s).toUpperCase() === target.symbol) || (value.symbol && value.symbol !== target.symbol)) throw new Error('BRIEF_RESEARCH_WRONG_SECURITY');
  if (typeof value.name === 'string' && value.name.trim()) { target.name = value.name.replace(/[\r\n]/g, ' ').slice(0, 90); target.queryName = target.name; }
  target.fund = target.fund || /ETF|MUTUALFUND/i.test(value.instrumentType ?? '');
  if (!add(target, 'profile', url, `${target.symbol} 公司/基金资料与估值字段`, fallback?.content ?? profileContent(value), fallback?.publishedAt ?? null, undefined, fallback ? true : undefined, fallback?.fetchedAt)) return;
  target.areas.add('profile');
  if (Object.keys(numericFields(value.statistics, ['forwardPE', 'trailingPE', 'priceToBook', 'enterpriseToRevenue', 'enterpriseToEbitda'])).length) target.areas.add('valuation');
  else target.gaps.add(target.fund ? '未取得基金估值或完整成分资料，不能推算穿透权重' : '未取得可用估值倍数');
  target.gaps.add('结构化估值抓取时间已记录，但价格时点、盈利预期修订时间及历史分位未完整核验');
  if (fallback) target.gaps.add(`本次更新失败，复用同UTC日已读profile（原抓取时间 ${fallback.fetchedAt}）；保留原报价时间，缓存时间不代表价格时点`);
 };
 const read = async (target: Target | undefined, url: string, area: string, kind: Evidence['kind'], query?: string): Promise<boolean> => {
  const value = await tool('read', { url });
  const returnedUrl = value.url ? publicUrl(value.url) : url;
  if (!returnedUrl) throw new Error('BRIEF_RESEARCH_URL_INVALID');
  if (returnedUrl === 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm') {
   for (const link of Array.isArray(value.links) ? value.links : []) {
    const candidate = publicUrl(link?.url);
    if (/^https:\/\/www\.federalreserve\.gov\/newsevents\/pressreleases\/monetary\d{8}a\.htm$/.test(candidate)) fedStatementLinks.add(candidate);
   }
  }
  const content = typeof value.content === 'string' ? value.content : '';
  const title = typeof value.title === 'string' ? value.title : '';
  if (content.length < 150 || /(?:access denied|enable javascript and cookies|captcha verification|verify you are human)/i.test(content.slice(0, 400))) throw new Error('BRIEF_RESEARCH_NO_ORIGINAL');
  if (!originalMatches(target, title, content, returnedUrl)) throw new Error('BRIEF_RESEARCH_WRONG_SECURITY');
  const publishedAt = publicationDate(value, content);
  if (publishedAt && Date.parse(publishedAt) > asOf) throw new Error('BRIEF_RESEARCH_AFTER_CUTOFF');
  // Keep a contiguous extract for verbatim support validation, never the search snippet.
  const limit = kind === 'macro' ? 3_000 : area === 'calendar' ? 1_800 : 2_000;
  const excerpt = originalExcerpt(content, limit, area, asOf);
  if (area === 'calendar' && !calendarWindow(excerpt, asOf)) throw new Error('BRIEF_RESEARCH_NO_UPCOMING_EVENT');
  const item = add(target, kind, returnedUrl, title || `${target?.symbol ?? '宏观'} ${area}`, excerpt, publishedAt, query, value.cached === true);
  if (!item) return false;
  target?.areas.add(area);
  if (!publishedAt) gap(target, `${area} 原文发布时间未确认；抓取时间不能证明属于近7日新增信息`);
  else if (area === 'news' && Date.parse(publishedAt) < asOf - 7 * DAY) gap(target, '事件原文早于近7日窗口，只能作为历史背景');
  if (value.cached === true) gap(target, `${area} 阅读服务返回缓存，最新状态未确认`);
  if (value.sourceSubstitution) gap(target, `${area} 新闻稿未取得，使用BLS官方原始序列；水平值不是涨幅，发布日期和市场预期仍未知`);
  if (area === 'calendar' && content.length > limit) gap(target, '日历保留当前时间附近的原文节选，不能将未出现的事件解释为未来7日无事件');
  return true;
 };
 const searchRead = async (target: Target | undefined, query: string, area: string, kind: Evidence['kind']): Promise<void> => {
  try {
   const result = await tool('search', { query });
   const candidates = (Array.isArray(result.results) ? result.results : []).map((r: any) => ({ url: publicUrl(r.url ?? r.href) })).filter((r: any) => r.url)
    .sort((a: { url: string }, b: { url: string }) => Number(isPrimary(b.url, target?.symbol)) - Number(isPrimary(a.url, target?.symbol)));
   for (const candidate of candidates.slice(0, 2)) {
    try { if (await read(target, candidate.url, area, kind, query)) return; }
    catch { check(); }
   }
   gap(target, `${area} 未取得可核验且相关的原文；不能据此断言没有事件`);
  } catch (error) {
   check();
   gap(target, `${area} ${String((error as Error).message).includes('BUDGET') ? '达到来源预算' : '检索暂不可用'}，覆盖不足`);
  }
 };
 const limited = async <T>(items: T[], work: (item: T) => Promise<void>) => {
  let next = 0;
  const results = await Promise.allSettled(Array.from({ length: Math.min(3, items.length) }, async () => {
   while (next < items.length) { check(); await work(items[next++]); }
  }));
  const failure = results.find(r => r.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
 };
 const progress = async (message: string) => { check(); await io.progress?.(message); };
 try {
  check();
  if (options.previousAsOf && !Number.isFinite(Date.parse(options.previousAsOf))) gaps.add('上一期截止时间无效，不能精确判断相较上期的新增事件');
  await progress(`读取全部 ${targets.length} 只持仓的公司/基金资料，再优先准备宏观和重点财报`);
  await limited(targets, async target => {
   if (!target.supported) { target.gaps.add('证券类型或代码暂不支持可靠匹配；未套用普通股票估值'); return; }
   if (target.currency === 'USD') {
    try {
     const value = await tool('profile', { symbol: target.symbol });
     acceptProfile(target, value);
    } catch (error) {
     check(); target.gaps.add(`公司/基金结构化资料更新失败（${safeResearchCode(error)}）`);
     for (const fallback of [...(options.fallbackEvidence ?? [])].sort((a, b) => String(b?.fetchedAt ?? '').localeCompare(String(a?.fetchedAt ?? '')))) {
      const value = cachedProfile(fallback, target, asOf);
      if (value) { acceptProfile(target, value, fallback); break; }
     }
    }
   } else target.gaps.add('非美元证券尚无可靠的结构化行情映射，使用公开原文并保留估值缺口');
  });
  await progress('读取官方通胀、就业、央行政策与经济数据发布日历');
  await limited([
   { url: 'https://www.bls.gov/news.release/empsit.nr0.htm', area: '就业与增长' },
   { url: 'https://www.bls.gov/news.release/cpi.nr0.htm', area: '通胀' },
   { url: `https://api.bls.gov/publicAPI/v2/timeseries/data/LNS14000000?startyear=${new Date(asOf).getUTCFullYear()-1}&endyear=${new Date(asOf).getUTCFullYear()}`, area: '失业率' },
   { url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', area: '央行政策日历' },
   { url: 'https://www.bea.gov/news/schedule', area: '经济数据日历' },
  ], async source => {
   try { await read(undefined, source.url, source.area, 'macro'); }
   catch { check(); gaps.add(`宏观 ${source.area} 官方原文读取失败`); }
  });
  gaps.add('BLS新闻/日历网页受访问限制；就业与通胀使用官方API原始序列，下一次发布日期仍需其他实际读取来源确认');
  // Select from links actually read on the official calendar. A generic search may rank an obsolete statement first.
  const latestStatement = [...fedStatementLinks].map(url => ({ url, day: url.match(/monetary(\d{8})a\.htm$/)![1].replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') }))
   .filter(item => item.day <= today).sort((a, b) => b.day.localeCompare(a.day))[0];
  if (latestStatement) {
   try { await read(undefined, latestStatement.url, '日历所列最新已发布央行声明', 'macro'); }
   catch { check(); gaps.add('官方日历所列最新已发布FOMC声明读取失败；不能用更早声明代表当前政策'); }
  } else gaps.add('官方日历未读取到截止时间前的FOMC声明链接，当前政策声明未覆盖');
  await progress('补充重点持仓财报及带日期的价格资料');
  const focus = targets.filter(t => t.supported && t.currency === 'USD').slice(0, 5);
  await limited(focus, async target => {
   for (const action of target.fund ? ['prices'] : ['financials', 'prices']) {
    try {
     const value = await tool(action, { symbol: target.symbol });
     const url = publicUrl(value.url);
     if (!url) throw new Error('BRIEF_RESEARCH_URL_INVALID');
     let content: string;
     if (action === 'financials') {
      const entry = value.data?.[`${target.symbol}.US`];
      const periods = Array.isArray(entry?.periods) ? entry.periods.filter((p: any) => typeof p.REPORT_DATE === 'string' && p.REPORT_DATE.slice(0, 10) <= today && (!p.FILED || String(p.FILED).slice(0, 10) <= today)) : [];
      if (!periods.length) throw new Error('BRIEF_RESEARCH_NO_STATEMENTS');
      const selected: unknown[] = [];
      for (const period of periods.slice(0, 6)) {
       const candidate = JSON.stringify({ ...fields(value, ['url', 'source', 'statement', 'period']), data: { [`${target.symbol}.US`]: { ...fields(entry, ['currency', 'source', 'statement', 'period']), periods: [...selected, period] } } });
       if (candidate.length > LIMITS.perSource) break;
       selected.push(period);
      }
      if (!selected.length) throw new Error('BRIEF_RESEARCH_RECORD_TOO_LARGE');
      content = JSON.stringify({ ...fields(value, ['url', 'source', 'statement', 'period']), data: { [`${target.symbol}.US`]: { ...fields(entry, ['currency', 'source', 'statement', 'period']), periods: selected } } });
     } else {
      if (!new URL(url).pathname.split('/').some(s => decodeURIComponent(s).toUpperCase() === target.symbol)) throw new Error('BRIEF_RESEARCH_WRONG_SECURITY');
      const rows = Array.isArray(value.rows) ? value.rows.filter((r: any) => typeof r.trade_date === 'number' ? r.trade_date * 1000 <= asOf : typeof r.date === 'string' && r.date.slice(0, 10) <= today).slice(-5) : [];
      if (!rows.length) throw new Error('BRIEF_RESEARCH_NO_PRICES');
      content = JSON.stringify({ ...fields(value, ['source', 'url', 'currency']), rows });
     }
     if (add(target, action === 'financials' ? 'filing' : 'market', url, `${target.symbol} ${action === 'financials' ? '已披露财报完整期间记录' : '历史价格与日期'}`, content, null)) target.areas.add(action === 'financials' ? 'financials' : 'market');
    } catch { check(); target.gaps.add(`${action} 重点资料暂不可用`); }
   }
  });
  await progress(`扫描全部 ${targets.length} 只持仓的近7日事件与未来7日日历`);
  await limited(targets.filter(target => target.supported), async target => {
   // Only provider-returned public company names and ticker metadata are used in public queries.
   const identity = `${target.symbol} ${target.queryName === target.symbol ? '' : target.queryName}`.trim();
   await searchRead(target, `${identity} ${target.fund ? 'ETF fund issuer announcement distribution' : 'company news announcement earnings guidance'} after:${from} before:${end}`, 'news', 'news');
   await searchRead(target, `${identity} ${target.fund ? 'ETF issuer distribution ex dividend calendar' : 'investor relations upcoming events earnings dividend calendar'} ${today} through ${future}`, 'calendar', 'news');
  });
  for (const target of targets.filter(t => t.supported && !t.fund && !focus.includes(t))) target.gaps.add('本轮仅扫描资料、事件与日历，未逐份展开原始财报');
 } catch (error) {
  if (signal.aborted || (error as Error).message === 'BRIEF_RESEARCH_CANCELLED') throw new Error('BRIEF_RESEARCH_CANCELLED');
  if (!timedOut && (error as Error).message !== 'BRIEF_RESEARCH_TIMEOUT') throw error;
  gaps.add('资料准备达到4分钟上限，返回已取得证据；未完成的领域不得声称已覆盖');
 } finally {
  clearTimeout(deadline);
  signal.removeEventListener('abort', cancel);
  controller.abort();
 }
 if (!evidence.some(e => e.kind === 'macro')) gaps.add('未取得可用宏观原文，不能推断当前经济周期或政策变化');
 gaps.add('估值历史分位、完整分析师一致预期及修订记录未取得；不得以抓取日替代估值基准日');
 gaps.add('财报结构化工具当前仅提供损益表；资产负债表、现金流原表与管理层指引需以实际读取的公告补充');
 if (evidence.some(e => e.kind === 'filing')) gaps.add('结构化财报保留报告期与来源记录，披露日期未完整提供；报告期不能作为发布日期');
 if (targets.some(t => t.currency !== 'USD')) gaps.add('本轮宏观重点为美国；其他市场政策与汇率证据未完整覆盖');
 const coverage: BriefResearchResult['coverage'] = targets.map(target => {
  if (target.supported) for (const area of ['profile', 'news', 'calendar']) if (!target.areas.has(area)) target.gaps.add(`${area} 未完成有效原文覆盖`);
  return { symbol: target.symbol, status: !target.supported ? 'unsupported' : !target.areas.size ? 'failed' : target.gaps.size ? 'partial' : 'complete', areas: [...target.areas], gaps: [...target.gaps] };
 });
 // Stable short IDs are assigned after asynchronous collection, not during completion races.
 evidence.sort((a, b) => a.symbols.join(',').localeCompare(b.symbols.join(',')) || a.kind.localeCompare(b.kind) || a.url.localeCompare(b.url));
 evidence.forEach((item, i) => { item.id = `E${i + 1}`; });
 return { analysisAsOf, evidence, coverage, gaps: [...gaps] };
}
