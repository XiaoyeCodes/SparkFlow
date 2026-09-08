import { z } from 'zod';
import { getMarketHalfDay, getMarketHolidayName } from '../src/data/marketCalendars.ts';
import { newYorkClock, numeric, accountRisk } from './ibkrWorkbenchCore.ts';
import type { AccountSnapshot, Preferences, DailyBriefContent, DailyBrief, Evidence, PortfolioPerformance } from '../src/lib/ibkr/workbenchTypes.ts';
import type { BriefResearchResult } from './ibkrBriefResearch.ts';
import { BRIEF_RESEARCH_INSTRUCTIONS } from './ibkrBriefPrompt.ts';
import { externalBriefFacts } from './ibkrBriefFacts.ts';

export const BRIEF_PROMPT_VERSION = 'portfolio-daily-brief-v4';
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
export function briefInput(snapshot: AccountSnapshot, preferences: Preferences, sessionDate: string | null, research?: BriefResearchResult, previous?: DailyBrief, performance?: PortfolioPerformance) {
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
  const lastPerformance = performance?.returnMethod === 'TWR' && performance.source === 'IBKR PortfolioAnalyst' ? performance.points.at(-1)?.cumulativeReturn : null;
  add('twr', '已取得区间 TWR', ratio(typeof lastPerformance === 'number' && Number.isFinite(lastPerformance) ? lastPerformance : null), performance?.returnMethod === 'TWR' && performance.source === 'IBKR PortfolioAnalyst' ? 'IBKR PortfolioAnalyst 时间加权收益' : '未取得可核验的 IBKR TWR');
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

以下是本系统的传输与来源规则。
只分析系统自动提供的 holdings、facts 和 research.evidence；coverage/gaps 说明哪些资料未取得。不得声称进行了额外搜索。持仓快照由系统自动读取，用户无需粘贴。输出只包含账户风险速览、最多三项风险／机会和直接相关来源；calendar 必须为 []。

仅返回一个完整 JSON 对象，不使用 Markdown 围栏，不输出分析过程，不增加字段。headline 不超过二十四字；summary 是开头一句，最多七十字。insights 为二至三条（账户数据不足时宁可少写，不得凑数），每条 title 必须以“【风险点】”形式命名；fact、impact、watch、invalidation 和 confidenceReason 各不超过四十字。changes 最多一条，gaps 最多两条。全部面向用户的字段合计不得超过 200 个汉字（固定免责声明不在 JSON 内）。

summary 必须引用 facts 中存在的账户事实占位符，例如 {{twr}}、{{topFive}}、{{cashWeight}} 或 {{holding0Weight}}；系统会替换。不要直接书写账户金额、权重或自行设定风险阈值。未实现盈亏不等于当日收益。若 {{twr}} 显示“未提供”，直接说明 TWR 未提供，不得从净值变动推算。账户快照风险可以不引用外部来源，但每条这类提醒必须在自身文字中引用实际的持仓／现金／集中度／盈亏／TWR 事实占位符。

为降低误报，正文优先使用无数字的定性表述。不要翻译、换算、推导或补写任何外部数字、日期、百分比、价格目标或预测；若确有必要，只能逐字使用同一条 support 原文中已经存在的数字。headline、summary、changes 和 gaps 不写外部裸数字。

外部事件 insight 必须有非空 evidenceIds 和 support。support 必须是对应 evidence.content 内逐字连续的原文，不能改写、拼接、翻译或使用省略号；每个引用来源都要有一段 support。仅基于账户快照的风险提醒可以令 evidenceIds 和 support 均为空，但不得虚构新闻或事件。symbols 只能是实际 holdings；仅当提醒明确针对整个组合、不能诚实归属给单一证券时，symbols 可以为空。status 相对 previous 判断，首期为 new，不虚构上期变化。

结构如下（类型说明不是要逐字输出的内容）：
{"headline":"今日组合变化","summary":"简短账户含义，含 {{nav}} 或其他账户事实","insights":[{"id":"稳定事件名","title":"提醒标题","kind":"opportunity 或 risk 或 mixed 或 watch","priority":"high 或 medium 或 low","status":"new 或 ongoing 或 upgraded 或 eased","symbols":["实际持仓代码"],"fact":"已核实事实","impact":"对组合的影响","watch":"待观察条件","invalidation":"判断减弱的条件","horizon":"未来数日或数周","confidence":"high 或 medium 或 low","confidenceReason":"置信度依据","evidenceIds":["E1"],"support":[{"evidenceId":"E1","quote":"对应 content 内连续原文"}]}],"calendar":[],"changes":["相较上期的组合变化；首期说明建立基线"],"gaps":["限制本期判断的关键缺口"]}
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
  if (!references) result.gaps = [...result.gaps, 'AI 文本未引用账户事实；账户数字以 IBKR 快照为准。'].slice(-3);
  return result;
}

