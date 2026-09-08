import type { Holding } from './workbenchTypes';

const normalize = (value: string) => value
  .trim()
  .toLowerCase()
  .replace(/[–—−]/g, '-')
  .replace(/\s*-\s*/g, ' - ')
  .replace(/\s+/g, ' ');

const labels = new Map(Object.entries({
  'technology': '科技',
  'electronic technology': '电子科技',
  'retail trade': '零售',
  'communication services': '通信服务',
  'consumer non-durables': '必需消费品',
  'health technology': '医疗科技',
  'consumer services': '消费服务',
  'consumer durables': '耐用消费品',
  'consumer cyclical': '可选消费',
  'consumer defensive': '必需消费',
  'healthcare': '医疗保健',
  'financial services': '金融服务',
  'finance': '金融',
  'industrials': '工业',
  'energy': '能源',
  'basic materials': '基础材料',
  'real estate': '房地产',
  'utilities': '公用事业',
  'miscellaneous': '其他',
  'consumer electronics': '消费电子',
  'semiconductors': '半导体',
  'internet retail': '互联网零售',
  'internet content & information': '互联网内容与信息服务',
  'beverages: non-alcoholic': '非酒精饮料',
  'pharmaceuticals: major': '大型制药',
  'drug manufacturers - general': '综合制药',
  'restaurants': '餐饮',
  'software - infrastructure': '基础软件',
  'motor vehicles': '汽车制造',
  'household/personal care': '家庭与个人护理',
  'investment trusts/mutual funds': '投资信托与共同基金',
  'telecommunications equipment': '通信设备',
  'multi-line insurance': '综合保险',
  'etf（不穿透）': 'ETF（不穿透）',
  'etf (look-through disabled)': 'ETF（不穿透）',
  '行业待核实': '行业核实中',
  '行业未核实': '行业核实中',
  'unknown': '行业核实中',
}).map(([key, label]) => [normalize(key), label]));

/** Converts verified upstream classifications for display without changing raw data. */
export function industryLabel(value?: string | null) {
  const original = value?.trim();
  if (!original) return '';
  return labels.get(normalize(original)) ?? original;
}

export function instrumentTypeLabel(value?: string | null) {
  const type = value?.trim().toUpperCase();
  if (type === 'ETF' || type === 'FUND') return 'ETF';
  if (type === 'STK' || type === 'STOCK' || type === 'EQUITY') return '股票';
  return value?.trim() || '品种核实中';
}

export function holdingIndustryLabel(holding: Pick<Holding, 'instrumentType' | 'assetType' | 'industry' | 'sector'>) {
  if ((holding.instrumentType || holding.assetType || '').toUpperCase() === 'ETF') return 'ETF';
  return industryLabel(holding.industry || holding.sector) || '行业核实中';
}

export function holdingIndustryDetails(holding: Pick<Holding, 'instrumentType' | 'assetType' | 'industry' | 'sector'>) {
  if ((holding.instrumentType || holding.assetType || '').toUpperCase() === 'ETF') return 'ETF（不穿透）';
  const values = [industryLabel(holding.sector), industryLabel(holding.industry)].filter(Boolean);
  return [...new Set(values)].join(' · ') || '行业核实中';
}
