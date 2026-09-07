import type { AccountMode, Snapshot } from './types';

export function emptySnapshot(mode: AccountMode): Snapshot {
  return { schemaVersion: 1, snapshotId: '', accountKey: `${mode}:unbound`, mode, sessionRevision: 0, sequence: 0,
    source: 'ibkr', testData: false, asOf: null, connection: 'unconfigured', state: 'permission-required', baseCurrency: null,
    metrics: { netLiquidation: null, unrealizedPnl: null, buyingPower: null, maintenanceMargin: null }, cash: [], positions: [], orders: [], quotes: [],
    capabilities: { placeOrders: false, shareWithAi: false }, missing: ['account-binding', 'quotes'], detail: '等待本地账户服务与只读账户绑定。' };
}
