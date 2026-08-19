import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { geoMercator, geoPath } from 'd3-geo';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import {
  ArrowLeft,
  ArrowUpRight,
  BadgeDollarSign,
  Banknote,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  ChevronLeft,
  CircleGauge,
  Database,
  Factory,
  GraduationCap,
  Landmark,
  MapPinned,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  TrendingUp,
  Users,
  Waves,
} from 'lucide-react';
import { CHINA_PROVINCE_DATA_SOURCES, CHINA_PROVINCE_ECONOMY, type ChinaProvinceEconomy } from '../data/chinaProvinceEconomy';
import './ChinaMacroCommandCenter.css';

type ChinaMetric = {
  id: string;
  label: string;
  display: string;
  value: number | null;
  change?: number | null;
  changeDisplay?: string;
  period: string;
  source: string;
  sourceUrl: string;
  status: 'live' | 'delayed' | 'unavailable';
  note?: string;
};

type ChinaIndex = {
  id: string;
  code: string;
  name: string;
  price: number;
  changePercent: number;
  updatedAt?: string;
  sourceUrl: string;
};

type ChinaNews = {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt?: string;
  category: string;
  importance?: 'critical' | 'high' | 'medium';
  importanceScore?: number;
  sourceCount?: number;
  sources?: string[];
  importanceReason?: string;
};

type ChinaMacroDashboard = {
  generatedAt: string;
  indices: ChinaIndex[];
  metrics: ChinaMetric[];
  quadrant: {
    current: '复苏' | '过热' | '滞胀' | '衰退 / 通缩';
    growthDirection: number;
    inflationDirection: number;
    explanation: string;
  };
  policy: {
    stage: string;
    direction: string;
    creditState: string;
    nextData: string;
    nextDataUrl: string;
    policies: Array<{ title: string; source: string; url: string }>;
  };
  news: ChinaNews[];
  newsMeta?: {
    onlineSources: number;
    totalSources: number;
    candidates: number;
    duplicatesRemoved: number;
  };
  methodology: string;
};

const EMPTY_CHINA_DASHBOARD: ChinaMacroDashboard = {
  generatedAt: '',
  indices: [],
  metrics: [],
  quadrant: {
    current: '复苏',
    growthDirection: 0,
    inflationDirection: 0,
    explanation: '正在连接增长与通胀数据。',
  },
  policy: {
    stage: '等待政策数据',
    direction: '正在连接政策信息',
    creditState: '--',
    nextData: '国家统计局发布日程',
    nextDataUrl: 'https://www.stats.gov.cn/sj/',
    policies: [],
  },
  news: [],
  methodology: '',
};

type ProvinceFeature = Feature<Geometry, { name?: string; adcode?: number | string }>;
type RegionCollection = FeatureCollection<Geometry, { name?: string; adcode?: number | string }>;
type MapMetric = 'gdp' | 'population' | 'perCapita';
type ProvincePanel = 'government' | 'economy' | 'fiscal' | 'population';

type ProvinceOfficialItem = {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt?: string;
  fallback?: boolean;
};

type ProvinceOfficialFeed = {
  province: string;
  generatedAt: string;
  policies: ProvinceOfficialItem[];
  news: ProvinceOfficialItem[];
  sourceStatus: 'live' | 'fallback';
  errors: string[];
};

type MapTrailItem = {
  label: string;
  adcode?: string;
  data: RegionCollection;
};

const PROVINCE_PILLARS: Record<string, string> = {
  广东省: '电子信息、先进制造、汽车、新能源与现代服务业',
  江苏省: '先进制造、电子信息、生物医药与装备工业',
  浙江省: '数字经济、民营制造、平台经济与现代商贸',
  山东省: '高端化工、装备制造、新能源与现代农业',
  北京市: '数字经济、科技服务、金融与文化产业',
  上海市: '金融、集成电路、生物医药、汽车与航运',
  四川省: '电子信息、装备制造、能源化工与文旅',
};

const PROVINCE_PANEL_TABS = [
  { id: 'government', label: '政务与班子', icon: Landmark },
  { id: 'economy', label: '经济与产业', icon: BriefcaseBusiness },
  { id: 'fiscal', label: '财政与债务', icon: BadgeDollarSign },
  { id: 'population', label: '人口与社会', icon: Users },
] as const;

