import type { AnalysisContent } from '../../lib/ibkr/workbenchTypes';
import { portfolioRiskAssessment } from '../../lib/ibkr/portfolioRisk';
import { ResearchRichText } from './ResearchRichText';
import { CalendarDays, ChevronRight, Droplets, ScanLine, Target } from 'lucide-react';
import { riskHighlights, riskScoreChange } from '../../lib/ibkr/riskHighlights';
import './PortfolioRiskGauge.css';

const point = (score: number, radius: number) => {
  const angle = Math.PI * (1 - score / 100);
  return [180 + radius * Math.cos(angle), 162 - radius * Math.sin(angle)];
};
const arc = (from: number, to: number, radius = 126) => {
  const [x1, y1] = point(from, radius), [x2, y2] = point(to, radius);
  return `M${x1} ${y1} A${radius} ${radius} 0 0 1 ${x2} ${y2}`;
};

export function PortfolioRiskGauge({ content, previousContent, onFocus }: { content: AnalysisContent; previousContent?: AnalysisContent; onFocus?: (source: string) => void }) {
  const risk = portfolioRiskAssessment(content.rawContent || content.riskSummary || '');
  const highlights = riskHighlights(content);
  const change = riskScoreChange(content, previousContent);
  const score = risk?.score;
  const marker = score === undefined ? undefined : point(score, 126);
  return <div className="awb-portfolio-risk">
    <div className="awb-portfolio-risk-chart">
      <span className="awb-portfolio-risk-eyebrow">PORTFOLIO RISK / 持仓风险指数</span>
      <svg viewBox="0 0 360 210" role="img" aria-label={risk ? `持仓风险指数 ${score}/100，${risk.level}关注度` : '持仓风险指数暂缺'}>
        <path d={arc(0, 100, 103)} fill="none" stroke="currentColor" opacity=".12" strokeDasharray="2 5"/>
        {[['#68d8b8', 0, 32], ['#d7b974', 34, 66], ['#d98181', 68, 100]].map(([color, from, to]) => <path key={String(from)} d={arc(Number(from), Number(to))} fill="none" stroke={String(color)} strokeWidth="7" opacity=".62"/>)}
        {Array.from({ length: 21 }, (_, i) => { const a = point(i * 5, 137), b = point(i * 5, i % 5 ? 141 : 146); return <path key={i} d={`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`} stroke="currentColor" opacity=".35"/>; })}
        {[0, 25, 50, 75, 100].map(value => { const [x, y] = point(value, 157); return <text key={value} x={x} y={y + 4} textAnchor="middle" className="awb-risk-tick">{value}</text>; })}
        {marker && <><circle cx={marker[0]} cy={marker[1]} r="11" fill="#e9fff7" opacity=".13"/><circle cx={marker[0]} cy={marker[1]} r="5" fill="#e9fff7"/></>}
        <text x="180" y="136" textAnchor="middle" className="awb-risk-number">{score ?? '—'}</text>
        <text x="180" y="159" textAnchor="middle" className="awb-risk-caption">{risk ? `/ 100 · ${risk.level}关注度` : '评分暂缺'}</text>
        <text x="180" y="197" textAnchor="middle" className={`awb-risk-caption awb-risk-change ${change !== undefined && change > 0 ? 'is-up' : change !== undefined && change < 0 ? 'is-down' : ''}`}>{change === undefined ? '较上次风险 · 暂无可比评分' : `较上次风险 ${change > 0 ? '+' : change < 0 ? '−' : '±'}${Math.abs(change)} 分`}</text>
      </svg>
    </div>
    {highlights.length > 0 && <div className="awb-risk-highlights" aria-label="报告关注点">
      {highlights.map(item => {
        const Icon = { cash: Droplets, concentration: Target, event: CalendarDays, metric: ScanLine }[item.kind];
        return <button type="button" className="awb-risk-highlight" key={item.id} onClick={() => onFocus?.(item.source)} disabled={!onFocus} title={`${item.source}\n点击定位完整分析`}>
          <Icon size={16} className="awb-risk-highlight-icon" aria-hidden="true"/>
          <span className="awb-risk-highlight-copy"><b>{item.title}</b><small>{item.detail}</small></span>
          <span className="awb-risk-highlight-values">{item.values.map(value => <strong key={value}>{value}</strong>)}</span>
          {onFocus && <ChevronRight size={12} className="awb-risk-highlight-arrow" aria-hidden="true"/>}
        </button>;
      })}
    </div>}
    <div className={`awb-portfolio-risk-conclusion ${risk?.level === '高' ? 'is-high' : ''}`} tabIndex={0} aria-label="风险分析摘要"><span className="awb-risk-summary-label">综合判断</span><ResearchRichText restrained text={risk?.summary || content.riskSummary || content.brief || '今日整体风险关注度：暂无法评估。报告未提供有效评分，请查看完整报告中的依据与数据局限。'}/></div>
  </div>;
}
