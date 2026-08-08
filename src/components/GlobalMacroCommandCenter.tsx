import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { hierarchy, treemap } from 'd3-hierarchy';
import { geoGraticule10, geoNaturalEarth1, geoPath } from 'd3-geo';
import type { FeatureCollection, Geometry } from 'geojson';
import { feature } from 'topojson-client';
import * as THREE from 'three';
import {
  ArrowRight,
  CalendarDays,
  ExternalLink,
  Globe2,
  Map as MapIcon,
  Maximize2,
  Minus,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  ChinaMarketHeatmap,
  CryptoMarketHeatmap,
  HongKongMarketHeatmap,
  UsMarketHeatmap,
} from './ChinaMarketHeatmap';
import './GlobalMacroCommandCenter.css';

export type GlobalMarketMode = 'china' | 'hongkong' | 'us' | 'crypto';
type RegionId = 'global' | 'apac' | 'middleEast' | 'europe' | 'americas';

type HistoryPoint = { time: string; value: number };
type Quote = {
  id: string;
  name: string;
  symbol: string;
  price: number;
  changePercent: number;
  updatedAt?: string;
  sourceUrl: string;
  market?: GlobalMarketMode;
  region: RegionId;
  latitude: number;
  longitude: number;
  session: { label: string; tone: 'live' | 'closed' | 'pre' | 'unknown' };
  history: HistoryPoint[];
};
type Metric = {
  id: string;
  label: string;
  value: number | null;
  display: string;
  change?: number | null;
  updatedAt?: string;
  sourceUrl: string;
  status: 'live' | 'delayed' | 'unavailable';
  history: HistoryPoint[];
};
type KeySignal = {
  id: string;
  label: string;
  value: string;
  change: string;
  rawChange?: number | null;
  note: string;
  url?: string;
};
const HIDDEN_MACRO_RISK_IDS = new Set(['dxy', 'us10y', 'ust2y10y', 'fedfunds', 'gscpi']);
type News = {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt?: string;
  category: string;
  region: RegionId;
  importance?: 'critical' | 'high' | 'medium';
  importanceScore?: number;
};
type CalendarEvent = {
  id: string;
  date: string;
  time: string;
  title: string;
  source: string;
  url: string;
  kind: 'macro' | 'central-bank' | 'earnings';
  importance: 'high' | 'medium';
};
type Dashboard = {
  generatedAt: string;
  global: Quote | null;
  markets: Quote[];
  macro: Metric[];
  pmi: Metric[];
  commodities: Metric[];
  news: News[];
  calendar: CalendarEvent[];
};
type WorldHeatmapStock = {
  id: string;
  symbol: string;
  name: string;
  sector: string;
  weight: number;
  price: number;
  changePercent: number;
  updatedAt: string;
  sourceUrl: string;
};
type WorldHeatmapResponse = {
  market: string;
  generatedAt: string;
  source: string;
  weightMethod: string;
  stocks: WorldHeatmapStock[];
};

const WORLD_SPHERE = { type: 'Sphere' } as const;
const WORLD_GRATICULE = geoGraticule10();
let worldCountriesPromise: Promise<FeatureCollection<Geometry>> | null = null;

function loadWorldCountries() {
  if (!worldCountriesPromise) {
    worldCountriesPromise = fetch('/data/world-countries-50m.json')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ objects: { countries: unknown } }>;
      })
      .then((topology) => feature(
        topology as never,
        topology.objects.countries as never,
      ) as unknown as FeatureCollection<Geometry>);
  }
  return worldCountriesPromise;
}

