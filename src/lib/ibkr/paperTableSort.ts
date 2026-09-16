import type { Holding } from './workbenchTypes';

export type PaperTableSort = { key: string; direction: 'default' | 'asc' | 'desc' };
type SortValue = string | number | null | undefined;

export const paperSortNumber = (value: SortValue) => value == null || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);

export function paperHoldingValues(row: Holding) {
  const quantity = paperSortNumber(row.quantity), marketValue = paperSortNumber(row.marketValue), cost = paperSortNumber(row.averageCost);
  const stock = !row.assetType || ['STK', 'ETF'].includes(row.assetType);
  const currentPrice = stock && quantity != null && quantity !== 0 && marketValue != null ? paperSortNumber(marketValue / quantity) : null;
  const unrealizedPnl = paperSortNumber(row.unrealizedPnl) ?? (stock && quantity != null && quantity !== 0 && marketValue != null && cost != null ? paperSortNumber(marketValue - cost * quantity) : null);
  return { currentPrice, unrealizedPnl };
}

// Missing values stay at the bottom in either direction; equal values retain input order.
export function sortPaperTable<T>(rows: T[], sort: PaperTableSort, valueFor: (row: T, key: string) => SortValue): T[] {
  if (sort.direction === 'default') return [...rows];
  return [...rows].sort((a, b) => {
    const left = valueFor(a, sort.key), right = valueFor(b, sort.key);
    const missing = (value: SortValue) => value == null || value === '' || (typeof value === 'number' && !Number.isFinite(value));
    if (missing(left)) return missing(right) ? 0 : 1;
    if (missing(right)) return -1;
    const comparison = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), 'zh-CN', { numeric: true });
    return sort.direction === 'asc' ? comparison : -comparison;
  });
}

export function paperOrderTime(value?: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(new Date(value));
}
