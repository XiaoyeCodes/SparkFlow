import { holdingIndustryDetails, instrumentTypeLabel } from './industryLabels';
import type { WorkbenchState } from './workbenchTypes';

export const portfolioAnalysisStarterPrompt = '分析一下我的当前持仓情况';
const portfolioPromptLead = `${portfolioAnalysisStarterPrompt}。\n\n下面是我的 IBKR 只读账户当前快照。`;

export function displayAssistantPrompt(content: string) {
  return content.startsWith(portfolioPromptLead) ? portfolioAnalysisStarterPrompt : content;
}

const displayNumber = (value: unknown, maximumFractionDigits = 8) => {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '未提供';
  return Number(value).toLocaleString('en-US', { maximumFractionDigits });
};

const displayTime = (value?: string | null) => {
  const time = value ? new Date(value) : null;
  return time && Number.isFinite(time.getTime()) ? time.toLocaleString('zh-CN', { hour12: false }) : '未提供';
};

const quoteStatusLabels: Record<string, string> = {
  delayed: '延迟行情', stale: '缓存已过期', missing: '行情缺失', unmapped: '标的待匹配', unsupported: '品种未覆盖',
};

export function buildPortfolioAnalysisPrompt(state: WorkbenchState) {
  const { snapshot } = state;
  if (!snapshot.snapshotId || !['ready', 'empty'].includes(snapshot.state)) {
    throw new Error('IBKR 持仓尚未同步，请先到账户工作台刷新账户。');
  }
  if (!snapshot.positions.length) throw new Error('当前 IBKR 账户没有可分析的持仓。');

  const quoteByContract = new Map(state.quotes.map(quote => [quote.conId, quote]));
  const currency = snapshot.baseCurrency || '未提供';
  const cash = snapshot.cash.length
    ? snapshot.cash.map(item => `${item.currency} ${displayNumber(item.amount, 2)}`).join('；')
    : '未提供';
  const holdings = snapshot.positions.map((holding, index) => {
    const quote = quoteByContract.get(holding.conId);
    const quoteText = quote?.price == null
      ? '参考价未取得'
      : `参考价 ${displayNumber(quote.price, 4)} ${quote.currency}（${quoteStatusLabels[quote.status] || quote.status}，${quote.source}，${displayTime(quote.asOf)}）`;
    return `${index + 1}. ${holding.symbol}｜${holding.name || holding.symbol}｜${instrumentTypeLabel(holding.instrumentType || holding.assetType)}｜${holdingIndustryDetails(holding)}｜数量 ${displayNumber(holding.quantity)}｜平均成本 ${displayNumber(holding.averageCost, 4)} ${holding.currency}｜市值 ${displayNumber(holding.marketValue, 2)} ${holding.currency}｜未实现盈亏 ${displayNumber(holding.unrealizedPnl, 2)} ${holding.currency}｜${quoteText}`;
  }).join('\n');

  return `${portfolioPromptLead}请以这些数据为组合分析基准，并结合最新、可靠的公开资料进行深度研究。账户标识已省略。

【快照概况】
- 快照时间：${displayTime(snapshot.asOf)}
- 基准币种：${currency}
- 账户净值：${displayNumber(snapshot.metrics.netLiquidation, 2)} ${currency}
- 未实现盈亏：${displayNumber(snapshot.metrics.unrealizedPnl, 2)} ${currency}
- 购买力：${displayNumber(snapshot.metrics.buyingPower, 2)} ${currency}
- 维持保证金：${displayNumber(snapshot.metrics.maintenanceMargin, 2)} ${currency}
- 现金余额：${cash}
- 持仓数量：${snapshot.positions.length}
- 规则风险等级：${state.metrics?.riskLevel || '未计算'}
- 已触发规则：${state.metrics?.reasons.join('；') || '无'}

【完整持仓】
${holdings}

【分析要求】
1. 先概括组合结构、仓位集中度、行业暴露、现金与保证金安全垫。
2. 逐项分析全部持仓的基本面、估值、近期催化剂、主要风险及其对组合的影响。
3. 区分已核实事实、合理推断与无法确认的信息；数据过期或缺失时明确说明，不得编造。
4. 给出短期、中期和长期三种视角，并提供基准、乐观、悲观情景。
5. 给出按优先级排序的观察与调整建议，说明触发条件、失效条件和风险控制；不要替我下单。
6. 引用关键公开来源，并标注资料日期。`;
}
