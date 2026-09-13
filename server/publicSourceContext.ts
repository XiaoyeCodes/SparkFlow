import { AsyncLocalStorage } from 'node:async_hooks';

// Public refreshes must not silently renew a legacy last-good response. The
// context follows only this async call tree; simultaneous private/legacy calls
// keep their original fallback behavior (no process-global mode switch).
const context = new AsyncLocalStorage<boolean>();
export const isPublicSourceRefresh = () => context.getStore() === true;
export function withPublicSourceRefresh<T>(load: () => Promise<T>): Promise<T> {
  return context.run(true, load);
}