const ANCHORS = [
  { id: 'credit', title: '信贷与水龙头', eyebrow: 'CREDIT PULSE', icon: Waves, metricIds: ['tsf', 'm1m2'] },
  { id: 'growth', title: '生产与景气度', eyebrow: 'GROWTH / PMI', icon: Factory, metricIds: ['official-pmi', 'caixin-pmi'] },
  { id: 'inflation', title: '通胀与物价', eyebrow: 'INFLATION', icon: TrendingUp, metricIds: ['cpi', 'ppi'] },
  { id: 'policy', title: '政策与资金价格', eyebrow: 'POLICY RATE', icon: Landmark, metricIds: ['dr007', 'cn10y', 'lpr'] },
] as const;

const STRUCTURAL_IDS = ['household-loans', 'corporate-loans', 'fiscal', 'property', 'land-sales', 'exports'];
const TACTICAL_IDS = ['cn-us-spread', 'cnh-hibor', 'credit-spread', 'bill-financing', 'interbank-repo', 'term-spread'];

function formatNumber(value: number, digits = 2) {
  return new Intl.NumberFormat('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

function signedNumber(value: number, digits = 2) {
  return `${value > 0 ? '+' : ''}${formatNumber(value, digits)}`;
}

function provinceValue(item: ChinaProvinceEconomy | undefined, metric: MapMetric) {
  if (!item) return 0;
  if (metric === 'population') return item.populationMillion;
  if (metric === 'perCapita') return item.gdpPerCapitaCny;
  return item.gdpMillionCny;
}

function provinceMetricText(item: ChinaProvinceEconomy, metric: MapMetric) {
  if (metric === 'population') return `${formatNumber(item.populationMillion, 2)} 百万人`;
  if (metric === 'perCapita') return `¥${formatNumber(item.gdpPerCapitaCny, 0)}`;
  return `¥${formatNumber(item.gdpMillionCny / 100, 2)} 亿元`;
}

function provinceFill(intensity: number, active: boolean, hasData: boolean) {
  if (active) return '#4bb58f';
  if (!hasData) return '#111b19';
  const amount = Math.max(0.08, Math.min(1, intensity));
  const start = [10, 25, 22];
  const end = [43, 132, 103];
  const channel = (index: number) => Math.round(start[index] + (end[index] - start[index]) * amount);
  return `rgb(${channel(0)} ${channel(1)} ${channel(2)})`;
}

function normalizeProvinceWinding(feature: ProvinceFeature): ProvinceFeature {
  const geometry = feature.geometry;
  if (geometry.type === 'Polygon') {
    return {
      ...feature,
      geometry: {
        ...geometry,
        coordinates: geometry.coordinates.map((ring) => [...ring].reverse()),
      },
    };
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      ...feature,
      geometry: {
        ...geometry,
        coordinates: geometry.coordinates.map((polygon) => polygon.map((ring) => [...ring].reverse())),
      },
    };
  }
  return feature;
}

function regionLevelLabel(depth: number) {
  if (depth === 0) return '省级';
  if (depth === 1) return '地市级';
  return '区县级';
}

function metricTone(change?: number | null) {
  if (change === null || change === undefined || Math.abs(change) < 0.0001) return 'flat';
  return change > 0 ? 'up' : 'down';
}

function MetricCell({ item }: { item?: ChinaMetric }) {
  if (!item) return <div className="china-metric-cell is-empty"><span>等待数据</span></div>;
  return (
    <a className="china-metric-cell" href={item.sourceUrl} target="_blank" rel="noreferrer">
      <span>{item.label}</span>
      <strong>{item.display}</strong>
      <b className={`is-${metricTone(item.change)}`}>{item.changeDisplay || item.note || item.period}</b>
      <small>{item.period} · {item.source}</small>
    </a>
  );
}

function timeAgo(value?: string) {
  if (!value) return '时间待核验';
  const age = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(age)) return value.slice(0, 10);
  if (age < 3_600_000) return `${Math.max(1, Math.round(age / 60_000))} 分钟前`;
  if (age < 86_400_000) return `${Math.round(age / 3_600_000)} 小时前`;
  return value.slice(0, 10);
}

