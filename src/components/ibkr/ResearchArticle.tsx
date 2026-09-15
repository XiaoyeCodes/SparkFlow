import type { AnalysisReport } from '../../lib/ibkr/workbenchTypes';
import { useEffect, useRef } from 'react';
import { riskPlainText } from '../../lib/ibkr/riskHighlights';
import { reportMarkdown } from '../../lib/ibkr/workbenchReport';
import { ResearchRichText } from './ResearchRichText';
import './PortfolioRiskGauge.css';
import './ResearchArticle.css';

export function ResearchArticle({ report, focusText }: { report: AnalysisReport; focusText?: string }) {
  const article = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focusText || !article.current) return;
    const needle = riskPlainText(focusText).replace(/\s|\|/g, '');
    const blocks = [...article.current.querySelectorAll<HTMLElement>('p,li,tr,blockquote')];
    const target = blocks.find(block => riskPlainText(block.textContent || '').replace(/\s|\|/g, '').includes(needle));
    if (!target) return;
    target.classList.add('awb-risk-source-focus');
    target.setAttribute('tabindex', '-1');
    const frame = requestAnimationFrame(() => { target.scrollIntoView({ block: 'center', behavior: 'instant' }); target.focus({ preventScroll: true }); });
    return () => { cancelAnimationFrame(frame); target.classList.remove('awb-risk-source-focus'); target.removeAttribute('tabindex'); };
  }, [report.id, focusText]);
  return <article ref={article} className="awb-research-document" aria-label="完整账户研究报告">
    <div className="awb-report-masthead"><span>PORTFOLIO RESEARCH</span><span>持仓研究 · 完整报告</span></div>
    <ResearchRichText text={reportMarkdown(report)} restrained/>
    <div className="awb-report-endmark" aria-hidden="true"><span/>END OF REPORT<span/></div>
  </article>;
}
