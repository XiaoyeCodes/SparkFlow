import type { CloseMarket, CloseIndex, CloseSource } from '../src/lib/marketCloseTypes.ts';
import { marketClock, closeSessionDue } from './marketCloseCalendar.ts';

type Read = (url: string) => Promise<string>;
export type CloseResearch = { indices: CloseIndex[]; sources: CloseSource[]; gaps: string[] };
const cnIndices = [['1.000001', '上证指数'], ['0.399001', '深证成指'], ['0.399006', '创业板指'], ['1.000688', '科创50'], ['1.000300', '沪深300']];
const usIndices = [['^GSPC', '标普500'], ['^DJI', '道琼斯工业指数'], ['^IXIC', '纳斯达克综合指数']];
// Eastmoney's NDX is its Nasdaq Composite instrument, not Yahoo's ^NDX Nasdaq-100.
const usEastmoney: Record<string, string> = { '^GSPC': '100.SPX', '^DJI': '100.DJIA', '^IXIC': '100.NDX' };
const clean = (html: string) => html.replace(/<(script|style|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null;
export function yicaiArticle(raw: string) {
  const title = clean(raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '第一财经快讯');
  const article = raw.match(/<div[^>]*id=["']multi-text["'][^>]*>([\s\S]*?)(?:<div[^>]*id=["']jb_report|<div[^>]*class=["'](?:report|relate))/i)?.[1]
    ?? raw.match(/(<p><span>\d{2}:\d{2}<\/span>[\s\S]*?)<div[^>]*id=["']jb_report/i)?.[1];
  return { title, text: article ? clean(article).slice(0, 7000) : '' };
}
export async function mapLimited<T, R>(items: T[], callback: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const output: PromiseSettledResult<R>[] = []; let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => { while (next < items.length) { const i = next++; try { output[i] = { status: 'fulfilled', value: await callback(items[i]) }; } catch (reason) { output[i] = { status: 'rejected', reason }; } } }));
  return output;
}

export function parseYahooClose(raw: string, symbol: string, name: string, date: string): CloseIndex {
  const data = JSON.parse(raw)?.chart?.result?.[0];
  const closes = data?.indicators?.quote?.[0]?.close ?? [];
  const rows = (data?.timestamp ?? []).flatMap((timestamp: number, i: number) => num(closes[i]) !== null ? [{ date: marketClock(new Date(timestamp * 1000), 'us').date, close: Number(closes[i]) }] : []);
  const i = rows.findIndex((row: { date: string }) => row.date === date);
  if (i < 1 || rows[i - 1].close <= 0) throw new Error('当日收盘数据未就绪');
  return { name, symbol, date, close: rows[i].close, change: rows[i].close - rows[i - 1].close, changePercent: (rows[i].close / rows[i - 1].close - 1) * 100, sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/history/` };
}
export function parseEastmoneyClose(raw: string, symbol: string, name: string, date: string): CloseIndex {
  const rows = JSON.parse(raw)?.data?.klines?.map((line: string) => line.split(',')) ?? [];
  const row = rows.find((r: string[]) => r[0] === date);
  if (!row || num(row[2]) === null || num(row[8]) === null || num(row[9]) === null) throw new Error('当日收盘数据未就绪');
  return { name, symbol, date, close: Number(row[2]), change: Number(row[9]), changePercent: Number(row[8]), sourceUrl: `https://quote.eastmoney.com/${symbol.startsWith('100.') ? 'gb/' : ''}zs${symbol.split('.')[1]}.html` };
}

export async function collectCloseResearch(market: CloseMarket, date: string, read: Read): Promise<CloseResearch> {
  const sources: CloseSource[] = [], gaps: string[] = [];
  const add = (title: string, url: string, publishedAt: string, content: string) => sources.push({ id: `S${sources.length + 1}`, title, url, publishedAt, fetchedAt: new Date().toISOString(), content: content.slice(0, 7000) });
  // Visit the requested publications before the supplementary quantitative checks.
  let yicai = '';
  try { yicai = await read('https://www.yicai.com/'); } catch { gaps.push('第一财经首页暂不可用'); }
  try { await read('https://www.jin10.com/'); } catch { gaps.push('金十数据首页暂不可用'); }
  const configs = market === 'cn' ? cnIndices : usIndices;
  const indexResults = await mapLimited(configs, async ([symbol, name]) => {
    if (market === 'cn') {
      const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${symbol}&klt=101&fqt=0&beg=${date.replaceAll('-', '')}&end=${date.replaceAll('-', '')}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`;
      return parseEastmoneyClose(await read(url), symbol, name, date);
    }
    const end = Date.parse(`${date}T23:59:59Z`) / 1000;
    try { return parseYahooClose(await read(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${end - 14 * 86400}&period2=${end}&interval=1d`), symbol, name, date); }
    catch {
      const secid = usEastmoney[symbol];
      const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=0&beg=${date.replaceAll('-', '')}&end=${date.replaceAll('-', '')}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`;
      const row = parseEastmoneyClose(await read(url), secid, name, date);
      gaps.push(`${name}使用东方财富当日收盘数据，Yahoo Finance 暂不可用`);
      return { ...row, symbol };
    }
  });
  const indices = indexResults.flatMap((result, i) => {
    if (result.status === 'rejected') { gaps.push(`${configs[i][1]}的 ${date} 收盘数据未取得`); return []; }
    const row = result.value;
    add(`${row.name}收盘数据`, row.sourceUrl, new Date(closeSessionDue(market, date)!.getTime() - 10 * 60000).toISOString(), JSON.stringify(row));
    return [row];
  });
  // Only read article links actually found on the requested site's page; never execute page code.
  const links = [...yicai.matchAll(/href=["']((?:https:\/\/www\.yicai\.com)?\/(?:news|brief)\/\d+\.html)["'][^>]*>([\s\S]*?)<\/a>/g)]
    .map(match => ({ url: new URL(match[1], 'https://www.yicai.com').href, title: clean(match[2]) }))
    .filter(item => /收盘|复盘|沪指|深成|创业板|科创|美股|纳指|标普|道指|板块|涨停|市场|央行|美联储/.test(item.title));
  const unique = [...new Map(links.map(item => [item.url, item])).values()].sort((a, b) => Number(/收盘|复盘|沪指|美股/.test(b.title)) - Number(/收盘|复盘|沪指|美股/.test(a.title))).slice(0, 8);
  const articles = await mapLimited(unique, async item => {
    const raw = await read(item.url);
    const published = raw.match(/['"]actime['"]\s*,\s*['"]([^'"]+)/)?.[1] ?? raw.match(/(?:datePublished|article:published_time)["']?\s*(?::|content=)\s*["']([^"']+)/)?.[1];
    if (!published) return;
    const at = new Date(published.replace(/\+08$/, '+08:00'));
    if (!Number.isFinite(at.getTime()) || marketClock(at, market).date !== date) return;
    const article = yicaiArticle(raw);
    if (!article.text) return;
    return { ...item, ...article, published: at.toISOString() };
  });
  for (const result of articles) if (result.status === 'fulfilled' && result.value) { const a = result.value; add(a.title, a.url, a.published, a.text); }
  if (!sources.some(s => s.url.includes('yicai.com'))) gaps.push('第一财经未取得对应交易日的可核实正文；指数表使用独立行情数据校验');
  try {
    const raw = await read('https://www.jin10.com/flash_newest.js');
    const rows = JSON.parse(raw.replace(/^\s*var\s+newest\s*=\s*/, '').replace(/;\s*$/, ''));
    const flashes = rows.filter((row: any) => typeof row.time === 'string' && Number.isFinite(Date.parse(row.time.replace(' ', 'T') + '+08:00')) && marketClock(new Date(row.time.replace(' ', 'T') + '+08:00'), market).date === date && typeof row.data?.content === 'string' && /[\u3400-\u9fff]/.test(row.data.content))
      .sort((a: any, b: any) => Number(/收盘|沪指|创业板|科创|板块|涨停|美股|纳指|标普|道指|美联储|央行|利率/.test(b.data.content)) - Number(/收盘|沪指|创业板|科创|板块|涨停|美股|纳指|标普|道指|美联储|央行|利率/.test(a.data.content))).slice(0, 18);
    for (const row of flashes) add(clean(row.data.title || row.data.content).slice(0, 90), `https://www.jin10.com/flash_detail/${encodeURIComponent(row.id)}.html`, row.time.replace(' ', 'T') + '+08:00', clean(row.data.content));
    if (!flashes.length) gaps.push('金十快讯流未覆盖所选交易日，不使用其他日期的新闻替代');
  } catch { gaps.push('金十快讯获取失败'); }
  if (market === 'cn') gaps.push('行业涨跌排名仅在当日新闻提供明确依据时列出，不推算全市场排名');
  return { indices, sources, gaps };
}
