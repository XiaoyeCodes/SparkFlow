type LogoStock = { code: string; marketCap?: number; logoUrl?: string; fallbackLogoUrl?: string };
type LogoEntry = { image: HTMLImageElement; promise: Promise<void>; settled: boolean; failedAt?: number };
const images = new Map<string, LogoEntry>();
const queue: Array<() => void> = [];
const CONCURRENCY = 6;
const MAX_IMAGES = 2048;
let active = 0;

export function heatmapLogoPath(market: string, stock: LogoStock) {
  if (market === 'china') return `/stock-logos/${stock.code}.svg`;
  if (market === 'hongkong') return `/stock-logos/hk-${stock.code}.svg`;
  if (market === 'us') return `/stock-logos/us-${stock.code}.svg`;
  return stock.logoUrl || stock.fallbackLogoUrl || '';
}

function marketForEndpoint(endpoint: string) {
  const url = new URL(endpoint, 'http://heatmap.local');
  if (url.pathname === '/api/china-market-heatmap') return 'china';
  if (url.pathname === '/api/hong-kong-market-heatmap') return 'hongkong';
  if (url.pathname === '/api/us-market-heatmap') return 'us';
  if (url.pathname === '/api/crypto-market-heatmap') return 'crypto';
  if (url.pathname === '/api/global-market-heatmap') return url.searchParams.get('market');
  return null;
}

function pump() {
  while (active < CONCURRENCY && queue.length) queue.shift()!();
}

function preloadImage(src: string): Promise<void> {
  const previous = images.get(src);
  if (previous && (!previous.failedAt || Date.now() - previous.failedAt < 60_000)) return previous.promise;
  images.delete(src);
  if (images.size >= MAX_IMAGES) {
    // Retain decoded images across navigation; only evict completed old entries.
    for (const [key, entry] of images) {
      if (entry.settled) { images.delete(key); break; }
    }
    if (images.size >= MAX_IMAGES) return Promise.resolve();
  }
  const image = new Image();
  image.decoding = 'async';
  image.loading = 'eager';
  image.fetchPriority = 'low';
  let resolve!: () => void;
  const entry: LogoEntry = { image, promise: new Promise<void>(done => { resolve = done; }), settled: false };
  images.set(src, entry);
  queue.push(() => {
    active++;
    let finished = false;
    const finish = (failed: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      image.onload = image.onerror = null;
      entry.settled = true;
      if (failed) { entry.failedAt = Date.now(); image.removeAttribute('src'); }
      active--;
      resolve();
      pump();
    };
    const timer = setTimeout(() => finish(true), 12_000);
    image.onload = () => { void image.decode().then(() => finish(false), () => finish(false)); };
    image.onerror = () => finish(true);
    image.src = src;
  });
  pump();
  return entry.promise;
}

/** Return an already decoded fallback when the primary logo failed during warmup. */
export function preloadedHeatmapLogoSrc(primary: string, fallback?: string) {
  const alternate = fallback && images.get(fallback);
  return primary && images.get(primary)?.failedAt && alternate && !alternate.failedAt && alternate.image.naturalWidth > 0
    ? fallback! : primary;
}

export function prepareHeatmapLogoResources(resources: Record<string, unknown>): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve();
  const markets: string[][] = [];
  for (const [endpoint, payload] of Object.entries(resources)) {
    const market = marketForEndpoint(endpoint);
    const stocks = (payload as { stocks?: LogoStock[] } | null)?.stocks;
    if (!market || !Array.isArray(stocks)) continue;
    const urls: string[] = [];
    for (const stock of [...stocks].filter(stock => stock && typeof stock.code === 'string').sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))) {
      const primary = heatmapLogoPath(market, stock);
      if (primary) urls.push(primary);
      if (stock.fallbackLogoUrl && stock.fallbackLogoUrl !== primary) urls.push(stock.fallbackLogoUrl);
    }
    markets.push(urls);
  }
  const work: Promise<void>[] = [];
  // Interleave markets so a full A-share universe cannot delay all US/HK icons.
  const count = Math.max(0, ...markets.map(urls => urls.length));
  for (let index = 0; index < count; index++) {
    for (const urls of markets) if (urls[index]) work.push(preloadImage(urls[index]));
  }
  return Promise.all(work).then(() => undefined);
}
