import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fetch as request, ProxyAgent } from 'undici';
import { MARKET_HOLIDAYS_2026, getMarketHalfDay } from '../src/data/marketCalendars.ts';
import { DIGEST_MARKETS, type DigestMarketId, type DigestMarketQuote, type DigestMarketSnapshot } from '../src/lib/dailyDigestTypes.ts';

type Response = { text: string; fetchedAt: string; sha256: string };
export type DigestFeed = (url: string, signal: AbortSignal) => Promise<Response>;
const MINUTE = 60_000, DAY = 86_400_000;
export const DIGEST_SINA_URL = 'https://hq.sinajs.cn/list=gb_$ixic,gb_$inx,gb_mags,sh000001,rt_hkHSI,hf_XAU,hf_OIL';
export const DIGEST_TENCENT_URL = 'https://qt.gtimg.cn/q=us.IXIC,us.INX,usMAGS,sh000001,hkHSI';
const stockCodes = { COMP: ['gb_$ixic', 'us.IXIC'], SPX: ['gb_$inx', 'us.INX'], MAGS: ['gb_mags', 'usMAGS'], SSE: ['sh000001', 'sh000001'], HSI: ['rt_hkHSI', 'hkHSI'] } as const;
const iso = (n: number) => new Date(n).toISOString();
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const positive = (v: unknown) => typeof v !== 'boolean' && v !== null && String(v).trim() !== '' && Number.isFinite(Number(v)) && Number(v) > 0;

