import type { AnalysisContent } from './workbenchTypes.ts';

export type PortfolioRiskAssessment = { score: number; level: '低' | '中' | '高'; summary: string };

/** Only the final, explicitly labelled conclusion is eligible; never infer a score. */
export function portfolioRiskAssessment(markdown: string): PortfolioRiskAssessment | undefined {
  const last = markdown.trim().split(/\n\s*\n/).pop()?.replace(/[*_`]/g, '').replace(/^\s*[>#]+\s*/gm, '').trim() ?? '';
  const match = /^今日整体风险关注度\s*[：:]\s*(低|中|高)\s*[（(]\s*风险指数\s*(\d{1,3})\s*\/\s*100\s*[）)]\s*[—–-]+\s*(\S[\s\S]*)$/.exec(last);
  if (!match) return undefined;
  const score = Number(match[2]);
  if (score > 100 || match[1] !== (score <= 32 ? '低' : score <= 66 ? '中' : '高')) return undefined;
  return { score, level: match[1] as PortfolioRiskAssessment['level'], summary: last };
}

export function assistantReportContent(markdown: string): AnalysisContent {
  const risk = portfolioRiskAssessment(markdown);
  return {
    reportFormat: 'markdown', rawContent: markdown, riskSummary: risk?.summary,
    headline: markdown.match(/^#\s+(.+)$/m)?.[1] ?? '当前持仓研究',
    brief: risk?.summary ?? '完整报告已保存；结尾未提供有效的风险评分。',
    accountSummary: '', portfolioRisk: risk?.summary ?? '', marketContext: '',
    holdings: [], opportunities: [], risks: [], actions: [], gaps: risk ? [] : ['报告结尾缺少有效风险评分，未自动估算。'],
  };
}
