import { getMarketHalfDay, getMarketHolidayName } from '../src/data/marketCalendars.ts';
import { newYorkClock, numeric, accountRisk } from './ibkrWorkbenchCore.ts';
import type { AccountSnapshot, Preferences, DailyBriefContent, DailyBrief, Evidence, PortfolioPerformance } from '../src/lib/ibkr/workbenchTypes.ts';
import type { BriefResearchResult } from './ibkrBriefResearch.ts';
import { BRIEF_RESEARCH_INSTRUCTIONS } from './ibkrBriefPrompt.ts';
import { externalBriefFacts } from './ibkrBriefFacts.ts';

export const BRIEF_PROMPT_VERSION = 'portfolio-daily-brief-v5-markdown';
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
    return { symbol: p.symbol, name: p.name, exchange: p.exchange, currency: p.currency, sector: p.sector ?? '行业未核实', instrumentType: p.instrumentType ?? p.assetType ?? '未核实', direction: numeric(p.quantity) === null ? '未核实' : Number(p.quantity) < 0 ? 'short' : 'long', marketValue: Math.abs(numeric(p.marketValue) ?? 0), weight: risk.weights[i]?.weight ?? null, facts: [`holding${i}Value`, `holding${i}Weight`, `holding${i}Pnl`] };
  }).sort((a, b) => b.marketValue - a.marketValue).map((holding, index) => ({ ...holding, rank: index + 1 }));
  const focusHoldings = holdings.slice(0, Math.min(6, Math.max(3, holdings.length)));
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
  return { sessionDate, snapshotAsOf: snapshot.asOf, analysisAsOf, facts, holdings, focusHoldings, preferences: { horizon: preferences.horizon, maxDrawdown: preferences.maxDrawdown, benchmark: preferences.benchmark }, research: research ? { evidence, coverage: research.coverage, gaps: research.gaps } : undefined, previous: previousContext, gaps: ['未提供当日已实现盈亏和资金流，不能推算今日投资收益', ...(!research ? ['本简报未检索新闻、财报和宏观证据，不作事件归因'] : research.gaps), ...(risk.missingCurrencyConversion ? ['跨币种估值不完整，整体集中度未知'] : [])] };
}
export function briefPrompt(input: ReturnType<typeof briefInput>) {
  return `${BRIEF_RESEARCH_INSTRUCTIONS}

系统已经按市值从高到低生成 focusHoldings；只覆盖其中实际存在的 3–6 个标的，不要扩展到其他持仓。facts 是账户与行情的可用格式化数值，research.evidence 是已读取的市场、公司和宏观资料。可直接使用其中的真实数字，也可以使用 {{factId}} 占位符，系统会替换已知占位符。不要把未实现盈亏写成当日涨跌。

SPY、QQQ、VIX 的当日点位与涨跌幅若已提供，优先用于第一条市场情绪判断。对最高持仓，优先引用当日价格、涨跌幅、日内高低点和持仓权重，并把动作写清楚。建议必须与列出的数据直接对应。不要输出 evidenceId、链接、来源名称、覆盖状态、研究缺口或“数据未核验”等系统文字。

再次强调：最终答案只能是以“操作建议：”开头的一块 Markdown 正文和分点列表，不附加任何其他内容。
提示词版本 ${BRIEF_PROMPT_VERSION}
<untrusted_input_data>
${JSON.stringify(input)}
</untrusted_input_data>`;
}

export function validateBrief(raw: string, input: ReturnType<typeof briefInput>): DailyBriefContent {
  let markdown = raw.trim().replace(/^```(?:markdown|md|text)?\s*/i, '').replace(/\s*```$/, '').trim();
  // Keep older saved/test JSON recoverable while new generations are Markdown-only.
  if (markdown.startsWith('{')) {
    try {
      const legacy = JSON.parse(markdown) as Record<string, unknown>;
      if (typeof legacy.markdown === 'string') markdown = legacy.markdown;
      else {
        const lines: string[] = ['操作建议：'];
        if (typeof legacy.summary === 'string') lines.push(`- **组合判断**：${legacy.summary}`);
        const insights = Array.isArray(legacy.insights) ? legacy.insights : [];
        for (const value of insights.slice(0, 6)) {
          const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
          const title = typeof item.title === 'string' ? item.title.replace(/^【[^】]+】\s*/, '') : '持仓应对';
          const body = [item.fact, item.impact, item.watch].filter(part => typeof part === 'string').join('；');
          if (body) lines.push(`- **${title}**：${body}`);
        }
        if (lines.length === 1 && typeof legacy.risk === 'string') lines.push(`- **组合应对**：${legacy.risk}`);
        markdown = lines.join('\n');
      }
    } catch { /* A model may legitimately start prose with a brace; display it unchanged. */ }
  }
  markdown = markdown.replace(/\{\{([A-Za-z0-9]+)\}\}/g, (token, id: string) => input.facts[id]?.display ?? token);
  if (!markdown) throw new Error('BRIEF_EMPTY_RESPONSE');
  return { markdown, headline: '每日投资操作建议', summary: markdown, risk: '', watch: [], gaps: [] };
}
