export const TERMINAL_REGIONAL_INDICES = [
  { id: 'china', name: '上证指数', symbol: '000001.SS', sina: 'sh000001', tencent: 'sh000001',
    sourceUrl: 'https://finance.sina.com.cn/realstock/company/sh000001/nc.shtml' },
  { id: 'hongkong', name: '恒生指数', symbol: '^HSI', sina: 'rt_hkHSI', tencent: 'hkHSI',
    sourceUrl: 'https://stock.finance.sina.com.cn/hkstock/quotes/HSI.html' },
] as const;

export type TerminalRegionalQuote = {
  id: string; name: string; symbol: string; price: number; changePercent: number;
  updatedAt?: string; sourceUrl: string;
};

export function validTerminalRegionalQuote(quote: TerminalRegionalQuote, now = Date.now()) {
  if (!quote || typeof quote !== 'object') return false;
  const config = TERMINAL_REGIONAL_INDICES.find(item => item.id === quote.id);
  const timestamp = Date.parse(quote.updatedAt || '');
  return Boolean(config && quote.symbol === config.symbol && Number.isFinite(quote.price) && quote.price > 0
    && Number.isFinite(quote.changePercent) && Math.abs(quote.changePercent) <= 100
    && Number.isFinite(timestamp) && timestamp <= now + 60_000 && now - timestamp <= 7 * 86400_000);
}

/** Both views use the same complete quote, while retaining globe history/location. */
export function reconcileTerminalRegionalIndices<M extends TerminalRegionalQuote, T extends TerminalRegionalQuote>(markets: M[], ticker: T[]) {
  const latest = new Map<string, TerminalRegionalQuote>();
  for (const quote of [...markets, ...ticker]) {
    if (!validTerminalRegionalQuote(quote)) continue;
    const previous = latest.get(quote.id);
    if (!previous || Date.parse(quote.updatedAt!) >= Date.parse(previous.updatedAt!)) latest.set(quote.id, quote);
  }
  const apply = <R extends TerminalRegionalQuote>(quote: R): R => {
    const config = TERMINAL_REGIONAL_INDICES.find(item => item.id === quote.id);
    if (!config) return quote;
    const canonical = latest.get(quote.id);
    return { ...quote, name: config.name, symbol: config.symbol, ...(canonical ? {
      price: canonical.price, changePercent: canonical.changePercent,
      updatedAt: canonical.updatedAt, sourceUrl: canonical.sourceUrl,
    } : {}) };
  };
  return { markets: markets.map(apply), ticker: ticker.map(apply) };
}