function request<T>(url: string) {
  return fetch(url, { headers: { Accept: 'application/json' } }).then(async (response) => {
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${response.status}`);
    }
    return response.json() as Promise<T>;
  });
}

function formatNumber(value?: number | null, digits = 2) {
  if (value === undefined || value === null || !Number.isFinite(value)) return '待更新';
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function signed(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return '待更新';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function trendClass(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value) || Math.abs(value) <= 0.03) return 'macro-flat';
  return value > 0 ? 'macro-up' : 'macro-down';
}

function newsTagClass(category: string) {
  const value = category.toLowerCase();
  if (/(地缘|冲突|战争|geopolit|conflict|war)/.test(value)) return 'macro-tag-geo';
  if (/(灾害|灾难|气候|地震|台风|disaster|climate|quake|storm)/.test(value)) return 'macro-tag-disaster';
  if (/(央行|美联储|利率|货币|central|fed|rate)/.test(value)) return 'macro-tag-central';
  if (/(市场|股市|商品|能源|market|equity|commodity)/.test(value)) return 'macro-tag-market';
  if (/(财经|经济|宏观|财报|finance|econom|earnings)/.test(value)) return 'macro-tag-finance';
  if (/(政治|政策|选举|politic|policy|election)/.test(value)) return 'macro-tag-politics';
  return 'macro-tag-neutral';
}

function clock(timeZone: string, date = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function WorldClockTime({ timeZone }: { timeZone: string }) {
  const value = clock(timeZone);
  const separatorIndex = value.indexOf(':');
  if (separatorIndex === -1) return <b>{value}</b>;

  return (
    <b className="macro-clock-time" aria-label={value}>
      <span className="macro-clock-digits">{value.slice(0, separatorIndex)}</span>
      <i className="macro-clock-separator" aria-hidden="true">:</i>
      <span className="macro-clock-digits">{value.slice(separatorIndex + 1)}</span>
    </b>
  );
}

function WorldClockBar({ onRefresh }: { onRefresh: () => void }) {
  const [, setMinuteTick] = useState(() => Date.now());

  useEffect(() => {
    let interval: number | undefined;
    const untilNextMinute = 60_000 - (Date.now() % 60_000) + 20;
    const timeout = window.setTimeout(() => {
      setMinuteTick(Date.now());
      interval = window.setInterval(() => setMinuteTick(Date.now()), 60_000);
    }, untilNextMinute);

    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);

  return (
    <div className="macro-clock">
      <span>纽约 <WorldClockTime timeZone="America/New_York" /></span>
      <span>伦敦 <WorldClockTime timeZone="Europe/London" /></span>
      <span>东京 <WorldClockTime timeZone="Asia/Tokyo" /></span>
      <span>上海 <WorldClockTime timeZone="Asia/Shanghai" /></span>
      <button type="button" onClick={onRefresh} title="刷新真实数据"><RefreshCw size={15} /></button>
    </div>
  );
}

function formatEventDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return {
    day: String(date.getDate()).padStart(2, '0'),
    month: `${date.getMonth() + 1}月`,
    weekday: new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date),
  };
}

function formatNewsTime(value?: string) {
  if (!value) return '刚刚';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}分钟前`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}小时前`;
  return `${Math.floor(minutes / 1_440)}天前`;
}

function newsImportanceLabel(item: News) {
  if (item.importance === 'critical') return '最高影响';
  if (item.importance === 'high') return '高影响';
  return '重要';
}

type PulseTone = 'positive' | 'negative' | 'neutral';
type VixTone = 'calm' | 'normal' | 'elevated' | 'stress' | 'unavailable';

const PULSE_REGIONS: Array<{ id: Exclude<RegionId, 'global'>; label: string; shortLabel: string }> = [
  { id: 'apac', label: '亚太', shortLabel: 'APAC' },
  { id: 'europe', label: '欧洲', shortLabel: 'EU' },
  { id: 'americas', label: '美洲', shortLabel: 'US' },
  { id: 'middleEast', label: '中东非', shortLabel: 'MEA' },
];

function average(values: Array<number | null | undefined>) {
  const available = values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  return available.length ? available.reduce((sum, value) => sum + value, 0) / available.length : 0;
}

function pulseTone(value: number, threshold = 0.12): PulseTone {
  if (value > threshold) return 'positive';
  if (value < -threshold) return 'negative';
  return 'neutral';
}

function vixTemperature(value?: number | null): { tone: VixTone; label: string; summary: string; percent: number } {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return { tone: 'unavailable', label: '等待数据', summary: 'VIX 最近收盘值暂未更新', percent: 0 };
  }
  const percent = Math.max(2, Math.min(98, (value / 40) * 100));
  if (value < 12) return { tone: 'calm', label: '低波动', summary: '市场定价平静，注意低波动下的拥挤风险', percent };
  if (value < 20) return { tone: 'normal', label: '常态波动', summary: '风险定价处于历史常态观察区间', percent };
  if (value < 30) return { tone: 'elevated', label: '波动升温', summary: '避险需求上升，注意仓位与流动性', percent };
  return { tone: 'stress', label: '高压波动', summary: '市场压力显著，优先关注尾部风险', percent };
}

function pointChange(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return '待更新';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)} pts`;
}

function signalChange(item?: Metric, basisPoints = false) {
  if (item?.change === undefined || item.change === null || !Number.isFinite(item.change)) return '待更新';
  if (basisPoints) {
    const value = Math.round(item.change * 100);
    return `${value > 0 ? '+' : ''}${value}bp`;
  }
  return signed(item.change);
}

function buildPmiSignals(pmi: Metric[]): KeySignal[] {
  const metric = (id: string) => pmi.find((item) => item.id === id);
  const signal = (item: Metric | undefined, id: string, label: string): KeySignal => ({
    id,
    label,
    value: item?.display || '待更新',
    change: pointChange(item?.change),
    rawChange: item?.change,
    note: item?.value === null || item?.value === undefined ? '等待数据' : item.value >= 50 ? '制造业扩张' : '制造业收缩',
    url: item?.sourceUrl,
  });
  const us = metric('pmi-us');
  const china = metric('pmi-china');
  const europe = metric('pmi-europe');
  const japan = metric('pmi-japan');
  const korea = metric('pmi-korea');
  const asiaValues = [japan?.value, korea?.value].filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  const asiaChanges = [japan?.change, korea?.change].filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  const asiaValue = asiaValues.length === 2 ? average(asiaValues) : null;
  const asiaChange = asiaChanges.length === 2 ? average(asiaChanges) : null;

  return [
    signal(us, 'pmi-us', '美国 PMI'),
    signal(china, 'pmi-china', '中国 PMI'),
    signal(europe, 'pmi-europe', '欧洲 PMI'),
    {
      id: 'pmi-asia',
      label: '日韩 PMI',
      value: asiaValue === null ? '待更新' : asiaValue.toFixed(2),
      change: pointChange(asiaChange),
      rawChange: asiaChange,
      note: japan?.value !== null && japan?.value !== undefined && korea?.value !== null && korea?.value !== undefined
        ? `均值 · 日${japan.display}/韩${korea.display}`
        : '等待日韩数据',
      url: 'https://www.spglobal.com/market-intelligence/en/solutions/products/pmi',
    },
  ];
}

function buildMarketSignals(macro: Metric[], commodities: Metric[]): KeySignal[] {
  const metric = (id: string) => macro.find((item) => item.id === id);
  const commodity = (id: string) => commodities.find((item) => item.id === id);
  const dxy = metric('dxy');
  const us10y = metric('us10y');
  const brent = commodity('brent');
  const gold = commodity('gold');

  return [
    { id: 'dxy', label: '美元指数', value: dxy?.display || '待更新', change: signalChange(dxy), rawChange: dxy?.change, note: dxy?.change === undefined || dxy.change === null ? '等待数据' : dxy.change >= 0 ? '美元走强' : '美元走弱', url: dxy?.sourceUrl },
    { id: 'us10y', label: '美债 10Y', value: us10y?.display || '待更新', change: signalChange(us10y, true), rawChange: us10y?.change, note: us10y?.change === undefined || us10y.change === null ? '等待数据' : us10y.change >= 0 ? '利率上行' : '利率下行', url: us10y?.sourceUrl },
    { id: 'brent', label: '布伦特原油', value: brent?.display || '待更新', change: signalChange(brent), rawChange: brent?.change, note: brent?.change === undefined || brent.change === null ? '等待数据' : brent.change >= 0 ? '能源价格走强' : '能源价格走弱', url: brent?.sourceUrl },
    { id: 'gold', label: '黄金', value: gold?.display || '待更新', change: signalChange(gold), rawChange: gold?.change, note: gold?.change === undefined || gold.change === null ? '等待数据' : gold.change >= 0 ? '避险资产走强' : '避险资产走弱', url: gold?.sourceUrl },
  ];
}

function eventTimestamp(event?: CalendarEvent) {
  if (!event || !/^\d{1,2}:\d{2}$/.test(event.time)) return null;
  const timestamp = new Date(`${event.date}T${event.time.padStart(5, '0')}:00+08:00`).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function NextMacroEvent({ event }: { event?: CalendarEvent }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  if (!event) {
    return (
      <div className="macro-next-event macro-pulse-empty">
        <CalendarDays size={15} />
        <span>等待重要日历更新</span>
      </div>
    );
  }

  const date = formatEventDate(event.date);
  const target = eventTimestamp(event);
  const remaining = target === null ? null : Math.max(0, target - now);
  const days = remaining === null ? 0 : Math.floor(remaining / 86_400_000);
  const hours = remaining === null ? 0 : Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = remaining === null ? 0 : Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = remaining === null ? 0 : Math.floor((remaining % 60_000) / 1_000);
  const countdown = remaining === null
    ? `${date.month}${date.day}日 · ${event.time}`
    : `${days ? `${days}D ` : ''}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return (
    <a className="macro-next-event" href={event.url} target="_blank" rel="noreferrer">
      <div className="macro-next-event-head">
        <span><CalendarDays size={13} /> NEXT EVENT</span>
        <b className={event.importance}>{event.importance === 'high' ? '高影响' : '中影响'}</b>
      </div>
      <strong>{event.title}</strong>
      <div className="macro-next-event-meta">
        <span>{event.source} · {date.weekday}</span>
        <time>{countdown}</time>
      </div>
    </a>
  );
}

function MacroPulsePanel({ data, loading }: { data: Dashboard | null; loading: boolean }) {
  const pulse = useMemo(() => {
    const markets = data?.markets || [];
    const macro = data?.macro || [];
    const pmi = data?.pmi || [];
    const metric = (id: string) => macro.find((item) => item.id === id);
    const vix = metric('vix');
    const temperature = vixTemperature(vix?.value);

    const regions = PULSE_REGIONS.map((region) => {
      const items = markets.filter((item) => item.region === region.id);
      const change = average(items.map((item) => item.changePercent));
      const regionBreadth = items.length ? items.filter((item) => item.changePercent > 0.03).length / items.length : 0.5;
      const tone = pulseTone(change, 0.12);
      const strength = Math.max(8, Math.min(96, Math.round(50 + change * 12 + (regionBreadth - 0.5) * 32)));
      return { ...region, change, strength, tone, status: tone === 'positive' ? '偏强' : tone === 'negative' ? '偏弱' : '中性' };
    });

    const sessions = PULSE_REGIONS.slice(0, 3).map((region) => {
      const items = markets.filter((item) => item.region === region.id);
      const tone = items.some((item) => item.session.tone === 'live')
        ? 'live'
        : items.some((item) => item.session.tone === 'pre') ? 'pre' : 'closed';
      return { ...region, tone, status: tone === 'live' ? '交易中' : tone === 'pre' ? '将开盘' : '已收盘' };
    });

    const keySignals = buildPmiSignals(pmi);

    const nextEvent = (data?.calendar || []).find((item) => {
      const timestamp = eventTimestamp(item);
      return timestamp === null || timestamp > Date.now();
    }) || data?.calendar?.[0];

    return {
      vix: {
        value: vix?.value,
        display: vix?.display || '待更新',
        change: vix?.change,
        sourceUrl: vix?.sourceUrl,
        sourceStatus: vix?.status === 'live' ? '实时' : vix?.status === 'unavailable' ? '待更新' : '最近收盘',
        ...temperature,
      },
      sessions,
      regions,
      keySignals,
      drivers: (data?.news || []).slice(0, 3),
      nextEvent,
    };
  }, [data]);

  const generatedAt = data?.generatedAt ? new Date(data.generatedAt) : null;
  const asOf = generatedAt && !Number.isNaN(generatedAt.getTime())
    ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(generatedAt)
    : '等待数据';

  return (
    <aside className="macro-left macro-panel" aria-label="全球宏观脉搏">
      <div className="macro-left-head">
        <div><span>GLOBAL MACRO PULSE</span><h2>全球宏观脉搏</h2></div>
        <span className="macro-live-badge"><i />{asOf}</span>
      </div>

      <div className="macro-session-strip" aria-label="主要区域交易状态">
        {pulse.sessions.map((item) => (
          <span key={item.id} className={item.tone}><i />{item.label}<b>{item.status}</b></span>
        ))}
      </div>

      <section
        className={`macro-vix-card ${pulse.vix.tone}`}
        role="meter"
        aria-label="VIX 市场波动温度计"
        aria-valuemin={0}
        aria-valuemax={40}
        aria-valuenow={pulse.vix.value ?? undefined}
        aria-valuetext={`${pulse.vix.display}，${pulse.vix.label}`}
      >
        <div className="macro-vix-head">
          <div><p>VIX VOLATILITY INDEX</p><h3>市场波动温度计</h3></div>
          <div className="macro-vix-reading"><strong>{pulse.vix.display}</strong><span className={trendClass(pulse.vix.change)}>较前值 {pointChange(pulse.vix.change)}</span></div>
        </div>
        <div className="macro-vix-status">
          <span>当前温度</span><strong>{pulse.vix.label}</strong><small>{pulse.vix.summary}</small>
          {pulse.vix.sourceUrl ? <a href={pulse.vix.sourceUrl} target="_blank" rel="noreferrer">FRED · {pulse.vix.sourceStatus}<ExternalLink size={9} /></a> : <i>{pulse.vix.sourceStatus}</i>}
        </div>
        <div className="macro-vix-thermometer" aria-hidden="true">
          <div className="macro-vix-bulb"><i /></div>
          <div className="macro-vix-tube"><i style={{ width: `${pulse.vix.percent}%` }} /><em style={{ left: `${pulse.vix.percent}%` }} /></div>
        </div>
        <div className="macro-vix-scale" aria-hidden="true">
          <span>平静<br /><b>&lt;12</b></span><span>常态<br /><b>12–20</b></span><span>升温<br /><b>20–30</b></span><span>高压<br /><b>30+</b></span>
        </div>
      </section>

      <section className="macro-pulse-section">
        <p className="macro-section-title">制造业 PMI · 最新</p>
        <div className="macro-signal-grid">
          {pulse.keySignals.map((item) => (
            <a key={item.id} className="macro-signal" href={item.url || undefined} target="_blank" rel="noreferrer" aria-disabled={!item.url} title={`${item.label} ${item.value} · ${item.change} · ${item.note}`}>
              <span><small>{item.label}</small><strong>{item.value}</strong></span>
              <span className="macro-signal-move"><b className={trendClass(item.rawChange)}>{item.change}</b><small>{item.note}</small></span>
            </a>
          ))}
        </div>
      </section>

      <section className="macro-pulse-section">
        <p className="macro-section-title">区域脉搏</p>
        <div className="macro-region-pulse">
          {pulse.regions.map((item) => (
            <div key={item.id} className={item.tone}>
              <span><b>{item.label}</b><small>{item.shortLabel}</small></span>
              <i><em style={{ width: `${item.strength}%` }} /></i>
              <strong>{item.status}</strong>
              <small>{signed(item.change)}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="macro-pulse-section macro-driver-section">
        <p className="macro-section-title">今日宏观焦点 · 重要性优先</p>
        <div className="macro-driver-list">
          {pulse.drivers.length ? pulse.drivers.map((item, index) => (
            <a key={item.id} href={item.url} target="_blank" rel="noreferrer">
              <span>{String(index + 1).padStart(2, '0')}</span>
              <span><small className={`macro-driver-impact ${item.importance || 'medium'}`}>{newsImportanceLabel(item)} · {item.category} · {formatNewsTime(item.publishedAt)}</small><strong>{item.title}</strong></span>
              <ExternalLink size={11} />
            </a>
          )) : (
            <div className="macro-pulse-empty"><span className={loading ? 'macro-pulse-loader' : ''} />{loading ? '正在筛选今日重要新闻' : '今日暂无符合高重要性标准的宏观新闻'}</div>
          )}
        </div>
      </section>

      <NextMacroEvent event={pulse.nextEvent} />
    </aside>
  );
}

function latLngToVector(lat: number, lon: number, radius: number) {
  const latitude = THREE.MathUtils.degToRad(lat);
  const longitude = THREE.MathUtils.degToRad(lon);
  return new THREE.Vector3(
    radius * Math.cos(latitude) * Math.cos(longitude),
    radius * Math.sin(latitude),
    -radius * Math.cos(latitude) * Math.sin(longitude),
  );
}

const MARKET_MARKER_MERGE_DISTANCE_KM = 50;
const HIDDEN_MARKER_LABEL_IDS = new Set(['euro']);
const MARKER_LABEL_PRIORITY = new Map([
  ['us', 0],
  ['nasdaq', 1],
  ['germany', 0],
]);

type MarketMarkerCluster = {
  id: string;
  primary: Quote;
  quotes: Quote[];
};

function marketDistanceKm(left: Quote, right: Quote) {
  const latitudeDelta = THREE.MathUtils.degToRad(right.latitude - left.latitude);
  const longitudeDelta = THREE.MathUtils.degToRad(right.longitude - left.longitude);
  const leftLatitude = THREE.MathUtils.degToRad(left.latitude);
  const rightLatitude = THREE.MathUtils.degToRad(right.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)));
}

function clusterMarketMarkers(markets: Quote[]) {
  const groups: Quote[][] = [];
  for (const market of markets) {
    const group = groups.find((items) => marketDistanceKm(items[0], market) < MARKET_MARKER_MERGE_DISTANCE_KM);
    if (group) group.push(market);
    else groups.push([market]);
  }

  return groups.flatMap((items): MarketMarkerCluster[] => {
    const quotes = items
      .filter((market) => !HIDDEN_MARKER_LABEL_IDS.has(market.id))
      .sort((left, right) => (MARKER_LABEL_PRIORITY.get(left.id) ?? 100) - (MARKER_LABEL_PRIORITY.get(right.id) ?? 100));
    const primary = quotes[0];
    return primary ? [{ id: primary.id, primary, quotes }] : [];
  });
}

function MiniLine({ history, color = '#61dfff' }: { history: HistoryPoint[]; color?: string }) {
  const values = history.filter((item) => Number.isFinite(item.value)).slice(-36);
  if (values.length < 2) return <div className="macro-line-empty">等待序列更新</div>;
  const min = Math.min(...values.map((item) => item.value));
  const max = Math.max(...values.map((item) => item.value));
  const span = Math.max(max - min, 0.0001);
  const points = values.map((item, index) => (
    `${(index / (values.length - 1)) * 100},${92 - ((item.value - min) / span) * 78}`
  )).join(' ');
  const area = `0,100 ${points} 100,100`;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="macro-line" aria-hidden="true">
      <defs>
        <linearGradient id={`line-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.24" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#line-${color.replace('#', '')})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function HologramGlobe({
  markets,
  selectedId,
  onSelect,
}: {
  markets: Quote[];
  selectedId?: string;
  onSelect: (quote: Quote) => void;
}) {
  const markerClusters = useMemo(() => clusterMarketMarkers(markets), [markets]);
  const markerClusterSignature = markerClusters
    .map((cluster) => `${cluster.id}:${cluster.quotes.map((quote) => quote.id).join(',')}`)
    .join('|');
  const mount = useRef<HTMLDivElement | null>(null);
  const callbackRef = useRef(onSelect);
  const selectedRef = useRef(selectedId);
  const marketsRef = useRef(markets);
  const [labels, setLabels] = useState<Array<{ quote: Quote; markerY: number; x: number; y: number; visible: boolean }>>([]);

  useEffect(() => { callbackRef.current = onSelect; }, [onSelect]);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);
  useEffect(() => { marketsRef.current = markets; }, [markets]);

  useEffect(() => {
    const host = mount.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 40);
    camera.position.set(0, 0, 6.7);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const root = new THREE.Group();
    // Center East Asia initially; the marker transform below follows SphereGeometry's UV axes.
    root.rotation.set(-0.08, 2.92, 0);
    scene.add(root);

    const texture = new THREE.TextureLoader().load('/textures/earth-day.jpg');
    texture.colorSpace = THREE.SRGBColorSpace;
    const earthGeometry = new THREE.SphereGeometry(1.72, 96, 96);
    const earthMaterial = new THREE.MeshPhongMaterial({
      map: texture,
      color: '#8ddfff',
      emissive: '#031421',
      emissiveIntensity: 0.72,
      shininess: 24,
      transparent: true,
      opacity: 0.88,
    });
    const earth = new THREE.Mesh(earthGeometry, earthMaterial);
    root.add(earth);

    const graticuleMaterial = new THREE.LineBasicMaterial({ color: '#5adbf7', transparent: true, opacity: 0.16 });
    const graticuleGeometries: THREE.BufferGeometry[] = [];
    for (let latitude = -80; latitude <= 80; latitude += 20) {
      const points = Array.from({ length: 121 }, (_, index) => latLngToVector(latitude, -180 + index * 3, 1.735));
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      graticuleGeometries.push(geometry);
      root.add(new THREE.Line(geometry, graticuleMaterial));
    }
    for (let longitude = -160; longitude <= 180; longitude += 20) {
      const points = Array.from({ length: 61 }, (_, index) => latLngToVector(-90 + index * 3, longitude, 1.735));
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      graticuleGeometries.push(geometry);
      root.add(new THREE.Line(geometry, graticuleMaterial));
    }

    const haloGeometry = new THREE.SphereGeometry(1.83, 64, 64);
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: '#3edcff',
      transparent: true,
      opacity: 0.045,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
    });
    root.add(new THREE.Mesh(haloGeometry, haloMaterial));

    scene.add(new THREE.AmbientLight('#84deff', 1.65));
    const keyLight = new THREE.DirectionalLight('#d9f7ff', 2.3);
    keyLight.position.set(3, 2, 5);
    scene.add(keyLight);

    const nodes = markerClusters.map((cluster) => {
      const quote = cluster.primary;
      const group = new THREE.Group();
      group.position.copy(latLngToVector(quote.latitude, quote.longitude, 1.79));
      const color = quote.changePercent >= 0 ? '#ff667d' : '#38e7b2';
      const markerGeometry = new THREE.SphereGeometry(0.038, 20, 20);
      const markerMaterial = new THREE.MeshBasicMaterial({ color });
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      const pulseGeometry = new THREE.RingGeometry(0.056, 0.078, 28);
      const pulseMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.48, side: THREE.DoubleSide });
      const pulse = new THREE.Mesh(pulseGeometry, pulseMaterial);
      pulse.lookAt(group.position.clone().multiplyScalar(2));
      group.add(marker, pulse);
      root.add(group);
      return {
        id: cluster.id,
        quoteIds: cluster.quotes.map((item) => item.id),
        longitude: quote.longitude,
        group,
        markerGeometry,
        markerMaterial,
        pulse,
        pulseGeometry,
        pulseMaterial,
      };
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const drag = { active: false, moved: false, x: 0, y: 0 };
    const target = { x: root.rotation.x, y: root.rotation.y };
    const zoom = { current: 1, target: 1 };
    let baseCameraZ = 6.7;

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const aspect = rect.width / Math.max(rect.height, 1);
      camera.aspect = aspect;
      baseCameraZ = 6.7 * Math.max(1, aspect < 1 ? 1.08 / aspect : 1);
      camera.position.z = baseCameraZ / zoom.current;
      camera.updateProjectionMatrix();
      renderer.setSize(rect.width, rect.height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const handleDown = (event: PointerEvent) => {
      drag.active = true;
      drag.moved = false;
      drag.x = event.clientX;
      drag.y = event.clientY;
      host.setPointerCapture(event.pointerId);
    };
    const handleMove = (event: PointerEvent) => {
      if (!drag.active) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      target.y += dx * 0.008;
      target.x = THREE.MathUtils.clamp(target.x + dy * 0.006, -0.78, 0.78);
      drag.x = event.clientX;
      drag.y = event.clientY;
    };
    const handleUp = (event: PointerEvent) => {
      drag.active = false;
      if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
      if (drag.moved) return;
      const rect = host.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -(((event.clientY - rect.top) / rect.height) * 2 - 1),
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(nodes.map((item) => item.group.children[0]))[0];
      if (!hit) return;
      const node = nodes.find((item) => item.group.children[0] === hit.object);
      const quote = node ? marketsRef.current.find((item) => item.id === node.id) : undefined;
      if (quote) callbackRef.current(quote);
    };
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom.target = THREE.MathUtils.clamp(
        zoom.target * Math.exp(-event.deltaY * 0.001),
        0.72,
        1.62,
      );
    };
    host.addEventListener('pointerdown', handleDown);
    host.addEventListener('pointermove', handleMove);
    host.addEventListener('pointerup', handleUp);
    host.addEventListener('wheel', handleWheel, { passive: false });

    let animationFrame = 0;
    let tick = 0;
    const clock = new THREE.Clock();
    const markerWorld = new THREE.Vector3();
    const markerNormal = new THREE.Vector3();
    const markerToCamera = new THREE.Vector3();
    const animate = () => {
      const delta = Math.min(clock.getDelta(), 0.05);
      root.rotation.x += (target.x - root.rotation.x) * 0.07;
      root.rotation.y += (target.y - root.rotation.y) * 0.07;
      zoom.current += (zoom.target - zoom.current) * 0.11;
      camera.position.z = baseCameraZ / zoom.current;
      if (!drag.active) target.y += delta * 0.018;
      camera.updateMatrixWorld();
      root.updateMatrixWorld(true);
      const quoteMap = new Map(marketsRef.current.map((quote) => [quote.id, quote]));
      nodes.forEach(({ id, quoteIds, longitude, group, markerMaterial, pulse, pulseMaterial }) => {
        const quote = quoteMap.get(id);
        if (!quote) return;
        group.getWorldPosition(markerWorld);
        const facing = markerNormal.copy(markerWorld).normalize()
          .dot(markerToCamera.copy(camera.position).sub(markerWorld).normalize());
        group.visible = facing > 0.08;
        const color = quote.changePercent >= 0 ? '#ff667d' : '#38e7b2';
        markerMaterial.color.set(color);
        pulseMaterial.color.set(color);
        const active = Boolean(selectedRef.current && quoteIds.includes(selectedRef.current));
        const scale = (active ? 1.35 : 1) + Math.sin(Date.now() * 0.003 + longitude) * 0.08;
        pulse.scale.setScalar(scale);
        pulseMaterial.opacity = active ? 0.9 : 0.42;
      });
      if (tick++ % 3 === 0) {
        const rect = host.getBoundingClientRect();
        const projectedLabels = nodes.flatMap(({ quoteIds, group }) => {
          const world = group.getWorldPosition(new THREE.Vector3());
          const facing = world.clone().normalize().dot(camera.position.clone().sub(world).normalize());
          const projected = world.clone().project(camera);
          const rawX = (projected.x * 0.5 + 0.5) * rect.width;
          const rawY = (-projected.y * 0.5 + 0.5) * rect.height;
          const visible = facing > 0.18
            && projected.z < 1
            && rawX > 68
            && rawX < rect.width - 68
            && rawY > 34
            && rawY < rect.height - 42;
          return quoteIds.flatMap((quoteId, index) => {
            const quote = quoteMap.get(quoteId);
            return quote ? [{
              quote,
              x: rawX,
              markerY: rawY,
              y: rawY + 30 + index * 19,
              visible,
            }] : [];
          });
        }).sort((left, right) => left.y - right.y || left.x - right.x);
        const placed: typeof projectedLabels = [];
        projectedLabels.forEach((label) => {
          if (!label.visible) { placed.push(label); return; }
          while (placed.some((item) => item.visible && Math.abs(item.x - label.x) < 92 && Math.abs(item.y - label.y) < 19)) {
            label.y += 19;
          }
          label.visible = label.y < rect.height - 19;
          placed.push(label);
        });
        setLabels(placed);
      }
      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(animate);
    };
    resize();
    animate();

    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      host.removeEventListener('pointerdown', handleDown);
      host.removeEventListener('pointermove', handleMove);
      host.removeEventListener('pointerup', handleUp);
      host.removeEventListener('wheel', handleWheel);
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
      texture.dispose();
      earthGeometry.dispose();
      earthMaterial.dispose();
      graticuleGeometries.forEach((geometry) => geometry.dispose());
      graticuleMaterial.dispose();
      haloGeometry.dispose();
      haloMaterial.dispose();
      nodes.forEach(({ markerGeometry, markerMaterial, pulseGeometry, pulseMaterial }) => {
        markerGeometry.dispose();
        markerMaterial.dispose();
        pulseGeometry.dispose();
        pulseMaterial.dispose();
      });
      renderer.dispose();
    };
  }, [markerClusterSignature]);

  return (
    <div ref={mount} className="macro-holo" aria-label="可旋转全球市场地球">
      {labels.map(({ quote, markerY, x, y, visible }) => visible ? (
        <button
          key={quote.id}
          type="button"
          className={`macro-holo-label ${selectedId === quote.id ? 'active' : ''}`}
          style={{ left: x, top: y }}
          onClick={(event) => { event.stopPropagation(); onSelect(quote); }}
        >
          <i className="macro-holo-leader" style={{ height: Math.max(9, y - markerY - 3) }} />
          <span>{quote.name}</span>
          <b className={trendClass(quote.changePercent)}>{signed(quote.changePercent)}</b>
        </button>
      ) : null)}
    </div>
  );
}

