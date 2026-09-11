import type { PaperQuote } from './workbenchTypes';

export function paperPeFact(quote: PaperQuote | null | undefined, kind: 'ttm' | 'dynamic' | 'static' = 'ttm') {
  const valid = (value: string | null | undefined) => value != null && value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) !== 0;
  const [field, label, basis] = kind === 'dynamic'
    ? ['peDynamic', '市盈率（动）', '动态盈利口径'] as const
    : kind === 'static' ? ['peStatic', '市盈率（静）', '上一年度盈利口径'] as const
    : ['peTtm', '市盈率（TTM）', '最近四个季度盈利口径'] as const;
  const value = valid(quote?.[field]) ? quote![field]! : null;
  const source = quote?.peSource;
  const asOf = quote?.asOf;
  const missing = `${source || '数据源'}暂未提供有效${label}`;
  return { label, value, title: value == null ? missing :
    [source, basis, '接口原值', asOf && `报价时间 ${asOf}`, Number(value) < 0 && '该盈利口径为负'].filter(Boolean).join(' · ') };
}
