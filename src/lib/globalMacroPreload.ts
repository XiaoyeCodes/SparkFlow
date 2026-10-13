// Only the fixed public resources visible on the terminal's initial screen.
export const GLOBAL_MACRO_BOOTSTRAP_KEYS = [
  ...['markets', 'macro', 'pmi', 'commodities', 'news', 'calendar'].map(section =>
    `/api/global-macro-dashboard?region=global&section=${section}`),
  '/api/global-macro-quotes',
  '/api/global-macro-global-equity',
  ...['ppi', 'cpi', 'unemployment', 'nonfarm', 'pmi', 'pce'].map(id => `/api/us-macro-card?id=${id}`),
  ...['nasdaq', 'sp500', 'shanghai', 'sox'].map(id => `/api/global-macro-core-index?id=${id}`),
  ...['nasdaq', 'sp500', 'shanghai', 'sox'].map(id => `/api/global-macro-core-index-history?id=${id}`),
  ...['usd-jpy', 'usd-cny', 'usd-eur'].map(id => `/api/global-macro-fx-rate?id=${id}`),
  ...['vix', 'dxy', 'us10y', 'gold', 'brent', 'bitcoin', 'ethereum'].map(id => `/api/global-macro-asset?id=${id}`),
  '/api/global-macro-fed-rate', '/api/global-macro-treasury-spread', '/api/global-risk-sentiment',
  ...['vix', 'vxn', 'fear-greed'].map(id => `/api/global-risk-sentiment/${id}`),
  '/api/global-macro-ppi-expectation', '/api/financial-conditions',
] as const;

export type GlobalMacroBootstrap = { generatedAt: string; resources: Record<string, unknown> };