function MarketHeatmap({ mode }: { mode: GlobalMarketMode }) {
  if (mode === 'china') return <ChinaMarketHeatmap />;
  if (mode === 'hongkong') return <HongKongMarketHeatmap />;
  if (mode === 'us') return <UsMarketHeatmap />;
  return <CryptoMarketHeatmap />;
}

type HeatmapTreeNode = {
  name: string;
  weight?: number;
  stock?: WorldHeatmapStock;
  children?: HeatmapTreeNode[];
};

function WorldMarketHeatmap({ market }: { market: string }) {
  const [data, setData] = useState<WorldHeatmapResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    void request<WorldHeatmapResponse>(`/api/global-market-heatmap?market=${encodeURIComponent(market)}`)
      .then((payload) => { if (active) setData(payload); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : '热力图数据暂时不可用'); });
    return () => { active = false; };
  }, [market]);

  const layout = useMemo(() => {
    if (!data?.stocks.length) return null;
    const grouped = new Map<string, WorldHeatmapStock[]>();
    data.stocks.forEach((stock) => grouped.set(stock.sector, [...(grouped.get(stock.sector) || []), stock]));
    const root = hierarchy<HeatmapTreeNode>({
      name: market,
      children: [...grouped.entries()].map(([sector, stocks]) => ({
        name: sector,
        children: stocks.map((stock) => ({ name: stock.name, stock, weight: stock.weight })),
      })),
    }).sum((node) => node.weight || 0).sort((left, right) => (right.value || 0) - (left.value || 0));
    return treemap<HeatmapTreeNode>().size([1000, 620]).paddingOuter(4).paddingInner(3).paddingTop((node) => node.depth === 1 ? 25 : 0)(root);
  }, [data, market]);

  if (error) return <div className="macro-world-heatmap-state"><Globe2 size={28} /><strong>{error}</strong></div>;
  if (!layout || !data) return <div className="macro-world-heatmap-state"><span className="macro-world-loader" /><strong>正在读取成分股行情</strong></div>;

  return (
    <div className="macro-world-heatmap">
      {layout.descendants().filter((node) => node.depth === 1).map((node) => (
        <div
          key={node.data.name}
          className="macro-world-sector"
          style={{ left: `${node.x0 / 10}%`, top: `${node.y0 / 6.2}%`, width: `${(node.x1 - node.x0) / 10}%`, height: `${(node.y1 - node.y0) / 6.2}%` }}
        ><span>{node.data.name}</span></div>
      ))}
      {layout.leaves().map((node) => {
        const stock = node.data.stock;
        if (!stock) return null;
        const area = (node.x1 - node.x0) * (node.y1 - node.y0);
        return (
          <a
            key={stock.id}
            className={`macro-world-tile ${trendClass(stock.changePercent)} ${area > 55_000 ? 'large' : area > 24_000 ? 'medium' : 'small'}`}
            href={stock.sourceUrl}
            target="_blank"
            rel="noreferrer"
            style={{ left: `${node.x0 / 10}%`, top: `${node.y0 / 6.2}%`, width: `${(node.x1 - node.x0) / 10}%`, height: `${(node.y1 - node.y0) / 6.2}%` }}
            title={`${stock.name} ${stock.symbol} ${signed(stock.changePercent)}`}
          >
            <strong>{stock.name}</strong><span>{stock.symbol}</span><b>{signed(stock.changePercent)}</b><small>{formatNumber(stock.price)}</small>
          </a>
        );
      })}
      <p className="macro-world-source">{data.source} 行情 · {data.weightMethod}</p>
    </div>
  );
}

