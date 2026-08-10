import process from 'node:process';

const baseUrl = process.env.HEATMAP_BASE_URL || 'http://127.0.0.1:5180';
const markets = ['japan', 'korea', 'india', 'germany', 'france', 'uk'];
const expectedStocksPerMarket = 20;

async function fetchWithTimeout(url, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { cache: 'no-store', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const payloads = await Promise.all(markets.map(async (market) => {
  const response = await fetchWithTimeout(`${baseUrl}/api/global-market-heatmap?market=${market}`);
  if (!response.ok) throw new Error(`${market} 热力图 API 返回 ${response.status}`);
  return response.json();
}));

const failures = [];
const summaries = await Promise.all(payloads.map(async (payload) => {
  const stocks = Array.isArray(payload.stocks) ? payload.stocks : [];
  if (stocks.length !== expectedStocksPerMarket) {
    failures.push(`${payload.market}: 成分数量 ${stocks.length}/${expectedStocksPerMarket}`);
  }

  const duplicateSymbols = stocks
    .map((stock) => stock.symbol)
    .filter((symbol, index, symbols) => symbols.indexOf(symbol) !== index);
  if (duplicateSymbols.length) failures.push(`${payload.market}: 重复代码 ${duplicateSymbols.join(', ')}`);

  const results = await Promise.all(stocks.map(async (stock) => {
    if (!stock.logoUrl) return { symbol: stock.symbol, reason: '没有 logoUrl' };
    const response = await fetchWithTimeout(new URL(stock.logoUrl, baseUrl));
    const contentType = response.headers.get('content-type') || '';
    const svg = await response.text();
    if (!response.ok) return { symbol: stock.symbol, reason: `HTTP ${response.status}` };
    if (!contentType.includes('image/svg+xml')) return { symbol: stock.symbol, reason: `MIME ${contentType || '缺失'}` };
    if (!/<svg\b/i.test(svg)) return { symbol: stock.symbol, reason: '内容不是 SVG' };
    if (!/<(?:path|rect|circle|ellipse|polygon|polyline|line|image|text)\b/i.test(svg)) {
      return { symbol: stock.symbol, reason: 'SVG 不包含可见图形' };
    }
    return { symbol: stock.symbol };
  }));

  const invalid = results.filter((result) => result.reason);
  for (const result of invalid) failures.push(`${payload.market}/${result.symbol}: ${result.reason}`);
  return `${payload.market} ${stocks.length - invalid.length}/${stocks.length}`;
}));

if (failures.length) {
  throw new AggregateError(failures.map((failure) => new Error(failure)), `全球热力图 Logo 验证失败：\n${failures.join('\n')}`);
}

console.log(`六市场 Logo 端到端验证通过：${summaries.join(' · ')}`);
