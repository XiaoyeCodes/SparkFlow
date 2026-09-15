import type { AnalysisContent, AnalysisReport } from './workbenchTypes.ts';
import { portfolioRiskAssessment } from './portfolioRisk.ts';

export type RiskHighlight = {
  id: string;
  kind: 'cash' | 'concentration' | 'event' | 'metric';
  title: string;
  detail: string;
  values: string[];
  source: string;
};

/** Plain text is also used to locate the original rendered paragraph or table row. */
export const riskPlainText = (text: string) => text
  .replace(/```[\s\S]*?```/g, '')
  .replace(/<[^>]*>/g, '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/[*_`#>]/g, '')
  .replace(/\s+/g, ' ').trim();

export function previousRiskReport(current: AnalysisReport, reports: AnalysisReport[]) {
  return reports.filter(item => item.id !== current.id && item.accountKey === current.accountKey
    && item.kind !== 'chat' && Date.parse(item.generatedAt) < Date.parse(current.generatedAt))
    .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))[0];
}

export function riskScoreChange(content: AnalysisContent, previous?: AnalysisContent) {
  const current = portfolioRiskAssessment(content.rawContent || content.riskSummary || '');
  const prior = previous && portfolioRiskAssessment(previous.rawContent || previous.riskSummary || '');
  return current && prior ? current.score - prior.score : undefined;
}

/** Extract only stated facts. No account snapshot substitution or inferred measurements. */
export function riskHighlights(content: AnalysisContent): RiskHighlight[] {
  const summary = portfolioRiskAssessment(content.rawContent || content.riskSummary || '')?.summary || content.riskSummary || '';
  const sentences = [...new Set([summary, content.rawContent || '', content.portfolioRisk || '', content.marketContext || '']
    .flatMap(text => text.split(/\n|[。！？；;]/)).map(riskPlainText).filter(Boolean))];
  const cards: RiskHighlight[] = [];
  const add = (kind: RiskHighlight['kind'], title: string, detail: string, values: string[], source: string) => {
    cards.push({ id: kind === 'metric' ? title : kind, kind, title, detail, values, source });
  };
  const percent = '(?:[<>＜＞≤≥~≈]|约|仅|不足|低于|接近)?\\s*[-+]?\\d+(?:\\.\\d+)?\\s*[%％]';
  const cashPattern = new RegExp(`现金(?:占比|比例|权重|缓冲|仓位)?(?:\\s|[：:|]|为|仅|约|只有|占|净值|总资产|的|低于|不足|接近){0,16}(${percent})`, 'i');
  for (const sentence of sentences) {
    const cash = sentence.match(cashPattern);
    if (!cash || /建议|目标|提高至|降至|应保持|至少保留/.test(sentence.slice(Math.max(0, cash.index! - 14), cash.index))) continue;
    add('cash', '现金缓冲', '报告中的现金占比', [cash[1].trim().replace(/\s/g, '')], cash[0]);
    break;
  }
  for (const sentence of sentences) {
    if (!/持仓|仓位|权重|占比|集中|单名/.test(sentence)) continue;
    const pairs = [...sentence.matchAll(/\b([A-Z]{1,6}(?:[.-][A-Z]{1,2})?)\s*(?:[（(][^）)]{0,24}[）)])?\s*(?:[|：:]|占比|权重|占|约|为|达|持仓|仓位|\s){0,12}(\d+(?:\.\d+)?\s*[%％])/g)]
      .filter(match => !['FOMC', 'CPI', 'PCE', 'GDP', 'EPS', 'ROE', 'ROIC', 'USD', 'PE'].includes(match[1]));
    if (!pairs.length || /目标|建议.*(?:增|减|调).*至/.test(sentence)) continue;
    const unique = [...new Map(pairs.map(match => [match[1], match])).values()].slice(0, 2);
    add('concentration', '持仓集中度', '报告中的单一持仓权重', unique.map(match => `${match[1]} ${match[2]}`), unique[0][0]);
    break;
  }
  if (!cards.some(card => card.kind === 'concentration')) {
    const rows = (content.rawContent || '').split('\n');
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i].includes('|')) continue;
      const cells = rows[i].split('|').map(riskPlainText).filter(Boolean);
      const symbolColumn = cells.findIndex(cell => /^(?:代码|股票代码|标的|股票|持仓|symbol|ticker)$/i.test(cell));
      const weightColumn = cells.findIndex(cell => /^(?:持仓)?(?:权重|占比)(?:\s*[（(]%[）)])?$/.test(cell));
      if (symbolColumn < 0 || weightColumn < 0) continue;
      const holdings: { value: string; source: string }[] = [];
      for (let j = i + 1; j < rows.length && rows[j].includes('|'); j++) {
        const values = rows[j].split('|').map(riskPlainText).filter(Boolean);
        if (!/^[A-Z]{1,6}(?:[.-][A-Z]{1,2})?$/.test(values[symbolColumn] || '') || !/^\d+(?:\.\d+)?\s*[%％]$/.test(values[weightColumn] || '')) continue;
        holdings.push({ value: `${values[symbolColumn]} ${values[weightColumn]}`, source: riskPlainText(rows[j]) });
      }
      if (holdings.length) {
        add('concentration', '持仓集中度', '报告表格中的持仓权重', holdings.slice(0, 2).map(item => item.value), holdings[0].source);
        break;
      }
    }
  }
  // Dates stay in the report's own notation; missing dates are never manufactured.
  const events = sentences.flatMap(sentence => {
    const event = sentence.match(/FOMC|CPI|PCE|非农|议息|财报|业绩(?:发布|公告)|股东大会|到期日|除息|分红|央行会议/i);
    if (!event) return [];
    const dates = [...sentence.matchAll(/(?:20\d{2}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*(?:[—–~至-]\s*\d{1,2}\s*)?日|20\d{2}[-/]\d{1,2}[-/]\d{1,2}/g)];
    const distance = (date: RegExpMatchArray) => Math.max(0, event.index! - date.index! - date[0].length, date.index! - event.index! - event[0].length);
    const date = dates.filter(item => distance(item) < 32).sort((a, b) => distance(a) - distance(b))[0];
    if (!event || !date || /已公布|已经公布|已结束|回顾|上次|去年/.test(sentence)) return [];
    return [{ sentence, event: event[0], date: date[0] }];
  });
  if (events.length) {
    const event = events[0];
    add('event', '事件关注', `${event.event} · 报告提及的事件时间`, [event.date.replace(/\s/g, '')], event.sentence);
  }
  for (const [pattern, title] of [[/美债|国债|收益率/, '利率环境'], [/市盈率|估值|P\/E|\bPE\b/, '估值观察'], [/杠杆|保证金/, '杠杆与保证金'], [/汇率|外汇/, '汇率敞口'], [/回撤|波动率/, '波动与回撤']] as const) {
    if (cards.length >= 4) break;
    for (const sentence of sentences) {
      const clause = sentence.split(/[，,]/).find(part => pattern.test(part));
      const label = clause?.match(pattern);
      const tail = label ? clause!.slice(label.index! + label[0].length) : '';
      const value = tail.match(new RegExp(`^.{0,16}?(${percent}|\\d+(?:\\.\\d+)?\\s*(?:倍|[x×]|bp|基点))`, 'i'));
      if (!clause || !value) continue;
      add('metric', title, clause.replace(/^\s*[—–-]+/, '').trim(), [value[1].trim()], clause.trim());
      break;
    }
  }
  return cards;
}
