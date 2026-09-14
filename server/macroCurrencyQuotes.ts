// Sina's currency feed carries a source date and Beijing-local quote time.
// Field 8 is the last/reference price; fields 1/2 are bid/ask, not last.
export const SINA_CURRENCY_CODES = ['DINIW', 'fx_susdjpy', 'fx_susdcny', 'fx_susdeur'] as const;
export const SINA_US10Y_CODE = 'globalbd_us10yt';

// The bond feed differs from FX: field 3 is yield (%), 2 is previous close,
// and 11 is Unix seconds. Its display clock is not Beijing-local time.
export function parseSinaUs10yQuote(text: string) {
  const fields = text.match(/var\s+hq_str_globalbd_us10yt="([^"]*)"/)?.[1]?.split(',') || [];
  const price = Number(fields[3]);
  const previous = Number(fields[2]);
  const timestamp = Number(fields[11]);
  if (!fields[3]?.trim() || !fields[2]?.trim()
    || !Number.isFinite(price) || price <= 0
    || !Number.isFinite(previous) || previous <= 0
    || !Number.isSafeInteger(timestamp) || timestamp <= 0
    || timestamp * 1000 > Date.now() + 60_000) return;
  return {
    symbol: 'US10YT', price, change: price - previous,
    changePercent: (price / previous - 1) * 100,
    updatedAt: new Date(timestamp * 1000).toISOString(),
    sourceUrl: 'https://stock.finance.sina.com.cn/forex/globalbd/us10yt.html',
  };
}

export function currencyQuoteTime(date: string, time: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}:\d{2}$/.test(time || '')) return;
  const parsed = Date.parse(`${date}T${time}+08:00`);
  if (!Number.isFinite(parsed)) return;
  // Reject silently normalized dates, e.g. February 30.
  if (new Date(parsed + 8 * 3600_000).toISOString().slice(0, 19) !== `${date}T${time}`) return;
  return new Date(parsed).toISOString();
}

export function parseSinaCurrencyQuotes(text: string) {
  const configs = [
    { id: 'dxy', code: 'DINIW', symbol: 'DX-Y.NYB', dateIndex: 10 },
    { id: 'usd-jpy', code: 'fx_susdjpy', symbol: 'JPY=X', dateIndex: 17 },
    { id: 'usd-cny', code: 'fx_susdcny', symbol: 'CNY=X', dateIndex: 17 },
    // Already USD/EUR: do not invert it again like Yahoo's EURUSD=X.
    { id: 'usd-eur', code: 'fx_susdeur', symbol: 'USDEUR', dateIndex: 17 },
  ];
  return new Map(configs.flatMap(config => {
    const fields = text.match(new RegExp(`var\\s+hq_str_${config.code}="([^"]*)"`))?.[1]?.split(',') || [];
    const price = Number(fields[8]);
    const previous = Number(fields[3]);
    const updatedAt = currencyQuoteTime(fields[config.dateIndex], fields[0]);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(previous) || previous <= 0 || !updatedAt) return [];
    return [[config.id, { symbol: config.symbol, price, change: price - previous,
      changePercent: (price / previous - 1) * 100, updatedAt,
      sourceUrl: `https://finance.sina.com.cn/money/forex/hq/${config.code === 'DINIW' ? 'DINIW' : config.code.slice(4).toUpperCase()}.shtml`,
    }] as const];
  }));
}
