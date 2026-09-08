import { z } from 'zod';
import { getMarketHalfDay, getMarketHolidayName } from '../src/data/marketCalendars.ts';
import { newYorkClock, numeric, accountRisk } from './ibkrWorkbenchCore.ts';
import type { AccountSnapshot, Preferences, DailyBriefContent, DailyBrief, Evidence } from '../src/lib/ibkr/workbenchTypes.ts';
import type { BriefResearchResult } from './ibkrBriefResearch.ts';
import { BRIEF_RESEARCH_INSTRUCTIONS } from './ibkrBriefPrompt.ts';
import { externalBriefFacts } from './ibkrBriefFacts.ts';

export const BRIEF_PROMPT_VERSION = 'portfolio-intelligence-brief-v2';
// NYSE official calendar, verified 2026-09-07: https://www.nyse.com/trade/hours-calendars
const holidays: Record<string, string[]> = {
  '2027': ['01-01','01-18','02-15','03-26','05-31','06-18','07-05','09-06','11-25','12-24'],
  '2028': ['01-17','02-21','04-14','05-29','06-19','07-04','09-04','11-23','12-25'],
};
const early = new Set(['2027-11-26', '2028-07-03', '2028-11-24']);
const supported = (date: string) => ['2026', '2027', '2028'].includes(date.slice(0, 4));
function sessionDue(date: string) {
  const noon = new Date(`${date}T12:00:00Z`);
  if (!supported(date) || [0, 6].includes(noon.getUTCDay()) || getMarketHolidayName('us', date) || holidays[date.slice(0, 4)]?.includes(date.slice(5))) return null;
  const close = getMarketHalfDay('us', date)?.closeMinute ?? (early.has(date) ? 780 : 960);
  return new Date(noon.getTime() + (close + 30 - newYorkClock(noon).minutes) * 60000);
}
export function briefSchedule(now: Date) {
  const date = newYorkClock(now).date;
  let dueSession: string | null = null, dueAt: string | null = null, nextRunAt: string | null = null;
  const calendarSupported = supported(date);
  if (calendarSupported) for (let offset = -14; offset <= 14; offset++) {
    const day = new Date(`${date}T12:00:00Z`); day.setUTCDate(day.getUTCDate() + offset);
    const key = day.toISOString().slice(0, 10), due = sessionDue(key);
    if (!due) continue;
    if (due <= now) { dueSession = key; dueAt = due.toISOString(); }
    else if (!nextRunAt) nextRunAt = due.toISOString();
  }
  return { dueSession, dueAt, nextRunAt, calendarSupported };
}

