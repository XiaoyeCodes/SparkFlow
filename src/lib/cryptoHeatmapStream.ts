export type CryptoMiniTicker = {
  symbol: string;
  price: number;
  openPrice: number;
  updatedAt: string;
};

function numberOrUndefined(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function parseCryptoMiniTickerMessage(payload: unknown): CryptoMiniTicker[] {
  const unwrapped = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as { data?: unknown }).data
    : payload;
  if (!Array.isArray(unwrapped)) return [];
  return (unwrapped as Array<Record<string, unknown>>).flatMap((row) => {
    const pair = typeof row.s === 'string' ? row.s.trim().toUpperCase() : '';
    const price = numberOrUndefined(row.c);
    const openPrice = numberOrUndefined(row.o);
    const eventTime = numberOrUndefined(row.E);
    if (!pair.endsWith('USDT') || pair.length <= 4 || price === undefined || openPrice === undefined || openPrice <= 0) return [];
    return [{
      symbol: pair.slice(0, -4),
      price,
      openPrice,
      updatedAt: new Date(eventTime || Date.now()).toISOString(),
    }];
  });
}

export function mergeCryptoMiniTickers<T extends {
  code: string;
  price: number;
  changePercent: number;
  updatedAt?: string;
}>(stocks: T[], tickers: Iterable<CryptoMiniTicker>) {
  const bySymbol = new Map(Array.from(tickers, (ticker) => [ticker.symbol, ticker]));
  let changed = false;
  let latestUpdatedAt = '';
  const nextStocks = stocks.map((stock) => {
    const ticker = bySymbol.get(stock.code);
    if (!ticker) return stock;
    if (ticker.updatedAt > latestUpdatedAt) latestUpdatedAt = ticker.updatedAt;
    const changePercent = (ticker.price - ticker.openPrice) / ticker.openPrice * 100;
    if (ticker.price === stock.price && Math.abs(changePercent - stock.changePercent) < 0.000001) return stock;
    changed = true;
    return { ...stock, price: ticker.price, changePercent, updatedAt: ticker.updatedAt };
  });
  return { stocks: nextStocks, changed, latestUpdatedAt };
}