function localParts(ms: number, zone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(ms);
  const get = (name: string) => parts.find(p => p.type === name)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minute: Number(get('hour')) * 60 + Number(get('minute')), weekday: get('weekday') };
}
export function digestZonedTime(date: string, clock: string, zone = 'Asia/Shanghai') {
  const match = `${date.replaceAll('/', '-')} ${clock}`.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) throw new Error('行情缺少完整来源时间');
  const nominal = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`);
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(nominal).find(p => p.type === 'timeZoneName')?.value;
  const stamp = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}${offset === 'GMT' ? 'Z' : offset?.replace('GMT', '')}`);
  if (!Number.isFinite(stamp) || localParts(stamp, zone).date !== match[1] || localParts(stamp, zone).minute !== Number(match[2]) * 60 + Number(match[3])) throw new Error('行情时间无效');
  return iso(stamp);
}
function sinaUsTime(fields: string[], now: number) {
  const match = fields[25]?.match(/([A-Za-z]{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2})(AM|PM)\s+(EDT|EST)/);
  if (!match) throw new Error('美股缺少交易所时区报价时间');
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(match[1]) + 1;
  if (!month) throw new Error('美股报价月份无效');
  const year = Number(fields[3]?.slice(0, 4));
  const clock = `${String(Number(match[3]) % 12 + (match[5] === 'PM' ? 12 : 0)).padStart(2, '0')}:${match[4]}:00`;
  const candidates = [year - 1, year, year + 1].map(y => digestZonedTime(`${y}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`, clock, 'America/New_York')).filter(s => Date.parse(s) <= now + MINUTE);
  const latest = candidates.sort().at(-1);
  if (!latest) throw new Error('美股报价来自未来');
  return latest;
}
function quote(id: DigestMarketId, raw: Response, options: Omit<DigestMarketQuote, 'id' | 'checkedAt' | 'evidence' | 'changePercent'> & { reportedPercent?: number; fields: unknown }): DigestMarketQuote {
  const { reportedPercent, fields, ...rest } = options;
  if (!positive(rest.price) || !positive(rest.previous)) throw new Error(`${id} 价格或前值无效`);
  const changePercent = (rest.price / rest.previous - 1) * 100;
  if (!Number.isFinite(changePercent) || Math.abs(changePercent) > 90 || (reportedPercent !== undefined && (!Number.isFinite(reportedPercent) || Math.abs(changePercent - reportedPercent) > 0.08))) throw new Error(`${id} 涨跌幅与前值不一致`);
  return { id, ...rest, changePercent, checkedAt: raw.fetchedAt, evidence: { sha256: raw.sha256, fields: JSON.stringify(fields).slice(0, 3000) } };
}
export function parseDigestSina(raw: Response, now = Date.now()) {
  const rows = new Map([...raw.text.matchAll(/hq_str_([^=\s]+)="([^"]*)"/g)].map(m => [m[1], m[2].split(',')]));
  const output: DigestMarketQuote[] = [];
  for (const [key, [code]] of Object.entries(stockCodes)) {
    const id = key as keyof typeof stockCodes, f = rows.get(code);
    if (!f?.length) continue;
    try {
      const domestic = id === 'SSE', hk = id === 'HSI';
      if (domestic ? !f[0].includes('上证') : hk ? !f[1].includes('恒生') : id === 'COMP' ? !f[0].includes('纳斯达克') : id === 'SPX' ? !f[0].includes('标普') : f[0].toUpperCase() !== 'MAGS') continue;
      if (!domestic && !hk && [5,6,7].every(i => Number(f[i]) === 0)) continue;
      const price = Number(f[domestic ? 3 : hk ? 6 : 1]);
      const previous = Number(f[domestic ? 2 : hk ? 3 : 26]);
      const quotedAt = domestic ? digestZonedTime(f[30], f[31]) : hk ? digestZonedTime(f[17], f[18], 'Asia/Hong_Kong') : sinaUsTime(f, now);
      output.push(quote(id, raw, { price, previous, quotedAt, source: '新浪财经', sourceUrl: domestic ? 'https://finance.sina.com.cn/realstock/company/sh000001/nc.shtml' : hk ? 'https://stock.finance.sina.com.cn/hkstock/quotes/HSI.html' : `https://stock.finance.sina.com.cn/usstock/quotes/${id === 'MAGS' ? 'MAGS' : id === 'COMP' ? '.IXIC' : '.INX'}.html`, symbol: DIGEST_MARKETS.find(s => s.id === id)!.symbol,
        instrument: id === 'MAGS' ? 'MAGS ETF' : '现金价格指数', basis: '较前收盘', delay: '源未声明延迟时长', ...(domestic ? {} : { reportedPercent: Number(f[hk ? 8 : 2]) }), fields: f }));
    } catch { /* Reject this row; the independent backup may supply it. */ }
  }
  for (const [id, code, title] of [['XAUUSD', 'hf_XAU', '现货黄金'], ['BRENT', 'hf_OIL', '布伦特']] as const) {
    const f = rows.get(code);
    if (!f || !f[13]?.includes(title)) continue;
    try { output.push(quote(id, raw, { price: Number(f[0]), previous: Number(f[7]), quotedAt: digestZonedTime(f[12], f[6]), source: '新浪财经', sourceUrl: `https://finance.sina.com.cn/futures/quotes/${id === 'XAUUSD' ? 'XAU' : 'OIL'}.shtml`, symbol: id === 'XAUUSD' ? 'XAU/USD' : 'OIL 连续', instrument: id === 'XAUUSD' ? '伦敦金现货 · USD/盎司' : '布伦特连续期货 · USD/桶', basis: '较源前收盘', delay: '源未声明延迟时长', fields: f })); } catch { /* Invalid row. */ }
  }
  return output;
}
export function parseDigestTencent(raw: Response) {
  const rows = new Map([...raw.text.matchAll(/v_([^=\s]+)="([^"]*)"/g)].map(m => [m[1], m[2].split('~')]));
  return Object.entries(stockCodes).flatMap(([key, [, code]]) => {
    const id = key as keyof typeof stockCodes, f = rows.get(code);
    try {
      if (!f || !f[2] || (id === 'COMP' ? f[2] !== '.IXIC' : id === 'SPX' ? f[2] !== '.INX' : id === 'MAGS' ? !f[2].startsWith('MAGS.') : id === 'SSE' ? f[2] !== '000001' : f[2] !== 'HSI')) return [];
      const match = f[30].match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})[ T]?(\d{2}):?(\d{2}):?(\d{2})$/);
      if (!match) return [];
      return [quote(id, raw, { price: Number(f[3]), previous: Number(f[4]), quotedAt: digestZonedTime(`${match[1]}-${match[2]}-${match[3]}`, `${match[4]}:${match[5]}:${match[6]}`, ['COMP','SPX','MAGS'].includes(id) ? 'America/New_York' : 'Asia/Shanghai'),
        reportedPercent: Number(f[32]), source: '腾讯财经', sourceUrl: `https://gu.qq.com/${code}`, symbol: DIGEST_MARKETS.find(s => s.id === id)!.symbol, instrument: id === 'MAGS' ? 'MAGS ETF' : '现金价格指数', basis: '较前收盘', delay: id === 'HSI' ? '港股可能延迟，按来源时间显示' : '源未声明延迟时长', fields: f })];
    } catch { return []; }
  });
}
export function parseCoinbaseDigest(stats: Response, ticker: Response, now = Date.now()) {
  const s = JSON.parse(stats.text), t = JSON.parse(ticker.text);
  const tradeTime = Date.parse(t.time);
  if (!Number.isFinite(tradeTime) || tradeTime > now + MINUTE || now - tradeTime > 3 * MINUTE || !positive(t.price) || !positive(s.last) || Math.abs(Number(t.price) / Number(s.last) - 1) > 0.02) throw new Error('BTC 统计与最新成交不一致或已过期');
  return quote('BTCUSD', stats, { price: Number(s.last), previous: Number(s.open), quotedAt: null, source: 'Coinbase Exchange', sourceUrl: 'https://exchange.coinbase.com/trade/BTC-USD', symbol: 'BTC/USD', instrument: 'Coinbase 美元现货 · 24h统计快照', basis: '24h统计变动', delay: '统计快照；采集时间不等于成交时间', fields: { stats: s, ticker: t } });
}
export function parseKrakenDigest(raw: Response, now = Date.now()) {
  const p = JSON.parse(raw.text);
  if (p.error?.length || !Array.isArray(p.result?.XXBTZUSD)) throw new Error('Kraken BTC/USD 响应无效');
  const rows = p.result.XXBTZUSD.filter((r: unknown[]) => Number(r[0]) * 1000 + 300_000 <= now).sort((a: number[], b: number[]) => a[0] - b[0]);
  const last = rows.at(-1), previous = last && rows.find((r: number[]) => r[0] === last[0] - 86400);
  if (!last || !previous || now - (Number(last[0]) + 300) * 1000 > 6 * MINUTE) throw new Error('Kraken 缺少匹配的已完成24h前值');
  return quote('BTCUSD', raw, { price: Number(last[4]), previous: Number(previous[4]), quotedAt: iso((Number(last[0]) + 300) * 1000), source: 'Kraken', sourceUrl: 'https://pro.kraken.com/app/trade/btc-usd', symbol: 'BTC/USD', instrument: 'Kraken 美元现货 · 5分钟收盘', basis: '24h同刻5m收盘', delay: '已完成5分钟K线', fields: [previous, last] });
}
export function parseGoldDigest(raw: Response) {
  const p = JSON.parse(raw.text), item = p.items?.find((r: { curr?: string }) => r.curr === 'USD');
  if (!item || !positive(p.ts)) throw new Error('黄金报价币种或时间缺失');
  return quote('XAUUSD', raw, { price: Number(item.xauPrice), previous: Number(item.xauPrice) - Number(item.chgXau), reportedPercent: Number(item.pcXau), quotedAt: iso(Number(p.ts)), source: 'GoldPrice', sourceUrl: 'https://goldprice.org/live-gold-price.html', symbol: 'XAU/USD', instrument: '现货黄金参考价 · USD/盎司', basis: '较源前收盘', delay: '源未声明延迟时长', fields: p });
}
export function parseDigestYahoo(raw: Response, id: DigestMarketId, symbol: string) {
  const result = JSON.parse(raw.text)?.chart?.result?.[0], m = result?.meta;
  if (!m || m.symbol !== symbol || m.currency !== (id === 'SSE' ? 'CNY' : id === 'HSI' ? 'HKD' : 'USD') || !positive(m.regularMarketTime)) throw new Error('Yahoo 品种、币种或时间不符');
  const date = localParts(Number(m.regularMarketTime) * 1000, m.exchangeTimezoneName || 'America/New_York').date;
  const bars = (result.timestamp ?? []).flatMap((t: number, i: number) => {
    const price = result.indicators?.quote?.[0]?.close?.[i];
    return positive(price) && localParts(t * 1000, m.exchangeTimezoneName || 'America/New_York').date < date ? [{ t, price: Number(price) }] : [];
  }).sort((a: { t: number }, b: { t: number }) => a.t - b.t);
  // chartPreviousClose can refer to the beginning of a multi-day range; use
  // the dated daily bar immediately preceding the quote's own session date.
  const previous = bars.at(-1)?.price;
  if (!previous) throw new Error('Yahoo 缺少同品种前一交易日收盘');
  if (id !== 'BRENT' && !['INDEX','ETF'].includes(m.instrumentType)) throw new Error('Yahoo 证券类型不符');
  if (id === 'BRENT' && m.instrumentType !== 'FUTURE') throw new Error('布伦特来源不是期货');
  return quote(id, raw, { price: Number(m.regularMarketPrice), previous, quotedAt: iso(Number(m.regularMarketTime) * 1000), source: 'Yahoo Finance', sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`, symbol,
    instrument: id === 'BRENT' ? 'NYMEX Brent 金融期货 · BZ=F' : id === 'MAGS' ? 'MAGS ETF' : '现金价格指数', basis: '较同品种前收盘', delay: '以来源时间为准，可能延迟', fields: { meta: m, previous: bars.at(-1) } });
}
export function parseTreasuryDigest(raw: Response, now = Date.now()) {
  const today = localParts(now, 'America/New_York').date;
  const rows: Array<{ date: string; value: number }> = [];
  const text = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  for (const table of raw.text.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const headers = [...table[1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(m => text(m[1]));
    if (!headers.includes('Date') || !headers.includes('10 Yr')) continue;
    for (const row of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => text(m[1]));
      const m = cells[headers.indexOf('Date')]?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!m) continue;
      const date = `${m[3]}-${m[1]}-${m[2]}`, value = Number(cells[headers.indexOf('10 Yr')]);
      if (date <= today && positive(value)) rows.push({ date, value });
    }
  }
  const sorted = [...new Map(rows.map(r => [r.date, r])).values()].sort((a, b) => b.date.localeCompare(a.date));
  if (sorted.length < 2 || Date.parse(today) - Date.parse(sorted[0].date) > 7 * DAY) throw new Error('财政部近期两次官方CMT数据不完整');
  return quote('US10Y', raw, { price: sorted[0].value, previous: sorted[1].value, quotedAt: null, observationDate: sorted[0].date, changeBp: (sorted[0].value - sorted[1].value) * 100, source: '美国财政部', sourceUrl: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve', symbol: 'CMT 10Y', instrument: '10年期名义固定期限收益率 · 日度', basis: '较前次公布 · bp', delay: '官方日度公布值，非盘中收益率', fields: sorted.slice(0, 2) });
}
export function parseFredDigest(raw: Response, now = Date.now()) {
  const rows = raw.text.trim().split(/\r?\n/).slice(1).flatMap(line => {
    const [date, value] = line.split(',');
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && positive(value) && date <= localParts(now, 'America/New_York').date ? [{ date, value: Number(value) }] : [];
  }).sort((a, b) => b.date.localeCompare(a.date));
  if (!raw.text.split(/\r?\n/)[0].endsWith(',DGS10') || rows.length < 2 || now - Date.parse(rows[0].date) > 8 * DAY) throw new Error('FRED DGS10 数据无效或过期');
  return quote('US10Y', raw, { price: rows[0].value, previous: rows[1].value, quotedAt: null, observationDate: rows[0].date, changeBp: (rows[0].value - rows[1].value) * 100, source: 'FRED · DGS10', sourceUrl: 'https://fred.stlouisfed.org/series/DGS10', symbol: 'DGS10', instrument: '10年期名义固定期限收益率 · 日度', basis: '较前次公布 · bp', delay: '官方日度公布值，非盘中收益率', fields: rows.slice(0, 2) });
}

function stockFresh(q: DigestMarketQuote, now: number, market: 'china' | 'hongkong' | 'us') {
  if (!q.quotedAt) return false;
  const zone = market === 'us' ? 'America/New_York' : 'Asia/Shanghai';
  const local = localParts(now, zone), quoted = localParts(Date.parse(q.quotedAt), zone);
  const known = local.date.startsWith('2026-');
  if (!known) return now - Date.parse(q.quotedAt) < 25 * MINUTE; // Do not guess a future year's holidays.
  const holiday = (date: string) => MARKET_HOLIDAYS_2026[market][date] || ['Sat','Sun'].includes(localParts(Date.parse(date + 'T12:00:00Z'), zone).weekday);
  const close = getMarketHalfDay(market, local.date)?.closeMinute ?? (market === 'china' ? 900 : 960);
  const open = market === 'us' ? 570 : 570;
  const tradingDay = !holiday(local.date);
  if (tradingDay && local.minute >= open && local.minute < close) {
    const lunch = market !== 'us' && local.minute >= (market === 'china' ? 690 : 720) && local.minute < 780;
    return quoted.date === local.date && now - Date.parse(q.quotedAt) < (lunch ? 150 : 25) * MINUTE;
  }
  let expected = local.date;
  if (!tradingDay || local.minute < close) expected = iso(Date.parse(expected + 'T12:00:00Z') - DAY).slice(0, 10);
  for (let i = 0; i < 30 && holiday(expected); i++) expected = iso(Date.parse(expected + 'T12:00:00Z') - DAY).slice(0, 10);
  const expectedClose = getMarketHalfDay(market, expected)?.closeMinute ?? (market === 'china' ? 900 : 960);
  // A morning quote from the closing session is still stale after the bell.
  return quoted.date >= expected && (quoted.date > expected || quoted.minute >= expectedClose - 25);
}
export function currentDigestQuote(q: DigestMarketQuote, now: number) {
  if (!q || !positive(q.price) || !positive(q.previous) || !Number.isFinite(q.changePercent) || Math.abs(q.changePercent - (q.price / q.previous - 1) * 100) > 0.001
    || !Number.isFinite(Date.parse(q.checkedAt)) || Date.parse(q.checkedAt) > now + MINUTE || !/^https:\/\//.test(q.sourceUrl) || !q.source || !q.basis || !q.instrument || !q.evidence?.sha256) return false;
  if (q.quotedAt && (!Number.isFinite(Date.parse(q.quotedAt)) || Date.parse(q.quotedAt) > now + MINUTE)) return false;
  if (q.id === 'US10Y') return !!q.observationDate && Number.isFinite(Date.parse(q.observationDate)) && q.observationDate <= localParts(now, 'America/New_York').date && now - Date.parse(q.observationDate) < 8 * DAY && now - Date.parse(q.checkedAt) < 6 * 3_600_000;
  if (now - Date.parse(q.checkedAt) > 3 * MINUTE) return false;
  if (q.id === 'BTCUSD') return !q.quotedAt || now - Date.parse(q.quotedAt) < 6 * MINUTE;
  if (['COMP','SPX','MAGS','SSE','HSI'].includes(q.id)) return stockFresh(q, now, q.id === 'SSE' ? 'china' : q.id === 'HSI' ? 'hongkong' : 'us');
  const weekend = ['Sat','Sun'].includes(localParts(now, 'America/New_York').weekday);
  return !!q.quotedAt && now - Date.parse(q.quotedAt) < (weekend ? 3 * DAY : 30 * MINUTE);
}

export function createDigestFeedTransport() {
  const proxyUrl = process.env.SPARKFLOW_DIGEST_PROXY ?? 'http://127.0.0.1:7890';
  const proxy = proxyUrl && proxyUrl !== 'direct' ? new ProxyAgent(proxyUrl) : null;
  const direct = new Set(['hq.sinajs.cn', 'qt.gtimg.cn']);
  const allowed = new Set([...direct, 'api.exchange.coinbase.com', 'api.kraken.com', 'data-asg.goldprice.org', 'query1.finance.yahoo.com', 'query2.finance.yahoo.com', 'home.treasury.gov', 'fred.stlouisfed.org']);
  const feed: DigestFeed = async (url, signal) => {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !allowed.has(u.hostname)) throw new Error('未知行情来源');
    const response = await request(url, { headers: { 'User-Agent': 'Mozilla/5.0 SparkFlowDailyMarkets/1.0', Accept: '*/*', Referer: 'https://finance.sina.com.cn/' }, signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]), redirect: 'error', ...(!direct.has(u.hostname) && proxy ? { dispatcher: proxy } : {}) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`${u.hostname}: HTTP ${response.status}`); }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 2_000_000) throw new Error('行情响应过大');
    return { text: new TextDecoder(direct.has(u.hostname) ? 'gbk' : 'utf-8').decode(bytes), fetchedAt: iso(Date.now()), sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  return { feed, close: () => { void proxy?.close(); } };
}

export function createDailyDigestMarkets(options: { cacheDir: string; feed: DigestFeed; now?: () => number }) {
  const now = options.now ?? Date.now;
  const quotes = new Map<DigestMarketId, DigestMarketQuote>(), errors = new Map<DigestMarketId, string>();
  const controller = new AbortController();
  let checkedAt: string | null = null, stopped = false, inFlight: Promise<void> | null = null;
  const file = path.join(options.cacheDir, 'markets.json');
  const safeLoad = async (run: () => Promise<DigestMarketQuote[]>) => { try { return await run(); } catch { return []; } };
  const get = (url: string) => options.feed(url, controller.signal);
  const accept = (rows: DigestMarketQuote[], candidates: Map<DigestMarketId, DigestMarketQuote>) => { for (const q of rows) if (currentDigestQuote(q, now())) candidates.set(q.id, q); };
  async function refresh() {
    if (stopped || inFlight) return inFlight;
    inFlight = (async () => {
      const candidates = new Map<DigestMarketId, DigestMarketQuote>();
      const [sina, btc, treasury] = await Promise.all([
        safeLoad(async () => parseDigestSina(await get(DIGEST_SINA_URL), now())),
        safeLoad(async () => { const [stats, ticker] = await Promise.all([get('https://api.exchange.coinbase.com/products/BTC-USD/stats'), get('https://api.exchange.coinbase.com/products/BTC-USD/ticker')]); return [parseCoinbaseDigest(stats, ticker, now())]; }),
        safeLoad(async () => {
          const old = quotes.get('US10Y');
          if (old && currentDigestQuote(old, now()) && now() - Date.parse(old.checkedAt) < 30 * MINUTE) return [old];
          const month = localParts(now(), 'America/New_York').date.slice(0, 7).replace('-', '');
          try { return [parseTreasuryDigest(await get(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve&field_tdr_date_value_month=${month}`), now())]; }
          catch { return [parseFredDigest(await get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10&cosd=${iso(now() - 25 * DAY).slice(0,10)}`), now())]; }
        }),
      ]);
      for (const rows of [sina, btc, treasury]) accept(rows, candidates);
      const stocks = Object.keys(stockCodes) as Array<keyof typeof stockCodes>;
      if (stocks.some(id => !candidates.has(id))) accept(await safeLoad(async () => parseDigestTencent(await get(DIGEST_TENCENT_URL))), candidates);
      await Promise.all([
        ...stocks.filter(id => !candidates.has(id)).map(id => safeLoad(async () => { const symbol = { COMP:'^IXIC', SPX:'^GSPC', MAGS:'MAGS', SSE:'000001.SS', HSI:'^HSI' }[id]; return [parseDigestYahoo(await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`), id, symbol)]; }).then(rows => accept(rows, candidates))),
        !candidates.has('BTCUSD') ? safeLoad(async () => [parseKrakenDigest(await get('https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=5'), now())]).then(rows => accept(rows, candidates)) : null,
        !candidates.has('XAUUSD') ? safeLoad(async () => [parseGoldDigest(await get('https://data-asg.goldprice.org/dbXRates/USD'))]).then(rows => accept(rows, candidates)) : null,
        !candidates.has('BRENT') ? safeLoad(async () => [parseDigestYahoo(await get('https://query1.finance.yahoo.com/v8/finance/chart/BZ%3DF?range=1mo&interval=1d'), 'BRENT', 'BZ=F')]).then(rows => accept(rows, candidates)) : null,
      ]);
      if (stopped) return;
      for (const spec of DIGEST_MARKETS) {
        const candidate = candidates.get(spec.id), old = quotes.get(spec.id);
        if (candidate && (!old?.quotedAt || !candidate.quotedAt || Date.parse(candidate.quotedAt) >= Date.parse(old.quotedAt))) { quotes.set(spec.id, candidate); errors.delete(spec.id); }
        else if (!candidate) errors.set(spec.id, '主备来源本轮未返回通过时间、品种及前值校验的报价');
      }
      checkedAt = iso(now());
      const payload = { schema: 1, checkedAt, quotes: [...quotes.values()], errors: Object.fromEntries(errors) };
      const tmp = `${file}.${randomUUID()}.tmp`;
      try { await mkdir(options.cacheDir, { recursive: true }); await writeFile(tmp, JSON.stringify(payload)); if (!stopped) await rename(tmp, file); }
      finally { await unlink(tmp).catch(() => undefined); }
    })().catch(error => { if (!stopped) console.warn('[digest-markets]', error); }).finally(() => { inFlight = null; });
    return inFlight;
  }
  function snapshot(): DigestMarketSnapshot {
    const rows = DIGEST_MARKETS.map(spec => {
      const q = quotes.get(spec.id), age = q ? now() - Date.parse(q.quotedAt ?? (q.observationDate ? q.observationDate + 'T00:00:00Z' : q.checkedAt)) : Infinity;
      const retained = q && age >= -MINUTE && age < (spec.id === 'BTCUSD' ? 15 * MINUTE : spec.id === 'US10Y' ? 8 * DAY : 14 * DAY) ? q : null;
      const state = retained ? currentDigestQuote(retained, now()) && !errors.has(spec.id) ? 'current' as const : 'cached' as const : 'unavailable' as const;
      return { ...spec, quote: retained, state, error: errors.get(spec.id) ?? null };
    });
    return { schema: 1, checkedAt, nextRefreshAt: null, refreshing: !!inFlight, available: rows.filter(r => r.quote).length, revision: hash(JSON.stringify(rows)), rows };
  }
  return { snapshot, refresh,
    async start() {
      try {
        const stored = JSON.parse(await readFile(file, 'utf8'));
        if (stored.schema === 1 && Array.isArray(stored.quotes)) for (const q of stored.quotes) {
          if (DIGEST_MARKETS.some(s => s.id === q.id) && positive(q.price) && positive(q.previous) && Number.isFinite(q.changePercent) && Math.abs(q.changePercent - (q.price/q.previous-1)*100) < .001 && Number.isFinite(Date.parse(q.checkedAt)) && Date.parse(q.checkedAt) <= now() + MINUTE && q.source && q.basis && q.instrument && /^[a-f0-9]{64}$/.test(q.evidence?.sha256) && /^https:\/\//.test(q.sourceUrl)) quotes.set(q.id, q);
        }
        if (stored.errors && typeof stored.errors === 'object') for (const spec of DIGEST_MARKETS) if (typeof stored.errors[spec.id] === 'string') errors.set(spec.id, stored.errors[spec.id]);
        checkedAt = stored.checkedAt ?? null;
      } catch { /* An absent/broken cache is warmed independently. */ }
      if (stopped) return;
      // Only generation calls refresh(). Reading, startup restoration and the
      // browser's lightweight status polling never fetch upstream market data.
    },
    stop() { stopped = true; controller.abort(); },
    idle: async () => { await inFlight; },
  };
}
