import { ResearchRichText } from './ResearchRichText';
import type { AnalysisContent } from '../../lib/ibkr/workbenchTypes';
import './ResearchOutputExtras.css';
import { editorialResearchContent } from '../../lib/ibkr/researchPresentation';

export function ResearchOutputExtras({ content }: { content: AnalysisContent }) {
  const sections = editorialResearchContent(content).additionalSections || [];
  return <>
    {content.validationWarnings?.length ? <details className="awb-analysis-card awb-output-notices">
      <summary>内容核查提示 · {content.validationWarnings.length} 项（不影响阅读）</summary>
      <ul>{content.validationWarnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>
    </details> : null}
    {content.rawContent ? <section className="awb-analysis-card awb-flexible-output" aria-label="模型原始分析">
      <h2>模型分析内容</h2><ResearchRichText text={content.rawContent}/>
    </section> : null}
    {sections.length ? <details className="awb-analysis-card awb-output-notices awb-flexible-output"><summary>补充分析 · {sections.length} 项</summary>
      {sections.map((section, i) => <div className="awb-research-subsection" key={i}><h3>{section.title}</h3><ResearchRichText text={section.content}/></div>)}
    </details> : null}
  </>;
}
