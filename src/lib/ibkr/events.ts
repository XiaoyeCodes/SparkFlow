import type { Snapshot } from './types';

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const decimal = (value: unknown) => typeof value === 'string' && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(value);
const optionalDecimal = (value: unknown) => value === null || decimal(value);
const integer = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const optionalTime = (value: unknown) => value === null || typeof value === 'string' && Number.isFinite(Date.parse(value));

export function validSnapshot(value: unknown): value is Snapshot {
  if (!record(value) || value.schemaVersion !== 1 || !['paper', 'live', 'backtest'].includes(String(value.mode))
    || typeof value.accountKey !== 'string' || !value.accountKey.startsWith(`${value.mode}:`)
    || typeof value.snapshotId !== 'string' || !integer(value.sessionRevision) || !integer(value.sequence)
    || !['ibkr', 'fixture'].includes(String(value.source)) || typeof value.testData !== 'boolean' || (value.source === 'fixture') !== value.testData
    || !['loading', 'ready', 'empty', 'error', 'stale', 'permission-required'].includes(String(value.state))
    || !['unconfigured', 'connecting', 'connected', 'disconnected', 'reconciling', 'error'].includes(String(value.connection))
    || !(value.asOf === null || typeof value.asOf === 'string' && Number.isFinite(Date.parse(value.asOf)))
    || !(value.baseCurrency === null || typeof value.baseCurrency === 'string')
    || typeof value.detail !== 'string' || !Array.isArray(value.missing) || !value.missing.every(item => typeof item === 'string')
    || !record(value.capabilities) || value.capabilities.placeOrders !== false || value.capabilities.shareWithAi !== false
    || !record(value.metrics) || !['netLiquidation', 'unrealizedPnl', 'buyingPower', 'maintenanceMargin'].every(key => optionalDecimal((value.metrics as Record<string, unknown>)[key]))) return false;
  if (!Array.isArray(value.positions) || !value.positions.every(row => record(row) && row.accountKey === value.accountKey && integer(row.conId) && Number(row.conId) > 0
    && typeof row.symbol === 'string' && typeof row.currency === 'string' && decimal(row.quantity) && optionalDecimal(row.averageCost) && optionalDecimal(row.marketValue))) return false;
  if (!Array.isArray(value.cash) || !value.cash.every(row => record(row) && typeof row.currency === 'string' && decimal(row.amount))) return false;
  if (!Array.isArray(value.orders) || !value.orders.every(row => record(row) && row.accountKey === value.accountKey && integer(row.conId) && Number(row.conId) > 0 && typeof row.clientIntentId === 'string'
    && decimal(row.quantity) && ['filled', 'remaining'].every(key => optionalDecimal(row[key])) && typeof row.submission === 'string' && typeof row.execution === 'string' && typeof row.managed === 'boolean')) return false;
  if (value.executions !== undefined && (!Array.isArray(value.executions) || !value.executions.every(row => record(row) && row.accountKey === value.accountKey && typeof row.execId === 'string'
    && ['conId', 'orderId', 'clientId', 'permId'].every(key => integer(row[key])) && Number(row.conId) > 0 && ['symbol', 'currency', 'side'].every(key => typeof row[key] === 'string')
    && decimal(row.quantity) && decimal(row.price) && optionalDecimal(row.commission) && (row.commissionCurrency === null || typeof row.commissionCurrency === 'string') && optionalTime(row.executedAt)))) return false;
  if (value.provenance !== undefined && (!record(value.provenance) || !Object.values(value.provenance).every(stamp => record(stamp) && typeof stamp.source === 'string'
    && optionalTime(stamp.observedAt) && optionalTime(stamp.brokerAsOf) && optionalTime(stamp.requestCompletedAt)))) return false;
  return Array.isArray(value.quotes) && value.quotes.every(row => record(row) && integer(row.conId) && Number(row.conId) > 0 && optionalDecimal(row.price)
    && ['realtime', 'delayed', 'frozen', 'disconnected', 'missing'].includes(String(row.state)) && typeof row.source === 'string' && (row.asOf === null || typeof row.asOf === 'string' && Number.isFinite(Date.parse(row.asOf))));
}

type EventResult = { action: 'ignore' | 'resync' } | { action: 'apply'; snapshot: Snapshot };
const patchKeys = new Set(['snapshotId', 'source', 'testData', 'asOf', 'connection', 'state', 'baseCurrency', 'metrics', 'cash', 'positions', 'orders', 'quotes', 'capabilities', 'missing', 'detail', 'executions', 'provenance']);

export function applyAccountEvent(snapshot: Snapshot, event: unknown): EventResult {
  if (!record(event) || !integer(event.sequence) || !integer(event.sessionRevision)) return { action: 'resync' };
  if (event.mode !== snapshot.mode || event.accountKey !== snapshot.accountKey || Number(event.sessionRevision) < snapshot.sessionRevision) return { action: 'ignore' };
  if (event.sessionRevision !== snapshot.sessionRevision || event.kind === 'resync-required') return { action: 'resync' };
  if (event.kind === 'heartbeat') return { action: event.sequence === snapshot.sequence ? 'ignore' : 'resync' };
  if (event.kind !== 'snapshot.patch') return { action: 'resync' };
  if (Number(event.sequence) <= snapshot.sequence) return { action: 'ignore' };
  if (event.previousSequence !== snapshot.sequence || event.sequence !== snapshot.sequence + 1 || !record(event.payload)
    || Object.keys(event.payload).some(key => !patchKeys.has(key))) return { action: 'resync' };
  const next = { ...snapshot, ...event.payload, sequence: event.sequence };
  return validSnapshot(next) ? { action: 'apply', snapshot: next } : { action: 'resync' };
}
