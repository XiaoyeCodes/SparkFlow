import type { Evidence } from '../src/lib/ibkr/workbenchTypes.ts';

const object = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const prose = (v: unknown): string => typeof v === 'string' ? v.trim() : v == null ? '' : typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
const list = (v: unknown): any[] => Array.isArray(v) ? v : v == null || v === '' ? [] : [v];
const strings = (v: unknown) => list(v).map(prose).filter(Boolean);
const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

// Presentation normalization only. No extra model calls and no invented facts.
export function flexibleResearchOutput(result: { text: string; finishReason?: string }, symbols: string[], evidence: Evidence[]) {
  if (!result.text?.trim()) throw new Error('OUTPUT_EMPTY');
  if (result.text.length > 500_000) throw new Error('OUTPUT_FIELDS: 模型输出超过安全处理大小');
  const warnings: string[] = [];
  const warn = (s: string) => { if (!warnings.includes(s)) warnings.push(s); };
  const source = result.text.trim().replace(/^```(?:json|markdown)?\s*/i, '').replace(/\s*```$/, '');
  let raw: Record<string, any> = {}, rawContent = '';
  try {
    const decoded = JSON.parse(source);
    if (typeof decoded === 'string') rawContent = decoded;
    else raw = Array.isArray(decoded) ? { sections: decoded } : object(decoded);
  }
  catch {
    // Permit a JSON object surrounded by a short explanation; otherwise retain
    // the entire response as text rather than discarding an expensive analysis.
    try { raw = object(JSON.parse(source.slice(source.indexOf('{'), source.lastIndexOf('}') + 1))); }
    catch { rawContent = source; warn('模型未返回标准结构，已按原始内容展示；其中的引用与结论尚需核查。'); }
  }
  if (!rawContent && !Object.values(raw).some(v => prose(v) && !['[]', '{}', 'null'].includes(prose(v)))) throw new Error('OUTPUT_EMPTY');
  if (['length', 'max_tokens'].includes(result.finishReason ?? '')) warn('模型输出被截断，以下保留已收到的内容，报告可能不完整。');
  const valid = new Map(evidence.filter(e => e.read).map(e => [e.id, e]));
  for (const [, id] of JSON.stringify(raw).matchAll(/\[(E\d+)\]/g)) {
    if (!valid.has(id)) warn(`正文引用 ${id} 未匹配到已保存原文，相关判断需要核查。`);
  }
  const refs = (v: unknown) => strings(v).filter(id => {
    if (valid.has(id)) return true;
    warn(`引用 ${id} 未匹配到已保存原文，未作为已核实来源。`); return false;
  });
  const fields = (v: unknown, keys: string[]) => Object.fromEntries(keys.map(k => [k, prose(object(v)[k])]));
  const paragraphs = (v: unknown, key: string) => list(v).map(value => {
    const item = object(value);
    return Object.keys(item).length ? item : { [key]: prose(value) };
  });
  const sections: Array<{ title: string; content: string }> = [];
  const extra = (item: Record<string, any>, keys: string[], title: string) => {
    for (const [key, value] of Object.entries(item)) if (!keys.includes(key) && prose(value)) sections.push({ title: `${title} · ${key}`, content: prose(value) });
  };
  const holdingKeys = ['basis','symbol','background','fact','impact','counterEvidence','shortTerm','longTerm','invalidation','support','evidenceIds','note','analysis','summary','weight','type','name','currency','quantity'];
  const holdings = paragraphs(raw.holdings, 'background').map((h, index) => {
    h = { ...h, background: prose(h.background) || [h.analysis, h.summary, h.note].map(prose).filter(Boolean).join('\n\n') };
    const symbol = prose(h.symbol) || `研究观点 ${index + 1}`;
    if (!symbols.includes(symbol)) warn(`${symbol} 不属于当前账户持仓，仅作为模型讨论内容展示。`);
    const support = paragraphs(h.support, 'quote').filter(s => prose(s.quote)).map(s => {
      const evidenceId = prose(s.evidenceId), e = valid.get(evidenceId), quote = prose(s.quote);
      const parts = [e?.content ?? ''];
      const visit = (v: unknown) => { if (typeof v === 'string') parts.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(visit); };
      try { visit(JSON.parse(e?.content ?? '')); } catch { /* Plain text source. */ }
      const verified = Boolean(e && e.symbols.includes(symbol) && parts.some(part => normalize(part).includes(normalize(quote))));
      if (!verified) warn(`${symbol} 的引用 ${evidenceId || '（未注明来源）'} 未通过逐字匹配，按模型摘要／待核查内容展示，不作为原文引语。`);
      return { evidenceId, quote, verified };
    });
    const inlineIds = [...JSON.stringify(h).matchAll(/(?:\[|\(|（)\s*(E\d+)\s*(?:\]|\)|）)/g)].map(match=>match[1]).filter(id=>valid.has(id));
    const evidenceIds = [...new Set([...refs(h.evidenceIds), ...inlineIds, ...support.filter(s => valid.has(s.evidenceId)).map(s => s.evidenceId)])];
    if (h.basis !== 'account' && !evidenceIds.length && [h.background,h.fact,h.impact,h.shortTerm,h.longTerm].some(v=>prose(v))) warn(`${symbol} 的外部判断缺少可核查来源。`);
    extra(h, holdingKeys, symbol);
    return { ...fields(h, holdingKeys.filter(k => !['support','evidenceIds'].includes(k))), symbol, support, evidenceIds };
  }).filter(h => ['background','fact','impact','counterEvidence','shortTerm','longTerm','invalidation'].some(key=>prose(object(h)[key])) || h.support.length);
  const actionKeys = ['basis','symbol','action','horizon','priority','rationale','executionWindow','riskControl','expectedImpact','counterEvidence','trigger','invalidation','targetWeight','evidenceIds'];
  const actions = paragraphs(raw.actions, 'rationale').flatMap(a => {
    const symbol = prose(a.symbol);
    if (!symbols.includes(symbol)) {
      sections.push({ title: symbol ? `${symbol} · 补充建议` : '组合建议', content: prose(a) });
      warn('未匹配账户持仓的建议仅展示为文本，不进入可制定计划的行动清单。'); return [];
    }
    const weight = typeof a.targetWeight === 'number' && Number.isFinite(a.targetWeight) && a.targetWeight >= 0 && a.targetWeight <= 1 ? a.targetWeight : null;
    if (a.targetWeight != null && weight === null) warn(`${symbol} 的目标权重格式或范围无效，保留为待确认，不用于计划计算。`);
    if (!['hold','watch','increase','reduce'].includes(a.action)) {
      sections.push({ title: `${symbol} · 原始行动建议`, content: prose(a) });
      warn(`${symbol} 的行动类型未识别，按观察展示，不自动转换成买卖动作。`);
    }
    extra(a, actionKeys, `${symbol} 建议`);
    return [{ ...fields(a, actionKeys), symbol, action: ['hold','watch','increase','reduce'].includes(a.action) ? a.action : 'watch',
      horizon: a.horizon === 'short' ? 'short' : 'long', priority: ['high','medium','low'].includes(a.priority) ? a.priority : 'medium',
      targetWeight: weight, evidenceIds: refs(a.evidenceIds) }];
  });
  const frameworks: Record<string, any> = {};
  for (const [key, value] of Object.entries(object(raw.frameworks))) {
    const f = typeof value === 'string' ? { analysis: value } : object(value);
    if (prose(f.analysis) || prose(f.commentary)) frameworks[key] = { ...fields(f, ['analysis','commentary']), evidenceIds: refs(f.evidenceIds) };
  }
  const briefPoints = strings(raw.briefPoints);
  const covered = strings(raw.reviewedSymbols);
  const missing = symbols.filter(s => !covered.includes(s));
  if (missing.length) warn(`模型未明确声明覆盖：${missing.join('、')}；不代表已逐仓完成研究。`);
  const keys = ['riskSummary','preMarketNews','industryRotation','aiDevelopments','keyIssues','headline','brief','briefPoints','accountSummary','portfolioRisk','marketContext','benchmarkComparison','reviewedSymbols','holdings','actions','frameworks','opportunities','risks','gaps','limitations','disclaimer','fullSummary','targetAllocation','evidenceIds','valuationReview','calendar','scenarios','monitoring'];
  extra(raw, keys, '补充分析');
  const data = {
    ...fields(raw, ['riskSummary','preMarketNews','industryRotation','aiDevelopments','keyIssues','accountSummary','portfolioRisk','marketContext','benchmarkComparison','fullSummary','targetAllocation','disclaimer']),
    disclaimer: prose(raw.disclaimer) || 'AI 生成的辅助分析，未经核实内容需自行核查，不构成投资建议。',
    headline: prose(raw.headline) || '账户分析', briefPoints,
    brief: prose(raw.brief) || briefPoints.join('\n\n') || prose(raw.fullSummary) || prose(raw.accountSummary),
    reviewedSymbols: [...new Set(covered.filter(s => symbols.includes(s)))], holdings, actions, frameworks,
    opportunities: strings(raw.opportunities), risks: strings(raw.risks), gaps: strings(raw.gaps), limitations: strings(raw.limitations),
    evidenceIds: refs(raw.evidenceIds),
    valuationReview: paragraphs(raw.valuationReview, 'rationale').map(v => ({ ...fields(v, ['symbol','rationale']),
      verdict: ['overvalued','opportunity','fair','insufficient'].includes(v.verdict) ? v.verdict : 'insufficient', evidenceIds: refs(v.evidenceIds) })),
    calendar: paragraphs(raw.calendar, 'event').map(v => ({ ...fields(v, ['date','event','impact']), symbols: strings(v.symbols), evidenceIds: refs(v.evidenceIds) })),
    scenarios: paragraphs(raw.scenarios, 'assumptions').map(v => fields(v, ['name','assumptions','accountImpact','response'])),
    monitoring: paragraphs(raw.monitoring, 'indicator').map(v => fields(v, ['indicator','warningLine','action'])),
    validationWarnings: warnings, additionalSections: sections, rawContent,
  };
  return data;
}
