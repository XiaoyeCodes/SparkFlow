export type PublicDataPolicy = {
  key: string;
  refreshMs: number;
  maxAgeMs: number;
  clientMs: number;
  warm: boolean;
  realtime: boolean;
};
const policies = new Map<string, PublicDataPolicy>();
export const REALTIME_QUOTE_INTERVAL_MS = 3_000;
const keyFor = (url: URL) => { url.searchParams.sort(); return url.pathname + url.search; };
function add(key: string, seconds: number, maxAgeSeconds: number, warm = false) {
  const canonical = keyFor(new URL(key, 'http://public.local'));
  policies.set(canonical, { key: canonical, refreshMs: seconds * 1000, maxAgeMs: maxAgeSeconds * 1000,
    clientMs: seconds === 3 ? 0 : Math.min(seconds * 1000, 15_000), warm, realtime: seconds === 3 });
}

// Finite allowlist: never broaden this to `/api/*`. No account, broker, research,
// settings, custom subscriptions, user-entered symbols or streaming resources.
add('/api/public-market-intelligence', 120, 600, true);
add('/api/market-quotes', 3, 90, true);
add('/api/global-macro-quotes', 3, 90, true);
for (const section of ['indices', 'metrics', 'policy', 'news']) {
  const seconds = section === 'indices' ? 3 : section === 'policy' ? 600 : 120;
  add(`/api/china-macro-dashboard?section=${section}`, seconds, section === 'indices' ? 120 : 1800, true);
}
for (const section of ['markets', 'macro', 'pmi', 'commodities', 'news', 'calendar']) {
  const seconds = ['markets', 'commodities'].includes(section) ? 60 : section === 'pmi' ? 900 : 120;
  add(`/api/global-macro-dashboard?region=global&section=${section}`, seconds, ['markets', 'commodities'].includes(section) ? 180 : 1800, true);
}
for (const region of ['apac', 'middleEast', 'europe', 'americas']) add(`/api/global-macro-dashboard?region=${region}&section=news`, 120, 1800);
add('/api/china-fisher?mode=loan', 60, 300);
add('/api/china-fisher?mode=deposit', 60, 300, true);
add('/api/china-gdp', 3600, 3600, true);
add('/api/china-income', 60, 900, true);
for (const market of ['china', 'hong-kong', 'us']) add(`/api/${market}-market-heatmap`, 3, 180);
// The browser applies Binance's live mini-ticker stream every three seconds.
// This REST snapshot is the resilient bootstrap/fallback, while its internally
// cached market-cap universe remains on a slower cadence.
add('/api/crypto-market-heatmap', 60, 900, true);
for (const id of ['nasdaq', 'sp500', 'shanghai', 'sox']) add(`/api/global-macro-core-index?id=${id}`, 3, 180);
for (const id of ['usd-jpy', 'usd-cny', 'usd-eur']) add(`/api/global-macro-fx-rate?id=${id}`, 3, 180);
for (const id of ['vix', 'dxy', 'us10y', 'gold', 'brent', 'bitcoin', 'ethereum']) add(`/api/global-macro-asset?id=${id}`, 3, 180);
for (const id of ['ppi', 'cpi', 'unemployment', 'nonfarm', 'pmi', 'pce']) add(`/api/us-macro-card?id=${id}`, 120, 900);
add('/api/global-macro-fed-rate', 900, 1800);
for (const endpoint of ['global-risk-sentiment', 'global-macro-ppi-expectation', 'fed-net-liquidity', 'financial-conditions']) {
  add(`/api/${endpoint}`, 120, endpoint === 'global-risk-sentiment' ? 300 : 900);
}
const international = ['japan', 'korea', 'india', 'germany', 'france', 'uk'];
for (const market of international) {
  add(`/api/global-market-heatmap?market=${market}`, 3, 180);
  add(`/api/international-market-overview?market=${market}`, 3, 180);
}
for (const market of ['australia', 'euro', 'saudi']) add(`/api/global-market-heatmap?market=${market}`, 3, 180);
for (const market of ['china', 'hongkong', 'us', ...international]) add(`/api/valuation-temperature?market=${market}`, 900, 3600);
for (const market of ['hongkong', 'us']) add(`/api/regional-market-content?market=${market}`, 300, 1800);
add('/api/bitcoin-cycle-history', 21600, 43200);
add('/api/us-market-system-status', 60, 180);

