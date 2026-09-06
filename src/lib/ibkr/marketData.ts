import type { AccountMode, Position, Snapshot } from './types';

export type ChartPeriod = '1D' | '5D' | '1M' | '6M' | '1Y';
export type HistoricalBar = { time: string; open: string; high: string; low: string; close: string; volume: string | null };
export type HistoricalDataset = {
  schemaVersion: 1; accountKey: string; mode: AccountMode; snapshotId: string; conId: number; period: ChartPeriod;
  barSize: string; timezone: string; source: string; testData: boolean; asOf: string;
  state: 'ready' | 'empty' | 'error' | 'stale' | 'permission-required'; missing: string[];
  bars: HistoricalBar[]; dataHash: string;
};

const decimal = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;
function valid(value: unknown, snapshot: Snapshot, position: Pick<Position,'conId'>, period: ChartPeriod): value is HistoricalDataset {
  if (!value || typeof value !== 'object') return false;
  const item = value as HistoricalDataset;
  if (item.schemaVersion !== 1 || item.accountKey !== snapshot.accountKey || item.mode !== snapshot.mode || item.snapshotId !== snapshot.snapshotId
    || item.conId !== position.conId || item.period !== period || !/^[0-9a-f]{64}$/.test(item.dataHash)
    || !['ready', 'empty', 'error', 'stale', 'permission-required'].includes(item.state) || !Array.isArray(item.bars)) return false;
  let previous = -Infinity;
  return item.bars.every(bar => {
    const time = Date.parse(bar.time);
    const values = [bar.open, bar.high, bar.low, bar.close, ...(bar.volume === null ? [] : [bar.volume])];
    const numbers = values.map(Number);
    const ok = Number.isFinite(time) && time > previous && values.every(text => typeof text === 'string' && decimal.test(text)) && numbers.every(number => Number.isFinite(number));
    previous = time;
    return ok;
  });
}

export async function getHistoricalData(snapshot: Snapshot, position: Pick<Position,'conId'>, period: ChartPeriod, signal: AbortSignal) {
  const query = new URLSearchParams({ mode: snapshot.mode, accountKey: snapshot.accountKey, conId: String(position.conId), period });
  const response = await fetch(`/api/ibkr-terminal/market-data?${query}`, { signal });
  if (!response.ok) throw new Error('历史行情服务不可用。');
  const value: unknown = await response.json();
  if (!valid(value, snapshot, position, period)) throw new Error('历史行情身份、顺序或数字格式无效。');
  return value;
}
