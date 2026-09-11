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

export function parseTencentStockSearch(raw: unknown, query: string): PaperSearchCandidate[] {
  if (typeof raw !== 'string' || raw.length > 200_000) throw new Error('中文股票搜索暂不可用，请稍后重试或输入股票代码。');
  const assignment = raw.trim().match(/^v_hint=("(?:\\.|[^"\\])*");?$/s);
  if (!assignment) throw new Error('中文股票搜索暂不可用，请稍后重试或输入股票代码。');
  let decoded: string;
  try { decoded = JSON.parse(assignment[1]); } catch { throw new Error('中文股票搜索暂不可用，请稍后重试或输入股票代码。'); }
  const seen = new Set<string>();
  const rows = decoded.split('^').flatMap(entry => {
    const [market, identifier, name] = entry.split('~');
    if (market !== 'us' || typeof identifier !== 'string' || typeof name !== 'string') return [];
    const match = identifier.toUpperCase().match(/^([A-Z][A-Z0-9]*(?:\.[A-Z])?)\.(OQ|N|AM|P)$/);
    if (!match || seen.has(match[1])) return [];
    seen.add(match[1]);
    const exchange = match[2] === 'OQ' ? 'NASDAQ' : match[2] === 'N' ? 'NYSE' : 'AMEX';
    return [{ symbol: match[1], brokerSymbol: match[1].replace('.', ' '), name: name.trim(), exchange, kind: /ETF/i.test(name) ? 'ETF' : '股票' } satisfies PaperSearchCandidate];
  });
  const normalized = query.trim().toLocaleLowerCase();
  const rank = (row: PaperSearchCandidate) => row.symbol.toLocaleLowerCase() === normalized ? 0
    : row.name.toLocaleLowerCase() === normalized && row.kind === '股票' ? 1
    : row.name.toLocaleLowerCase().startsWith(normalized) && row.kind === '股票' ? 2
    : row.name.toLocaleLowerCase().includes(normalized) && row.kind === '股票' ? 3
    : row.name.toLocaleLowerCase().startsWith(normalized) ? 4 : 5;
  return rows.sort((a, b) => rank(a) - rank(b)).slice(0, 20);
}

export async function searchStocks(query: string, get: JsonFetcher) {
  const eastmoney = 'https://searchapi.eastmoney.com/api/suggest/get?' + new URLSearchParams({input:query,type:'14',token:'D43BF722C8E33BDC906FB84D85E326E8',count:'30'});
  try { return parseStockSearch(await get(eastmoney), query); }
  catch {
    const tencent = 'https://smartbox.gtimg.cn/s3/?' + new URLSearchParams({q:query,t:'all'});
    try { return parseTencentStockSearch(await get(tencent), query); }
    catch { throw new Error('中文股票搜索暂不可用，请稍后重试或输入股票代码。'); }
  }
}
