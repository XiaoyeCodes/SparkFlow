import { currencyQuoteTime } from './macroCurrencyQuotes.ts';
import { TERMINAL_REGIONAL_INDICES, validTerminalRegionalQuote, type TerminalRegionalQuote } from '../src/lib/terminalRegionalIndices.ts';

export const SINA_TERMINAL_INDEX_URL = 'https://hq.sinajs.cn/list=sh000001,rt_hkHSI';
export const TENCENT_TERMINAL_INDEX_URL = 'https://qt.gtimg.cn/q=sh000001,hkHSI';

export function parseSinaTerminalIndices(text: string, now = Date.now()) {
  return TERMINAL_REGIONAL_INDICES.flatMap(config => {
    const fields = text.match(new RegExp(`(?:var\\s+)?hq_str_${config.sina}="([^"]*)"`))?.[1]?.split(',');
    if (!fields) return [];
    const cn = config.id === 'china', priceIndex = cn ? 3 : 6, priorIndex = cn ? 2 : 3;
    if (!fields[priceIndex]?.trim() || !fields[priorIndex]?.trim()) return [];
    const price = Number(fields[priceIndex]), previous = Number(fields[priorIndex]);
    if (!Number.isFinite(previous) || previous <= 0) return [];
    const computed = (price / previous - 1) * 100;
    const changePercent = cn ? computed : fields[8]?.trim() ? Number(fields[8]) : NaN;
    if (!Number.isFinite(changePercent) || Math.abs(changePercent - computed) > 0.06) return [];
    const quote = { id: config.id, name: config.name, symbol: config.symbol, price, changePercent,
      updatedAt: currencyQuoteTime(fields[cn ? 30 : 17]?.replaceAll('/', '-'), fields[cn ? 31 : 18]), sourceUrl: config.sourceUrl };
    return validTerminalRegionalQuote(quote, now) ? [quote] : [];
  });
}

export function parseTencentTerminalIndices(text: string, now = Date.now()) {
  return TERMINAL_REGIONAL_INDICES.flatMap(config => {
    const fields = text.match(new RegExp(`v_${config.tencent}="([^"]*)"`))?.[1]?.split('~');
    if (!fields || fields.length <= 32 || !fields[3]?.trim() || !fields[32]?.trim()) return [];
    const match = fields[30]?.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})[ T]?(\d{2}):?(\d{2}):?(\d{2})$/);
    const updatedAt = match ? currencyQuoteTime(`${match[1]}-${match[2]}-${match[3]}`, `${match[4]}:${match[5]}:${match[6]}`) : undefined;
    const quote = { id: config.id, name: config.name, symbol: config.symbol, price: Number(fields[3]), changePercent: Number(fields[32]),
      updatedAt, sourceUrl: `https://gu.qq.com/${config.tencent}` };
    const previous = Number(fields[4]);
    if (!fields[4]?.trim() || !Number.isFinite(previous) || previous <= 0
      || Math.abs(quote.changePercent - (quote.price / previous - 1) * 100) > 0.06) return [];
    return validTerminalRegionalQuote(quote, now) ? [quote] : [];
  });
}

/** The supplied transport must be direct. Never route these domestic feeds via the foreign proxy. */
export function createTerminalRegionalIndexLoader(fetchDirect: (url: string) => Promise<string>, now = Date.now) {
  let inFlight: Promise<TerminalRegionalQuote[]> | undefined;
  let cached: { at: number; quotes: TerminalRegionalQuote[] } | undefined;
  return () => {
    if (inFlight) return inFlight;
    if (cached && now() - cached.at < 3000) return Promise.resolve(cached.quotes);
    inFlight = (async () => {
      const primary = await fetchDirect(SINA_TERMINAL_INDEX_URL).then(text => parseSinaTerminalIndices(text, now())).catch(() => []);
      const backup = primary.length === TERMINAL_REGIONAL_INDICES.length
        && primary.every(quote => now() - Date.parse(quote.updatedAt!) < 20 * 60_000) ? []
        : await fetchDirect(TENCENT_TERMINAL_INDEX_URL).then(text => parseTencentTerminalIndices(text, now())).catch(() => []);
      const quotes = TERMINAL_REGIONAL_INDICES.flatMap(config => {
        const preferred = primary.find(item => item.id === config.id), alternative = backup.find(item => item.id === config.id);
        const quote = preferred && (!alternative || Date.parse(preferred.updatedAt!) >= Date.parse(alternative.updatedAt!)
          || now() - Date.parse(preferred.updatedAt!) < 20 * 60_000) ? preferred : alternative;
        return quote ? [quote] : [];
      });
      if (!quotes.length) throw new Error('上证与恒生直连主备来源暂不可用');
      cached = { at: now(), quotes };
      return quotes;
    })().finally(() => { inFlight = undefined; });
    return inFlight;
  };
}
