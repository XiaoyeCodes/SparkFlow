export type CryptoMarketUniverseRow = {
  id: string;
  symbol: string;
  name: string;
  image?: string;
  current_price: number;
  market_cap: number;
  market_cap_rank?: number;
  price_change_percentage_24h?: number;
  last_updated?: string;
  sourceUrl: string;
};

export type CryptoMarketTickerRow = {
  symbol: string;
  price: number;
  openPrice?: number;
  updatedAt?: string;
};

type CoinGeckoMarketRow = {
  id?: unknown;
  symbol?: unknown;
  name?: unknown;
  image?: unknown;
  current_price?: unknown;
  market_cap?: unknown;
  market_cap_rank?: unknown;
  price_change_percentage_24h?: unknown;
  last_updated?: unknown;
};

type CoinPaprikaMarketRow = {
  id?: unknown;
  symbol?: unknown;
  name?: unknown;
  rank?: unknown;
  last_updated?: unknown;
  quotes?: { USD?: { price?: unknown; market_cap?: unknown; percent_change_24h?: unknown } };
};

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function requiredText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseCoinGeckoMarketUniverse(payload: unknown): CryptoMarketUniverseRow[] {
  if (!Array.isArray(payload)) return [];
  return (payload as CoinGeckoMarketRow[]).flatMap((row) => {
    const id = requiredText(row.id);
    const symbol = requiredText(row.symbol).toUpperCase();
    const name = requiredText(row.name);
    const currentPrice = finiteNumber(row.current_price);
    const marketCap = finiteNumber(row.market_cap);
    if (!id || !symbol || !name || currentPrice === undefined || !marketCap || marketCap <= 0) return [];
    const image = requiredText(row.image);
    const lastUpdated = requiredText(row.last_updated);
    return [{
      id,
      symbol,
      name,
      ...(image ? { image } : {}),
      current_price: currentPrice,
      market_cap: marketCap,
      market_cap_rank: finiteNumber(row.market_cap_rank),
      price_change_percentage_24h: finiteNumber(row.price_change_percentage_24h),
      ...(lastUpdated ? { last_updated: lastUpdated } : {}),
      sourceUrl: `https://www.coingecko.com/zh/\u6570\u5b57\u8d27\u5e01/${encodeURIComponent(id)}`,
    }];
  });
}

export function parseCoinPaprikaMarketUniverse(payload: unknown): CryptoMarketUniverseRow[] {
  if (!Array.isArray(payload)) return [];
  return (payload as CoinPaprikaMarketRow[]).flatMap((row) => {
    const id = requiredText(row.id);
    const symbol = requiredText(row.symbol).toUpperCase();
    const name = requiredText(row.name);
    const quote = row.quotes?.USD;
    const currentPrice = finiteNumber(quote?.price);
    const marketCap = finiteNumber(quote?.market_cap);
    if (!id || !symbol || !name || currentPrice === undefined || !marketCap || marketCap <= 0) return [];
    const lastUpdated = requiredText(row.last_updated);
    return [{
      id,
      symbol,
      name,
      image: `https://static.coinpaprika.com/coin/${encodeURIComponent(id)}/logo.png`,
      current_price: currentPrice,
      market_cap: marketCap,
      market_cap_rank: finiteNumber(row.rank),
      price_change_percentage_24h: finiteNumber(quote?.percent_change_24h),
      ...(lastUpdated ? { last_updated: lastUpdated } : {}),
      sourceUrl: `https://coinpaprika.com/coin/${encodeURIComponent(id)}/`,
    }];
  });
}

export function parseBinanceMarketTickers(payload: unknown): CryptoMarketTickerRow[] {
  if (!Array.isArray(payload)) return [];
  return (payload as Array<Record<string, unknown>>).flatMap((row) => {
    const pair = requiredText(row.symbol).toUpperCase();
    const price = finiteNumber(row.lastPrice);
    if (!pair.endsWith('USDT') || pair.length <= 4 || price === undefined) return [];
    const closeTime = finiteNumber(row.closeTime);
    return [{
      symbol: pair.slice(0, -4),
      price,
      openPrice: finiteNumber(row.openPrice),
      ...(closeTime ? { updatedAt: new Date(closeTime).toISOString() } : {}),
    }];
  });
}

export function parseOkxMarketTickers(payload: unknown): CryptoMarketTickerRow[] {
  const rows = payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
    ? (payload as { data: Array<Record<string, unknown>> }).data
    : [];
  return rows.flatMap((row) => {
    const pair = requiredText(row.instId).toUpperCase();
    const price = finiteNumber(row.last);
    if (!pair.endsWith('-USDT') || pair.length <= 5 || price === undefined) return [];
    const timestamp = finiteNumber(row.ts);
    return [{
      symbol: pair.slice(0, -5),
      price,
      openPrice: finiteNumber(row.open24h),
      ...(timestamp ? { updatedAt: new Date(timestamp).toISOString() } : {}),
    }];
  });
}
