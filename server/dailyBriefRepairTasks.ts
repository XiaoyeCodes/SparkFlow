import type { DailyBriefEditorialSnapshot as Editorial, DailyBriefSnapshot, DailyBriefUpstreamQuote as Quote } from '../src/lib/dailyBriefTypes.ts';
import type { DailyBriefRepairTask } from './dailyBriefRepair.ts';

// Only absent measurements/series are filled. Valid daily observations remain frozen.
export function fillBriefGaps<T>(current: T, incoming: T): T {
  if (incoming == null) return current;
  if (current == null) return structuredClone(incoming);
  if (Array.isArray(current) && Array.isArray(incoming)) {
    if (!current.length) return structuredClone(incoming) as T;
    const key = (item: any) => item?.symbol || item?.id || item?.label;
    if (!current.every(key)) return current;
    const rows = [...current];
    for (const item of incoming) {
      const index = rows.findIndex(row => key(row) === key(item));
      if (index < 0) rows.push(structuredClone(item)); else rows[index] = fillBriefGaps(rows[index], item);
    }
    return rows as T;
  }
  if (typeof current !== 'object' || typeof incoming !== 'object') return current;
  const before = current as Record<string, any>, after = incoming as Record<string, any>;
  for (const field of ['price', 'value']) {
    if (field in before && before[field] == null && Number.isFinite(after[field])) {
      return { ...structuredClone(after), ...(before.history?.length ? { history: before.history } : {}) } as T;
    }
  }
  const result = { ...before };
  for (const [key, value] of Object.entries(after)) result[key] = fillBriefGaps(before[key], value);
  return result as T;
}

type CryptoData = Pick<Editorial, 'crypto' | 'btcTechnical' | 'futuresLongShort' | 'derivativesSentiment' | 'binanceLiquidations' | 'derivativeInputs'>
  & Pick<Editorial['onchain'], 'fundingRate' | 'openInterest' | 'dominance'>;
type Metric = Editorial['sentiment']['vix'];
export type BriefRepairLoaders = {
  yahoo: (symbol: string, range: string) => Promise<{ price: number; changePercent: number; change: number; sourceUrl: string; history: NonNullable<Quote['history']> }>;
  yahooConfigs: Array<{ symbol: string; displaySymbol: string; name: string; kind: 'stock' | 'index' | 'asset'; macro?: boolean }>;
  crypto: (only: readonly number[], previous: Editorial) => Promise<CryptoData>;
  cryptoFear: () => Promise<{ metric: Metric; history: Editorial['sentiment']['cryptoHistory'] }>;
  stockFear: () => Promise<{ metric: Metric; components: Editorial['sentiment']['stockComponents'] }>;
  coinMetrics: () => Promise<{ mvrvZScore: Metric; puellMultiple: Metric }>;
  glassnode: (only: readonly string[]) => Promise<Record<string, Metric>>;
  hasGlassnodeKey: () => boolean;
  day1Metrics: () => Promise<Editorial['day1BtcMetrics']>;
  cycle: () => Promise<{ points: Array<{ time: string; value: number }> }>;
  news?: () => Promise<DailyBriefSnapshot['news']>;
  calendar?: () => Promise<Editorial['events']>;
};

const missing = (value: unknown) => typeof value !== 'number' || !Number.isFinite(value);
const quoteIn = (e: Editorial, symbol: string) => e.crypto.find(item => item.symbol === symbol);