export function ChinaMacroCommandCenter({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<ChinaMacroDashboard | null>(null);
  const [geoData, setGeoData] = useState<RegionCollection | null>(null);
  const [mapTrail, setMapTrail] = useState<MapTrailItem[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [regionLoadState, setRegionLoadState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState('');
  const [selectedProvince, setSelectedProvince] = useState('广东省');
  const [selectedRegion, setSelectedRegion] = useState('广东省');
  const [hoveredProvince, setHoveredProvince] = useState('');
  const [mapMetric, setMapMetric] = useState<MapMetric>('gdp');
  const [provincePanel, setProvincePanel] = useState<ProvincePanel>('economy');
  const [provinceFeed, setProvinceFeed] = useState<ProvinceOfficialFeed | null>(null);
  const [provinceFeedState, setProvinceFeedState] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const [mapView, setMapView] = useState({ scale: 1, x: 0, y: 0 });
  const [tooltip, setTooltip] = useState({ x: 0, y: 0, visible: false });
  const mapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const dashboardRequestRef = useRef<AbortController | null>(null);
  const regionRequestRef = useRef<AbortController | null>(null);
  const provinceFeedRequestRef = useRef<AbortController | null>(null);

  const loadRootMap = async (signal: AbortSignal) => {
    try {
      const response = await fetch('/data/china-provinces.json', { signal });
      if (!response.ok) throw new Error(`中国省级地图请求失败 (${response.status})`);
      const rootMap = await response.json() as RegionCollection;
      if (signal.aborted) return;
      setGeoData(rootMap);
      setMapTrail((current) => current.length > 0 ? current : [{ label: '全国', data: rootMap }]);
    } catch (requestError) {
      if (signal.aborted) return;
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  };

  const load = async (silent = false) => {
    dashboardRequestRef.current?.abort();
    const controller = new AbortController();
    dashboardRequestRef.current = controller;
    if (!silent) {
      setLoadState('loading');
      setError('');
    }
    const sections = ['indices', 'metrics', 'policy', 'news'] as const;
    const requests = sections.map(async (section) => {
      const response = await fetch(`/api/china-macro-dashboard?section=${section}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`${section} 分区请求失败 (${response.status})`);
      const partial = await response.json() as Partial<ChinaMacroDashboard>;
      if (controller.signal.aborted) return;
      setData((current) => ({ ...EMPTY_CHINA_DASHBOARD, ...current, ...partial }));
      setLoadState('ready');
    });
    try {
      const results = await Promise.allSettled(requests);
      if (controller.signal.aborted) return;
      const failures = results.flatMap((result, index) => result.status === 'rejected' ? [sections[index]] : []);
      if (failures.length === sections.length) {
        throw new Error('中国宏观数据分区均未加载成功');
      }
      setError(failures.length ? `${failures.join('、')} 分区暂时使用现有内容` : '');
      setLoadState('ready');
    } catch (requestError) {
      if (controller.signal.aborted) return;
      setError(requestError instanceof Error ? requestError.message : String(requestError));
      setLoadState('error');
    } finally {
      if (dashboardRequestRef.current === controller) dashboardRequestRef.current = null;
    }
  };

  useEffect(() => {
    const rootMapController = new AbortController();
    void loadRootMap(rootMapController.signal);
    void load();
    const timer = window.setInterval(() => void load(true), 120_000);
    return () => {
      window.clearInterval(timer);
      rootMapController.abort();
      dashboardRequestRef.current?.abort();
      dashboardRequestRef.current = null;
      regionRequestRef.current?.abort();
      regionRequestRef.current = null;
      provinceFeedRequestRef.current?.abort();
      provinceFeedRequestRef.current = null;
    };
  }, []);

  useEffect(() => {
    provinceFeedRequestRef.current?.abort();
    const controller = new AbortController();
    provinceFeedRequestRef.current = controller;
    setProvinceFeedState('loading');
    void fetch(`/api/china-province-official-feed?province=${encodeURIComponent(selectedProvince)}`, {
      cache: 'no-store',
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error(`地方政务数据请求失败 (${response.status})`);
      return response.json() as Promise<ProvinceOfficialFeed>;
    }).then((feed) => {
      if (controller.signal.aborted) return;
      setProvinceFeed(feed);
      setProvinceFeedState(feed.sourceStatus === 'live' ? 'ready' : 'fallback');
    }).catch(() => {
      if (controller.signal.aborted) return;
      setProvinceFeed(null);
      setProvinceFeedState('fallback');
    }).finally(() => {
      if (provinceFeedRequestRef.current === controller) provinceFeedRequestRef.current = null;
    });
    return () => controller.abort();
  }, [selectedProvince]);

  const metrics = useMemo(() => new Map((data?.metrics || []).map((item) => [item.id, item])), [data]);
  const mapModel = useMemo(() => {
    if (!geoData) return null;
    const visibleFeatures = geoData.features
      .filter((item) => item.properties?.name)
      .map((item) => normalizeProvinceWinding(item as ProvinceFeature));
    const collection = { ...geoData, features: visibleFeatures } as RegionCollection;
    const projection = geoMercator().fitExtent([[32, 28], [868, 578]], collection);
    const path = geoPath(projection);
    const values = visibleFeatures.map((feature) => provinceValue(CHINA_PROVINCE_ECONOMY[feature.properties?.name || ''], mapMetric)).filter(Boolean);
    return { features: visibleFeatures as ProvinceFeature[], path, maxValue: Math.max(...values, 1) };
  }, [geoData, mapMetric]);

  const activeProvinceName = hoveredProvince || selectedProvince;
  const activeProvince = CHINA_PROVINCE_ECONOMY[activeProvinceName] || CHINA_PROVINCE_ECONOMY[selectedProvince];
  const provinceRanking = useMemo(() => {
    const rows = Object.values(CHINA_PROVINCE_ECONOMY);
    const gdp = [...rows].sort((left, right) => right.gdpMillionCny - left.gdpMillionCny);
    const perCapita = [...rows].sort((left, right) => right.gdpPerCapitaCny - left.gdpPerCapitaCny);
    return {
      gdp: gdp.findIndex((item) => item.name === selectedProvince) + 1,
      perCapita: perCapita.findIndex((item) => item.name === selectedProvince) + 1,
    };
  }, [selectedProvince]);
  const mapDepth = Math.max(0, mapTrail.length - 1);
  const structural = STRUCTURAL_IDS.map((id) => metrics.get(id));
  const tactical = TACTICAL_IDS.map((id) => metrics.get(id));
  const currentQuadrant = data?.quadrant.current || '复苏';

  const clampMapView = (view: { scale: number; x: number; y: number }) => {
    const maxOffsetX = 450 * (view.scale - 1);
    const maxOffsetY = 305 * (view.scale - 1);
    return {
      scale: Math.max(1, Math.min(8, view.scale)),
      x: Math.max(-maxOffsetX, Math.min(maxOffsetX, view.x)),
      y: Math.max(-maxOffsetY, Math.min(maxOffsetY, view.y)),
    };
  };

  const setZoom = (nextScale: number, anchorX = 450, anchorY = 305) => {
    setMapView((current) => {
      const scale = Math.max(1, Math.min(8, nextScale));
      if (scale === 1) return { scale: 1, x: 0, y: 0 };
      const ratio = scale / current.scale;
      return clampMapView({
        scale,
        x: anchorX - (anchorX - current.x) * ratio,
        y: anchorY - (anchorY - current.y) * ratio,
      });
    });
  };

  const drillRegion = async (feature: ProvinceFeature) => {
    const name = feature.properties?.name || '';
    const adcode = String(feature.properties?.adcode || '');
    if (!name) return;
    setSelectedRegion(name);
    if (mapDepth === 0 && CHINA_PROVINCE_ECONOMY[name]) setSelectedProvince(name);
    if (mapDepth >= 2 || !/^\d{6}$/.test(adcode)) return;
    regionRequestRef.current?.abort();
    const controller = new AbortController();
    regionRequestRef.current = controller;
    setRegionLoadState('loading');
    try {
      const response = await fetch(`/api/china-region-boundary?adcode=${encodeURIComponent(adcode)}`, {
        cache: 'force-cache',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`行政区划请求失败 (${response.status})`);
      const nextMap = await response.json() as RegionCollection;
      if (controller.signal.aborted) return;
      if (!Array.isArray(nextMap.features) || nextMap.features.length < 2) throw new Error('下一级行政区划暂不可用');
      setGeoData(nextMap);
      setMapTrail((current) => [...current, { label: name, adcode, data: nextMap }]);
      setMapView({ scale: 1, x: 0, y: 0 });
      setHoveredProvince('');
      setTooltip((current) => ({ ...current, visible: false }));
      setRegionLoadState('idle');
    } catch {
      if (controller.signal.aborted) return;
      setRegionLoadState('error');
    } finally {
      if (regionRequestRef.current === controller) regionRequestRef.current = null;
    }
  };

  const returnToMapLevel = (index: number) => {
    const target = mapTrail[index];
    if (!target) return;
    setGeoData(target.data);
    setMapTrail((current) => current.slice(0, index + 1));
    setSelectedRegion(target.label === '全国' ? selectedProvince : target.label);
    setMapView({ scale: 1, x: 0, y: 0 });
    setRegionLoadState('idle');
  };

  return (
    <section className="china-command-shell">
      <header className="china-command-ticker">
        <button type="button" className="china-back-button" onClick={onBack} title="返回股票市场">
          <ArrowLeft size={17} />
        </button>
        <div className="china-command-brand">
          <span><Landmark size={15} /> CHINA MACRO INTELLIGENCE</span>
          <strong>中国核心宏观主控台</strong>
        </div>
        <div className="china-index-tape" aria-label="中国主要市场指数">
          <div className="china-index-track">
            {[...(data?.indices || []), ...(data?.indices || [])].map((item, index) => (
              <a key={`${item.id}-${index}`} href={item.sourceUrl} target="_blank" rel="noreferrer" className="china-index-item">
                <small>{item.name}</small>
                <strong>{formatNumber(item.price, item.price > 10_000 ? 0 : 2)}</strong>
                <b className={item.changePercent >= 0 ? 'is-up' : 'is-down'}>{item.changePercent >= 0 ? '+' : ''}{item.changePercent.toFixed(2)}%</b>
              </a>
            ))}
          </div>
        </div>
        <div className="china-command-updated">
          <span>{loadState === 'loading' ? '连接数据中' : `更新 ${data?.generatedAt ? new Date(data.generatedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '--'}`}</span>
          <button type="button" onClick={() => void load()} title="刷新中国宏观数据"><RefreshCw size={15} className={loadState === 'loading' ? 'is-spinning' : ''} /></button>
        </div>
      </header>

      {error ? <div className="china-command-error">{error}<button type="button" onClick={() => void load()}>重新获取</button></div> : null}

      <div className="china-command-layout">
        <aside className="china-command-left">
          <div className="china-section-heading"><CircleGauge size={15} /><span>TIER 1 · 四大宏观锚点</span></div>
          <div className="china-anchor-list">
            {ANCHORS.map((anchor) => {
              const Icon = anchor.icon;
              return (
                <section className="china-anchor-card" key={anchor.id}>
                  <header><Icon size={16} /><div><small>{anchor.eyebrow}</small><strong>{anchor.title}</strong></div></header>
                  <div className="china-anchor-metrics">{anchor.metricIds.map((id) => <MetricCell key={id} item={metrics.get(id)} />)}</div>
                </section>
              );
            })}
          </div>
          <div className="china-tier-block">
            <div className="china-section-heading"><Building2 size={15} /><span>TIER 2 · 结构与传导</span></div>
            <div className="china-compact-grid">{structural.map((item, index) => <MetricCell key={item?.id || index} item={item} />)}</div>
          </div>
          <div className="china-tier-block">
            <div className="china-section-heading"><ShieldCheck size={15} /><span>TIER 3 · 战术与外溢</span></div>
            <div className="china-compact-grid">{tactical.map((item, index) => <MetricCell key={item?.id || index} item={item} />)}</div>
          </div>
        </aside>

        <main className="china-map-stage">
          <div className="china-map-title-row">
            <div><span>PROVINCIAL ECONOMIC ATLAS</span><h2>中国省级经济图谱</h2></div>
            <div className="china-map-modes">
              {([['gdp', 'GDP'], ['population', '人口'], ['perCapita', '人均 GDP']] as const).map(([id, label]) => (
                <button type="button" key={id} className={mapMetric === id ? 'is-active' : ''} onClick={() => setMapMetric(id)}>{label}</button>
              ))}
            </div>
          </div>
          <div
            className={`china-map-canvas${dragRef.current ? ' is-dragging' : ''}`}
            ref={mapRef}
            onWheel={(event) => {
              event.preventDefault();
              const bounds = mapRef.current?.getBoundingClientRect();
              if (!bounds) return;
              const anchorX = ((event.clientX - bounds.left) / bounds.width) * 900;
              const anchorY = ((event.clientY - bounds.top) / bounds.height) * 610;
              setZoom(mapView.scale * (event.deltaY < 0 ? 1.18 : 0.84), anchorX, anchorY);
            }}
            onPointerDown={(event) => {
              if (event.button !== 0 || mapView.scale <= 1) return;
              dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current;
              const bounds = mapRef.current?.getBoundingClientRect();
              if (!drag || !bounds || drag.pointerId !== event.pointerId) return;
              const dx = ((event.clientX - drag.x) / bounds.width) * 900;
              const dy = ((event.clientY - drag.y) / bounds.height) * 610;
              dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
              setMapView((current) => clampMapView({ ...current, x: current.x + dx, y: current.y + dy }));
            }}
            onPointerUp={(event) => {
              if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => { dragRef.current = null; }}
          >
            <div className="china-map-breadcrumb" aria-label="行政区划层级">
              {mapTrail.map((item, index) => (
                <button type="button" key={`${item.label}-${index}`} onClick={() => returnToMapLevel(index)} className={index === mapTrail.length - 1 ? 'is-current' : ''}>
                  {index > 0 ? <ChevronLeft size={11} /> : null}{item.label}
                </button>
              ))}
              <span>{regionLevelLabel(mapDepth)}视图</span>
            </div>
            {mapModel ? (
              <svg viewBox="0 0 900 610" role="img" aria-label="中国省级经济地图">
                <defs>
                  <filter id="province-glow"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                </defs>
                <g transform={`translate(${mapView.x} ${mapView.y}) scale(${mapView.scale})`}>
                {mapModel.features.map((feature) => {
                  const name = feature.properties?.name || '';
                  const item = mapDepth === 0 ? CHINA_PROVINCE_ECONOMY[name] : CHINA_PROVINCE_ECONOMY[selectedProvince];
                  const intensity = mapDepth === 0 && item ? Math.sqrt(provinceValue(item, mapMetric) / mapModel.maxValue) : 0.34;
                  const active = name === (hoveredProvince || selectedRegion);
                  const centroid = mapModel.path.centroid(feature);
                  const showLabel = mapDepth > 0 || mapView.scale >= 1.7;
                  return (
                    <g key={String(feature.properties?.adcode || name)}>
                    <path
                      d={mapModel.path(feature) || undefined}
                      className={`china-province${active ? ' is-active' : ''}${item ? '' : ' has-no-data'}`}
                      aria-label={name}
                      style={{
                        '--province-intensity': intensity,
                        fill: provinceFill(intensity, active, Boolean(item)),
                      } as CSSProperties}
                      tabIndex={0}
                      onMouseEnter={() => setHoveredProvince(name)}
                      onMouseLeave={() => { setHoveredProvince(''); setTooltip((current) => ({ ...current, visible: false })); }}
                      onMouseMove={(event) => {
                        const bounds = mapRef.current?.getBoundingClientRect();
                        if (!bounds) return;
                        setTooltip({ x: event.clientX - bounds.left + 14, y: event.clientY - bounds.top + 14, visible: true });
                      }}
                      onFocus={() => setHoveredProvince(name)}
                      onBlur={() => setHoveredProvince('')}
                      onClick={(event) => {
                        event.stopPropagation();
                        void drillRegion(feature);
                      }}
                    />
                    {showLabel && Number.isFinite(centroid[0]) ? (
                      <text className="china-region-label" x={centroid[0]} y={centroid[1]}>{name.replace(/(省|市|自治区|特别行政区)$/u, '')}</text>
                    ) : null}
                    </g>
                  );
                })}
                </g>
              </svg>
            ) : <div className="china-map-loading"><MapPinned size={24} /><span>正在加载省级边界</span></div>}
            {tooltip.visible ? (
              <div className="china-map-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
                <small>{regionLevelLabel(mapDepth)} · 点击进入下一级</small>
                <strong>{hoveredProvince || selectedRegion}</strong>
                <span>{activeProvince ? provinceMetricText(activeProvince, mapMetric) : `${selectedProvince}下辖行政区`}</span>
              </div>
            ) : null}
            <div className="china-map-controls">
              <button type="button" onClick={() => setZoom(mapView.scale * 1.25)} title="放大地图"><Plus size={15} /></button>
              <button type="button" onClick={() => setZoom(mapView.scale * 0.8)} title="缩小地图"><Minus size={15} /></button>
              <button type="button" onClick={() => setMapView({ scale: 1, x: 0, y: 0 })} title="复位地图"><RotateCcw size={14} /></button>
            </div>
            <div className="china-map-status">
              {regionLoadState === 'loading' ? '正在加载下一级行政区划' : regionLoadState === 'error' ? '下一级边界暂不可用' : `缩放 ${mapView.scale.toFixed(1)}× · 滚轮缩放 · 拖动平移`}
            </div>
            <div className="china-map-legend"><span>低</span><i /><span>高</span></div>
          </div>
          <section className="china-province-inspector">
            <header>
              <MapPinned size={17} />
              <div><small>SELECTED REGION</small><strong>{selectedRegion}</strong></div>
              <span>{selectedProvince} · {regionLevelLabel(mapDepth)}</span>
            </header>
            <div className="china-province-tabs">
              {PROVINCE_PANEL_TABS.map(({ id, label, icon: Icon }) => (
                <button type="button" key={id} onClick={() => setProvincePanel(id)} className={provincePanel === id ? 'is-active' : ''}>
                  <Icon size={14} />{label}
                </button>
              ))}
            </div>
            {activeProvince ? (
              <div className="china-province-panel">
                {provincePanel === 'government' ? <>
                  <div><span>省级政府门户</span><strong>{activeProvince.shortName}省级政务官网</strong><small>领导、机构与政府信息以本省官网实时页面为准</small></div>
                  <div><span>政务数据状态</span><strong>{provinceFeedState === 'loading' ? '并行获取中' : provinceFeedState === 'ready' ? '官方页面已连接' : '官方入口可用'}</strong><small>抓取失败不会影响经济、财政与人口数据</small></div>
                  <div><span>地方政策</span><strong>{provinceFeed?.policies.length || 0} 条可访问</strong><small>仅展示省级政府及政务公开页面</small></div>
                  <a href={activeProvince.governmentUrl} target="_blank" rel="noreferrer">打开官方门户<ArrowUpRight size={12} /></a>
                </> : null}
                {provincePanel === 'economy' ? <>
                  <div><span>地区生产总值</span><strong>{formatNumber(activeProvince.gdpMillionCny / 100, 1)} 亿元</strong><small>{activeProvince.period} 年国家统计局统一核算口径</small></div>
                  <div><span>人均 GDP</span><strong>¥{formatNumber(activeProvince.gdpPerCapitaCny, 0)}</strong><small>31 地区第 {provinceRanking.perCapita} 位</small></div>
                  <div><span>经济总量位次</span><strong>第 {provinceRanking.gdp} 位</strong><small>按 31 个省、自治区、直辖市比较</small></div>
                  <div><span>经济与产业入口</span><strong>{PROVINCE_PILLARS[selectedProvince] || '省级统计公报与政府工作报告'}</strong><small>产业信息不与其他省份或其他年份串用</small></div>
                </> : null}
                {provincePanel === 'fiscal' ? <>
                  <div><span>一般公共预算收入</span><strong>{formatNumber(activeProvince.fiscalRevenue100mCny, 2)} 亿元</strong><small>{activeProvince.period} 年国家统计局年鉴口径</small></div>
                  <div><span>一般公共预算支出</span><strong>{formatNumber(activeProvince.fiscalExpenditure100mCny, 2)} 亿元</strong><small>{activeProvince.period} 年国家统计局年鉴口径</small></div>
                  <div><span>财政自给率</span><strong>{formatNumber(activeProvince.fiscalSelfSufficiencyPercent, 1)}%</strong><small>一般公共预算收入 ÷ 一般公共预算支出</small></div>
                  <div><span>收支缺口</span><strong>{formatNumber(activeProvince.fiscalExpenditure100mCny - activeProvince.fiscalRevenue100mCny, 2)} 亿元</strong><small>仅为预算收支差额，不等同于地方债务余额</small></div>
                </> : null}
                {provincePanel === 'population' ? <>
                  <div><span>年末常住人口</span><strong>{formatNumber(activeProvince.populationMillion, 2)} 百万人</strong><small>{activeProvince.period} 年国家统计局人口变动抽样调查</small></div>
                  <div><span>常住人口城镇化率</span><strong>{formatNumber(activeProvince.urbanizationPercent, 2)}%</strong><small>城镇人口占年末常住人口比重</small></div>
                  <div><span>出生 / 自然增长率</span><strong>{formatNumber(activeProvince.birthRatePermille, 2)}‰ · {signedNumber(activeProvince.naturalGrowthRatePermille)}‰</strong><small>同年、同一人口调查口径</small></div>
                  <div><span>老年人口抚养比</span><strong>{formatNumber(activeProvince.elderlyDependencyPercent, 2)}%</strong><small>65 岁及以上人口相对 15—64 岁人口</small></div>
                  <GraduationCap className="china-panel-watermark" size={52} />
                </> : null}
              </div>
            ) : <p className="china-province-unavailable">该行政区暂未纳入同一统计口径，页面不会用其他年份数据补位。</p>}
            <div className="china-local-intel">
              <section>
                <header><Landmark size={13} /><strong>地方政策</strong><span>{provinceFeedState === 'loading' ? '获取中' : provinceFeedState === 'ready' ? '官方实时页' : '官方入口'}</span></header>
                {(provinceFeed?.policies || []).slice(0, 3).map((item) => <a key={item.id} href={item.url} target="_blank" rel="noreferrer"><span>{item.title}</span><ArrowUpRight size={11} /></a>)}
              </section>
              <section>
                <header><Database size={13} /><strong>地方新闻</strong><span>{provinceFeedState === 'loading' ? '获取中' : provinceFeedState === 'ready' ? '官方实时页' : '官方入口'}</span></header>
                {(provinceFeed?.news || []).slice(0, 3).map((item) => <a key={item.id} href={item.url} target="_blank" rel="noreferrer"><span>{item.title}</span><ArrowUpRight size={11} /></a>)}
              </section>
            </div>
            <a href={(provincePanel === 'fiscal' ? CHINA_PROVINCE_DATA_SOURCES.fiscal : provincePanel === 'population' ? CHINA_PROVINCE_DATA_SOURCES.population : CHINA_PROVINCE_DATA_SOURCES.economy).url} target="_blank" rel="noreferrer">
              {(provincePanel === 'fiscal' ? CHINA_PROVINCE_DATA_SOURCES.fiscal : provincePanel === 'population' ? CHINA_PROVINCE_DATA_SOURCES.population : CHINA_PROVINCE_DATA_SOURCES.economy).label}<ArrowUpRight size={13} />
            </a>
          </section>
        </main>

        <aside className="china-command-right">
          <section className="china-policy-board">
            <div className="china-section-heading"><Landmark size={15} /><span>政策周期与信用状态</span></div>
            <div className="china-policy-state">
              <small>当前阶段</small><strong>{data?.policy.stage || '等待宏观数据'}</strong><p>{data?.policy.direction || '正在连接政策信息'}</p>
              <div><span>信用状态</span><b>{data?.policy.creditState || '--'}</b></div>
            </div>
            <a className="china-next-data" href={data?.policy.nextDataUrl} target="_blank" rel="noreferrer"><CalendarClock size={16} /><span><small>下一项重要数据</small><strong>{data?.policy.nextData || '国家统计局发布日程'}</strong></span><ArrowUpRight size={14} /></a>
            <div className="china-policy-links">{(data?.policy.policies || []).map((item) => <a key={item.url} href={item.url} target="_blank" rel="noreferrer"><span>{item.title}</span><small>{item.source}</small></a>)}</div>
          </section>

          <section className="china-quadrant-board">
            <div className="china-section-heading"><CircleGauge size={15} /><span>增长 × 通胀四象限</span></div>
            <div className="china-quadrant-grid">
              {['过热', '滞胀', '复苏', '衰退 / 通缩'].map((label) => <div key={label} className={label === currentQuadrant ? 'is-active' : ''}><span>{label}</span></div>)}
              <i className="axis-x" /><i className="axis-y" />
            </div>
            <div className="china-quadrant-result"><span>当前判断</span><strong>{currentQuadrant}</strong><p>{data?.quadrant.explanation}</p></div>
          </section>

          <section className="china-news-board">
            <div className="china-section-heading">
              <Database size={15} />
              <span>中国政策与经济要闻</span>
              <b>{data?.newsMeta ? `${data.newsMeta.onlineSources}/${data.newsMeta.totalSources} SOURCES` : 'MULTI-SOURCE'}</b>
            </div>
            <div className="china-news-list">
              {(data?.news || []).length ? data!.news.map((item, index) => (
                <a
                  key={item.id}
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  title={`${item.importanceReason || '按重要性与时效排序'}${item.sources?.length ? `\n来源：${item.sources.join('、')}` : ''}`}
                >
                  <em>{String(index + 1).padStart(2, '0')}</em>
                  <div>
                    <strong>{item.title}</strong>
                    <span>
                      <i className={`is-${item.importance || 'medium'}`} />
                      {item.category} · {item.sourceCount && item.sourceCount > 1 ? `${item.sourceCount}源印证` : item.source} · {timeAgo(item.publishedAt)}
                    </span>
                  </div>
                  <ArrowUpRight size={13} />
                </a>
              )) : <div className="china-news-empty">今日高重要性国内要闻暂未抓取到，避免用旧闻填充。</div>}
            </div>
          </section>
        </aside>
      </div>

      <footer className="china-command-footer">
        <span><Banknote size={13} /> 国内实时要闻</span>
        <div className="china-footer-news" aria-label="中国实时新闻滚动">
          <div className="china-footer-news-track">
            {[...(data?.news || []), ...(data?.news || [])].map((item, index) => (
              <a key={`footer-${item.id}-${index}`} href={item.url} target="_blank" rel="noreferrer">
                <i className={`is-${item.importance || 'medium'}`} />
                <b>{item.category}</b><span>{timeAgo(item.publishedAt)}</span><strong>{item.title}</strong><em>{item.source}</em>
              </a>
            ))}
          </div>
        </div>
        <b title={data?.methodology}><Database size={13} /> 官方口径优先</b>
      </footer>
    </section>
  );
}
