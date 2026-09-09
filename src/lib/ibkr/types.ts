export type AccountMode = 'paper' | 'live' | 'backtest';
export type DataState = 'loading' | 'ready' | 'empty' | 'error' | 'stale' | 'permission-required';
export type Position = { accountKey: string; conId: number; symbol: string; currency: string; quantity: string; averageCost: string | null; marketValue: string | null };
export type Quote = { conId: number; state: 'realtime' | 'delayed' | 'frozen' | 'disconnected' | 'missing'; price: string | null; asOf: string | null; source: string };
export type OrderView = { accountKey: string; clientIntentId: string; conId: number; quantity: string; filled: string | null; remaining: string | null; submission: string; execution: string; managed: boolean; orderId?: number | null; clientId?: number | null; permId?: number | null; brokerStatus?: string | null; symbol?: string | null; currency?: string | null; side?: string | null; limitPrice?: string | null };
export type ExecutionView = { accountKey: string; execId: string; conId: number; symbol: string; currency: string; orderId: number; clientId: number; permId: number; side: string; quantity: string; price: string; executedAt: string | null; commission: string | null; commissionCurrency: string | null };
export type SourceStamp = { source: string; observedAt: string | null; brokerAsOf: string | null; requestCompletedAt: string | null };
export type Snapshot = {
  schemaVersion: 1; snapshotId: string; accountKey: string; mode: AccountMode;
  sessionRevision: number; sequence: number; source: 'ibkr' | 'fixture'; testData: boolean;
  asOf: string | null; connection: 'unconfigured' | 'connecting' | 'connected' | 'disconnected' | 'reconciling' | 'error';
  state: DataState; baseCurrency: string | null;
  metrics: { netLiquidation: string | null; unrealizedPnl: string | null; dailyPnl?: string | null; buyingPower: string | null; maintenanceMargin: string | null };
  cash: { currency: string; amount: string }[]; positions: Position[]; orders: OrderView[]; quotes: Quote[];
  capabilities: { placeOrders: false; shareWithAi: false }; missing: string[]; detail: string;
  executions?: ExecutionView[]; provenance?: Record<string, SourceStamp>;
};
