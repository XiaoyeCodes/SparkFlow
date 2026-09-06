import type { AccountMode, Snapshot } from './types';

export function emptySnapshot(mode: AccountMode): Snapshot {
  return { schemaVersion: 1, snapshotId: '', accountKey: `${mode}:unbound`, mode, sessionRevision: 0, sequence: 0,
    source: 'ibkr', testData: false, asOf: null, connection: 'unconfigured', state: 'permission-required', baseCurrency: null,
    metrics: { netLiquidation: null, unrealizedPnl: null, buyingPower: null, maintenanceMargin: null }, cash: [], positions: [], orders: [], quotes: [],
    capabilities: { placeOrders: false, shareWithAi: false }, missing: ['account-binding', 'quotes'], detail: '等待本地账户服务与只读账户绑定。' };
}

export function acceptsSnapshot(snapshot: Snapshot, scope: { mode: AccountMode; accountKey: string | null; requestRevision: number; sequence: number }, requestRevision: number) {
  return requestRevision === scope.requestRevision && snapshot.mode === scope.mode
    && (scope.accountKey === null || snapshot.accountKey === scope.accountKey) && snapshot.sequence >= scope.sequence;
}

export function formatDecimal(value: string | null | undefined) {
  if (value == null || !/^-?\d+(\.\d+)?$/.test(value)) return '—';
  const [whole, fractional] = value.split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fractional === undefined ? '' : `.${fractional}`);
}
