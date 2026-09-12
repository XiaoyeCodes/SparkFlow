import type { AnalysisReport } from './workbenchTypes';
import { industryLabel } from './industryLabels';

export function holdingChanges(previous: AnalysisReport, current: AnalysisReport) {
  const before = new Map(previous.snapshot.positions.map(position => [position.conId, position]));
  const after = new Map(current.snapshot.positions.map(position => [position.conId, position]));
  return [...new Set([...before.keys(), ...after.keys()])].flatMap(conId => {
    const earlier = before.get(conId), latest = after.get(conId);
    return earlier?.quantity === latest?.quantity ? [] : [{ conId, symbol: latest?.symbol ?? earlier!.symbol, before: earlier?.quantity ?? '0', after: latest?.quantity ?? '0' }];
  });
}

const valuationVerdict = {
  overvalued: '存在估值过高风险',
  opportunity: '存在价值投资机会',
  fair: '估值相对合理',
  insufficient: '资料不足，暂不判断',
};

const frameworkLabel = {
  buffett: '巴菲特式价值投资框架',
  peterLynch: '彼得·林奇式成长股框架',
  rayDalio: '雷·达利欧式宏观对冲框架',
};

const tableCell = (value: string) => value.replace(/\|/g, '｜').replace(/\s*\n\s*/g, ' ');