export type BriefFact = { label: string; display: string; source: string; asOf: string | null; evidenceId?: string; rawValue?: number };
export function briefInput(snapshot: AccountSnapshot, preferences: Preferences, sessionDate: string | null, research?: BriefResearchResult, previous?: DailyBrief) {
  const facts: Record<string, BriefFact> = {};
  const risk = accountRisk(snapshot), currency = snapshot.baseCurrency ?? '币种未提供';
  const money = (v: unknown, c = currency) => numeric(v) === null ? '未提供' : `${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;
  const ratio = (v: number | null) => v === null ? '未提供' : `${(v * 100).toFixed(1)}%`;
  const add = (id: string, label: string, display: string, source = 'IBKR 账户快照') => { facts[id] = { label, display, source, asOf: snapshot.asOf }; };
  add('nav', '账户净资产', money(risk.nav));
  add('cash', '本币现金', money(risk.cash));
  add('unrealized', '当前未实现盈亏（非当日收益）', money(snapshot.metrics.unrealizedPnl));
  add('margin', '维持保证金', money(risk.margin));
  add('cashWeight', '本币现金占净资产', ratio(risk.nav && risk.nav > 0 && risk.cash !== null ? risk.cash / risk.nav : null), '程序计算：本币现金 / 净资产');
  add('count', '实际持仓数量', String(snapshot.positions.length), '程序统计');
  const top = [...risk.weights].sort((a, b) => (b.weight ?? -1) - (a.weight ?? -1));
  add('topFive', '前五大持仓占净资产', ratio(!risk.missingCurrencyConversion && risk.nav && risk.nav > 0 ? top.slice(0, 5).reduce((sum, r) => sum + (r.weight ?? 0), 0) : null), '程序计算：前五大绝对市值 / 净资产');
  const holdings = snapshot.positions.map((p, i) => {
    add(`holding${i}Value`, `${p.symbol} 券商市值`, money(p.marketValue, p.currency));
    add(`holding${i}Weight`, `${p.symbol} 占净资产`, ratio(risk.weights[i].weight), '程序计算；未换汇持仓不计算');
    add(`holding${i}Pnl`, `${p.symbol} 未实现盈亏（非当日收益）`, money(p.unrealizedPnl, p.currency));
    return { symbol: p.symbol, name: p.name, exchange: p.exchange, currency: p.currency, sector: p.sector ?? '行业未核实', instrumentType: p.instrumentType ?? p.assetType ?? '未核实', direction: numeric(p.quantity) === null ? '未核实' : Number(p.quantity) < 0 ? 'short' : 'long', facts: [`holding${i}Value`, `holding${i}Weight`, `holding${i}Pnl`] };
  });
  add('cashFloor', '用户设定现金底线', ratio(preferences.cashFloor), '用户设置；未提供表示没有个人风险额度');
  add('targetWeight', '用户设定单标的上限', ratio(preferences.targetWeight), '用户设置；未提供表示没有个人风险额度');
  const analysisAsOf = research?.analysisAsOf ?? new Date().toISOString();
  // Only the exact material sent to the model is eligible for citation validation.
  let remaining = 100000;
  const evidence: Evidence[] = (research?.evidence ?? []).filter(e => e.read && (!e.publishedAt || Date.parse(e.publishedAt) <= Date.parse(analysisAsOf))).flatMap(e => {
    const content = (e.content ?? '').slice(0, Math.min(6500, remaining)); remaining -= content.length;
    return content.length ? [{ ...e, content, summary: e.summary.slice(0, 500) }] : [];
  });
  Object.assign(facts, externalBriefFacts(evidence));
  const previousContext = previous ? { analysisAsOf: previous.analysisAsOf ?? previous.generatedAt, headline: previous.content.headline, summary: previous.content.summary, insights: previous.content.insights?.map(({ support, evidenceIds, ...item }) => item), changes: previous.content.changes } : null;
  return { sessionDate, snapshotAsOf: snapshot.asOf, analysisAsOf, facts, holdings, preferences: { horizon: preferences.horizon, maxDrawdown: preferences.maxDrawdown, benchmark: preferences.benchmark }, research: research ? { evidence, coverage: research.coverage, gaps: research.gaps } : undefined, previous: previousContext, gaps: ['未提供当日已实现盈亏和资金流，不能推算今日投资收益', ...(!research ? ['本简报未检索新闻、财报和宏观证据，不作事件归因'] : research.gaps), ...(risk.missingCurrencyConversion ? ['跨币种估值不完整，整体集中度未知'] : [])] };
}
export function briefPrompt(input: ReturnType<typeof briefInput>) {
  return `${BRIEF_RESEARCH_INSTRUCTIONS}

以下是本系统的输出传输规则，替代上文的排版要求，研究要求全部保留。
资料已经由系统检索。你没有额外检索工具，只能分析 research.evidence 实际提供的 content；coverage/gaps 明确哪些资料未取得，不得声称自行完成额外搜索。
summary 首句直接写外部变化对持仓的含义，最多引用一个有帮助的组合暴露数字，禁止重新列净资产、现金率和前五大权重。研究覆盖不足时说本次未能判断新增事件，不能说未发生新事件。用户未提供原有投资逻辑时，不能虚构“与此前持仓逻辑一致”。置信度针对整条判断，不能仅因用了官方来源就判为high。
比较增长必须有明确且可比的两个报告期，同一报告中的FISCAL_YEAR可能是申报年份，不能代替REPORT_DATE。FISCAL_PERIOD=FY是全年，不能与单季直接比较。没有同行样本和可比经营模式，不用跨行业PE差异判断谁更便宜。预期时点未核实的forwardPE只记数据缺口，不作当前估值结论。
仅返回一个完整 JSON 对象，不使用 Markdown 围栏，不输出分析过程，不增加字段。insights 最多五条（建议三条真正重要的），没有证据可以为空。每条的 fact/impact/watch/invalidation 各控制在一百字内，summary 约两百字，总正文不超过一千五百字。
账户数字只使用 facts 中存在的 {{事实编号}}，例如 {{nav}}、{{holding0Weight}}、{{count}}，系统会替换。全文至少引用一个账户事实。facts 内以external开头的是程序核对并格式化的外部数值与报告期，优先引用它们以得到易读的亿/万美元；必须在该条insight的evidenceIds中包含对应fact.evidenceId。财报日期也优先用名字以Period结尾的事实，避免从短摘录补写日期。不要直接书写账户金额、权重或自行设定风险阈值。未实现盈亏不等于当日收益。
外部数字只在 insights 的正文中引用，必须原样保留已经出现在该条 support 原文摘录中的数字，不要换算单位、自行计算、添加价格目标或预测百分比。其余 headline/summary/calendar/changes/gaps 使用定性文字或账户事实占位符，不写外部裸数字；calendar.at 是单独的 ISO 时间字段例外。
每条 insights 必须使用非空 evidenceIds 和 support。support 从对应 evidence.content 逐字摘录一段连续文字，不能改写、拼接、翻译或用省略号代替原文，不要摘录来源标题充当证据。每个已引用来源至少附一个短摘录，每条最多八段，每段十二至四百字；同一来源全部摘录合计不超过二十五个英文单词。没有外部证据的账户事实只放 summary 或 gaps，不单独制造机会风险卡片。没有真正外部证据时 insights 为空。
summary 只概括后面的有依据提醒。所有 symbols 只能来自实际 holdings；宏观提醒也要指定真正受影响持仓。保持 id 简短稳定，status 对照 previous 判断；首期均为 new，不虚构与上期的变化。
calendar.at 仅在来源能确认发布时间和时区时填写带时区的ISO时间，且在 analysisAsOf 后七日内；必须附 support 连续摘录原文中的该事件、日期与时点，不得只引用全年日历页。只有日期而没有时点时填 null，在 title 中不用数字地说明预计本周或待确认，不猜北京时间。dateStatus 只能 confirmed/estimated/unknown；缺乏可靠事件时 calendar 为空。
数据中日期未知的新闻只可作为待核实背景，不能写成今日事件。过期估值、未更新预期以及无法核对的数据不能承担当前买卖倾向。不要从中文媒体标题推断英文公告原文。
结构如下（类型说明不是要逐字输出的内容）：
{"headline":"组合判断","summary":"变化与账户含义，引用已有账户事实","insights":[{"id":"稳定事件名","title":"提醒标题","kind":"opportunity 或 risk 或 mixed 或 watch","priority":"high 或 medium 或 low","status":"new 或 ongoing 或 upgraded 或 eased","symbols":["实际持仓代码"],"fact":"有来源的事实","impact":"持仓权重及影响机制","watch":"具体指标和条件建议","invalidation":"反证或失效条件","horizon":"影响期限","confidence":"high 或 medium 或 low","confidenceReason":"置信度依据","evidenceIds":["E1"],"support":[{"evidenceId":"E1","quote":"对应content内连续原文"}]}],"calendar":[{"title":"事件名称","at":null,"dateStatus":"unknown","symbols":["实际持仓代码"],"watch":"观察指标","implication":"不同结果的含义","evidenceIds":["E1"],"support":[]}],"changes":["相较上期的实质变化；首期说明建立基线"],"gaps":["最多三个关键缺口及其限制"]}
提示词版本 ${BRIEF_PROMPT_VERSION}
<untrusted_input_data>
${JSON.stringify(input)}
</untrusted_input_data>`;
}
const schema = z.object({ headline: z.string().min(1).max(80), summary: z.string().min(1).max(500), risk: z.string().min(1).max(500), watch: z.array(z.string().min(1).max(180)).min(1).max(3), gaps: z.array(z.string().min(1).max(180)).max(3) }).strict();
export function validateBrief(raw: string, input: ReturnType<typeof briefInput>): DailyBriefContent {
  if (input.research) return validateIntelligenceBrief(raw, input);
  const content = schema.parse(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')));
  let references = 0;
  const resolve = (text: string) => {
    const bare = text.replace(/\{\{([A-Za-z0-9]+)\}\}/g, (_, id: string) => {
      if (!input.facts[id]) throw new Error('BRIEF_UNKNOWN_FACT');
      references++; return '';
    });
    const withoutSymbols = input.holdings.reduce((s, h) => s.split(h.symbol).join(''), bare);
    if (/[0-9０-９]|\{\{|\}\}/.test(withoutSymbols)) throw new Error('BRIEF_UNSOURCED_NUMBER');
    return text.replace(/\{\{([A-Za-z0-9]+)\}\}/g, (_, id: string) => input.facts[id].display);
  };
  const result = { headline: resolve(content.headline), summary: resolve(content.summary), risk: resolve(content.risk), watch: content.watch.map(resolve), gaps: content.gaps.map(resolve) };
  if (!references) throw new Error('BRIEF_FACT_REFERENCE_REQUIRED');
  return result;
}

const prose = z.string().min(1).max(900);
const sourceIds = z.array(z.string().regex(/^E\d+$/)).max(8);
const insightSchema = z.object({
  id: z.string().min(1).max(100), title: z.string().min(1).max(100),
  kind: z.enum(['opportunity', 'risk', 'mixed', 'watch']), priority: z.enum(['high', 'medium', 'low']), status: z.enum(['new', 'ongoing', 'upgraded', 'eased']),
  symbols: z.array(z.string()).min(1).max(100), fact: prose, impact: prose, watch: prose, invalidation: prose, horizon: prose,
  confidence: z.enum(['high', 'medium', 'low']), confidenceReason: prose, evidenceIds: sourceIds,
  support: z.array(z.object({ evidenceId: z.string(), quote: z.string().min(12).max(600) }).strict()).max(8),
}).strict();
const calendarSchema = z.object({ title: prose, at: z.string().datetime({ offset: true }).nullable(), dateStatus: z.enum(['confirmed', 'estimated', 'unknown']), symbols: z.array(z.string()).max(100), watch: prose, implication: prose, evidenceIds: sourceIds.min(1), support: z.array(z.object({ evidenceId: z.string(), quote: z.string().min(12).max(600) }).strict()).max(2).default([]) }).strict();
const intelligenceSchema = z.object({ headline: z.string().min(1).max(100), summary: z.string().min(1).max(1200), insights: z.array(insightSchema).max(5), calendar: z.array(calendarSchema).max(5), changes: z.array(prose).max(6), gaps: z.array(prose).max(3) }).strict();
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
const numbers = (value: string) => value.replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, '').match(/\d+(?:\.\d+)?/g) ?? [];
function sourceText(e: Evidence) {
  const parts = [e.content ?? ''];
  const visit = (value: unknown) => { if (typeof value === 'string') parts.push(value); else if (value && typeof value === 'object') Object.values(value).forEach(visit); };
  try { visit(JSON.parse(e.content ?? '')); } catch { /* Plain original text. */ }
  return parts.map(normalize);
}
function calendarTimeSupported(at: string, support: { evidenceId: string; quote: string }[], sources: Map<string, Evidence>) {
  // Conservative conversion of common official-calendar formats. Ambiguous text is displayed without a confirmed time.
  const zones: [string, RegExp][] = [['America/New_York', /\b(?:Eastern(?: Standard| Daylight)? Time|EST|EDT|ET)\b/i], ['UTC', /\b(?:UTC|GMT)\b/i], ['Asia/Shanghai', /北京时间|China Standard Time/i]];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return support.some(s => {
    if (s.quote.includes(at)) return true;
    for (const [timeZone, zonePattern] of zones) {
      if (!zonePattern.test(`${s.quote} ${sources.get(s.evidenceId)?.content ?? ''}`)) continue;
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at)).map(p => [p.type, p.value]));
      const y = parts.year, m = Number(parts.month), d = Number(parts.day), h = Number(parts.hour), minute = parts.minute;
      const date = new RegExp(`(?:${y}-0?${m}-0?${d}\\b|0?${m}/0?${d}/${y}\\b|(?:${months[m - 1]}|${months[m - 1].slice(0, 3)}\\.?)\\s+0?${d}(?:st|nd|rd|th)?[,]?\\s+${y}\\b)`, 'i');
      const hour12 = h % 12 || 12, suffix = h >= 12 ? 'p' : 'a';
      const time = new RegExp(`\\b(?:0?${h}:${minute}(?!\\s*[ap]\\.?m)|0?${hour12}:${minute}\\s*${suffix}\\.?m\\.?)`, 'i');
      if (date.test(s.quote) && time.test(s.quote)) return true;
    }
    return false;
  });
}
function validateIntelligenceBrief(raw: string, input: ReturnType<typeof briefInput>): DailyBriefContent {
  const data = intelligenceSchema.parse(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')));
  const sources = new Map(input.research!.evidence.map(e => [e.id, e]));
  const symbols = new Set(input.holdings.map(h => h.symbol));
  let factReferences = 0;
  const checkSymbols = (values: string[]) => { if (new Set(values).size !== values.length || values.some(s => !symbols.has(s))) throw new Error('BRIEF_UNKNOWN_SYMBOL'); };
  const checkSources = (values: string[]) => { if (new Set(values).size !== values.length || values.some(id => !sources.has(id))) throw new Error('BRIEF_UNKNOWN_SOURCE'); };
  const resolve = (value: string, supported = '', allowedSources: string[] = []) => {
    // Resolve the unambiguous literal holding count to its known account fact; do not repair arbitrary numbers.
    const count = input.facts.count?.display;
    const canonical = count && /^\d+$/.test(count) ? value.replace(new RegExp(`\\b${count}\\s*(只|个)\\s*(持仓|标的|证券)`, 'g'), '{{count}}$1$2') : value;
    const bare = canonical.replace(/\{\{([A-Za-z0-9]+)\}\}/g, (_, id: string) => {
      const fact = input.facts[id];
      if (!fact) throw new Error('BRIEF_UNKNOWN_FACT');
      if (fact.evidenceId && !allowedSources.includes(fact.evidenceId)) throw new Error('BRIEF_FACT_SOURCE_REQUIRED');
      if (!fact.evidenceId) ++factReferences;
      return '';
    }).replace(/(?:未来|近)\s*7\s*(?:日|天)/g, '研究窗口');
    let stripped = input.holdings.reduce((s, h) => s.split(h.symbol).join(''), bare);
    // BLS's M08 and Chinese 8月 are the same month. Only normalize a cited
    // BLS month token; the numeral in an unrelated 8% claim remains rejected.
    const hasBls = allowedSources.some(id => {
      const e = sources.get(id);
      return e?.kind === 'macro' && new URL(e.url).hostname === 'api.bls.gov';
    });
    if (hasBls) stripped = stripped.replace(/(?<!\d)([1-9]|1[0-2])月/g, (text, month) => supported.includes(`"M${String(month).padStart(2, '0')}"`) ? `${String(month).padStart(2, '0')}月` : text);
    const permitted = new Set(numbers(supported));
    if (/\{\{|\}\}|[０-９]/.test(stripped) || numbers(stripped).some(n => !permitted.has(n))) throw new Error('BRIEF_UNSOURCED_NUMBER');
    return canonical.replace(/\{\{([A-Za-z0-9]+)\}\}/g, (_, id: string) => input.facts[id].display);
  };
  if (new Set(data.insights.map(i => i.id)).size !== data.insights.length) throw new Error('BRIEF_DUPLICATE_EVENT');
  const insights = data.insights.map(item => {
    checkSymbols(item.symbols); checkSources(item.evidenceIds);
    if (!item.evidenceIds.length || !item.support.length) throw new Error('BRIEF_SUPPORT_REQUIRED');
    for (const citation of item.support) {
      const e = sources.get(citation.evidenceId);
      if (!e || !item.evidenceIds.includes(e.id) || !sourceText(e).some(part => part.includes(normalize(citation.quote))) || e.symbols.length && !e.symbols.some(s => item.symbols.includes(s))) throw new Error('BRIEF_UNSUPPORTED_QUOTE');
    }
    if (item.evidenceIds.some(id => !item.support.some(s => s.evidenceId === id))) throw new Error('BRIEF_SUPPORT_REQUIRED');
    const supported = item.support.map(s => s.quote).join(' ');
    return { ...item, title: resolve(item.title, supported, item.evidenceIds), fact: resolve(item.fact, supported, item.evidenceIds), impact: resolve(item.impact, supported, item.evidenceIds), watch: resolve(item.watch, supported, item.evidenceIds), invalidation: resolve(item.invalidation, supported, item.evidenceIds), horizon: resolve(item.horizon, supported, item.evidenceIds), confidenceReason: resolve(item.confidenceReason, supported, item.evidenceIds) };
  });
  let calendarDowngraded = false;
  const calendar = data.calendar.map(item => {
    checkSymbols(item.symbols); checkSources(item.evidenceIds);
    if (item.at && (Date.parse(item.at) <= Date.parse(input.analysisAsOf) || Date.parse(item.at) > Date.parse(input.analysisAsOf) + 7 * 86400000)) throw new Error('BRIEF_CALENDAR_OUTSIDE_WINDOW');
    if (item.dateStatus === 'confirmed' && !item.at) throw new Error('BRIEF_CALENDAR_TIME_REQUIRED');
    if (item.at && !item.support.length) throw new Error('BRIEF_CALENDAR_SUPPORT_REQUIRED');
    for (const citation of item.support) {
      const source = sources.get(citation.evidenceId);
      if (!source || !item.evidenceIds.includes(citation.evidenceId) || !sourceText(source).some(part => part.includes(normalize(citation.quote)))) throw new Error('BRIEF_UNSUPPORTED_QUOTE');
    }
    const verifiedTime = !item.at || calendarTimeSupported(item.at, item.support, sources);
    if (!verifiedTime) calendarDowngraded = true;
    return { ...item, at: verifiedTime ? item.at : null, dateStatus: verifiedTime ? item.dateStatus : 'unknown' as const, title: resolve(item.title), watch: resolve(item.watch), implication: resolve(item.implication) };
  });
  const headline = resolve(data.headline), summary = resolve(data.summary), changes = data.changes.map(s => resolve(s)), gaps = data.gaps.map(s => resolve(s));
  if (!factReferences) throw new Error('BRIEF_FACT_REFERENCE_REQUIRED');
  if (calendarDowngraded) gaps.splice(2, gaps.length, '部分事件时点未能与原文日期和时区对应，已撤下确认时间，需查阅来源核实。');
  return { headline, summary, insights, calendar, changes, gaps, risk: insights.filter(i => i.kind === 'risk' || i.kind === 'mixed').map(i => i.impact).join('\n') || '本期没有形成有充分证据的新风险判断，请结合研究覆盖范围阅读。', watch: insights.map(i => i.watch).slice(0, 3) };
}
