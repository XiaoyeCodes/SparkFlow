import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { ProxyAgent } from 'undici';

const tradingViewTickers = {
  '7203.T': 'TSE:7203',
  '8306.T': 'TSE:8306',
  '6758.T': 'TSE:6758',
  '6501.T': 'TSE:6501',
  '9983.T': 'TSE:9983',
  '6861.T': 'TSE:6861',
  '7974.T': 'TSE:7974',
  '9984.T': 'TSE:9984',
  '8035.T': 'TSE:8035',
  '6098.T': 'TSE:6098',
  '4063.T': 'TSE:4063',
  '4519.T': 'TSE:4519',
  '8058.T': 'TSE:8058',
  '8316.T': 'TSE:8316',
  '8766.T': 'TSE:8766',
  '9432.T': 'TSE:9432',
  '9433.T': 'TSE:9433',
  '6954.T': 'TSE:6954',
  '7267.T': 'TSE:7267',
  '7741.T': 'TSE:7741',
  '005930.KS': 'KRX:005930',
  '000660.KS': 'KRX:000660',
  '373220.KS': 'KRX:373220',
  '005380.KS': 'KRX:005380',
  '207940.KS': 'KRX:207940',
  '000270.KS': 'KRX:000270',
  '068270.KS': 'KRX:068270',
  '105560.KS': 'KRX:105560',
  '035420.KS': 'KRX:035420',
  '035720.KS': 'KRX:035720',
  '006400.KS': 'KRX:006400',
  '051910.KS': 'KRX:051910',
  '055550.KS': 'KRX:055550',
  '012330.KS': 'KRX:012330',
  '028260.KS': 'KRX:028260',
  '066570.KS': 'KRX:066570',
  '003550.KS': 'KRX:003550',
  '323410.KS': 'KRX:323410',
  '096770.KS': 'KRX:096770',
  '034730.KS': 'KRX:034730',
  'RELIANCE.NS': 'NSE:RELIANCE',
  'HDFCBANK.NS': 'NSE:HDFCBANK',
  'BHARTIARTL.NS': 'NSE:BHARTIARTL',
  'TCS.NS': 'NSE:TCS',
  'ICICIBANK.NS': 'NSE:ICICIBANK',
  'SBIN.NS': 'NSE:SBIN',
  'INFY.NS': 'NSE:INFY',
  'LICI.NS': 'NSE:LICI',
  'HINDUNILVR.NS': 'NSE:HINDUNILVR',
  'ITC.NS': 'NSE:ITC',
  'LT.NS': 'NSE:LT',
  'BAJFINANCE.NS': 'NSE:BAJFINANCE',
  'AXISBANK.NS': 'NSE:AXISBANK',
  'MARUTI.NS': 'NSE:MARUTI',
  'SUNPHARMA.NS': 'NSE:SUNPHARMA',
  'M&M.NS': 'NSE:M&M',
  'KOTAKBANK.NS': 'NSE:KOTAKBANK',
  'NTPC.NS': 'NSE:NTPC',
  'TITAN.NS': 'NSE:TITAN',
  'ONGC.NS': 'NSE:ONGC',
  'BHP.AX': 'ASX:BHP',
  'CBA.AX': 'ASX:CBA',
  'CSL.AX': 'ASX:CSL',
  'NAB.AX': 'ASX:NAB',
  'WBC.AX': 'ASX:WBC',
  'ANZ.AX': 'ASX:ANZ',
  'WES.AX': 'ASX:WES',
  'MQG.AX': 'ASX:MQG',
  'GMG.AX': 'ASX:GMG',
  'RIO.AX': 'ASX:RIO',
  'ASML.AS': 'EURONEXT:ASML',
  'SAP.DE': 'XETR:SAP',
  'MC.PA': 'EURONEXT:MC',
  'NOVO-B.CO': 'OMXCOP:NOVO_B',
  'OR.PA': 'EURONEXT:OR',
  'SIE.DE': 'XETR:SIE',
  'ALV.DE': 'XETR:ALV',
  'DTE.DE': 'XETR:DTE',
  'AIR.DE': 'XETR:AIR',
  'BAS.DE': 'XETR:BAS',
  'BMW.DE': 'XETR:BMW',
  'MBG.DE': 'XETR:MBG',
  'MUV2.DE': 'XETR:MUV2',
  'IFX.DE': 'XETR:IFX',
  'VOW3.DE': 'XETR:VOW3',
  'ADS.DE': 'XETR:ADS',
  'DBK.DE': 'XETR:DBK',
  'RHM.DE': 'XETR:RHM',
  'HEN3.DE': 'XETR:HEN3',
  'BEI.DE': 'XETR:BEI',
  'CON.DE': 'XETR:CON',
  'BAYN.DE': 'XETR:BAYN',
  'EOAN.DE': 'XETR:EOAN',
  'MRK.DE': 'XETR:MRK',
  'TTE.PA': 'EURONEXT:TTE',
  'AIR.PA': 'EURONEXT:AIR',
  'RMS.PA': 'EURONEXT:RMS',
  'SU.PA': 'EURONEXT:SU',
  'SAN.PA': 'EURONEXT:SAN',
  'BNP.PA': 'EURONEXT:BNP',
  'CS.PA': 'EURONEXT:CS',
  'EL.PA': 'EURONEXT:EL',
  'AI.PA': 'EURONEXT:AI',
  'SAF.PA': 'EURONEXT:SAF',
  'DG.PA': 'EURONEXT:DG',
  'ENGI.PA': 'EURONEXT:ENGI',
  'ACA.PA': 'EURONEXT:ACA',
  'CAP.PA': 'EURONEXT:CAP',
  'RI.PA': 'EURONEXT:RI',
  'DSY.PA': 'EURONEXT:DSY',
  'KER.PA': 'EURONEXT:KER',
  'HO.PA': 'EURONEXT:HO',
  'SHEL.L': 'LSE:SHEL',
  'AZN.L': 'LSE:AZN',
  'HSBA.L': 'LSE:HSBA',
  'ULVR.L': 'LSE:ULVR',
  'BP.L': 'LSE:BP.',
  'GSK.L': 'LSE:GSK',
  'BATS.L': 'LSE:BATS',
  'REL.L': 'LSE:REL',
  'RIO.L': 'LSE:RIO',
  'LSEG.L': 'LSE:LSEG',
  'DGE.L': 'LSE:DGE',
  'GLEN.L': 'LSE:GLEN',
  'NG.L': 'LSE:NG.',
  'RR.L': 'LSE:RR.',
  'BARC.L': 'LSE:BARC',
  'NWG.L': 'LSE:NWG',
  'LLOY.L': 'LSE:LLOY',
  'AAL.L': 'LSE:AAL',
  'PRU.L': 'LSE:PRU',
  'VOD.L': 'LSE:VOD',
  '2222.SR': 'TADAWUL:2222',
  '1120.SR': 'TADAWUL:1120',
  '2010.SR': 'TADAWUL:2010',
  '1180.SR': 'TADAWUL:1180',
  '7010.SR': 'TADAWUL:7010',
  '1211.SR': 'TADAWUL:1211',
  '1010.SR': 'TADAWUL:1010',
  '2280.SR': 'TADAWUL:2280',
  '7020.SR': 'TADAWUL:7020',
  '7203.SR': 'TADAWUL:7203',
};

