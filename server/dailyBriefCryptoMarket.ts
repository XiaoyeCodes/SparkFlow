import type { SnapshotStore } from './publicDataCache.ts';

export type BriefCryptoSymbol = 'BTC' | 'ETH' | 'SOL';
type Provider = 'Binance' | 'OKX';
type Payload = { rows: unknown[]; provider: Provider; sourceUrl: string; fetchedAt: number; cached?: boolean };
type Stored = Payload & { key: string; version: 1 };
const DAY = 86_400_000;
const number = (value: unknown) => value !== '' && value != null && Number.isFinite(Number(value)) ? Number(value) : NaN;
const origins = ['https://api.binance.com', 'https://data-api.binance.vision'] as const;

// These resources have their own bounded cache and flights. They never enqueue
// work in the macro/news pools or change the application's global proxy route.
export function createDailyBriefCryptoMarket(options: {
  request: (url: string, route: 'direct' | 'proxy', timeoutMs: number) => Promise<string>;
  store?: SnapshotStore;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const cache = new Map<string, Stored>();
  const pending = new Map<string, Promise<Payload>>();
  const restored = new Set<string>();
  const retryAt = new Map<string, number>();

  function candles(input: unknown): number[][] {
    if (!Array.isArray(input)) throw new Error('日线响应格式错误');
    const rows = input.map(row => {
      if (!Array.isArray(row)) throw new Error('日线条目格式错误');
      const [time, open, high, low, close, volume] = row.slice(0, 6).map(number);
      if (![time, open, high, low, close, volume].every(Number.isFinite)
        || time <= 0 || time % DAY !== 0 || time > now() || volume < 0
        || low <= 0 || high < Math.max(open, close) || low > Math.min(open, close)) {
        throw new Error('日线 OHLC 或 UTC 时间校验失败');
      }
      return [time, open, high, low, close, volume, time + DAY - 1];
    });
    const ordered = [...new Map(rows.map(row => [row[0], row])).values()].sort((a, b) => a[0] - b[0]).slice(-90);
    if (ordered.length < 31 || now() - ordered.at(-1)![0] > 2 * DAY
      || ordered.some((row, index) => index > 0 && row[0] - ordered[index - 1][0] !== DAY)) {
      throw new Error('日线不足、过期或存在日期缺口');
    }
    return ordered;
  }

  function valid(key: string, value: any): value is Stored {
    if (value?.version !== 1 || value.key !== key || !origins.some(origin => value.sourceUrl?.startsWith(origin + '/'))
      && !value.sourceUrl?.startsWith('https://www.okx.com/')
      || !['Binance', 'OKX'].includes(value.provider) || !Number.isFinite(value.fetchedAt)
      || value.fetchedAt > now() || !Array.isArray(value.rows)) return false;
    try {
      if (key.startsWith('candles:')) candles(value.rows);
      else if (value.rows.length !== 1 || !(number(value.rows[0]?.lastPrice) > 0)
        || value.rows[0]?.symbol !== key.slice(5) + 'USDT'
        || !Number.isFinite(number(value.rows[0]?.priceChangePercent))
        || !Number.isFinite(number(value.rows[0]?.closeTime))
        || number(value.rows[0]?.closeTime) > now() + 60_000
        || now() - number(value.rows[0]?.closeTime) > 15 * 60_000) return false;
      return true;
    } catch { return false; }
  }

  async function read(key: string, ttl: number, maxAge: number, load: () => Promise<Payload>): Promise<Payload> {
    const active = pending.get(key);
    if (active) return active;
    const flight = (async () => {
      if (!restored.has(key)) {
        restored.add(key);
        const text = await options.store?.read(key).catch(() => null);
        if (text) {
          try { const entry = JSON.parse(text); if (valid(key, entry) && now() - entry.fetchedAt <= maxAge) cache.set(key, entry); } catch { /* discard invalid disk data */ }
        }
      }
      const previous = cache.get(key);
      const usable = previous && valid(key, previous) && now() - previous.fetchedAt <= maxAge;
      if (usable && now() - previous.fetchedAt < ttl) return previous;
      if ((retryAt.get(key) ?? 0) > now()) {
        if (usable) return { ...previous, cached: true };
        throw new Error('来源正在等待独立重试');
      }
      try {
        const result: Stored = { ...await load(), version: 1, key };
        if (!valid(key, result)) throw new Error('加密行情校验失败');
        cache.set(key, result);
        retryAt.delete(key);
        await options.store?.write(key, JSON.stringify(result)).catch(() => undefined);
        return result;
      } catch (error) {
        retryAt.set(key, now() + 30_000);
        if (usable) return { ...previous, cached: true };
        throw error;
      }
    })();
    pending.set(key, flight);
    try { return await flight; } finally { if (pending.get(key) === flight) pending.delete(key); }
  }

  async function fallback<T>(paths: string[], parse: (value: any, url: string) => T): Promise<T> {
    let last: unknown;
    for (const url of paths) {
      for (const route of ['direct', 'proxy'] as const) {
        try { return parse(JSON.parse(await options.request(url, route, 2_000)), url); }
        catch (error) { last = error; }
      }
    }
    throw last instanceof Error ? last : new Error('加密行情来源暂不可用');
  }

  async function spot(symbols: readonly BriefCryptoSymbol[] = ['BTC', 'ETH', 'SOL']) {
    const result = await Promise.allSettled(symbols.map(symbol => read(`spot:${symbol}`, 30_000, 15 * 60_000, () => fallback(
      [...origins.map(origin => `${origin}/api/v3/ticker/24hr?symbol=${symbol}USDT`), `https://www.okx.com/api/v5/market/ticker?instId=${symbol}-USDT`],
      (data, url) => {
        const okx = url.includes('okx.com');
        const row = okx && data?.code === '0' ? data.data?.[0] : data;
        if (!row || (okx ? row.instId !== `${symbol}-USDT` : row.symbol !== `${symbol}USDT`)) throw new Error('交易对不匹配');
        const price = number(okx ? row.last : row.lastPrice);
        const change = okx ? (price / number(row.open24h) - 1) * 100 : number(row.priceChangePercent);
        const timestamp = number(okx ? row.ts : row.closeTime);
        if (!(price > 0) || !Number.isFinite(change) || !Number.isFinite(timestamp)
          || timestamp > now() + 60_000 || now() - timestamp > 15 * 60_000) throw new Error('报价数值或时间无效');
        return { rows: [{ symbol: `${symbol}USDT`, lastPrice: price, priceChangePercent: change, closeTime: timestamp }],
          provider: okx ? 'OKX' : 'Binance', sourceUrl: url, fetchedAt: now() };
      },
    ))));
    const rows = result.flatMap(item => item.status === 'fulfilled' ? item.value.rows.map(row => ({
      ...row as object, sourceUrl: item.value.provider === 'OKX'
        ? `https://www.okx.com/trade-spot/${String((row as any).symbol).replace('USDT', '').toLowerCase()}-usdt`
        : `https://www.binance.com/en/trade/${String((row as any).symbol).replace('USDT', '')}_USDT?type=spot`, source: item.value.provider,
      updatedAt: new Date(number((row as any).closeTime)).toISOString(), cached: Boolean(item.value.cached),
    })) : []);
    if (!rows.length && symbols.length) throw new Error('现货报价主备源暂不可用');
    return JSON.stringify(rows);
  }

  async function history(symbol: BriefCryptoSymbol) {
    const result = await read(`candles:${symbol}`, 60_000, DAY, () => fallback(
      [...origins.map(origin => `${origin}/api/v3/klines?symbol=${symbol}USDT&interval=1d&limit=90`), `https://www.okx.com/api/v5/market/candles?instId=${symbol}-USDT&bar=1Dutc&limit=90`],
      (data, url) => {
        const okx = url.includes('okx.com');
        return { rows: candles(okx && data?.code === '0' ? data.data : data), provider: okx ? 'OKX' : 'Binance', sourceUrl: url, fetchedAt: now() };
      },
    ));
    return JSON.stringify(result);
  }
  return { spot, history };
}
