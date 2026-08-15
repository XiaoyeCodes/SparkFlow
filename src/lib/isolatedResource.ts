export const ISOLATED_RESOURCE_TIMEOUT_MS = 30_000;
export const ISOLATED_RESOURCE_MAX_ATTEMPTS = 3;

type IsolatedResourceOptions = {
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : new Error('请求已取消');
}

function waitForRetry(delayMs: number, signal?: AbortSignal) {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      callback();
    };
    const timer = setTimeout(() => finish(resolve), delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      finish(() => reject(abortReason(signal!)));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Fetches exactly one dashboard resource. Each invocation owns its timeout,
 * retry counter and abort controller, so a slow or failed resource cannot
 * block or cancel any sibling card.
 */
export async function requestIsolatedJson<T>(url: string, options: IsolatedResourceOptions = {}) {
  const timeoutMs = options.timeoutMs ?? ISOLATED_RESOURCE_TIMEOUT_MS;
  const maxAttempts = Math.max(1, options.maxAttempts ?? ISOLATED_RESOURCE_MAX_ATTEMPTS);
  const retryDelayMs = options.retryDelayMs ?? 600;
  const fetchImpl = options.fetchImpl ?? fetch;
  let lastError: unknown = new Error('独立数据请求失败');

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.signal?.aborted) throw abortReason(options.signal);
    const controller = new AbortController();
    const onParentAbort = () => controller.abort(abortReason(options.signal!));
    options.signal?.addEventListener('abort', onParentAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error(`请求超过 ${Math.round(timeoutMs / 1000)} 秒`)),
      timeoutMs,
    );

    try {
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      return await response.json() as T;
    } catch (error) {
      if (options.signal?.aborted) throw abortReason(options.signal);
      lastError = error;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onParentAbort);
    }

    if (attempt < maxAttempts) {
      await waitForRetry(retryDelayMs * attempt, options.signal);
    }
  }

  throw lastError;
}
