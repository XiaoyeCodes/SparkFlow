import type { AccountMode, Snapshot } from './types';
import { validSnapshot } from './events';

// P1 reads the service contract only. No production fixture import or write API.
export async function getSnapshot(mode: AccountMode, signal: AbortSignal, accountKey?: string): Promise<Snapshot> {
  const response = await fetch(`/api/ibkr-terminal/snapshot?mode=${mode}${accountKey ? `&accountKey=${encodeURIComponent(accountKey)}` : ''}`, { signal });
  if (!response.ok) throw new Error('本地账户服务未连接，请完成只读服务配置。');
  const value: unknown = await response.json();
  if (!validSnapshot(value) || value.mode !== mode || accountKey && value.accountKey !== accountKey) {
    throw new Error('账户快照身份或格式无效，已拒绝显示。');
  }
  return value;
}
