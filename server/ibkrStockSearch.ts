import type { PaperSearchCandidate } from '../src/lib/ibkr/workbenchTypes.ts';
import type { JsonFetcher } from './ibkrMarket.ts';

export function parseStockSearch(raw: any, query: string): PaperSearchCandidate[] {
  const table = raw?.QuotationCodeTable;
  if (table?.Status !== 0 || !Array.isArray(table.Data)) throw new Error('中文股票搜索暂不可用，请稍后重试或输入股票代码。');
  const seen = new Set<string>();
  return table.Data.flatMap((row: any) => {
    if (row.Classify !== 'UsStock' || !['105','106','107'].includes(String(row.MktNum)) || typeof row.Code !== 'string' || !/^[A-Z][A-Z0-9]{0,14}(?:[_.][A-Z])?$/.test(row.Code) || typeof row.Name !== 'string') return [];
    const symbol = row.Code.replace('_','.');
    if (seen.has(symbol)) return [];
    seen.add(symbol);
    return [{symbol, brokerSymbol: symbol.replace('.', ' '), name: row.Name,
      exchange: ({105:'NASDAQ',106:'NYSE',107:'AMEX'} as Record<string,string>)[String(row.MktNum)], kind: row.TypeUS === '5' ? 'ETF' : '股票'}];
  }).sort((a: PaperSearchCandidate,b: PaperSearchCandidate) => {
    const rank = (r: PaperSearchCandidate) => r.symbol===query.toUpperCase()?0:r.name===query?1:r.name.startsWith(query)&&r.kind==='股票'?2:r.name.startsWith(query)?3:4;
    return rank(a)-rank(b);
  }).slice(0,20);
}

export async function searchStocks(query: string, get: JsonFetcher) {
  const url = 'https://searchapi.eastmoney.com/api/suggest/get?' + new URLSearchParams({input:query,type:'14',count:'30'});
  return parseStockSearch(await get(url),query);
}
