import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

const HEATMAP_URL = process.env.SPARKFLOW_HEATMAP_URL
  || 'http://127.0.0.1:5174/api/china-market-heatmap';
const SCANNER_URL = 'https://scanner.tradingview.com/china/scan';
const LOGO_CDN = 'https://s3-symbol-logo.tradingview.com';
const OUTPUT_DIR = path.resolve('public/stock-logos');
const CONCURRENCY = 10;
const PROXY_URL = process.env.STOCK_LOGO_PROXY;
const LOGO_OVERRIDES = {
  '688825': {
    url: 'https://www.cxmt.com/statics/shuwon/assets/img/svg/logo.svg',
    logoId: 'cxmt-official',
    source: 'CXMT official website',
  },
  '001248': {
    url: `${LOGO_CDN}/china-resources-power-hldgs-co--big.svg`,
    logoId: 'china-resources-power-hldgs-co',
    source: 'TradingView symbol logo CDN',
  },
};

if (PROXY_URL) {
  setGlobalDispatcher(new ProxyAgent(PROXY_URL));
}

function tradingViewSymbol(code) {
  if (code.startsWith('6')) return `SSE:${code}`;
  if (code.startsWith('0') || code.startsWith('3')) return `SZSE:${code}`;
  return `BSE:${code}`;
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function runPool(items, worker) {
  let cursor = 0;
  const results = [];
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

const heatmap = await fetchJson(HEATMAP_URL);
const stocks = Array.isArray(heatmap.stocks) ? heatmap.stocks : [];
if (!stocks.length) throw new Error(`No stocks returned by ${HEATMAP_URL}`);

const scanner = await fetchJson(SCANNER_URL, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    symbols: {
      tickers: stocks.map((stock) => tradingViewSymbol(stock.code)),
      query: { types: [] },
    },
    columns: ['name', 'description', 'logoid'],
  }),
});

const logoIds = new Map(
  (scanner.data || [])
    .map((row) => [String(row.d?.[0] || ''), String(row.d?.[2] || '')])
    .filter(([code, logoId]) => code && logoId),
);

await mkdir(OUTPUT_DIR, { recursive: true });

const downloaded = await runPool(stocks, async (stock) => {
  const override = LOGO_OVERRIDES[stock.code];
  const logoId = logoIds.get(stock.code);
  if (!logoId && !override) return null;

  const response = await fetch(override?.url || `${LOGO_CDN}/${logoId}--big.svg`);
  if (!response.ok) return null;

  const svg = await response.text();
  if (!svg.includes('<svg')) return null;

  const file = `${stock.code}.svg`;
  await writeFile(path.join(OUTPUT_DIR, file), svg, 'utf8');
  return {
    code: stock.code,
    name: stock.name,
    file,
    logoId: override?.logoId || logoId,
    source: override?.source || 'TradingView symbol logo CDN',
  };
});

const logos = downloaded.filter(Boolean);
const manifest = {
  generatedAt: new Date().toISOString(),
  source: 'TradingView symbol logo CDN',
  requested: stocks.length,
  count: logos.length,
  logos,
};

await writeFile(
  path.join(OUTPUT_DIR, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);

console.log(`Saved ${logos.length}/${stocks.length} stock logos to ${OUTPUT_DIR}`);
