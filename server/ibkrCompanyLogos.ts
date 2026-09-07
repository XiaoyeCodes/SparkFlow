type Instrument = { symbol: string; currency: string; assetType: string; exchange?: string };
type Logo = { src: string | null; source: string | null };
const empty: Logo = { src: null, source: null };

export function logoIdentity(p: Instrument) {
  const symbol = p.symbol.trim().toUpperCase().replace(/ /g, '.');
  if (!['STK', 'ETF'].includes(p.assetType) || !/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(symbol)) return null;
  const exchange = (p.exchange ?? 'SMART').toUpperCase();
  if (p.currency === 'USD') {
    const venues: Record<string, string> = { NASDAQ: 'NASDAQ', ISLAND: 'NASDAQ', NYSE: 'NYSE', ARCA: 'AMEX', NYSEARCA: 'AMEX', AMEX: 'AMEX', BATS: 'BATS' };
    const candidates = venues[exchange] ? [venues[exchange]] : ['', 'SMART'].includes(exchange) ? ['NASDAQ', 'NYSE', 'AMEX', 'BATS'] : [];
    if (!candidates.length) return null;
    return { file: `us-${symbol.replaceAll('.', '_')}.svg`, tickers: candidates.map(x => `${x}:${symbol}`) };
  }
  if (p.currency === 'HKD' && ['SEHK', 'HKEX', 'SMART', ''].includes(exchange) && /^\d{1,5}$/.test(symbol)) {
    return { file: `hk-${symbol.padStart(5, '0')}.svg`, tickers: [`HKEX:${Number(symbol)}`] };
  }
  if (['CNY', 'CNH'].includes(p.currency) && /^\d{6}$/.test(symbol)) {
    const venue = symbol.startsWith('6') ? 'SSE' : /^[03]/.test(symbol) ? 'SZSE' : null;
    if (venue) return { file: `${symbol}.svg`, tickers: [`${venue}:${symbol}`] };
  }
  return null;
}

// Public instrument metadata only: no account identifiers, quantities or credentials.
export class CompanyLogos {
  private cache = new Map<string, { until: number; logo: Logo }>();
  private flights = new Map<string, Promise<Logo>>();
  constructor(private scan: (tickers: string[]) => Promise<any>, private hasLocal: (file: string) => Promise<boolean>) {}
  resolve(instrument: Instrument): Promise<Logo> {
    const identity = logoIdentity(instrument);
    if (!identity) return Promise.resolve(empty);
    const key = identity.tickers.join(',');
    const cached = this.cache.get(key);
    if (cached && cached.until > Date.now()) return Promise.resolve(cached.logo);
    const flight = this.flights.get(key);
    if (flight) return flight;
    const request = (async (): Promise<Logo> => {
      if (await this.hasLocal(identity.file)) return { src: `/stock-logos/${identity.file}`, source: 'TradingView · 本地 Logo 库' };
      const data = await this.scan(identity.tickers);
      const ids = new Set<string>();
      for (const row of Array.isArray(data?.data) ? data.data : []) {
        const id = row?.d?.[0];
        if (identity.tickers.includes(row?.s) && typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_/-]{0,160}$/.test(id) && !id.includes('//')) ids.add(id);
      }
      if (ids.size !== 1) return empty;
      return { src: `https://s3-symbol-logo.tradingview.com/${[...ids][0]}--big.svg`, source: 'TradingView' };
    })().catch(() => empty).then(logo => {
      this.cache.set(key, { logo, until: Date.now() + (logo.src ? 86400000 : 60000) });
      if (this.cache.size > 1000) this.cache.delete(this.cache.keys().next().value!);
      return logo;
    }).finally(() => this.flights.delete(key));
    this.flights.set(key, request);
    return request;
  }
}

export class CompanyLogoImages {
  private cache = new Map<string, { at: number; bytes: Uint8Array }>();
  private flights = new Map<string, Promise<Uint8Array>>();
  constructor(private download: (url: string) => Promise<Uint8Array>) {}
  get(url: string): Promise<Uint8Array> {
    if (!/^https:\/\/s3-symbol-logo\.tradingview\.com\/[\w/-]+--big\.svg$/.test(url)) return Promise.reject(new Error('Invalid logo source'));
    const cached = this.cache.get(url);
    if (cached && Date.now() - cached.at < 86400000) return Promise.resolve(cached.bytes);
    const flight = this.flights.get(url);
    if (flight) return flight;
    const request = this.download(url).then(bytes => {
      if (bytes.byteLength > 512000 || !new TextDecoder().decode(bytes).includes('<svg')) throw new Error('Invalid logo image');
      this.cache.set(url, { at: Date.now(), bytes });
      if (this.cache.size > 250) this.cache.delete(this.cache.keys().next().value!);
      return bytes;
    }).finally(() => this.flights.delete(url));
    this.flights.set(url, request);
    return request;
  }
}