export function reportMarkdown(report: AnalysisReport) {
  const content = report.content;
  const refs = (ids?: string[]) => ids?.map(id => {
    const evidence = report.evidence.find(item => item.id === id);
    return evidence ? `[${evidence.title.replace(/[\[\]]/g, '')}](${evidence.url})` : '';
  }).filter(Boolean).join(' · ') ?? '';
  const opportunityRiskRows = Array.from({ length: Math.max(1, content.opportunities.length, content.risks.length) }, (_, index) => `| ${tableCell(content.opportunities[index] ?? '—')} | ${tableCell(content.risks[index] ?? '—')} |`);
  const frameworkEntries = content.frameworks ? Object.entries(content.frameworks) as [keyof typeof frameworkLabel, typeof content.frameworks.buffett][] : [];

  return [
    '# SparkFlow · 投资组合分析报告',
    `${report.version === 2 ? '主动研究 V2' : '旧版分析（兼容视图）'} · ${report.generatedAt} · ${report.provider} / ${report.model}`,
    `账户快照 ${report.snapshotId} · SHA256 ${report.snapshotHash}`,
    `# ${content.headline ?? '今日整体风险关注度：待判断'}`,
    refs(content.evidenceIds),
    '## 1. 账户概览',
    content.accountSummary,
    content.benchmarkComparison ? `基准比较：${content.benchmarkComparison}` : '',
    `组合风险：${content.portfolioRisk}`,
    ...(report.metrics ? [`规则等级 ${report.metrics.riskLevel}`, ...report.metrics.reasons, ...report.metrics.sectors.map(sector => `${industryLabel(sector.name)} ${(sector.weight * 100).toFixed(1)}%`)] : []),
    ...(content.valuationReview?.length ? ['## 2. 重点持仓估值判断', ...content.valuationReview.flatMap(item => [`### ${item.symbol} · ${valuationVerdict[item.verdict]}`, item.rationale, refs(item.evidenceIds)])] : []),
    '## 3. 机会与风险',
    '| 【机会】 | 【风险】 |',
    '| --- | --- |',
    ...opportunityRiskRows,
    '## 4. 过去一周宏观经济、政策与地缘风险',
    content.marketContext,
    ...(content.calendar?.length ? ['## 5. 未来 7–14 天关注日历', ...content.calendar.flatMap(item => [`### ${item.date} · ${item.event}`, `影响与关注点：${item.impact}`, `相关持仓：${item.symbols.join('、') || '账户整体'}`, refs(item.evidenceIds)])] : ['## 5. 未来 7–14 天关注日历', '当前资料中没有可核实具体日期的未来事件。']),
    ...(frameworkEntries.length ? ['## 6. 三套持仓分析框架', '> 以下内容是依据公开投资原则生成的框架化评论，并非巴菲特、彼得·林奇或雷·达利欧本人的发言或实时观点。', ...frameworkEntries.flatMap(([key, value]) => [`### ${frameworkLabel[key]}`, value.analysis, `**框架评论** ${value.commentary}`, refs(value.evidenceIds)])] : []),
    '## 7. 今天最需要关注的 3 件事',
    ...(content.briefPoints ?? [content.brief]).map((point, index) => `${index + 1}. ${point}`),
    ...(content.fullSummary ? ['## 8. 全文总结', content.fullSummary] : []),
    '## 重点持仓与组合传导',
    ...content.holdings.flatMap(holding => [`### ${holding.symbol}`, holding.background, holding.fact ? `**事实** ${holding.fact}` : '', holding.impact ? `**影响机制** ${holding.impact}` : '', `**短期** ${holding.shortTerm}`, `**长期** ${holding.longTerm}`, holding.counterEvidence ? `**反对证据** ${holding.counterEvidence}` : '', holding.invalidation ? `**失效条件** ${holding.invalidation}` : '', ...(holding.support ?? []).map(support => `> ${support.quote}\n\n${refs([support.evidenceId])}`), refs(holding.evidenceIds)]),
    ...(content.scenarios?.length ? ['## 条件情景分析', ...content.scenarios.flatMap(scenario => [`### ${{ base: '基准情景', upside: '乐观情景', downside: '悲观情景' }[scenario.name]}`, `条件：${scenario.assumptions}`, `账户影响：${scenario.accountImpact}`, `应对：${scenario.response}`])] : []),
    '## 行动清单',
    ...content.actions.flatMap(action => [`### ${action.symbol} · ${action.priority ? `${{ high: '高', medium: '中', low: '低' }[action.priority]}优先级 · ` : ''}${action.horizon === 'short' ? '短期' : '长期'} · ${{ hold: '维持', watch: '观察', increase: '增持', reduce: '减持' }[action.action]}`, action.rationale, action.executionWindow ? `执行窗口：${action.executionWindow}` : '', `触发条件：${action.trigger}`, action.riskControl ? `风险控制：${action.riskControl}` : '', action.expectedImpact ? `预期组合影响：${action.expectedImpact}` : '', `反对证据：${action.counterEvidence}`, `失效条件：${action.invalidation}`, `建议目标权重：${action.targetWeight === null ? '待偏好与证据充分后确定' : `${(action.targetWeight * 100).toFixed(1)}%`}`, refs(action.evidenceIds)]),
    ...(content.targetAllocation ? ['## 目标配置框架', content.targetAllocation] : []),
    ...(content.monitoring?.length ? ['## 监控与预警', ...content.monitoring.map(item => `- **${item.indicator}** · 预警线：${item.warningLine} · 应对：${item.action}`)] : []),
    '## 证据、数据缺口与局限',
    ...content.gaps.map(gap => `- 数据缺口 · ${gap}`),
    ...(content.limitations ?? []).map(limitation => `- 局限 · ${limitation}`),
    ...(content.disclaimer ? ['## 免责声明', content.disclaimer] : []),
    '## 来源记录',
    ...report.evidence.map(evidence => `- [${evidence.title.replace(/[\[\]]/g, '')}](${evidence.url}) · ${evidence.source} · 发布 ${evidence.publishedAt ?? '未核实'} · 获取 ${evidence.fetchedAt} · ${evidence.read ? '已阅读原文／原始数据' : '摘要线索'} · 相关持仓 ${evidence.symbols.join('、') || '宏观背景'}`),
    ...(report.research ? ['## 研究过程', `覆盖 ${report.research.covered.length}/${report.research.total} · 来源 ${report.research.sources} · 搜索 ${report.research.searches} · 阅读 ${report.research.reads} · 模型调用 ${report.research.modelCalls}`, ...report.research.trace.map(item => `- ${item.at} · ${item.tool} · ${item.ok ? '成功' : '未取得'} · ${item.target}`)] : []),
    '本报告为只读研究，所有调整需结合最新账户与行情核对。组合计划统一校验现金，不计手续费、税费与滑点。',
  ].filter(Boolean).join('\n\n');
}
