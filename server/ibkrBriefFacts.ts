import type { Evidence } from '../src/lib/ibkr/workbenchTypes.ts';

export type ExternalBriefFact = { label: string; display: string; source: string; asOf: string | null; evidenceId: string; rawValue?: number };
type JsonRecord = Record<string, unknown>;
const object = (value: unknown): JsonRecord | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const fixed = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isoDate = (value: unknown): string | null => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(value)) return null;
  const date = value.slice(0, 10), parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
};
const fiscalPeriod = (value: unknown) => typeof value === 'string' && /^(?:FY|Q[1-4])$/.test(value) ? value : null;
const usdAmount = (value: number) => {
  const scale = Math.abs(value) >= 100_000_000 ? 100_000_000 : Math.abs(value) >= 10_000 ? 10_000 : 1;
  return { display: `${fixed(value / scale)} ${scale === 100_000_000 ? '亿美元' : scale === 10_000 ? '万美元' : 'USD'}`, conversion: scale === 1 ? '原始 USD，保留两位小数' : `原始 USD ÷ ${scale}，显示为${scale === 100_000_000 ? '亿美元' : '万美元'}，保留两位小数` };
};
const metrics = [
  { key: 'Revenue', label: '营收', concepts: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues'], unit: 'USD' },
  { key: 'NetIncome', label: '净利润', concepts: ['NetIncomeLoss'], unit: 'USD' },
  { key: 'OperatingIncome', label: '营业利润', concepts: ['OperatingIncomeLoss'], unit: 'USD' },
  { key: 'GrossProfit', label: '毛利润', concepts: ['GrossProfit'], unit: 'USD' },
  { key: 'DilutedEPS', label: '稀释每股收益', concepts: ['EarningsPerShareDiluted'], unit: 'USD/shares' },
] as const;

/** Select recent observations and same fiscal periods roughly one reporting year earlier; do not calculate growth. */
function selectedPeriods(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const periods = value.map(object).filter((period): period is JsonRecord => !!period && !!isoDate(period.REPORT_DATE) && !!fiscalPeriod(period.FISCAL_PERIOD))
    .sort((a, b) => isoDate(b.REPORT_DATE)!.localeCompare(isoDate(a.REPORT_DATE)!))
    .filter(period => { const key = `${isoDate(period.REPORT_DATE)}:${period.FISCAL_PERIOD}`; if (seen.has(key)) return false; seen.add(key); return true; });
  const selected = periods.slice(0, 2);
  for (const recent of [...selected]) {
    const at = Date.parse(isoDate(recent.REPORT_DATE)!);
    const prior = periods.find(period => {
      const days = (at - Date.parse(isoDate(period.REPORT_DATE)!)) / 86_400_000;
      return period.FISCAL_PERIOD === recent.FISCAL_PERIOD && days >= 330 && days <= 400 && !selected.includes(period);
    });
    if (prior) selected.push(prior);
  }
  return selected.slice(0, 4);
}

/** Format only numeric values present in read evidence; no ratios, growth rates, forecasts, or currency conversion are computed. */
export function externalBriefFacts(evidence: Evidence[]): Record<string, ExternalBriefFact> {
  const facts: Record<string, ExternalBriefFact> = {};
  const seen = new Set<string>();
  for (const item of evidence) {
    if (!item.read || !item.content || !/^[A-Za-z0-9]+$/.test(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    let data: JsonRecord | undefined;
    try { data = object(JSON.parse(item.content)); } catch { continue; }
    if (!data) continue;
    const source = `已读取来源 ${item.source || item.title}`;
    if (item.kind === 'filing') {
      const statements = object(data.data);
      if (!statements) continue;
      const securities = Object.entries(statements).filter(([symbol, entry]) => item.symbols.includes(symbol.endsWith('.US') ? symbol.slice(0, -3) : symbol) && !!object(entry));
      securities.forEach(([security, value], securityIndex) => {
        const entry = object(value)!, symbol = security.endsWith('.US') ? security.slice(0, -3) : security;
        selectedPeriods(entry.periods).forEach((period, index) => {
          const date = isoDate(period.REPORT_DATE)!, fiscal = fiscalPeriod(period.FISCAL_PERIOD)!;
          const label = `${symbol} · 报告期截至 ${date}（${fiscal === 'FY' ? 'FY 全年' : `${fiscal} 财季`}，非发布日期）`;
          const units = object(period._units);
          const prefix = `external${item.id}${securities.length > 1 ? `S${securityIndex}` : ''}P${index}`;
          let hasMetric = false;
          for (const metric of metrics) {
            const concept = metric.concepts.find(key => finite(period[key]) && units?.[key] === metric.unit);
            if (!concept) continue;
            const rawValue = period[concept] as number;
            const formatted = metric.unit === 'USD' ? usdAmount(rawValue) : { display: `${fixed(rawValue)} USD/股`, conversion: '原始 USD/shares → USD/股，保留两位小数；未按金额缩放' };
            const key = `${prefix}${metric.key}`;
            facts[key] = { label: `${label} · ${metric.label}`, display: formatted.display, source: `${source}；原字段 ${concept}；${formatted.conversion}；报告期末非发布日期`, asOf: date, evidenceId: item.id, rawValue };
            hasMetric = true;
          }
          if (hasMetric) facts[`${prefix}Period`] = { label: `${symbol} · 报告期间（非发布日期）`, display: `截至${date}的${fiscal === 'FY' ? 'FY全年' : `${fiscal}财季`}`, source: `${source}；原字段 REPORT_DATE 与 FISCAL_PERIOD 原样标注；报告期末非发布日期，未推算日期`, asOf: date, evidenceId: item.id };
        });
      });
    } else if (item.kind === 'profile') {
      const statistics = object(data.statistics), financials = object(data.financials);
      const suppliedCurrency = [data.currency, data.quoteCurrency, object(data.quote)?.currency].find(value => typeof value === 'string' && /^[A-Z]{3}$/.test(value));
      const currency = typeof suppliedCurrency === 'string' ? suppliedCurrency : null;
      const symbol = item.symbols.join(' / ') || '标的未核实';
      const candidates = [
        { key: 'ForwardPE', field: 'forwardPE', value: statistics?.forwardPE, label: '预期市盈率', unit: '倍' },
        { key: 'TrailingPE', field: 'trailingPE', value: statistics?.trailingPE, label: '历史市盈率', unit: '倍' },
        { key: 'ForwardEPS', field: 'forwardEps', value: statistics?.forwardEps, label: '预期每股收益', unit: currency ? `${currency}/股` : '（币种未核实）' },
        { key: 'TrailingEPS', field: 'trailingEps', value: statistics?.trailingEps, label: '历史每股收益', unit: currency ? `${currency}/股` : '（币种未核实）' },
        { key: 'CurrentPrice', field: 'currentPrice', value: financials?.currentPrice, label: '资料中的价格', unit: currency ?? '（币种未核实）' },
      ];
      for (const metric of candidates) {
        if (!finite(metric.value)) continue;
        facts[`external${item.id}${metric.key}`] = { label: `${symbol} · ${metric.label}（估值快照；价格时点、预期修订时间未核实）`, display: `${fixed(metric.value)} ${metric.unit}`, source: `${source}；原字段 ${metric.field}，保留两位小数；仅显示来源数值，未推算或进行同行比较；价格时点、预期修订时间未核实`, asOf: null, evidenceId: item.id, rawValue: metric.value };
      }
    }
  }
  return facts;
}
