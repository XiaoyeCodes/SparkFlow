import type { PaperContract, PaperQuote } from '../src/lib/ibkr/workbenchTypes.ts';
import type { JsonFetcher } from './ibkrMarket.ts';

// f530 requests the order-book group; individual level fields alone can be omitted by upstream.
const fields = 'f57,f58,f59,f43,f44,f45,f46,f47,f48,f60,f86,f114,f115,f162,f170,f530,f19,f20,f17,f18,f15,f16,f39,f40,f37,f38,f35,f36';
export const ticketQuoteUrl = (secid: string) => `https://push2.eastmoney.com/api/qt/stock/get?${new URLSearchParams({ secid, fltt: '2', fields })}`;
export const tencentTicketQuoteUrl = (ticker: string) => `https://web.ifzq.gtimg.cn/appstock/app/usfqkline/get?${new URLSearchParams({ param: `${ticker},day,,,2,qfq` })}`;
const positive = (v: unknown) => (typeof v === 'number' || typeof v === 'string' && v.trim() !== '') && Number.isFinite(Number(v)) && Number(v) > 0 ? String(v) : null;
const quoteSymbol = (symbol: string) => symbol.replace(/[ .]/g, '_');
const tencentSymbol = (symbol: string) => symbol.replace(/[ _]/g, '.');

export function mergeBrokerTicketQuote(reference: PaperQuote, broker: Partial<PaperQuote>): PaperQuote {
  if (broker.conId !== reference.conId || broker.currency !== 'USD'
    || quoteSymbol(String(broker.symbol || '')) !== quoteSymbol(reference.symbol)) return reference;
  const bid = positive(broker.bid), ask = positive(broker.ask), last = positive(broker.last);
  if (!bid && !ask && !last) return reference;
  const brokerLevels = (side: 'bids'|'asks', price: string|null) => price
    ? [{ level: 1, price, size: null }, { level: 2, price: null, size: null }, { level: 3, price: null, size: null }]
    : reference[side];
  return {
    ...reference,
    bid: bid ?? reference.bid,
    ask: ask ?? reference.ask,
    last: last ?? reference.last,
    minTick: positive(broker.minTick) ?? reference.minTick,
    state: typeof broker.state === 'string' && broker.state !== 'missing' ? broker.state : reference.state,
    regularHours: typeof broker.regularHours === 'boolean' ? broker.regularHours : reference.regularHours,
    nextOpen: broker.nextOpen ?? reference.nextOpen,
    fetchedAt: typeof broker.fetchedAt === 'string' ? broker.fetchedAt : reference.fetchedAt,
    source: `IBKR Gateway（下单参考） · ${reference.source}（扩展数据）`,
    bids: brokerLevels('bids', bid),
    asks: brokerLevels('asks', ask),
    detail: `下单价格优先采用 IBKR Gateway 买卖价；开高低、成交量和估值继续采用${reference.source}。发送前仍会由 IBKR 重新校验。`,
  };
}

function newYorkTimestamp(value: unknown, now: number) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return null;
  const [date, time] = value.split(' '), [year, month, day] = date.split('-').map(Number), [hour, minute, second] = time.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  for (const offset of [4, 5]) {
    const candidate = wall + offset * 3600000;
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map(part => [part.type, part.value]));
    if (`${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}` === value && candidate <= now + 60000) return new Date(candidate).toISOString();
  }
  return null;
}

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
    open:positive(row.f46),volume:positive(row.f47),amount:positive(row.f48),peDynamic:positive(row.f115) || positive(row.f162),peStatic:positive(row.f114),
    high: positive(row.f44), low: positive(row.f45), bid: bids[0].price, ask: asks[0].price,
    minTick: null, state: last || close ? 'reference' : 'missing', fetchedAt: new Date(now).toISOString(),
    asOf: stamp ? new Date(stamp).toISOString() : null, source: '东方财富',
    sourceUrl: `https://quote.eastmoney.com/us/${encodeURIComponent(quoteSymbol(contract.symbol))}.html`,
    regularHours: null, nextOpen: null, bids, asks,
    detail: '每 5 秒刷新；上游未保证实时性。买卖档位仅展示实际返回值，成交价格以 IBKR 回报为准。' };
}

export function parseTencentTicketQuote(raw: any, contract: PaperContract, now = Date.now()): PaperQuote {
  const ticker = `us${tencentSymbol(contract.symbol)}`;
  const row = raw?.data?.[ticker]?.qt?.[ticker];
  const identity = Array.isArray(row) ? row[2] : null;
  const suffix = typeof identity === 'string' ? identity.match(/\.(N|OQ|AM|P|Z)$/)?.[1] : null;
  const symbol = typeof identity === 'string' ? identity.replace(/\.(N|OQ|AM|P|Z)$/, '') : '';
  const venue = contract.exchange?.toUpperCase();
  const venueMatches = !venue || venue === 'SMART'
    || (['NASDAQ', 'ISLAND'].includes(venue) && suffix === 'OQ')
    || (venue === 'NYSE' && suffix === 'N')
    || (['ARCA', 'NYSEARCA', 'AMEX'].includes(venue) && ['AM', 'P'].includes(suffix || ''));
  if (raw?.code !== 0 || !Array.isArray(row) || row[35] !== 'USD' || tencentSymbol(symbol) !== tencentSymbol(contract.symbol) || !suffix || !venueMatches) throw new Error('腾讯财经未返回匹配的美元股票行情');
  const last = positive(row[3]), close = positive(row[4]);
  const emptyDepth = [1, 2, 3].map(level => ({ level, price: null, size: null }));
  return { ...contract, name: String(row[46] || row[1] || contract.name || contract.symbol), last, close,
    open: positive(row[5]), volume: positive(row[6]), amount: positive(row[37]), peDynamic: positive(row[39]), peStatic: positive(row[41]),
    high: positive(row[33]), low: positive(row[34]), bid: null, ask: null,
    minTick: null, state: last || close ? 'reference' : 'missing', fetchedAt: new Date(now).toISOString(),
    asOf: newYorkTimestamp(row[30], now), source: '腾讯财经（备用）',
    sourceUrl: `https://gu.qq.com/${encodeURIComponent(ticker)}`,
    regularHours: null, nextOpen: null, bids: emptyDepth, asks: emptyDepth.map(level => ({ ...level })),
    detail: '东方财富不可用，已切换腾讯财经参考行情；上游未保证实时性，成交价格以 IBKR 回报为准。' };
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
        if (matched.length > 1) throw new Error('股票匹配不唯一，请确认上市交易所');
        const value = matched.length === 1 ? matched[0] : parseTencentTicketQuote(await this.get(tencentTicketQuoteUrl(`us${tencentSymbol(contract.symbol)}`)), contract);
        this.cache.set(key,{at:Date.now(),value});
        if (this.cache.size > 50) this.cache.delete(this.cache.keys().next().value!);
        return value;
      } catch (e) {
        if (cached) return {...cached.value,state:'stale',detail:'东方财富刷新失败，保留上次报价；请留意报价时间。'};
        throw e;
      } finally { this.flights.delete(key); }
    })();
    this.flights.set(key,flight);
    return flight;
  }
}
