import { currencyQuoteTime } from './macroCurrencyQuotes.ts';

export const SINA_CORE_INDEX_CONFIGS = [
  { id: 'nasdaq', code: 'gb_$ndx', symbol: '^NDX', sourceUrl: 'https://stock.finance.sina.com.cn/usstock/quotes/.NDX.html' },
  { id: 'sp500', code: 'gb_$inx', symbol: '^GSPC', sourceUrl: 'https://stock.finance.sina.com.cn/usstock/quotes/.INX.html' },
  { id: 'shanghai', code: 'sh000001', symbol: '000001.SS', sourceUrl: 'https://finance.sina.com.cn/realstock/company/sh000001/nc.shtml' },
  { id: 'sox', code: 'gb_sox', symbol: '^SOX', sourceUrl: 'https://stock.finance.sina.com.cn/usstock/quotes/SOX.html' },
] as const;

export function parseSinaCoreIndexQuotes(text: string) {
  const rows = new Map([...text.matchAll(/var\s+hq_str_([^=\s]+)="([^"]*)"/g)]
    .map(match => [match[1], match[2].split(',')]));
  const number = (value?: string) => value?.trim() && Number.isFinite(Number(value)) ? Number(value) : undefined;
  return new Map(SINA_CORE_INDEX_CONFIGS.flatMap(config => {
    const fields = rows.get(config.code) || [];
    const domestic = config.id === 'shanghai';
    const price = number(fields[domestic ? 3 : 1]);
    const previous = number(fields[2]);
    const change = domestic && price !== undefined && previous !== undefined ? price - previous : number(fields[4]);
    const changePercent = domestic && change !== undefined && previous && previous > 0
      ? change / previous * 100 : domestic ? undefined : number(fields[2]);
    // Before a US session Sina may reset change/open/high/low to zero while
    // carrying the previous close in price. This is not a flat trading session.
    // Require the full placeholder signature; a real 0% with an open is valid.
    const awaitingSession = !domestic && change === 0 && changePercent === 0
      && [5, 6, 7].every(index => number(fields[index]) === 0)
      && number(fields[26]) === price;
    if (awaitingSession) return [];
    // US feed field 3 is the provider's Beijing-local timestamp, unlike US10YT.
    const [date, time] = domestic ? [fields[30], fields[31]] : (fields[3] || '').split(' ');
    const updatedAt = currencyQuoteTime(date, time);
    if (price === undefined || price <= 0 || change === undefined || changePercent === undefined || !updatedAt
      || (domestic && (!previous || previous <= 0)) || Date.parse(updatedAt) > Date.now() + 60_000) return [];
    return [[config.id, { symbol: config.symbol, price, change, changePercent, updatedAt, sourceUrl: config.sourceUrl }] as const];
  }));
}

// Cold-start/failed fast-source fallback: derive the last published daily
// session's change from its own two closing observations, never today's zero.
export function coreIndexHistoryQuote(
  symbol: string,
  history: Array<{ time: string; value: number }>,
  now = Date.now(),
) {
  const points = history.filter(point => Number.isFinite(point.value) && point.value > 0
    && Number.isFinite(Date.parse(point.time)) && Date.parse(point.time) <= now)
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const latest = points.at(-1);
  const previous = points.slice(0, -1).reverse().find(point => latest && point.time !== latest.time);
  if (!latest || !previous || now - Date.parse(latest.time) > 14 * 86400_000) return;
  return { symbol, price: latest.value, change: latest.value - previous.value,
    changePercent: (latest.value / previous.value - 1) * 100, updatedAt: latest.time,
    sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}` };
}