export function createDailyBriefRepairTasks(loaders: BriefRepairLoaders): DailyBriefRepairTask[] {
  const tasks: DailyBriefRepairTask[] = [];
  const add = <T>(id: string, label: string, needed: (e: Editorial) => boolean, load: (e: Editorial) => Promise<T>,
    apply: (e: Editorial, value: T, draft: DailyBriefSnapshot) => void, blocked?: () => string | undefined) => {
    tasks.push({ id, label, needed: s => Boolean(s.editorial && needed(s.editorial)), blocked,
      load: async s => { const value = await load(s.editorial!); return draft => apply(draft.editorial!, value, draft); } });
  };

  const unique = [...new Map(loaders.yahooConfigs.map(config => [config.symbol, config])).values()];
  for (const config of unique) {
    const target = (e: Editorial) => config.kind === 'stock' ? e.stocks.find(q => q.symbol === config.displaySymbol)
      : config.kind === 'index' ? e.indices.find(q => q.symbol === config.displaySymbol)
      : e.assetGroups.flatMap(group => group.items).find(q => q.symbol === config.displaySymbol)
        || e.macroAssets.find(q => q.symbol === config.displaySymbol);
    add(`yahoo:${config.symbol}`, `${config.name}行情`, e => missing(target(e)?.price)
      || ((!config.macro || e.assetGroups.some(g => g.items.some(q => q.symbol === config.displaySymbol))) && !target(e)?.history?.length), () => loaders.yahoo(config.symbol, '3mo'), (e, quote, draft) => {
      if (missing(quote.price)) throw new Error('报价缺失');
      const value: Quote = { symbol: config.displaySymbol, name: config.name, price: quote.price,
        changePercent: quote.changePercent, history: quote.history.slice(-63), sourceUrl: quote.sourceUrl,
        marketState: 'DELAYED', display: config.displaySymbol === 'US10Y' ? `${quote.price.toFixed(3)}%` : `$${quote.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}` };
      if (config.kind === 'stock') e.stocks = fillBriefGaps(e.stocks, [value]);
      if (config.kind === 'index') e.indices = fillBriefGaps(e.indices, [value]);
      for (const group of e.assetGroups) {
        if (group.items.some(item => item.symbol === value.symbol)) group.items = fillBriefGaps(group.items, [value]);
      }
      if (config.macro || e.macroAssets.some(item => item.symbol === value.symbol)) e.macroAssets = fillBriefGaps(e.macroAssets, [value]);
      if (config.kind === 'index') draft.markets = fillBriefGaps(draft.markets, [{ id: value.symbol.toLowerCase(), name: value.name,
        symbol: value.symbol, value: value.price, display: value.display || String(value.price), changePercent: value.changePercent, sourceUrl: value.sourceUrl }]);
    });
  }
  add('vix', 'VIX', e => missing(e.sentiment.vix.value), () => loaders.yahoo('^VIX', '1mo'), (e, q, draft) => {
    if (missing(q.price)) throw new Error('VIX缺失');
    e.sentiment.vix = { ...e.sentiment.vix, value: q.price, display: q.price.toFixed(2), change: q.change, status: 'delayed', sourceUrl: q.sourceUrl };
    draft.macro = fillBriefGaps(draft.macro, [{ id: 'vix', name: 'VIX 波动率', symbol: 'VIX', value: q.price,
      display: q.price.toFixed(2), changePercent: q.changePercent, sourceUrl: q.sourceUrl }]);
  });
  add('crypto-fng', '加密情绪', e => missing(e.sentiment.cryptoFearGreed.value) || !e.sentiment.cryptoHistory?.length,
    loaders.cryptoFear, (e, v) => { e.sentiment.cryptoFearGreed = fillBriefGaps(e.sentiment.cryptoFearGreed, v.metric); e.sentiment.cryptoHistory = fillBriefGaps(e.sentiment.cryptoHistory, v.history); });
  add('cnn-fng', 'CNN情绪及分项', e => missing(e.sentiment.stockFearGreed.value) || !e.sentiment.stockComponents?.length || e.sentiment.stockComponents.some(c => missing(c.value)),
    loaders.stockFear, (e, v) => { e.sentiment.stockFearGreed = fillBriefGaps(e.sentiment.stockFearGreed, v.metric); e.sentiment.stockComponents = fillBriefGaps(e.sentiment.stockComponents, v.components); });

  const cryptoParts: Array<[number, string, (e: Editorial) => boolean]> = [
    [0, 'BTC/ETH/SOL现价', e => ['BTC', 'ETH', 'SOL'].some(s => missing(quoteIn(e, s)?.price))],
    [1, '资金费率及标记价格', e => missing(e.onchain.fundingRate.value) || (missing(e.onchain.openInterest.value) && missing(e.derivativeInputs?.markPrice))],
    [2, '持仓量', e => missing(e.onchain.openInterest.value) && missing(e.derivativeInputs?.contracts)],
    [3, 'BTC账户多空比', e => missing(e.futuresLongShort?.longAccount) || missing(e.futuresLongShort?.shortAccount) || missing(e.futuresLongShort?.longShortRatio)],
    [4, 'BTC主动买卖比', e => missing(e.derivativesSentiment?.takerBuySellRatio)],
    [5, 'BTC大户持仓比', e => missing(e.derivativesSentiment?.topTraderLong)],
    [6, 'BTC持仓变化', e => missing(e.derivativesSentiment?.oiChange5m)],
    [7, 'BTC市值占比', e => missing(e.onchain.dominance.value)],
    [8, 'HYPE现价', e => missing(quoteIn(e, 'HYPE')?.price)],
    [9, 'Binance清算数据', e => missing(e.binanceLiquidations?.totalUsd) || missing(e.binanceLiquidations?.longUsd) || missing(e.binanceLiquidations?.shortUsd)],
    [10, 'BTC历史及关键区间', e => !quoteIn(e, 'BTC')?.history?.length || !e.btcTechnical],
    [11, 'ETH历史', e => !quoteIn(e, 'ETH')?.history?.length],
    [12, 'SOL历史', e => !quoteIn(e, 'SOL')?.history?.length],
    [13, 'HYPE历史', e => !quoteIn(e, 'HYPE')?.history?.length],
  ];
  for (const [part, label, needed] of cryptoParts) add(`crypto:${part}`, label, needed,
    e => loaders.crypto([part], e), (e, value, draft) => {
      e.crypto = fillBriefGaps(e.crypto, value.crypto);
      draft.markets = fillBriefGaps(draft.markets, e.crypto.map(q => ({ id: q.symbol.toLowerCase(), name: q.name, symbol: q.symbol,
        value: q.price, display: q.display || String(q.price ?? '—'), changePercent: q.changePercent, sourceUrl: q.sourceUrl })));
      for (const group of e.assetGroups) if (group.id === 'crypto') group.items = fillBriefGaps(group.items, value.crypto);
      e.onchain = fillBriefGaps(e.onchain, { ...e.onchain, fundingRate: value.fundingRate, openInterest: value.openInterest, dominance: value.dominance });
      e.derivativeInputs = fillBriefGaps(e.derivativeInputs, value.derivativeInputs);
      e.btcTechnical = fillBriefGaps(e.btcTechnical, value.btcTechnical);
      e.futuresLongShort = fillBriefGaps(e.futuresLongShort, value.futuresLongShort);
      e.derivativesSentiment = fillBriefGaps(e.derivativesSentiment, value.derivativesSentiment);
      e.binanceLiquidations = fillBriefGaps(e.binanceLiquidations, value.binanceLiquidations);
      const { markPrice, contracts } = e.derivativeInputs || {};
      if (missing(e.onchain.openInterest.value) && !missing(markPrice) && !missing(contracts)) {
        const usd = markPrice! * contracts!;
        e.onchain.openInterest = { ...e.onchain.openInterest, value: usd, display: `$${(usd / 1_000_000_000).toFixed(2)}B`, status: 'live' };
      }
      const d = e.derivativesSentiment;
      const ratio = d?.takerBuySellRatio;
      const values = [e.futuresLongShort?.longAccount, ratio != null && ratio > 0 ? 50 + Math.max(-35, Math.min(35, Math.log(ratio) * 30)) : null,
        d?.topTraderLong, e.onchain.fundingRate.value != null ? 50 + Math.max(-20, Math.min(20, e.onchain.fundingRate.value * 200)) : null].filter((v): v is number => !missing(v));
      if (d && missing(d.score) && values.length >= 3) d.score = Math.round(values.reduce((sum, v) => sum + v, 0) / values.length * 10) / 10;
    });

  add('coinmetrics', 'MVRV及Puell', e => missing(e.sentiment.mvrvZScore.value) || missing(e.onchain.puellMultiple.value),
    loaders.coinMetrics, (e, v) => { e.sentiment.mvrvZScore = fillBriefGaps(e.sentiment.mvrvZScore, v.mvrvZScore); e.onchain.puellMultiple = fillBriefGaps(e.onchain.puellMultiple, v.puellMultiple); });
  const glassnode: Array<[string, string[], (e: Editorial) => Metric, (e: Editorial, v: Metric) => void]> = [
    ['lthSupplyRatio', ['supply/lth_sum', 'supply/current'], e => e.sentiment.lthSupplyRatio, (e, v) => { e.sentiment.lthSupplyRatio = v; }],
    ['sopr', ['indicators/sopr'], e => e.onchain.sopr, (e, v) => { e.onchain.sopr = v; e.sentiment.sopr = v; }],
    ['lthSopr', ['indicators/lth_sopr'], e => e.onchain.lthSopr, (e, v) => { e.onchain.lthSopr = v; }],
  ];
  for (const [key, paths, read, write] of glassnode) add(`glassnode:${key}`, `Glassnode ${key}`, e => missing(read(e)?.value),
    () => loaders.glassnode(paths), (e, v) => { if (!missing(v[key]?.value)) write(e, v[key]); },
    () => loaders.hasGlassnodeKey() ? undefined : '缺少Glassnode授权配置，配置后自动重试');
  add('day1-metrics', 'Day1链上指标', e => !e.day1BtcMetrics || Object.entries(e.day1BtcMetrics).some(([k, v]) => !['sourceUrl', 'updatedAt'].includes(k) && missing(v)),
    loaders.day1Metrics, (e, v) => { e.day1BtcMetrics = fillBriefGaps(e.day1BtcMetrics, v); });
  add('btc-cycle', 'BTC长期历史', e => !e.marketSeries.some(s => s.symbol === 'BTC' && s.points.length) || missing(e.onchain.wma200Multiple.value), loaders.cycle, (e, v) => {
    const rows = v.points.slice(-31), base = rows[0]?.value;
    if (!base) throw new Error('BTC历史缺失');
    e.marketSeries = fillBriefGaps(e.marketSeries, [{ symbol: 'BTC', name: 'Bitcoin', color: '#8891c9', changePercent: (rows.at(-1)!.value / base - 1) * 100,
      points: rows.map(p => ({time: p.time, value: p.value / base * 100})) }]);
    const samples = v.points.slice(-1400);
    const mean = samples.length >= 1300 ? samples.reduce((sum, p) => sum + p.value, 0) / samples.length : 0;
    if (mean > 0 && missing(e.onchain.wma200Multiple.value)) {
      const multiple = (quoteIn(e, 'BTC')?.price ?? rows.at(-1)!.value) / mean;
      e.onchain.wma200Multiple = { ...e.onchain.wma200Multiple, value: multiple, display: `${multiple.toFixed(2)}x`, status: 'delayed' };
    }
  });
  if (loaders.news) tasks.push({ id: 'news', label: '简报新闻', needed: s => !s.news.length,
    load: async () => { const news = await loaders.news!(); return draft => { draft.news = fillBriefGaps(draft.news, news); }; } });
  if (loaders.calendar) add('calendar', '事件日历', e => !e.events.length, loaders.calendar,
    (e, events) => { e.events = fillBriefGaps(e.events, events); });
  // Derived coverage must follow newly filled inputs, without refreshing valid quotes.
  for (const task of tasks) {
    const load = task.load;
    task.load = async snapshot => {
      const patch = await load(snapshot);
      return draft => {
        patch(draft);
        const e = draft.editorial!;
        if (!e.marketSeries.some(series => series.symbol === 'MAG7' && series.points.length)) {
          const histories = e.stocks.map(stock => stock.history?.slice(-31) || []);
          const dates = [...new Set(histories.flatMap(history => history.map(p => p.time.slice(0, 10))))].sort();
          const points = dates.flatMap(time => {
            const normalized = histories.flatMap(history => {
              const base = history[0]?.value, current = history.find(p => p.time.slice(0, 10) === time)?.value;
              return base && current ? [current / base * 100] : [];
            });
            return normalized.length < 4 ? [] : [{ time, value: normalized.reduce((sum, v) => sum + v, 0) / normalized.length }];
          });
          if (points.length > 1) e.marketSeries = fillBriefGaps(e.marketSeries, [{ symbol: 'MAG7', name: 'MAG7 等权', color: '#8fd0ac',
            changePercent: points.at(-1)!.value - 100, points }]);
        }
        const scale = (v: number | null, fn: (n: number) => number) => missing(v) ? null : fn(v!);
        const values = [e.sentiment.cryptoFearGreed.value, e.sentiment.stockFearGreed.value,
          scale(e.sentiment.mvrvZScore.value, v => v / 7 * 100), scale(e.onchain.sopr.value, v => (v - .95) / .15 * 100),
          scale(e.onchain.lthSopr.value, v => (v - .8) / 2.2 * 100), scale(e.onchain.wma200Multiple.value, v => (v - .7) / 3.3 * 100),
          scale(e.onchain.puellMultiple.value, v => v / 4 * 100), scale(e.onchain.fundingRate.value, v => 50 + v * 2500)]
          .filter((v): v is number => !missing(v));
        const coverage = Math.round(values.length / 8 * 100);
        if (coverage > e.signals.coverage) {
          const top = values.length < 4 ? null : Math.round(values.reduce((sum, v) => sum + Math.max(0, Math.min(100, v)), 0) / values.length);
          e.signals = { ...e.signals, coverage, top, bottom: top === null ? null : 100 - top };
        }
      };
    };
  }
  return tasks;
}
