import type { Holding, MarketQuote } from '../src/lib/ibkr/workbenchTypes.ts';
import { numeric } from './ibkrWorkbenchCore.ts';

export type JsonFetcher = (url: string) => Promise<any>;
export function eastmoneyBatchUrl(secids: string[]) {
  return `https://push2.eastmoney.com/api/qt/ulist.np/get?${new URLSearchParams({ fltt: '2', secids: secids.join(','), fields: 'f12,f13,f14,f2,f3,f124' })}`;
}
export function parseEastmoneyRow(row: Record<string, unknown>) {
  const stamp = numeric(row.f124);
  return { symbol: String(row.f12 ?? '').toUpperCase(), secid: `${row.f13}.${row.f12}`, name: String(row.f14 ?? ''), price: numeric(row.f2), changePercent: numeric(row.f3), asOf: stamp && stamp > 0 && stamp * 1000 <= Date.now() + 60000 ? new Date(stamp * 1000).toISOString() : null };
}
export function secidCandidates(p: Holding): string[] {
  if (p.currency !== 'USD' || p.assetType !== 'STK' || !/^[A-Z0-9.\-]{1,20}$/.test(p.symbol)) return [];
  const exchange = p.exchange?.toUpperCase();
  const market = exchange === 'NASDAQ' || exchange === 'ISLAND' ? '105' : exchange === 'NYSE' ? '106' : ['ARCA', 'AMEX', 'NYSEARCA'].includes(exchange ?? '') ? '107' : null;
  // Unknown listing venue is resolved by exact symbol across exchanges; multiple matches stay unmapped.
  return (market ? [market] : ['105', '106', '107']).map(code => `${code}.${p.symbol}`);
}
export class IbkrMarket {
  private cache = new Map<string, { at: number; value: MarketQuote[] }>();
  private flights = new Map<string, Promise<MarketQuote[]>>();
  constructor(private get: JsonFetcher) {}
  quotes(positions: Holding[]): Promise<MarketQuote[]> {
    const key = JSON.stringify(positions.map(p => [p.conId, p.symbol, p.exchange, p.assetType, p.currency]));
    const cached = this.cache.get(key); if (cached && Date.now() - cached.at < 5000) return Promise.resolve(cached.value);
    const flight = this.flights.get(key); if (flight) return flight;
    const request = this.fetchQuotes(positions).then(value => { this.cache.set(key, { at: Date.now(), value }); if (this.cache.size > 30) this.cache.delete(this.cache.keys().next().value!); return value; }).catch(() => cached ? cached.value.map(q => ({ ...q, status: 'stale' as const })) : positions.map(p => this.empty(p))).finally(() => this.flights.delete(key));
    this.flights.set(key, request); return request;
  }
  private empty(p: Holding): MarketQuote { return { conId: p.conId, symbol: p.symbol, price: null, changePercent: null, asOf: null, fetchedAt: new Date().toISOString(), source: '东方财富', status: secidCandidates(p).length ? 'missing' : 'unsupported', currency: p.currency, sourceUrl: `https://quote.eastmoney.com/us/${encodeURIComponent(p.symbol)}.html` }; }
  private async fetchQuotes(positions: Holding[]) {
    const secids = [...new Set(positions.flatMap(secidCandidates))]; const rows: ReturnType<typeof parseEastmoneyRow>[] = [];
    for (let start = 0; start < secids.length; start += 60) {
      const payload = await this.get(eastmoneyBatchUrl(secids.slice(start, start + 60)));
      if (!Array.isArray(payload?.data?.diff)) throw new Error('行情源暂不可用');
      rows.push(...payload.data.diff.map(parseEastmoneyRow));
    }
    return positions.map(p => {
      const candidates = rows.filter(r => secidCandidates(p).includes(r.secid) && r.symbol === p.symbol && r.price !== null && r.price > 0);
      if (candidates.length !== 1) return { ...this.empty(p), status: secidCandidates(p).length ? 'unmapped' as const : 'unsupported' as const };
      const r = candidates[0]; return { ...this.empty(p), ...r, status: r.asOf ? 'delayed' as const : 'missing' as const };
    });
  }
  async history(quote: MarketQuote, period: string) {
    if (!quote.secid || !/^(105|106|107)\.[A-Z0-9.\-]{1,20}$/.test(quote.secid)) throw new Error('合约行情尚未匹配');
    const ranges: Record<string, [string, string]> = { '1D': ['5', '80'], '5D': ['30', '100'], '1M': ['101', '22'], '6M': ['101', '130'], '1Y': ['101', '260'] };
    if (!ranges[period]) throw new Error('无效行情周期');
    const [klt, lmt] = ranges[period];
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?${new URLSearchParams({ secid: quote.secid, fields1: 'f1,f2,f3,f4,f5,f6', fields2: 'f51,f52,f53,f54,f55,f56', klt, fqt: '0', end: '20500101', lmt })}`;
    const raw = await this.get(url);
    const bars = (raw?.data?.klines ?? []).flatMap((line: string) => {
      const [time, o, c, h, l, v] = line.split(','); const values = [o, c, h, l, v].map(numeric);
      if (!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(time) || values.some(v => v === null) || Number(h) < Math.max(Number(o), Number(c)) || Number(l) > Math.min(Number(o), Number(c))) return [];
      return [{ time, open: Number(o), close: Number(c), high: Number(h), low: Number(l), volume: Number(v) }];
    });
    return { bars, source: '东方财富', sourceUrl: url, adjustment: '不复权', timeZone: '上游时间原样展示', fetchedAt: new Date().toISOString(), status: bars.length ? 'delayed' : 'missing' };
  }
}
