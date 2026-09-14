import type { AnalysisContent, AnalysisCalendarEvent } from './workbenchTypes';

// Old reports are normalized at presentation time too; no stored report is rewritten.
export function editorialResearchContent(content: AnalysisContent): AnalysisContent {
  const holdings = content.holdings.map(h => ({ ...h, support: [...(h.support || [])] }));
  const sections = (content.additionalSections || []).filter(section => {
    const match = section.title.match(/^(.+?)\s*·\s*(weight|type|name|currency|quantity|note|analysis|summary)$/i);
    if (!match) return Boolean(section.content?.trim());
    if (/note|analysis|summary/i.test(match[2])) {
      const holding = holdings.find(h => h.symbol === match[1].trim());
      if (!holding) return true;
      if (!holding.background?.includes(section.content)) holding.background = [holding.background, section.content].filter(Boolean).join('\n\n');
    }
    return false;
  });
  return { ...content, additionalSections: sections, holdings: holdings.filter(h =>
    [h.background,h.fact,h.impact,h.shortTerm,h.longTerm,h.counterEvidence,h.invalidation].some(v=>v?.trim()) || h.support.some(s=>s.quote?.trim())) };
}

// Extract only explicitly labelled sections from legacy prose, without another AI call.
function labelledSection(text: string, label: string) {
  const lines = text.split(/\r?\n/);
  const clean = (line: string) => line.replace(/^\s*#{1,6}\s*/, '').replace(/\*/g, '').trim();
  const start = lines.findIndex(line => clean(line) === label || clean(line).startsWith(`${label}：`) || clean(line).startsWith(`${label}:`));
  if (start < 0) return '';
  const inline = clean(lines[start]).slice(label.length).replace(/^[：:]\s*/, '');
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(line => /^\s{0,3}#{1,6}\s/.test(line) || /^(?:[一二三四、.\s]+)?(?:账户信息|持仓解析|盘前新闻|总结)[:：]?$/.test(clean(line)));
  return [inline,...(end < 0 ? rest : rest.slice(0, end))].filter(Boolean).join('\n').trim();
}

export function researchDigest(content: AnalysisContent) {
  const raw = content.rawContent || '';
  const summary = content.fullSummary?.trim() || labelledSection(raw, '全文总结') || content.brief?.trim() || content.accountSummary?.trim() || '';
  const riskPattern = /(?:今日)?整体风险关注度\s*[：:]\s*(?:\*\*)?([高中低])/;
  const risk = content.riskSummary?.trim() || (riskPattern.test(content.headline || '') ? content.headline! : '') ||
    raw.split(/\r?\n/).find(line => riskPattern.test(line.replace(/\*/g, '')))?.replace(/^\s*[-#]+\s*/, '') || '';
  const explicit = risk.replace(/\*/g, '').match(riskPattern)?.[1];
  return { summary, risk, level: explicit === '高' ? 'high' : explicit === '中' ? 'medium' : explicit === '低' ? 'low' : 'unknown' };
}

export function sortedResearchCalendar(items: AnalysisCalendarEvent[] = []) {
  const stamp = (value: string) => {
    const match = value.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
    if (!match) return Infinity;
    const date = Date.parse(`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}T00:00:00Z`);
    const time = value.match(/(\d{1,2}):(\d{2})/);
    return Number.isFinite(date) ? date + (time ? (+time[1] * 60 + +time[2]) * 60000 : 0) : Infinity;
  };
  return items.map((item, index) => ({ item, index, at: stamp(item.date) }))
    .sort((a, b) => a.at - b.at || a.index - b.index).map(row => row.item);
}
