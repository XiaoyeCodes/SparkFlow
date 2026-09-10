import type { PaperContract, PaperQuote } from '../src/lib/ibkr/workbenchTypes.ts';
import type { JsonFetcher } from './ibkrMarket.ts';

// f530 requests the order-book group; individual level fields alone can be omitted by upstream.
const fields = 'f57,f58,f59,f43,f44,f45,f46,f47,f48,f60,f86,f170,f530,f19,f20,f17,f18,f15,f16,f39,f40,f37,f38,f35,f36';
export const ticketQuoteUrl = (secid: string) => `https://push2.eastmoney.com/api/qt/stock/get?${new URLSearchParams({ secid, fltt: '2', fields })}`;
const positive = (v: unknown) => (typeof v === 'number' || typeof v === 'string' && v.trim() !== '') && Number.isFinite(Number(v)) && Number(v) > 0 ? String(v) : null;
const quoteSymbol = (symbol: string) => symbol.replace(/[ .]/g, '_');

export function parseTicketQuote(raw: any, contract: PaperContract, now = Date.now()): PaperQuote {
  const row = raw?.data;
  if (raw?.rc !== 0 || !row || typeof row.f57 !== 'string' || quoteSymbol(row.f57) !== quoteSymbol(contract.symbol)) throw new Error('东方财富未返回匹配的股票行情');
  const stamp = typeof row.f86 === 'number' && Number.isFinite(row.f86) && row.f86 > 0 && row.f86 * 1000 <= now + 60000 ? row.f86 * 1000 : null;
  const level = (side: 'buy'|'sell', index: number) => {
    const field = side === 'buy' ? 19 - index * 2 : 39 - index * 2;
    const price = positive(row[`f${field}`]);
    // Upstream volume units are not assumed to be shares; omitted quantities remain unavailable.
    return { level: index + 1, price, size: price ? positive(row[`f${field + 1}`]) : null };
  };
  const bids = [0,1,2].map(i => level('buy', i)), asks = [0,1,2].map(i => level('sell', i));
  const last = positive(row.f43), close = positive(row.f60);
  return { ...contract, name: String(row.f58 || contract.name || contract.symbol), last, close,
    open:positive(row.f46),volume:positive(row.f47),amount:positive(row.f48),
    high: positive(row.f44), low: positive(row.f45), bid: bids[0].price, ask: asks[0].price,
    minTick: null, state: last || close ? 'reference' : 'missing', fetchedAt: new Date(now).toISOString(),
    asOf: stamp ? new Date(stamp).toISOString() : null, source: '东方财富',
    sourceUrl: `https://quote.eastmoney.com/us/${encodeURIComponent(quoteSymbol(contract.symbol))}.html`,
    regularHours: null, nextOpen: null, bids, asks,
    detail: '每 5 秒刷新；上游未保证实时性。买卖档位仅展示实际返回值，成交价格以 IBKR 回报为准。' };
}

export class EastmoneyTicketQuotes {
  private cache = new Map<string, { at: number; value: PaperQuote }>();
  private flights = new Map<string, Promise<PaperQuote>>();
  constructor(private get: JsonFetcher) {}
  async quote(contract: PaperContract) {
    if (contract.currency !== 'USD' || !/^[A-Z0-9][A-Z0-9. _\-]{0,19}$/.test(contract.symbol)) throw new Error('仅支持美元美股与 ETF 行情');
    const venue = contract.exchange?.toUpperCase();
    const market = ['NASDAQ','ISLAND'].includes(venue || '') ? '105' : venue === 'NYSE' ? '106' : ['ARCA','AMEX','NYSEARCA'].includes(venue || '') ? '107' : null;
    const key = JSON.stringify([contract.conId,contract.symbol,market]);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < 4000) return cached.value;
    if (this.flights.has(key)) return this.flights.get(key)!;
    const flight = (async () => {
      try {
        const results = await Promise.allSettled((market ? [market] : ['105','106','107']).map(async venue => parseTicketQuote(await this.get(ticketQuoteUrl(`${venue}.${quoteSymbol(contract.symbol)}`)),contract)));
        const matched = results.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
        if (matched.length !== 1) throw new Error(matched.length > 1 ? '股票匹配不唯一，请确认上市交易所' : '东方财富行情暂不可用');
        this.cache.set(key,{at:Date.now(),value:matched[0]});
        if (this.cache.size > 50) this.cache.delete(this.cache.keys().next().value!);
        return matched[0];
      } catch (e) {
        if (cached) return {...cached.value,state:'stale',detail:'东方财富刷新失败，保留上次报价；请留意报价时间。'};
        throw e;
      } finally { this.flights.delete(key); }
    })();
    this.flights.set(key,flight);
    return flight;
  }
}
