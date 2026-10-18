import type { StrategyState } from './stockStrategyTypes';

let cached: StrategyState | null = null;
let flight: Promise<StrategyState> | null = null;
let refreshedAt = 0;
export const peekStrategyState = () => cached;
export function loadStrategyState(force = false) {
  if (flight) return flight;
  if (!force && cached && Date.now() - refreshedAt < 15_000) return Promise.resolve(cached);
  flight = strategyRequest<StrategyState>('/state').then(data => { cached = data; refreshedAt = Date.now(); return data; }).finally(() => { flight = null; });
  return flight;
}
export async function strategyRequest<T>(suffix: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/stock-strategy${suffix}`, {
    ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    cache: 'no-store', signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || '策略研究暂时不可用');
  return data as T;
}
