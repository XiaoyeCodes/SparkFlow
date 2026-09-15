import { test, expect } from '@playwright/test';
import { assistantReportContent } from '../../src/lib/ibkr/portfolioRisk';
import { previousRiskReport, riskHighlights, riskScoreChange } from '../../src/lib/ibkr/riskHighlights';
import type { AnalysisReport } from '../../src/lib/ibkr/workbenchTypes';

const summary = '今日整体风险关注度：高（风险指数 74/100）——现金仅 **0.58%**，单名 AXP **16.3%** 与 TSM **12.5%** 集中度偏高，同时叠加 9 月 16 日 FOMC 大概率加息（约85%–91%），10年期美债逼近5%。';
test('extracts changing prose and markdown tables without confusing probabilities and holdings', () => {
  const cards = riskHighlights(assistantReportContent(summary));
  expect(cards.map(card => card.values)).toEqual([['0.58%'], ['AXP 16.3%', 'TSM 12.5%'], ['9月16日'], ['5%']]);
  const table = riskHighlights(assistantReportContent('| 项目 | 数值 |\n| --- | --- |\n| 现金占比 | 2.4% |\n\n| 股票 | 权重 |\n| --- | --- |\n| NVDA | 18.7% |\n| MSFT | 9.2% |'));
  expect(table.map(card => card.values)).toEqual([['2.4%'], ['NVDA 18.7%', 'MSFT 9.2%']]);
  expect(riskHighlights(assistantReportContent('建议现金占比 10%。FOMC 加息概率85%。缺少事件日期。'))).toEqual([]);
  expect(riskHighlights(assistantReportContent('现金占比0%，持仓NVDA占比18%。'))[0].values).toEqual(['0%']);
  expect(riskHighlights(assistantReportContent('没有可量化的数据。'))).toEqual([]);
  expect(riskHighlights(assistantReportContent('9月15日快照，9月16日 FOMC 会议。')).find(card => card.kind === 'event')?.values).toEqual(['9月16日']);
  expect(riskHighlights(assistantReportContent('现金占比0.58%且美债收益率5%。')).find(card => card.kind === 'metric')?.values).toEqual(['5%']);
});

test('compares the immediately preceding same-account formal report, including zero scores', () => {
  const report = (id: string, accountKey: string, generatedAt: string, kind = 'manual') => ({ id, accountKey, generatedAt, kind }) as AnalysisReport;
  const current = report('now', 'live:one', '2026-09-15T10:00:00Z');
  const prior = report('prior', 'live:one', '2026-09-15T09:00:00Z');
  expect(previousRiskReport(current, [report('other', 'paper:one', '2026-09-15T09:59:00Z'), report('chat', 'live:one', '2026-09-15T09:50:00Z', 'chat'), report('old', 'live:one', '2026-09-14T10:00:00Z'), prior, current])).toBe(prior);
  const content = assistantReportContent(summary);
  expect(riskScoreChange(content, assistantReportContent(summary.replace('74', '80')))).toBe(-6);
  expect(riskScoreChange(content, assistantReportContent(summary.replace('74', '70')))).toBe(4);
  expect(riskScoreChange(content, content)).toBe(0);
  expect(riskScoreChange(content, assistantReportContent(summary.replace('高', '低').replace('74', '0')))).toBe(74);
  expect(riskScoreChange(content)).toBeUndefined();
  expect(riskScoreChange(content, assistantReportContent('评分缺失'))).toBeUndefined();
});