export const PUBLIC_DATA_POLICIES: readonly PublicDataPolicy[] = [...policies.values()];

export function resolvePublicDataPolicy(input: string | URL): PublicDataPolicy | undefined {
  const url = new URL(input.toString(), 'http://public.local');
  if (url.username || url.password) return;
  // Forced browser reloads may bypass browser memory, but never force upstream
  // work for every visitor. Background deadlines control public refreshes.
  for (const flag of ['fresh', 'refresh']) {
    if (url.searchParams.has(flag)) {
      if (url.searchParams.getAll(flag).length !== 1 || !['0', '1'].includes(url.searchParams.get(flag)!)) return;
      url.searchParams.delete(flag);
    }
  }
  if (url.pathname === '/api/global-macro-dashboard') {
    const region = url.searchParams.get('region') || 'global';
    if (!['global', 'apac', 'middleEast', 'europe', 'americas'].includes(region)) return;
    if (url.searchParams.getAll('region').length > 1) return;
    url.searchParams.set('region', url.searchParams.get('section') === 'news' ? region : 'global');
  }
  if (url.pathname === '/api/china-fisher' && !url.searchParams.has('mode')) url.searchParams.set('mode', 'loan');
  if (url.pathname === '/api/china-valuation-temperature') url.pathname = '/api/valuation-temperature';
  if (url.pathname === '/api/valuation-temperature' && !url.searchParams.has('market')) url.searchParams.set('market', 'china');
  return policies.get(keyFor(url));
}

export function isUsablePublicPayload(data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const record = data as Record<string, unknown>;
  const hasStaleFallback = (value: unknown): boolean => Boolean(value && typeof value === 'object'
    && ((value as Record<string, unknown>).stale === true || Object.values(value).some(hasStaleFallback)));
  if (hasStaleFallback(data)) return false;
  if (record.error || ['unavailable', 'pending', 'error', 'loading', 'expired'].includes(String(record.status))) return false;
  // Metadata, descriptions and dates alone do not constitute a usable snapshot.
  const ignore = /^(generatedAt|updatedAt|checkedAt|validUntil|nextCheckAt|nextReleaseAt|source|sources|sourceStatus|newsMeta|errors|methodology|message|note|detail|period|label|name|id|mode|status|version|_publicCache)$/;
  const useful = (value: unknown): boolean => {
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.some(item => useful(item) || (item && typeof item === 'object' && typeof item.title === 'string' && (typeof item.url === 'string' || typeof item.date === 'string')));
    if (!value || typeof value !== 'object') return false;
    const item = value as Record<string, unknown>;
    if (['unavailable', 'pending', 'error', 'expired'].includes(String(item.status))) return false;
    return Object.entries(item).some(([key, child]) => !ignore.test(key) && useful(child));
  };
  // Policy/operational status resources have no quote measurements.
  return useful(data) || (record.policy != null) || ['open', 'closed', 'normal', 'degraded'].includes(String(record.state));
}

export function validatePublicResource(key: string, data: unknown): boolean {
  if (!isUsablePublicPayload(data)) return false;
  const url = new URL(key, 'http://public.local');
  const row = data as Record<string, unknown>;
  if (url.pathname === '/api/public-market-intelligence') return isUsablePublicPayload({ indices: row.indices });
  if (url.pathname === '/api/global-macro-quotes') return isUsablePublicPayload({ markets: row.markets, coreIndices: row.coreIndices, commodities: row.commodities, fxRates: row.fxRates });
  if (url.pathname === '/api/china-macro-dashboard') {
    const section = url.searchParams.get('section')!;
    return isUsablePublicPayload({ [section]: row[section] });
  }
  if (url.pathname === '/api/global-macro-dashboard') {
    const section = url.searchParams.get('section');
    if (section === 'markets') return isUsablePublicPayload({ markets: row.markets, coreIndices: row.coreIndices, ticker: row.ticker });
    if (section === 'macro') return isUsablePublicPayload({ macro: row.macro, cpi: row.cpi });
    return isUsablePublicPayload({ [section!]: row[section!] });
  }
  return true;
}

export function publicDataExpiresAt(data: unknown): number {
  if (!data || typeof data !== 'object') return Infinity;
  const meta = (data as { _publicCache?: { expiresAt?: string } })._publicCache;
  if (!meta?.expiresAt) return Infinity;
  const expiresAt = Date.parse(meta.expiresAt);
  return Number.isFinite(expiresAt) ? expiresAt : 0;
}
