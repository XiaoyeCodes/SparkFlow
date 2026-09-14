import { REALTIME_QUOTE_INTERVAL_MS } from './publicDataPolicy.ts';

/** Fixed cadence, one in-flight poll, immediate visibility recovery. */
export function startQuotePolling(task: (signal: AbortSignal) => Promise<void>) {
  const controller = new AbortController();
  let running = false;
  const poll = async () => {
    if (controller.signal.aborted || document.hidden || running) return;
    running = true;
    try { await task(controller.signal); }
    catch { /* Keep last-good UI; the next tick retries without overlapping. */ }
    finally { running = false; }
  };
  const resume = () => { if (!document.hidden) void poll(); };
  const timer = setInterval(() => void poll(), REALTIME_QUOTE_INTERVAL_MS);
  document.addEventListener('visibilitychange', resume);
  void poll();
  return () => {
    controller.abort();
    clearInterval(timer);
    document.removeEventListener('visibilitychange', resume);
  };
}

export function mergeQuoteRows<T extends { id: string; updatedAt?: string }>(current: T[], incoming: T[]) {
  const rows = new Map(current.map(item => [item.id, item]));
  incoming.forEach(item => {
    const previous = rows.get(item.id);
    const before = Date.parse(previous?.updatedAt || '') || 0;
    const after = Date.parse(item.updatedAt || '') || 0;
    if (!previous || after >= before) rows.set(item.id, { ...previous, ...item });
  });
  return [...rows.values()];
}
