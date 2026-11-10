import type { GravityHistory, GravityPoint, GravitySymbol } from '../src/lib/etfGravity.ts';

const DAY = 86_400_000;
const VWAP_START = '2020-01-01';
const FIRST_SESSION = { SPY: '1993-01-29', QQQ: '1999-03-10' };

type DailyBar = { day: number; date: string; close: number; turnover: number; volume: number };
type Column = Array<number | null>;
type YahooChart = {
  chart?: { result?: Array<{
    meta?: { symbol?: string; currency?: string; currentTradingPeriod?: { regular?: { end?: number } } };
    timestamp?: number[];
    indicators?: {
      quote?: Array<{ high?: Column; low?: Column; close?: Column; volume?: Column }>;
      adjclose?: Array<{ adjclose?: Column }>;
    };
  }> };
};

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function closedBars(payload: YahooChart, symbol: GravitySymbol, now: number): DailyBar[] {
  const result = payload.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const adjusted = result?.indicators?.adjclose?.[0]?.adjclose;
  if (result?.meta?.symbol !== symbol || result.meta.currency !== 'USD' || !quote || !adjusted) {
    throw new Error('缺少 ETF 美元复权日线');
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const end = (result.meta.currentTradingPeriod?.regular?.end ?? 0) * 1000;
  const bars: DailyBar[] = [];
  for (const [index, stamp] of (result.timestamp ?? []).entries()) {
    const date = new Date(stamp * 1000).toISOString().slice(0, 10);
    // Today's Yahoo daily candle also exists during the session. Wait for its close.
    if (date > today || (date === today && (!end || now < end || new Date(end).toISOString().slice(0, 10) !== date))) continue;
    const close = adjusted[index];
    if (!positive(close) || (bars.length && date <= bars[bars.length - 1].date)) throw new Error('ETF 日线不完整');
    let turnover = 0;
    let volume = 0;
    if (symbol === 'SPY' && date >= VWAP_START) {
      const raw = quote.close?.[index], high = quote.high?.[index], low = quote.low?.[index], shares = quote.volume?.[index];
      if (!positive(raw) || !positive(high) || !positive(low) || !positive(shares)) throw new Error('缺少 SPY 量价数据');
      volume = shares;
      turnover = ((high + low + raw) / 3) * (close / raw) * volume;
    }
    bars.push({ day: Date.parse(date) / DAY, date, close, turnover, volume });
  }
  if (bars[0]?.date !== FIRST_SESSION[symbol] || bars.length < (now / DAY - bars[0].day) * 0.65) {
    throw new Error('ETF 上市以来日线覆盖不足');
  }
  return bars;
}

function quantile(sorted: number[], fraction: number) {
  const index = (sorted.length - 1) * fraction;
  const low = Math.floor(index);
  return sorted[low] + (index - low) * (sorted[Math.ceil(index)] - sorted[low]);
}

export function buildGravityHistory(symbol: GravitySymbol, payload: YahooChart, now: number): GravityHistory {
  const bars = closedBars(payload, symbol, now);
  let start = 0, sum = 0, turnover = 0, volume = 0;
  const points: GravityPoint[] = bars.map((bar, index) => {
    sum += bar.close;
    while (bars[start].day <= bar.day - 200 * 7) {
      sum -= bars[start].close;
      start++;
    }
    const twap = sum / (index - start + 1);
    turnover += bar.turnover;
    volume += bar.volume;
    return { date: bar.date, close: bar.close, twap, premium: (bar.close / twap - 1) * 100,
      score: 0, level: 1, vwap: volume > 0 ? turnover / volume : null };
  });
  const premiums = points.map(point => point.premium).sort((a, b) => a - b);
  const low = quantile(premiums, 0.01), high = quantile(premiums, 0.99);
  if (high <= low) throw new Error('ETF 历史溢价区间无效');
  const validUntil = new Date((bars[bars.length - 1].day + 8) * DAY).toISOString();
  if (Date.parse(validUntil) <= now) throw new Error('ETF 行情源尚未更新');
  // The reference plots the last session of each week before 2020, daily thereafter.
  // Both the rolling mean and the historical percentiles use the full daily series.
  const week = (day: number) => Math.floor((day + 3) / 7);
  const display = points.filter((point, index) => point.date >= VWAP_START || !bars[index + 1]
    || bars[index + 1].date >= VWAP_START || week(bars[index].day) !== week(bars[index + 1].day));
  for (const point of display) {
    point.score = Math.max(0, Math.min(100, 100 * (point.premium - low) / (high - low)));
    point.level = Math.min(10, 1 + Math.floor(point.score / 10));
  }
  return { symbol, points: display, validUntil };
}

export async function loadGravityHistory(symbol: GravitySymbol, readJson: (url: string) => Promise<YahooChart>) {
  const now = Date.now();
  const params = new URLSearchParams({ period1: String(Date.parse(FIRST_SESSION[symbol]) / 1000),
    period2: String(Math.floor(now / 1000)), interval: '1d', events: 'history', includeAdjustedClose: 'true' });
  const payload = await readJson(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?${params}`);
  return buildGravityHistory(symbol, payload, now);
}