const requiredMarketSymbols = {
  japan: ['7203.T', '8306.T', '6758.T', '6501.T', '9983.T', '6861.T', '7974.T', '9984.T', '8035.T', '6098.T', '4063.T', '4519.T', '8058.T', '8316.T', '8766.T', '9432.T', '9433.T', '6954.T', '7267.T', '7741.T'],
  korea: ['005930.KS', '000660.KS', '373220.KS', '005380.KS', '207940.KS', '000270.KS', '068270.KS', '105560.KS', '035420.KS', '035720.KS', '006400.KS', '051910.KS', '055550.KS', '012330.KS', '028260.KS', '066570.KS', '003550.KS', '323410.KS', '096770.KS', '034730.KS'],
  india: ['RELIANCE.NS', 'HDFCBANK.NS', 'BHARTIARTL.NS', 'TCS.NS', 'ICICIBANK.NS', 'SBIN.NS', 'INFY.NS', 'LICI.NS', 'HINDUNILVR.NS', 'ITC.NS', 'LT.NS', 'BAJFINANCE.NS', 'AXISBANK.NS', 'MARUTI.NS', 'SUNPHARMA.NS', 'M&M.NS', 'KOTAKBANK.NS', 'NTPC.NS', 'TITAN.NS', 'ONGC.NS'],
  germany: ['SAP.DE', 'SIE.DE', 'ALV.DE', 'DTE.DE', 'AIR.DE', 'BAS.DE', 'BMW.DE', 'MBG.DE', 'MUV2.DE', 'IFX.DE', 'VOW3.DE', 'ADS.DE', 'DBK.DE', 'RHM.DE', 'HEN3.DE', 'BEI.DE', 'CON.DE', 'BAYN.DE', 'EOAN.DE', 'MRK.DE'],
  france: ['MC.PA', 'OR.PA', 'TTE.PA', 'AIR.PA', 'RMS.PA', 'SU.PA', 'SAN.PA', 'BNP.PA', 'CS.PA', 'EL.PA', 'AI.PA', 'SAF.PA', 'DG.PA', 'ENGI.PA', 'ACA.PA', 'CAP.PA', 'RI.PA', 'DSY.PA', 'KER.PA', 'HO.PA'],
  uk: ['SHEL.L', 'AZN.L', 'HSBA.L', 'ULVR.L', 'BP.L', 'GSK.L', 'BATS.L', 'REL.L', 'RIO.L', 'LSEG.L', 'DGE.L', 'GLEN.L', 'NG.L', 'RR.L', 'BARC.L', 'NWG.L', 'LLOY.L', 'AAL.L', 'PRU.L', 'VOD.L'],
};