const prose = z.string().min(1).max(900);
const sourceIds = z.array(z.string().regex(/^E\d+$/)).max(8);
const insightSchema = z.object({
  id: z.string().min(1).max(100), title: z.string().min(1).max(100),
  kind: z.enum(['opportunity', 'risk', 'mixed', 'watch']), priority: z.enum(['high', 'medium', 'low']), status: z.enum(['new', 'ongoing', 'upgraded', 'eased']),
  symbols: z.array(z.string()).max(100), fact: prose, impact: prose, watch: prose, invalidation: prose, horizon: prose,
  confidence: z.enum(['high', 'medium', 'low']), confidenceReason: prose, evidenceIds: sourceIds,
  support: z.array(z.object({ evidenceId: z.string(), quote: z.string().min(12).max(600) }).strict()).max(8),
}).strict();
const calendarSchema = z.object({ title: prose, at: z.string().datetime({ offset: true }).nullable(), dateStatus: z.enum(['confirmed', 'estimated', 'unknown']), symbols: z.array(z.string()).max(100), watch: prose, implication: prose, evidenceIds: sourceIds.min(1), support: z.array(z.object({ evidenceId: z.string(), quote: z.string().min(12).max(600) }).strict()).max(2).default([]) }).strict();
const intelligenceSchema = z.object({ headline: z.string().min(1).max(80), summary: z.string().min(1).max(500), insights: z.array(insightSchema).max(3), calendar: z.array(calendarSchema).length(0), changes: z.array(prose).max(3), gaps: z.array(prose).max(3) }).strict();
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
  let factReferences = 0, redactedNumerals = false;
  const checkSymbols = (values: string[]) => { if (new Set(values).size !== values.length || values.some(s => !symbols.has(s))) throw new Error('BRIEF_UNKNOWN_SYMBOL'); };
  const checkSources = (values: string[]) => { if (new Set(values).size !== values.length || values.some(id => !sources.has(id))) throw new Error('BRIEF_UNKNOWN_SOURCE'); };
  const resolve = (value: string, supported = '', allowedSources: string[] = []) => {
    // Resolve the unambiguous literal holding count to its known account fact; do not repair arbitrary numbers.
    const count = input.facts.count?.display;
    const canonical = count && /^\d+$/.test(count) ? value.replace(new RegExp(`\b${count}\s*(只|个)\s*(持仓|标的|证券)`, 'g'), '{{count}}$1$2') : value;
    const withFactsRemoved = canonical.replace(/\{\{([A-Za-z0-9]+)\}\}/g, (_, id: string) => {
      const fact = input.facts[id];
      if (!fact) throw new Error('BRIEF_UNKNOWN_FACT');
      if (fact.evidenceId && !allowedSources.includes(fact.evidenceId)) throw new Error('BRIEF_FACT_SOURCE_REQUIRED');
      if (!fact.evidenceId) ++factReferences;
      return '';
    }).replace(/(?:未来|近)\s*7\s*(?:日|天)/g, '研究窗口');
    const stripped = input.holdings.reduce((text, holding) => text.split(holding.symbol).join(''), withFactsRemoved);
    const sourceNumbers = allowedSources.flatMap(id => sourceText(sources.get(id)!).flatMap(numbers));
    const permitted = new Set([...numbers(supported), ...sourceNumbers]);
    const redact = (text: string) => text.split(/(\{\{[A-Za-z0-9]+\}\})/g).map(part => {
      if (/^\{\{[A-Za-z0-9]+\}\}$/.test(part)) return part;
      return part.replace(/\d[\d,]*(?:\.\d+)?/g, token => {
        if (permitted.has(token.replace(/,/g, ''))) return token;
        redactedNumerals = true;
        return '未核验数值';
      });
    }).join('');
    const safe = redact(stripped);
    if (/\{\{|\}\}|[０-９]/.test(safe)) throw new Error('BRIEF_UNSOURCED_NUMBER');
    return redact(canonical).replace(/\{\{([A-Za-z0-9]+)\}\}/g, (_, id: string) => input.facts[id].display);
  };
  const accountRiskFact = /\{\{(?:cashWeight|topFive|twr|holding\d+(?:Weight|Pnl|Value))\}\}/;
  const insightText = (item: z.infer<typeof insightSchema>) => [item.title, item.fact, item.impact, item.watch, item.invalidation, item.horizon, item.confidenceReason].join(' ');
  let droppedUnverifiedInsights = false, unlinkedAccountInsights = false;
  const insights = data.insights.flatMap(item => {
    try {
      checkSymbols(item.symbols); checkSources(item.evidenceIds);
      const hasExternalEvidence = item.evidenceIds.length > 0 || item.support.length > 0;
      if (!hasExternalEvidence && !accountRiskFact.test(insightText(item))) unlinkedAccountInsights = true;
      if (hasExternalEvidence && (!item.evidenceIds.length || !item.support.length)) throw new Error('BRIEF_SUPPORT_REQUIRED');
      for (const citation of item.support) {
        const e = sources.get(citation.evidenceId);
        if (!e || !item.evidenceIds.includes(e.id) || !sourceText(e).some(part => part.includes(normalize(citation.quote))) || item.symbols.length && e.symbols.length && !e.symbols.some(s => item.symbols.includes(s))) throw new Error('BRIEF_UNSUPPORTED_QUOTE');
      }
      if (item.evidenceIds.some(id => !item.support.some(s => s.evidenceId === id))) throw new Error('BRIEF_SUPPORT_REQUIRED');
      const supported = item.support.map(s => s.quote).join(' ');
      return [{ ...item, title: resolve(item.title, supported, item.evidenceIds), fact: resolve(item.fact, supported, item.evidenceIds), impact: resolve(item.impact, supported, item.evidenceIds), watch: resolve(item.watch, supported, item.evidenceIds), invalidation: resolve(item.invalidation, supported, item.evidenceIds), horizon: resolve(item.horizon, supported, item.evidenceIds), confidenceReason: resolve(item.confidenceReason, supported, item.evidenceIds) }];
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (/^BRIEF_(?:UNKNOWN_SYMBOL|UNKNOWN_SOURCE|UNSUPPORTED_QUOTE|SUPPORT_REQUIRED|FACT_SOURCE_REQUIRED|UNSOURCED_NUMBER|ACCOUNT_FACT_REQUIRED)$/.test(code)) { droppedUnverifiedInsights = true; return []; }
      throw error;
    }
  });
  if (new Set(insights.map(i => i.id)).size !== insights.length) throw new Error('BRIEF_DUPLICATE_EVENT');
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
  const addGap = (note: string) => { if (!gaps.includes(note)) { if (gaps.length >= 3) gaps[gaps.length - 1] = note; else gaps.push(note); } };
  if (!factReferences) addGap('AI 文本未引用账户事实；账户数字以 IBKR 快照为准。');
  if (redactedNumerals) addGap('模型输出中未能与来源核对的数值已隐藏，请查看原文来源。');
  if (droppedUnverifiedInsights) addGap('缺少可核验来源或持仓归属的模型提醒未展示。');
  if (unlinkedAccountInsights) addGap('本期风险文字未逐项引用账户事实；请以展开的 IBKR 快照核对。');
  if (calendarDowngraded) gaps.splice(2, gaps.length, '部分事件时点未能与原文日期和时区对应，已撤下确认时间，需查阅来源核实。');
  const visibleLength = [headline, summary, ...insights.flatMap(i => [i.title, i.fact, i.impact, i.watch]), ...changes, ...gaps].join('').replace(/\s/g, '').length;
  if (visibleLength > 200) addGap('本期简报超过 200 字目标，已按模型原文展示。');
  return { headline, summary, insights, calendar, changes, gaps, risk: insights.filter(i => i.kind === 'risk' || i.kind === 'mixed').map(i => i.impact).join('\n') || '本期没有形成有充分证据的新风险判断，请结合研究覆盖范围阅读。', watch: insights.map(i => i.watch).slice(0, 3) };
}
