import type { ReactNode } from 'react';
import type { AnalysisReport } from '../../lib/ibkr/workbenchTypes';
import { editorialResearchContent, researchDigest, sortedResearchCalendar } from '../../lib/ibkr/researchPresentation';
import { ResearchRichText } from './ResearchRichText';
import { ResearchOutputExtras } from './ResearchOutputExtras';
import { EvidenceLinks, time } from './WorkbenchPanels';

const frameworkLabel: Record<string, string> = { buffett: '巴菲特式价值投资框架', peterLynch: '彼得·林奇式成长股框架', rayDalio: '雷·达利欧式宏观对冲框架' };
const verdict = { overvalued: '估值偏高风险', opportunity: '价值机会', fair: '相对合理', insufficient: '资料不足' };
function Subsection({ title, text, children }: { title: string; text?: string; children?: ReactNode }) {
  return text || children ? <div className="awb-research-subsection"><h3>{title}</h3><ResearchRichText text={text}/>{children}</div> : null;
}
export function ResearchArticle({ report }: { report: AnalysisReport }) {
  const c = editorialResearchContent(report.content), digest = researchDigest(c), calendar = sortedResearchCalendar(c.calendar);
  // Free-form output remains intact; don't duplicate the prose or invent missing sections.
  if (c.rawContent) return <div className="awb-stack awb-research-article"><ResearchOutputExtras content={c}/></div>;
  return <div className="awb-stack awb-research-article">
    <section className="awb-analysis-card awb-analysis-full-summary">
      <div className="awb-analysis-section-head"><h2 className="awb-research-chapter-title">全文总结</h2><small>{time(report.generatedAt)}</small></div>
      {c.headline && c.headline !== '账户分析' && !/风险关注度/.test(c.headline) ? <h3>{c.headline}</h3> : null}
      <ResearchRichText text={digest.summary || '本次未单独提供全文总结。'}/>
      <EvidenceLinks report={report} ids={c.evidenceIds}/>
    </section>
    <section className="awb-analysis-card" aria-label="账户信息">
      <h2 className="awb-research-chapter-title"><small>01</small>账户信息</h2>
      <div className="awb-research-risk-line" data-level={digest.level}><ResearchRichText text={digest.risk || '本次未明确给出整体风险关注度。'}/></div>
      <Subsection title="账户概况" text={c.accountSummary}/>
      {c.valuationReview?.length ? <Subsection title="重点持仓估值判断"><div className="awb-analysis-valuation-grid">{c.valuationReview.map((v, i) => <article key={i} data-verdict={v.verdict}>
        <div><b>{v.symbol}</b><span>{verdict[v.verdict] || v.verdict}</span></div><ResearchRichText text={v.rationale}/><EvidenceLinks report={report} ids={v.evidenceIds}/>
      </article>)}</div></Subsection> : null}
      {c.opportunities.length || c.risks.length ? <Subsection title="机会与风险"><div className="awb-analysis-signal-columns">
        <div><h3>【机会】</h3>{c.opportunities.length ? c.opportunities.map((text, i) => <ResearchRichText key={i} text={text} className="awb-research-point"/>) : <p className="awb-muted">本次未提供机会判断。</p>}</div>
        <div><h3>【风险】</h3>{c.risks.length ? c.risks.map((text, i) => <ResearchRichText key={i} text={text} className="awb-research-point"/>) : <p className="awb-muted">本次未提供风险判断。</p>}</div>
      </div></Subsection> : null}
    </section>
    {c.portfolioRisk || c.holdings.length || Object.keys(c.frameworks || {}).length || c.benchmarkComparison ? <section className="awb-analysis-card awb-analysis-narrative" aria-label="持仓解析">
      <h2 className="awb-research-chapter-title"><small>02</small>持仓解析</h2>
      <Subsection title="集中度与穿透式风险" text={c.portfolioRisk}/>
      {Object.keys(c.frameworks || {}).length ? <Subsection title={Object.keys(c.frameworks || {}).length === 3 ? '三套持仓分析框架' : '投资分析框架'}>
        <p className="awb-analysis-framework-notice">以下按公开投资原则分析，不代表投资者本人的发言或实时判断。</p>
        <div className="awb-analysis-frameworks">{Object.entries(c.frameworks || {}).map(([key, f]) => <article key={key}>
          <h3>{frameworkLabel[key] || key}</h3><ResearchRichText text={f.analysis}/><ResearchRichText text={f.commentary}/><EvidenceLinks report={report} ids={f.evidenceIds}/>
        </article>)}</div>
      </Subsection> : null}
      {c.holdings.map((h, i) => <Subsection key={i} title={h.symbol}><div className="awb-holding-research">
        <ResearchRichText text={h.background}/>
        <Subsection title="事实与判断" text={h.fact}/><Subsection title="影响机制" text={h.impact}/>
        <Subsection title="短期应对" text={h.shortTerm}/><Subsection title="长期逻辑" text={h.longTerm}/>
        <Subsection title="反对证据" text={h.counterEvidence}/><Subsection title="失效条件" text={h.invalidation}/>
        {h.support?.map((s, j) => s.verified === false ? <div className="awb-unverified-summary" key={j}><small>模型概括 · 未逐字核实</small><ResearchRichText text={s.quote}/></div> : <blockquote className="awb-original-quote" key={j}><ResearchRichText text={s.quote}/></blockquote>)}
        <EvidenceLinks report={report} ids={h.evidenceIds}/>
      </div></Subsection>)}
      <Subsection title="基准比较" text={c.benchmarkComparison}/>
    </section> : null}
    {c.preMarketNews || c.marketContext || c.industryRotation || c.aiDevelopments ? <section className="awb-analysis-card" aria-label="盘前新闻">
      <h2 className="awb-research-chapter-title"><small>03</small>盘前新闻</h2>
      <Subsection title="盘前重点新闻与事件" text={c.preMarketNews}/>
      <Subsection title="过去一周 · 宏观、政策与地缘风险" text={c.marketContext}/>
      <Subsection title="行业轮动" text={c.industryRotation}/><Subsection title="AI 发展进展" text={c.aiDevelopments}/>
    </section> : null}
    {c.briefPoints?.length || calendar.length || c.keyIssues || c.targetAllocation || c.monitoring?.length ? <section className="awb-analysis-card" aria-label="总结">
      <h2 className="awb-research-chapter-title"><small>04</small>总结</h2>
      {c.briefPoints?.length ? <Subsection title={c.briefPoints.length === 3 ? '今天最需要关注的3件事' : '今天最需要关注的事'}><div className="awb-analysis-brief-points">
        {c.briefPoints.map((text, i) => <div key={i}><span>{String(i + 1).padStart(2, '0')}</span><ResearchRichText text={text}/></div>)}
      </div></Subsection> : null}
      {calendar.length ? <Subsection title="未来 7–14 天关注日历"><div className="awb-analysis-calendar">{calendar.map((event, i) => <article key={i}>
        <time>{event.date || '日期待确认'}</time><div><ResearchRichText text={`**${event.event}**`}/><ResearchRichText text={event.impact}/><small>{event.symbols.join(' · ') || '账户整体'}</small><EvidenceLinks report={report} ids={event.evidenceIds}/></div>
      </article>)}</div></Subsection> : null}
      <Subsection title="账户与持仓最需要解决的问题" text={c.keyIssues}/><Subsection title="目标配置与应对" text={c.targetAllocation}/>
      {c.monitoring?.length ? <Subsection title="持续监控">{c.monitoring.map((m, i) => <ResearchRichText key={i} text={[m.indicator, m.warningLine, m.action].filter(Boolean).join(' · ')}/>)}</Subsection> : null}
    </section> : null}
    {c.scenarios?.length ? <section className="awb-analysis-card awb-analysis-scenarios"><h2 className="awb-research-chapter-title">补充情景分析</h2>{c.scenarios.map((s, i) => <Subsection key={i} title={({ base: '基准情景', upside: '乐观情景', downside: '悲观情景' }[s.name] || s.name)} text={[s.assumptions,s.accountImpact,s.response].filter(Boolean).join('\n\n')}/>)}</section> : null}
    <ResearchOutputExtras content={c}/>
    {c.gaps.length || c.limitations?.length ? <details className="awb-analysis-card awb-output-notices"><summary>资料边界与说明 · 展开查看</summary>{[...new Set([...c.gaps,...(c.limitations || [])])].filter(Boolean).map((text, i) => <ResearchRichText key={i} text={text}/>)}</details> : null}
    {c.disclaimer ? <ResearchRichText text={c.disclaimer} className="awb-muted"/> : null}
  </div>;
}
