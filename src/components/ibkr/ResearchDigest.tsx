import type { AnalysisContent } from '../../lib/ibkr/workbenchTypes';
import { researchDigest } from '../../lib/ibkr/researchPresentation';
import { ResearchRichText } from './ResearchRichText';

export function ResearchDigest({ content }: { content: AnalysisContent }) {
  const digest = researchDigest(content);
  return <div className="awb-research-digest">
    <div className="awb-research-summary" aria-label="全文总结">
      <span className="awb-research-digest-label">全文总结</span>
      <ResearchRichText text={digest.summary || '本次报告未单独给出全文总结，可查看完整分析。'}/>
    </div>
    <div className="awb-research-risk-line" data-level={digest.level} aria-label="今日整体风险关注度">
      <ResearchRichText text={digest.risk || '本次报告未明确给出整体风险关注度及原因。'}/>
    </div>
  </div>;
}