const requiredSymbols = Object.values(requiredMarketSymbols).flat();
const unmappedRequiredSymbols = requiredSymbols.filter((symbol) => !tradingViewTickers[symbol]);
if (unmappedRequiredSymbols.length) {
  throw new Error(`热力图 Logo 同步清单不完整：${unmappedRequiredSymbols.join(', ')}`);
}

const outputDirectory = path.resolve(process.cwd(), 'public', 'stock-logos');
const scannerUrl = 'https://scanner.tradingview.com/global/scan';
const configuredProxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const proxyAgent = new ProxyAgent(configuredProxyUrl || 'http://127.0.0.1:7890');
const fetchDispatchers = configuredProxyUrl ? [proxyAgent, undefined] : [undefined, proxyAgent];

function localName(symbol) {
  return `global-${symbol.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.svg`;
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 20_000) {
  let lastError;
  for (const dispatcher of fetchDispatchers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), dispatcher ? timeoutMs : Math.min(timeoutMs, 6_000));
    try {
      const response = await fetch(url, { ...init, signal: controller.signal, dispatcher });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function runPool(items, concurrency, worker) {
  const queue = [...items];
  const failures = [];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) return;
      try {
        await worker(item);
      } catch (error) {
        failures.push({ item, error });
      }
    }
  }));
  return failures;
}

await mkdir(outputDirectory, { recursive: true });

const scannerResponse = await fetchWithTimeout(scannerUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'User-Agent': 'SparkFlow global heatmap logo sync',
  },
  body: JSON.stringify({
    symbols: { tickers: Object.values(tradingViewTickers), query: { types: [] } },
    columns: ['name', 'description', 'logoid', 'type'],
  }),
});
const scannerPayload = await scannerResponse.json();
const logoIds = new Map(
  (scannerPayload.data || [])
    .filter((row) => row?.s && row?.d?.[2])
    .map((row) => [row.s, row.d[2]]),
);

const entries = Object.entries(tradingViewTickers);
const missingTickers = entries.filter(([, ticker]) => !logoIds.has(ticker));
if (missingTickers.length) {
  throw new Error(`TradingView 未返回以下公司 Logo：${missingTickers.map(([symbol, ticker]) => `${symbol}(${ticker})`).join(', ')}`);
}

const failures = await runPool(entries, 8, async ([symbol, ticker]) => {
  const logoId = logoIds.get(ticker);
  const response = await fetchWithTimeout(`https://s3-symbol-logo.tradingview.com/${encodeURIComponent(logoId)}--big.svg`);
  const svg = await response.text();
  if (!/^\s*(?:<!--[^]*?-->\s*)?<svg\b/i.test(svg)) throw new Error('响应不是 SVG');
  if (!/<(?:path|rect|circle|ellipse|polygon|polyline|line|image|text)\b/i.test(svg)) {
    throw new Error('SVG 不包含可见图形');
  }
  await writeFile(path.join(outputDirectory, localName(symbol)), svg, 'utf8');
});

if (failures.length) {
  throw new AggregateError(
    failures.map(({ error }) => error),
    `有 ${failures.length} 个 Logo 下载失败：${failures.map(({ item }) => item[0]).join(', ')}`,
  );
}

const marketCoverage = Object.entries(requiredMarketSymbols)
  .map(([market, symbols]) => `${market} ${symbols.length}/${symbols.length}`)
  .join(' · ');
console.log(`已同步 ${entries.length} 个全球热力图矢量 Logo 到 ${outputDirectory}`);
console.log(`六市场 Logo 覆盖率：${marketCoverage}`);
