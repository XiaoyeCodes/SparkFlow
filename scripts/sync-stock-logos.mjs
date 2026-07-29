import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

const LOGO_CDN = 'https://s3-symbol-logo.tradingview.com';
const OUTPUT_DIR = path.resolve('public/stock-logos');
const CONCURRENCY = 10;
const PROXY_URL = process.env.STOCK_LOGO_PROXY
  || process.env.HTTPS_PROXY
  || process.env.HTTP_PROXY;
const CHINA_LOGO_OVERRIDES = {
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
const US_LOGO_OVERRIDES = {
  XOM: {
    url: `${LOGO_CDN}/exxon--big.svg`,
    logoId: 'exxon',
    source: 'TradingView symbol logo CDN',
  },
  HON: {
    url: `${LOGO_CDN}/honeywell--big.svg`,
    logoId: 'honeywell',
    source: 'TradingView symbol logo CDN',
  },
  HONA: {
    url: `${LOGO_CDN}/honeywell--big.svg`,
    logoId: 'honeywell',
    source: 'TradingView symbol logo CDN',
  },
};

const TARGETS = {
  china: {
    label: 'A-share',
    heatmapUrl: process.env.SPARKFLOW_HEATMAP_URL
      || 'http://127.0.0.1:5174/api/china-market-heatmap',
    scannerUrl: 'https://scanner.tradingview.com/china/scan',
    scannerCode: (code) => code,
    tradingViewSymbol: (code) => {
      if (code.startsWith('6')) return `SSE:${code}`;
      if (code.startsWith('0') || code.startsWith('3')) return `SZSE:${code}`;
      return `BSE:${code}`;
    },
    fileName: (code) => `${code}.svg`,
    manifestName: 'manifest.json',
    overrides: CHINA_LOGO_OVERRIDES,
  },
  hongkong: {
    label: 'Hong Kong',
    heatmapUrl: process.env.SPARKFLOW_HONG_KONG_HEATMAP_URL
      || 'http://127.0.0.1:5174/api/hong-kong-market-heatmap',
    scannerUrl: 'https://scanner.tradingview.com/hongkong/scan',
    scannerCode: (code) => code.replace(/^0+(?=\d)/, ''),
    tradingViewSymbol: (code) => `HKEX:${code.replace(/^0+(?=\d)/, '')}`,
    fileName: (code) => `hk-${code}.svg`,
    manifestName: 'manifest-hong-kong.json',
    overrides: {},
  },
  us: {
    label: 'US',
    heatmapUrl: process.env.SPARKFLOW_US_HEATMAP_URL
      || 'http://127.0.0.1:5174/api/us-market-heatmap',
    scannerUrl: 'https://scanner.tradingview.com/america/scan',
    scannerCode: (code) => code.replaceAll('_', '.'),
    tradingViewSymbol: (code, stock) =>
      `${stock.exchange}:${code.replaceAll('_', '.')}`,
    fileName: (code) => `us-${code}.svg`,
    manifestName: 'manifest-us.json',
    overrides: US_LOGO_OVERRIDES,
  },
};

if (PROXY_URL) {
  setGlobalDispatcher(new ProxyAgent(PROXY_URL));
}

async function fetchWithRetry(url, init, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (!response.ok) throw new Error(`${url} returned ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 600));
      }
    }
  }
  throw lastError;
}

async function fetchJson(url, init) {
  const response = await fetchWithRetry(url, init);
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

async function syncTarget(target) {
  const heatmap = await fetchJson(target.heatmapUrl);
  const stocks = Array.isArray(heatmap.stocks) ? heatmap.stocks : [];
  if (!stocks.length) throw new Error(`No stocks returned by ${target.heatmapUrl}`);

  const scanner = await fetchJson(target.scannerUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      symbols: {
        tickers: stocks.map((stock) => target.tradingViewSymbol(stock.code, stock)),
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
    const override = target.overrides[stock.code];
    const logoId = logoIds.get(target.scannerCode(stock.code));
    if (!logoId && !override) return null;

    const response = await fetchWithRetry(
      override?.url || `${LOGO_CDN}/${logoId}--big.svg`,
    ).catch(() => null);
    if (!response) return null;

    const svg = await response.text();
    if (!svg.includes('<svg')) return null;

    const file = target.fileName(stock.code);
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
    market: target.label,
    source: 'TradingView symbol logo CDN',
    requested: stocks.length,
    count: logos.length,
    logos,
  };

  await writeFile(
    path.join(OUTPUT_DIR, target.manifestName),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  console.log(`Saved ${logos.length}/${stocks.length} ${target.label} stock logos to ${OUTPUT_DIR}`);
}

const marketArgument = process.argv.find((argument) => argument.startsWith('--market='))?.split('=')[1] || 'all';
const selectedTargets = marketArgument === 'all'
  ? Object.values(TARGETS)
  : [TARGETS[marketArgument]].filter(Boolean);

if (!selectedTargets.length) {
  throw new Error(`Unknown market "${marketArgument}". Use china, hongkong, us, or all.`);
}

for (const target of selectedTargets) {
  await syncTarget(target);
}
