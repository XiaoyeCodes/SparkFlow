import { currencyQuoteTime } from './macroCurrencyQuotes.ts';
export type GlobalEquityQuote = { symbol: string; price: number; change: number; changePercent: number; updatedAt: string; sourceUrl: string };
const number = (raw?: string) => raw?.trim() && Number.isFinite(Number(raw)) ? Number(raw) : undefined;
export function validGlobalEquityQuote(quote: GlobalEquityQuote | undefined, now = Date.now()) {
  return quote && quote.symbol === 'VT' && Number.isFinite(quote.price) && quote.price > 0
    && Number.isFinite(quote.change) && Number.isFinite(quote.changePercent)
    && Number.isFinite(Date.parse(quote.updatedAt)) && Date.parse(quote.updatedAt) <= now + 60_000
    && now - Date.parse(quote.updatedAt) < 7 * 86400_000 ? quote : undefined;
}
export function parseSinaVtQuote(text: string, now = Date.now()) {
  const fields = text.match(/hq_str_gb_vt="([^"]*)"/)?.[1]?.split(',') || [];
  const price = number(fields[1]), changePercent = number(fields[2]), change = number(fields[4]);
  const [date, time] = (fields[3] || '').split(' '), updatedAt = currencyQuoteTime(date, time);
  if (price === undefined || changePercent === undefined || change === undefined || !updatedAt) return;
  if (change === 0 && changePercent === 0 && [5, 6, 7].every(index => number(fields[index]) === 0) && number(fields[26]) === price) return;
  return validGlobalEquityQuote({ symbol: 'VT', price, change, changePercent, updatedAt,
    sourceUrl: 'https://stock.finance.sina.com.cn/usstock/quotes/VT.html' }, now);
}
export function parseTencentVtQuote(text: string, timestamp: (raw: string, symbol: string) => string | undefined, now = Date.now()) {
  const fields = text.match(/v_usVT="([^"]*)"/i)?.[1]?.split('~') || [];
  const price = number(fields[3]), change = number(fields[31]), changePercent = number(fields[32]);
  let updatedAt: string | undefined;
  try { updatedAt = timestamp(fields[30], 'usVT'); } catch { return; }
  if (price === undefined || change === undefined || changePercent === undefined || !updatedAt) return;
  return validGlobalEquityQuote({ symbol: 'VT', price, change, changePercent, updatedAt,
    sourceUrl: 'https://gu.qq.com/usVT' }, now);
}
