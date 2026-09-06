import type { Snapshot } from './types';

export type StrategyActivation = {
  activationId: string; accountKey: string; mode: 'paper'; sessionRevision: number; strategyId: string; strategyVersion: string;
  strategyHash: string; authorizationId: string; testData: boolean;
  state: 'STOPPED' | 'RUNNING' | 'PAUSED' | 'HALTED' | 'RECOVERY_REQUIRED' | 'EXPIRED';
  activatedAt: string; expiresAt: string; updatedAt: string; lastSignalSequence: number; lastSnapshotId: string | null; reason: string | null;
};

const valid = (value: unknown, snapshot: Snapshot): value is StrategyActivation => {
  if (!value || typeof value !== 'object') return false;
  const row = value as StrategyActivation;
  return /^activation:[0-9a-f]{32}$/.test(row.activationId) && row.accountKey === snapshot.accountKey && row.mode === snapshot.mode
    && /^[0-9a-f]{64}$/.test(row.strategyHash) && ['STOPPED', 'RUNNING', 'PAUSED', 'HALTED', 'RECOVERY_REQUIRED', 'EXPIRED'].includes(row.state);
};

const query = (snapshot: Snapshot) => `mode=${snapshot.mode}&accountKey=${encodeURIComponent(snapshot.accountKey)}`;
export async function loadStrategyRuntime(snapshot: Snapshot, signal: AbortSignal) {
  const response = await fetch(`/api/ibkr-terminal/strategy-runtime?${query(snapshot)}`, { signal });
  if (!response.ok) throw new Error('STRATEGY_RUNTIME_DISABLED');
  const value: unknown = await response.json();
  if (!Array.isArray(value) || !value.every(row => valid(row, snapshot))) throw new Error('STRATEGY_RUNTIME_INVALID');
  return value;
}

export async function stopStrategyRuntime(snapshot: Snapshot, activation: StrategyActivation) {
  if (!valid(activation, snapshot)) throw new Error('ACTIVATION_SCOPE_MISMATCH');
  const response = await fetch(`/api/ibkr-terminal/strategy-runtime/${encodeURIComponent(activation.activationId)}/stop`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: snapshot.mode, accountKey: snapshot.accountKey }),
  });
  if (!response.ok) throw new Error('STOP_FAILED');
  const value: unknown = await response.json();
  if (!valid(value, snapshot) || value.activationId !== activation.activationId) throw new Error('ACTIVATION_SCOPE_MISMATCH');
  return value;
}
