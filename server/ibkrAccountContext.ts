const contextReads = new Set([
  '/api/ibkr-terminal/analysis/risk',
  '/api/ibkr-terminal/ai/status',
  '/api/ibkr-terminal/market-data',
]);

/** Server proxy boundary only. Consent creation is intentionally unavailable. */
export function allowedIbkrAccountContextRequest(method: string | undefined, pathname: string) {
  if (method === 'GET' && contextReads.has(pathname)) return true;
  if (method === 'GET' && /^\/api\/ibkr-terminal\/strategy-runtime(?:\/activation(?:%3A|:)[0-9a-f]{32}\/decisions)?$/i.test(pathname)) return true;
  return method === 'POST' && /^\/api\/ibkr-terminal\/strategy-runtime\/activation(?:%3A|:)[0-9a-f]{32}\/stop$/i.test(pathname);
}