function MarketModal({
  quote,
  mode,
  onClose,
  onOpenMarket,
}: {
  quote: Quote | null;
  mode: GlobalMarketMode | null;
  onClose: () => void;
  onOpenMarket: (mode: GlobalMarketMode) => void;
}) {
  if (!quote && !mode) return null;
  const title = quote?.name || '全球加密资产市场';
  return createPortal(
    <div className="macro-market-modal" role="dialog" aria-modal="true" aria-label={`${title}市场概览`}>
      <button type="button" className="macro-modal-backdrop" onClick={onClose} aria-label="关闭市场预览" />
      <section className="macro-modal-panel">
        <header className="macro-modal-header">
          <div>
            <span className="macro-modal-kicker">MARKET HEATMAP / 市场热力</span>
            <h2>{title}</h2>
          </div>
          <div className="macro-modal-quote">
            {quote ? <><strong>{formatNumber(quote.price)}</strong><span className={trendClass(quote.changePercent)}>{signed(quote.changePercent)}</span></> : null}
            {mode ? <button type="button" onClick={() => onOpenMarket(mode)}>进入交易页面 <ArrowRight size={14} /></button> : null}
            {quote && !mode ? <a href={quote.sourceUrl} target="_blank" rel="noreferrer">查看交易所行情 <ExternalLink size={13} /></a> : null}
            <button type="button" className="macro-modal-close" onClick={onClose} aria-label="关闭"><X size={18} /></button>
          </div>
        </header>
        <div className="macro-modal-content">
          {mode ? <MarketHeatmap mode={mode} /> : quote ? <WorldMarketHeatmap market={quote.id} /> : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function InteractiveFlatMap({ markets, onSelect }: { markets: Quote[]; onSelect: (quote: Quote) => void }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; originX: number; originY: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [size, setSize] = useState({ width: 1200, height: 680 });
  const [worldCountries, setWorldCountries] = useState<FeatureCollection<Geometry> | null>(null);
  const markerClusters = useMemo(() => clusterMarketMarkers(markets), [markets]);

  useEffect(() => {
    let active = true;
    void loadWorldCountries().then((countries) => {
      if (active) setWorldCountries(countries);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const update = () => {
      const rect = viewport.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setSize({ width: rect.width, height: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const projection = useMemo(() => geoNaturalEarth1().fitExtent(
    [[20, 16], [Math.max(21, size.width - 20), Math.max(17, size.height - 16)]],
    WORLD_SPHERE,
  ), [size.height, size.width]);
  const mapPath = useMemo(() => geoPath(projection), [projection]);
  const projectedMarkets = useMemo(() => markerClusters.flatMap((cluster) => {
    const point = projection([cluster.primary.longitude, cluster.primary.latitude]);
    return point ? [{ cluster, left: point[0], top: point[1] }] : [];
  }), [markerClusters, projection]);

  const reset = useCallback(() => setTransform({ scale: 1, x: 0, y: 0 }), []);

  const zoom = useCallback((nextScale: number, clientX?: number, clientY?: number) => {
    setTransform((current) => {
      const scale = Math.max(1, Math.min(4, nextScale));
      if (scale === current.scale) return current;
      if (scale < current.scale) {
        const centerRatio = (scale - 1) / Math.max(current.scale - 1, Number.EPSILON);
        return {
          scale,
          x: current.x * centerRatio,
          y: current.y * centerRatio,
        };
      }
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect || clientX === undefined || clientY === undefined) return { ...current, scale };
      const pointX = clientX - rect.left - rect.width / 2;
      const pointY = clientY - rect.top - rect.height / 2;
      const ratio = scale / current.scale;
      return {
        scale,
        x: pointX - (pointX - current.x) * ratio,
        y: pointY - (pointY - current.y) * ratio,
      };
    });
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      originX: transform.x,
      originY: transform.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }, [transform.x, transform.y]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const maxX = rect.width * Math.max(0.45, transform.scale * 0.55);
    const maxY = rect.height * Math.max(0.45, transform.scale * 0.55);
    const x = Math.max(-maxX, Math.min(maxX, drag.originX + event.clientX - drag.x));
    const y = Math.max(-maxY, Math.min(maxY, drag.originY + event.clientY - drag.y));
    setTransform((current) => ({ ...current, x, y }));
  }, [transform.scale]);

  const stopDragging = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  return (
    <div
      ref={viewportRef}
      className={`macro-map${dragging ? ' dragging' : ''}`}
      onWheel={(event) => {
        event.preventDefault();
        zoom(transform.scale * Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onDoubleClick={reset}
    >
      <div className="macro-map-layer">
        <svg className="macro-vector-map" viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">
          <defs>
            <radialGradient id="macro-ocean-glow" cx="50%" cy="44%" r="65%">
              <stop offset="0%" stopColor="#07141e" />
              <stop offset="72%" stopColor="#030a11" />
              <stop offset="100%" stopColor="#010509" />
            </radialGradient>
          </defs>
          <g transform={`translate(${size.width / 2 + transform.x} ${size.height / 2 + transform.y}) scale(${transform.scale}) translate(${-size.width / 2} ${-size.height / 2})`}>
            <path className="macro-vector-ocean" d={mapPath(WORLD_SPHERE) || undefined} />
            <path className="macro-vector-graticule" d={mapPath(WORLD_GRATICULE) || undefined} />
            <g className="macro-vector-countries">
              {(worldCountries?.features || []).map((country, index) => (
                <path key={country.id ?? index} d={mapPath(country) || undefined} />
              ))}
            </g>
          </g>
        </svg>
        {projectedMarkets.map(({ cluster, left, top }) => (
          <div
            key={cluster.id}
            className="macro-map-marker-cluster"
            style={{
              left: size.width / 2 + (left - size.width / 2) * transform.scale + transform.x,
              top: size.height / 2 + (top - size.height / 2) * transform.scale + transform.y,
            }}
          >
            <i className={`macro-map-shared-marker ${cluster.primary.changePercent >= 0 ? 'up' : 'down'}`} />
            <div className="macro-map-cluster-labels">
              {cluster.quotes.map((item) => (
                <button key={item.id} type="button" onClick={() => onSelect(item)}>
                  <span>{item.name}</span>
                  <b className={trendClass(item.changePercent)}>{signed(item.changePercent)}</b>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="macro-map-controls">
        <button type="button" onClick={() => zoom(transform.scale * 1.25)} title="放大地图" aria-label="放大地图"><Plus size={15} /></button>
        <button type="button" onClick={() => zoom(transform.scale / 1.25)} title="缩小地图" aria-label="缩小地图"><Minus size={15} /></button>
        <button type="button" onClick={reset} title="复位地图" aria-label="复位地图"><Maximize2 size={14} /></button>
      </div>
    </div>
  );
}

export function GlobalMacroCommandCenter({ onOpenMarket }: { onOpenMarket: (market: GlobalMarketMode) => void }) {
  const [view, setView] = useState<'globe' | 'map'>('globe');
  const [data, setData] = useState<Dashboard | null>(null);
  const [selected, setSelected] = useState<Quote | null>(null);
  const [modalMode, setModalMode] = useState<GlobalMarketMode | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await request<Dashboard>('/api/global-macro-dashboard?region=global'));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '全球市场数据暂时不可用');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(refresh);
  }, [load]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setSelected(null); setModalMode(null); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const macro = data?.macro || [];
  const commodities = data?.commodities || [];
  const rightMarketSignals = useMemo(() => buildMarketSignals(data?.macro || [], data?.commodities || []), [data?.macro, data?.commodities]);
  const macroRiskMetrics = macro.filter((item) => !HIDDEN_MACRO_RISK_IDS.has(item.id));
  const treasurySpread = macro.find((item) => item.id === 'ust2y10y');
  const crypto = commodities.filter((item) => ['bitcoin', 'ethereum'].includes(item.id));
  const markets = data?.markets || [];

  const openQuote = useCallback((quote: Quote) => {
    setSelected(quote);
    setModalMode(quote.market || null);
  }, []);

  return (
    <section className="global-macro-shell">
      <div className="macro-app">
        <header className="macro-ticker macro-panel">
          <div className="macro-vt">
            <span className="macro-status-dot" />
            <div>
              <p className="macro-vt-label">GLOBAL EQUITY PROXY · 全球股票</p>
              <p className="macro-vt-name"><span>VT</span><strong>{formatNumber(data?.global?.price)}</strong><b className={trendClass(data?.global?.changePercent)}>{signed(data?.global?.changePercent)}</b></p>
            </div>
          </div>
          <div className="macro-vt-chart"><MiniLine history={data?.global?.history || []} color="#52e0b5" /></div>
          <WorldClockBar onRefresh={() => void load()} />
        </header>

        <MacroPulsePanel data={data} loading={loading} />

        <main className="macro-main macro-panel">
          <div className="macro-stage">
            <div className="macro-stage-head">
              <div><span>GLOBAL EXCHANGE NETWORK</span><h1>全球资本市场主控台</h1></div>
              <div className="macro-mode-toggle">
                <button type="button" className={view === 'globe' ? 'active' : ''} onClick={() => setView('globe')} title="全息地球"><Globe2 size={15} /></button>
                <button type="button" className={view === 'map' ? 'active' : ''} onClick={() => setView('map')} title="平板地图"><MapIcon size={15} /></button>
              </div>
            </div>
            {error ? <button type="button" className="macro-error" onClick={() => void load()}>{error} · 点击重试</button> : null}
            <div className={`macro-globe-wrap ${view === 'map' ? 'flat' : ''}`}>
              {view === 'globe' ? (
                markets.length ? <HologramGlobe markets={markets} selectedId={selected?.id} onSelect={openQuote} /> : null
              ) : (
                <InteractiveFlatMap markets={markets} onSelect={openQuote} />
              )}
              <p className="macro-caption">{view === 'map' ? '拖动平移 · 滚轮缩放 · 双击复位 · 点击交易所打开实时热力图' : '拖动旋转 · 滚轮缩放 · 点击交易所打开实时热力图 · 红涨绿跌'}</p>
            </div>
            {loading ? <div className="macro-loading"><span />正在连接全球市场数据</div> : null}
          </div>
        </main>

        <aside className="macro-right macro-panel">
          <section className="macro-terminal-section macro-macro-section">
            <p className="macro-section-title">宏观风险指标</p>
            <div className="macro-metric-list">
              {macroRiskMetrics.map((item) => (
                <a key={item.id} className="macro-metric-row" href={item.sourceUrl} target="_blank" rel="noreferrer">
                  <span className="macro-metric-copy"><small>{item.label}</small><strong>{item.display}</strong></span>
                  <span className={`macro-metric-change ${trendClass(item.change)}`}>{signed(item.change)}</span>
                  <span className="macro-metric-chart"><MiniLine history={item.history} color={item.value === null ? '#506273' : '#55d9b0'} /></span>
                </a>
              ))}
            </div>
          </section>

          <section className="macro-terminal-section macro-key-change-section">
            <p className="macro-section-title">关键变化 · 24H</p>
            <div className="macro-key-change-grid">
              {rightMarketSignals.map((item) => <KeyChangeCard key={item.id} item={item} />)}
            </div>
          </section>
          <section className="macro-terminal-section macro-treasury-section">
            <p className="macro-section-title">美债期限结构</p>
            <TreasurySpreadCard item={treasurySpread} />
          </section>
          <section className="macro-terminal-section macro-crypto-section">
            <div className="macro-section-row"><p className="macro-section-title">加密市场</p><button type="button" onClick={() => { setSelected(null); setModalMode('crypto'); }}>打开热力图 <ArrowRight size={12} /></button></div>
            <div className="macro-crypto-list">{crypto.map((item) => <CryptoRow key={item.id} item={item} />)}</div>
          </section>
        </aside>

        <footer className="macro-news macro-panel">
          <span className="macro-news-live"><i /> MARKET ALERT</span>
          <div className="macro-news-window">
            {data?.news?.length ? (
              <div className="macro-news-track">
                {[...data.news, ...data.news].map((item, index) => (
                  <a key={`${item.id}-${index}`} className="macro-news-item" href={item.url} target="_blank" rel="noreferrer">
                    <span className={`macro-tag ${newsTagClass(item.category)}`}>{item.category}</span><time>{formatNewsTime(item.publishedAt)}</time><span>{item.title}</span><small>{item.source}</small>
                  </a>
                ))}
              </div>
            ) : <span className="macro-news-empty">今日暂无达到重要性阈值的热点新闻</span>}
          </div>
        </footer>
      </div>

      <MarketModal
        quote={selected}
        mode={modalMode}
        onClose={() => { setSelected(null); setModalMode(null); }}
        onOpenMarket={onOpenMarket}
      />
    </section>
  );
}

function KeyChangeCard({ item }: { item: KeySignal }) {
  return (
    <a className="macro-key-change-card" href={item.url} target="_blank" rel="noreferrer" title={`${item.label} ${item.value} · ${item.change} · ${item.note}`}>
      <span className="macro-key-change-copy">
        <small>{item.label}</small>
        <strong>{item.value}</strong>
      </span>
      <span className="macro-key-change-move">
        <b className={trendClass(item.rawChange)}>{item.change}</b>
        <small>{item.note}</small>
      </span>
    </a>
  );
}

function CryptoRow({ item }: { item: Metric }) {
  const symbols: Record<string, string> = { bitcoin: 'BTC', ethereum: 'ETH' };
  const symbol = symbols[item.id] || item.id.slice(0, 4).toUpperCase();
  return (
    <a className="macro-crypto-row" href={item.sourceUrl} target="_blank" rel="noreferrer">
      <span className="macro-crypto-icon">{symbol.slice(0, 1)}</span>
      <span className="macro-crypto-copy"><strong>{item.label}</strong><small>{symbol}</small></span>
      <span className="macro-crypto-value"><strong>{item.display}</strong><b className={trendClass(item.change)}>{signed(item.change)}</b></span>
    </a>
  );
}

function TreasurySpreadCard({ item }: { item?: Metric }) {
  const value = item?.value;
  const available = value !== undefined && value !== null && Number.isFinite(value);
  const state = !available ? '等待数据' : value < 0 ? '收益率曲线倒挂' : value < 0.25 ? '曲线接近水平' : '收益率曲线正常';
  const tone = !available ? 'unavailable' : value < 0 ? 'inverted' : value < 0.25 ? 'flat' : 'normal';
  const sourceUrl = item?.sourceUrl || 'https://fred.stlouisfed.org/series/T10Y2Y';

  return (
    <a className={`macro-treasury-card ${tone}`} href={sourceUrl} target="_blank" rel="noreferrer">
      <span className="macro-treasury-copy">
        <small>10Y - 2Y · FRED 日频</small>
        <strong>{item?.display || '待更新'}</strong>
        <b>{state}</b>
      </span>
      <span className="macro-treasury-change">
        <small>较前值</small>
        <b className={trendClass(item?.change)}>{item?.change === undefined || item.change === null ? '待更新' : `${item.change > 0 ? '+' : ''}${item.change.toFixed(2)}pct`}</b>
      </span>
      <span className="macro-treasury-chart">
        <MiniLine history={item?.history || []} color={tone === 'inverted' ? '#ff6b81' : tone === 'normal' ? '#52e0b5' : '#d8bd72'} />
      </span>
      <span className="macro-treasury-foot"><i />负值表示倒挂，正值表示长端收益率高于短端</span>
    </a>
  );
}
