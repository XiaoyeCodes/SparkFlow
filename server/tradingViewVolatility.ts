export const TRADINGVIEW_VOLATILITY_COLUMNS = ['close', 'change_abs', 'time|1', 'update_mode'] as const;

export function parseTradingViewVolatility(payload: unknown, id: 'vix' | 'vxn', now = Date.now()) {
  const ticker = `CBOE:${id.toUpperCase()}`;
  const data = (payload as { data?: Array<{ s?: string; d?: unknown[] }> } | null)?.data;
  const row = Array.isArray(data) ? data.find(item => item.s === ticker) : undefined;
  const [value, change, timestamp, updateMode] = row?.d || [];
  // Use the latest one-minute bar's source time, never the HTTP fetch time.
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0
    || typeof change !== 'number' || !Number.isFinite(change)
    || typeof timestamp !== 'number' || !Number.isFinite(timestamp)
    || timestamp * 1000 > now + 60_000 || now - timestamp * 1000 > 7 * 86400_000) {
    throw new Error(`TradingView ${ticker} 报价缺失或过期`);
  }
  return {
    value, change, display: value.toFixed(2),
    updatedAt: new Date(timestamp * 1000).toISOString(),
    sourceUrl: `https://www.tradingview.com/symbols/CBOE-${id.toUpperCase()}/`,
    // Public Cboe index quotes are delayed, even if a scanner omits update_mode.
    status: 'delayed' as const,
    provider: 'TradingView' as const,
    sourceDelaySeconds: Math.max(900, Number(String(updateMode).match(/delayed_streaming_(\d+)/)?.[1] || 900)),
    history: [] as Array<{ time: string; value: number }>,
  };
}
