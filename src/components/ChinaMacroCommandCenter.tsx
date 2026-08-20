import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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
  X,
} from 'lucide-react';
import { CHINA_PROVINCE_DATA_SOURCES, CHINA_PROVINCE_ECONOMY, type ChinaProvinceEconomy } from '../data/chinaProvinceEconomy';
import chinaRegionalEconomy from '../data/chinaRegionalEconomy.json';
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
  sourceStatus: 'live' | 'unavailable';
  errors: string[];
};

type AdministrativeLevel = 'province' | 'city' | 'county';

type ChinaRegionalEconomy = {
  adcode: string;
  name: string;
  level: 'city' | 'county';
  period: string;
  source: string;
  sourceUrl: string;
  parentProvinceCode?: string;
  parentCityCode?: string;
  dataCoverage?: 'administrative' | 'population' | 'economic';
  economicPeriod?: string | null;
  economicSource?: string | null;
  economicSourceUrl?: string | null;
  populationPeriod?: string | null;
  populationSource?: string | null;
  populationSourceUrl?: string | null;
  censusPeriod?: string | null;
  censusSource?: string | null;
  censusSourceUrl?: string | null;
  gdp100mCny?: number | null;
  populationMillion?: number | null;
  censusPopulationMillion?: number | null;
  householdPopulation10k?: number | null;
  householdSize?: number | null;
  sexRatio?: number | null;
  age0To14Percent?: number | null;
  age60PlusPercent?: number | null;
  age65PlusPercent?: number | null;
  areaKm2?: number | null;
  primary100mCny?: number | null;
  secondary100mCny?: number | null;
  tertiary100mCny?: number | null;
  secondaryPercent?: number | null;
  tertiaryPercent?: number | null;
  fiscalRevenue100mCny?: number | null;
  fiscalExpenditure100mCny?: number | null;
  deposit100mCny?: number | null;
  loan100mCny?: number | null;
  averageWageCny?: number | null;
  townCount?: number | null;
  streetCount?: number | null;
  industrialEnterpriseCount?: number | null;
  primarySchoolCount?: number | null;
  higherSchoolCount?: number | null;
  primaryStudentCount?: number | null;
  secondaryStudentCount?: number | null;
  healthBedCount?: number | null;
};

const CHINA_REGIONAL_ECONOMY = chinaRegionalEconomy.records as Record<string, ChinaRegionalEconomy>;

type MapTrailItem = {
  label: string;
  adcode?: string;
  level?: AdministrativeLevel;
  data: RegionCollection;
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

const METRIC_VISUALS = {
  tsf: { label: '社融增量', icon: Waves },
  m1m2: { label: 'M1–M2 剪刀差', icon: Banknote },
  'official-pmi': { label: '官方制造业 PMI', icon: Factory },
  'caixin-pmi': { label: '财新制造业 PMI', icon: Factory },
  cpi: { label: 'CPI 同比', icon: TrendingUp },
  ppi: { label: 'PPI 同比', icon: Factory },
  dr007: { label: 'DR007', icon: CircleGauge },
  cn10y: { label: '中国 10Y 国债', icon: Landmark },
  lpr: { label: 'LPR', icon: BadgeDollarSign },
  'household-loans': { label: '居民中长期贷款', icon: Users },
  'corporate-loans': { label: '企业中长期贷款', icon: Building2 },
  fiscal: { label: '一般公共预算支出', icon: Banknote },
  property: { label: '商品房销售额', icon: Building2 },
  'land-sales': { label: '土地出让收入', icon: MapPinned },
  exports: { label: '出口累计同比', icon: TrendingUp },
  'cn-us-spread': { label: '中美 10Y 利差', icon: Waves },
  'cnh-hibor': { label: 'CNH HIBOR 隔夜', icon: CircleGauge },
  'credit-spread': { label: 'AAA 信用利差', icon: ShieldCheck },
  'bill-financing': { label: '票据融资增量', icon: Banknote },
  'interbank-repo': { label: '质押式回购利率', icon: Landmark },
  'term-spread': { label: '国债 10Y–1Y 利差', icon: TrendingUp },
} as const;

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

function administrativeLevelForFeature(adcode: string, depth: number): AdministrativeLevel {
  if (depth === 0) return 'province';
  return CHINA_REGIONAL_ECONOMY[adcode]?.level || (/^\d{4}00$/.test(adcode) ? 'city' : 'county');
}

function regionLevelLabel(level: AdministrativeLevel | 'mixed') {
  if (level === 'province') return '省级';
  if (level === 'city') return '地市级';
  if (level === 'county') return '区县级';
  return '地市 / 区县级';
}

function metricTone(change?: number | null) {
  if (change === null || change === undefined || Math.abs(change) < 0.0001) return 'flat';
  return change > 0 ? 'up' : 'down';
}

function regionalPopulationMillion(item: ChinaRegionalEconomy) {
  if (item.populationMillion != null) return item.populationMillion;
  if (item.householdPopulation10k != null) return item.householdPopulation10k / 100;
  return null;
}

function regionalPerCapitaGdp(item: ChinaRegionalEconomy) {
  const population = regionalPopulationMillion(item);
  if (item.gdp100mCny == null || !population) return null;
  return item.gdp100mCny * 100 / population;
}

function regionalValue(item: ChinaRegionalEconomy | undefined, metric: MapMetric) {
  if (!item) return 0;
  if (metric === 'population') return regionalPopulationMillion(item) || 0;
  if (metric === 'perCapita') return regionalPerCapitaGdp(item) || 0;
  return item.gdp100mCny || 0;
}

function regionalMetricText(item: ChinaRegionalEconomy, metric: MapMetric) {
  if (metric === 'population') {
    const population = regionalPopulationMillion(item);
    return population == null ? '人口数据暂缺' : `${formatNumber(population, 2)} 百万人`;
  }
  if (metric === 'perCapita') {
    const value = regionalPerCapitaGdp(item);
    return value == null ? '人均 GDP 暂缺' : `¥${formatNumber(value, 0)}`;
  }
  return item.gdp100mCny == null ? 'GDP 数据暂缺' : `¥${formatNumber(item.gdp100mCny, 2)} 亿元`;
}

function regionalDisplay(value: number | null | undefined, suffix = '', digits = 2) {
  return value == null ? '—' : `${formatNumber(value, digits)}${suffix}`;
}

function RegionalEconomyPanel({ profile, panel }: { profile: ChinaRegionalEconomy; panel: ProvincePanel }) {
  const population = regionalPopulationMillion(profile);
  const primaryPercent = profile.secondaryPercent != null && profile.tertiaryPercent != null
    ? Math.max(0, 100 - profile.secondaryPercent - profile.tertiaryPercent)
    : null;
  const fiscalGap = profile.fiscalRevenue100mCny != null && profile.fiscalExpenditure100mCny != null
    ? profile.fiscalExpenditure100mCny - profile.fiscalRevenue100mCny
    : null;
  const fiscalRevenueToGdp = profile.fiscalRevenue100mCny != null && profile.gdp100mCny
    ? profile.fiscalRevenue100mCny / profile.gdp100mCny * 100
    : null;
  const loanToGdp = profile.loan100mCny != null && profile.gdp100mCny
    ? profile.loan100mCny / profile.gdp100mCny * 100
    : null;
  const economicPeriod = profile.economicPeriod || (profile.gdp100mCny != null ? profile.period : null);
  const populationPeriod = profile.populationPeriod || profile.censusPeriod || null;
  const economicSource = profile.economicSource || (profile.gdp100mCny != null ? profile.source : null);
  const coverageLabel = profile.dataCoverage === 'economic'
    ? '经济与人口数据'
    : profile.dataCoverage === 'population'
      ? '人口普查与行政档案'
      : '行政区划档案';
  return (
    <div className="china-province-panel">
      {panel === 'government' ? <>
        <div><span>行政区划代码</span><strong>{profile.adcode}</strong><small>民政部县以上行政区划代码</small></div>
        <div><span>行政层级</span><strong>{profile.level === 'city' ? '地市级行政区' : '区县级行政区'}</strong><small>当前面板严格对应所选区域</small></div>
        <div><span>数据覆盖</span><strong>{coverageLabel}</strong><small>缺失指标保留为空，不借用父级数据</small></div>
        <div><span>行政档案版本</span><strong>2024 年</strong><small>全国县以上行政区划代码</small></div>
      </> : null}
      {panel === 'economy' ? <>
        <div><span>地区生产总值</span><strong>{regionalDisplay(profile.gdp100mCny, ' 亿元', 2)}</strong><small>{economicPeriod ? `${economicPeriod} 年本级行政区口径` : '本级公开统计口径暂缺'}</small></div>
        <div><span>第一产业</span><strong>{profile.primary100mCny != null ? regionalDisplay(profile.primary100mCny, ' 亿元', 2) : regionalDisplay(primaryPercent, '%', 2)}</strong><small>{profile.primary100mCny != null ? '第一产业增加值' : '按产业占比反算'}</small></div>
        <div><span>第二产业</span><strong>{profile.secondary100mCny != null ? regionalDisplay(profile.secondary100mCny, ' 亿元', 2) : regionalDisplay(profile.secondaryPercent, '%', 2)}</strong><small>{profile.secondary100mCny != null ? '第二产业增加值' : '第二产业占 GDP 比重'}</small></div>
        <div><span>第三产业</span><strong>{profile.tertiary100mCny != null ? regionalDisplay(profile.tertiary100mCny, ' 亿元', 2) : regionalDisplay(profile.tertiaryPercent, '%', 2)}</strong><small>{economicSource || '本级经济来源暂缺'}</small></div>
      </> : null}
      {panel === 'fiscal' && profile.level === 'city' ? <>
        <div><span>一般公共预算收入</span><strong>{regionalDisplay(profile.fiscalRevenue100mCny, ' 亿元', 2)}</strong><small>{economicPeriod ? `${economicPeriod} 年本级财政口径` : '本级财政数据暂缺'}</small></div>
        <div><span>金融机构贷款余额</span><strong>{regionalDisplay(profile.loan100mCny, ' 亿元', 2)}</strong><small>年末金融机构各项贷款余额</small></div>
        <div><span>财政收入 / GDP</span><strong>{regionalDisplay(fiscalRevenueToGdp, '%', 2)}</strong><small>同年一般公共预算收入占 GDP 比重</small></div>
        <div><span>贷款余额 / GDP</span><strong>{regionalDisplay(loanToGdp, '%', 2)}</strong><small>观察地区信用扩张相对经济体量</small></div>
      </> : null}
      {panel === 'fiscal' && profile.level === 'county' ? <>
        <div><span>一般公共预算收入</span><strong>{regionalDisplay(profile.fiscalRevenue100mCny, ' 亿元', 2)}</strong><small>{economicPeriod ? `${economicPeriod} 年本级财政口径` : '本级财政数据暂缺'}</small></div>
        <div><span>一般公共预算支出</span><strong>{regionalDisplay(profile.fiscalExpenditure100mCny, ' 亿元', 2)}</strong><small>年鉴未提供时保留为空，不借用父级</small></div>
        <div><span>金融机构贷款余额</span><strong>{regionalDisplay(profile.loan100mCny, ' 亿元', 2)}</strong><small>年末金融机构各项贷款余额</small></div>
        <div><span>财政收支缺口</span><strong>{regionalDisplay(fiscalGap, ' 亿元', 2)}</strong><small>一般公共预算支出减收入</small></div>
      </> : null}
      {panel === 'population' ? <>
        <div><span>人口规模</span><strong>{regionalDisplay(population, ' 百万人', 2)}</strong><small>{profile.populationSource || profile.censusSource || '本级人口来源暂缺'} · {populationPeriod || '时期暂缺'}</small></div>
        <div><span>0—14 岁人口</span><strong>{regionalDisplay(profile.age0To14Percent, '%', 2)}</strong><small>{profile.censusPeriod || '2020'} 年人口普查年龄结构</small></div>
        <div><span>60 岁及以上人口</span><strong>{regionalDisplay(profile.age60PlusPercent, '%', 2)}</strong><small>{profile.censusPeriod || '2020'} 年人口普查年龄结构</small></div>
        <div><span>性别比 / 户规模</span><strong>{profile.sexRatio == null && profile.householdSize == null ? '—' : `${regionalDisplay(profile.sexRatio, '', 2)} / ${regionalDisplay(profile.householdSize, ' 人', 2)}`}</strong><small>{profile.censusSource || '第七次全国人口普查'}</small></div>
        <GraduationCap className="china-panel-watermark" size={52} />
      </> : null}
    </div>
  );
}

function metricSignal(item: ChinaMetric) {
  if (item.changeDisplay) return item.changeDisplay;
  if (item.note && item.note.length <= 8) return item.note;
  if (item.status === 'live') return '官方更新';
  if (item.status === 'delayed') return '最新口径';
  return '数据待核验';
}

function metricPeriodLabel(period: string) {
  const cumulative = period.match(/^(\d{4})-01[—–-]07$/);
  if (cumulative) return `${cumulative[1]}年1—7月累计`;
  const halfYear = period.match(/^(\d{4})\s*H1$/i);
  if (halfYear) return `${halfYear[1]}年上半年`;
  const month = period.match(/^(\d{4})-(\d{2})$/);
  if (month) return `${month[1]}年${Number(month[2])}月`;
  const day = period.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (day) return `截至${Number(day[2])}月${Number(day[3])}日`;
  return period;
}

function metricJudgement(item: ChinaMetric): { label: string; detail: string; tone: 'support' | 'risk' | 'watch' | 'neutral' } {
  const value = metricValue(item);
  const change = item.change ?? 0;
  const judgements: Record<string, { label: string; detail: string; tone: 'support' | 'risk' | 'watch' | 'neutral' }> = {
    tsf: value >= 7
      ? { label: '信用总量扩张', detail: '融资存量仍在增长，对需求形成支撑', tone: 'support' }
      : { label: '信用脉冲偏弱', detail: '融资扩张速度不足，内需修复承压', tone: 'watch' },
    m1m2: value < 0
      ? { label: '资金活性偏弱', detail: 'M1弱于M2，企业活期资金与交易意愿不足', tone: 'watch' }
      : { label: '资金活性改善', detail: '活期资金增速改善，经济交易活跃度回升', tone: 'support' },
    'official-pmi': value < 50
      ? { label: '制造业收缩', detail: '低于50荣枯线，制造业景气度偏弱', tone: 'risk' }
      : { label: '制造业扩张', detail: '高于50荣枯线，制造业活动扩张', tone: 'support' },
    'caixin-pmi': value < 50
      ? { label: '民企景气收缩', detail: '财新样本低于荣枯线，民企和出口链偏弱', tone: 'risk' }
      : { label: '民企景气扩张', detail: '财新样本高于荣枯线，民企景气相对较强', tone: 'support' },
    cpi: change < 0
      ? { label: '消费价格降温', detail: '环比回落，居民端价格压力下降', tone: 'watch' }
      : { label: '消费价格走强', detail: '环比回升，居民端价格压力抬升', tone: 'risk' },
    ppi: change < 0
      ? { label: '工业价格降温', detail: '环比回落，上游价格向下游传导减弱', tone: 'watch' }
      : { label: '工业价格走强', detail: '环比回升，上游成本压力增强', tone: 'risk' },
    dr007: value < 1.6
      ? { label: '资金面偏松', detail: '银行间短端资金价格处于偏低水平', tone: 'support' }
      : { label: '资金面偏紧', detail: '银行间短端融资成本偏高', tone: 'watch' },
    cn10y: { label: '长端利率低位', detail: '长期增长与通胀预期仍偏谨慎', tone: 'neutral' },
    lpr: change === 0
      ? { label: '贷款利率维持', detail: '企业与居民贷款定价暂未进一步调整', tone: 'neutral' }
      : { label: '贷款利率调整', detail: '实体融资成本发生变化', tone: change < 0 ? 'support' : 'risk' },
    'household-loans': { label: '居民信用偏弱', detail: '中长期贷款增量偏低，购房与耐用品需求修复有限', tone: 'watch' },
    'corporate-loans': { label: '企业融资较强', detail: '企业中长期融资形成信用扩张支撑', tone: 'support' },
    fiscal: value > 0
      ? { label: '财政温和发力', detail: '公共预算支出增长，对总需求形成支撑', tone: 'support' }
      : { label: '财政支出收缩', detail: '财政支出对需求的拉动减弱', tone: 'risk' },
    property: value < 0
      ? { label: '地产拖累扩大', detail: '商品房销售收缩，地产链需求继续承压', tone: 'risk' }
      : { label: '地产销售修复', detail: '商品房销售改善，地产链拖累减轻', tone: 'support' },
    'land-sales': value < 0
      ? { label: '地方财力承压', detail: '土地收入下降，地方政府可用财力受到约束', tone: 'risk' }
      : { label: '土地收入改善', detail: '土地收入回升，地方财力约束缓解', tone: 'support' },
    exports: value > 0
      ? { label: '外需形成支撑', detail: '出口增长为工业生产与就业提供支撑', tone: 'support' }
      : { label: '外需转弱', detail: '出口收缩，对制造业形成拖累', tone: 'risk' },
    'cn-us-spread': value < 0
      ? { label: '人民币利差承压', detail: '中美利差倒挂，跨境资金与汇率仍有压力', tone: 'watch' }
      : { label: '人民币利差改善', detail: '中美利差改善，外部资金压力缓解', tone: 'support' },
    'cnh-hibor': { label: '离岸流动性平稳', detail: '离岸人民币短端资金面保持平稳', tone: 'neutral' },
    'credit-spread': value < 60
      ? { label: '信用风险可控', detail: '高等级信用利差较窄，风险溢价温和', tone: 'support' }
      : { label: '信用风险升温', detail: '信用利差走阔，市场风险补偿上升', tone: 'risk' },
    'bill-financing': { label: '短期融资偏多', detail: '票据融资增加，需观察真实投资需求承接', tone: 'watch' },
    'interbank-repo': change <= 0
      ? { label: '短端资金偏松', detail: '回购利率较上月下降，流动性相对充裕', tone: 'support' }
      : { label: '短端资金趋紧', detail: '回购利率上升，流动性边际收紧', tone: 'watch' },
    'term-spread': value > 0
      ? { label: '曲线正斜率', detail: '长端利率高于短端，暂未出现期限倒挂', tone: 'neutral' }
      : { label: '期限曲线倒挂', detail: '长端利率低于短端，衰退预期升温', tone: 'risk' },
  };
  return judgements[item.id] || { label: metricSignal(item), detail: item.note || '请结合历史区间与市场预期综合判断', tone: 'neutral' };
}

function MetricCell({ item }: { item?: ChinaMetric }) {
  if (!item) return <div className="china-metric-cell is-empty"><span className="china-metric-name">等待数据</span></div>;
  const visual = METRIC_VISUALS[item.id as keyof typeof METRIC_VISUALS];
  const Icon = visual?.icon || CircleGauge;
  const judgement = metricJudgement(item);
  return (
    <a
      className={`china-metric-cell china-metric-${item.id}`}
      href={item.sourceUrl}
      target="_blank"
      rel="noreferrer"
      title={`${item.label}\n${judgement.detail}\n${item.note || ''}\n${metricPeriodLabel(item.period)} · ${item.source}`}
    >
      <span className="china-metric-head">
        <i><Icon size={12} /></i>
        <span className="china-metric-name">{visual?.label || item.label}</span>
        <em className={`is-${item.status}`} />
      </span>
      <span className="china-metric-value"><strong>{item.display}</strong><ArrowUpRight size={11} /></span>
      <span className="china-metric-foot">
        <b className={`is-impact-${judgement.tone}`}>{judgement.label}</b>
        <small>{metricPeriodLabel(item.period)}</small>
      </span>
    </a>
  );
}

type MacroAnchor = (typeof ANCHORS)[number];

function metricValue(item?: ChinaMetric) {
  return item?.value != null && Number.isFinite(item.value) ? item.value : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function anchorVerdict(anchorId: MacroAnchor['id'], items: ChinaMetric[]) {
  const values = new Map(items.map((item) => [item.id, item]));
  if (anchorId === 'credit') {
    const credit = metricValue(values.get('tsf'));
    const moneyGap = metricValue(values.get('m1m2'));
    if (credit > 7 && moneyGap < 0) return '总量扩张 · 活性偏弱';
    if (credit <= 7 && moneyGap < 0) return '信用脉冲偏弱';
    return '融资与货币活性改善';
  }
  if (anchorId === 'growth') {
    const official = metricValue(values.get('official-pmi'));
    const caixin = metricValue(values.get('caixin-pmi'));
    if (official < 50 && caixin >= 50) return '景气分化';
    if (official < 50 && caixin < 50) return '制造业收缩';
    return '扩张区间';
  }
  if (anchorId === 'inflation') {
    const changes = items.map((item) => item.change).filter((value): value is number => value != null);
    if (changes.length && changes.every((value) => value < 0)) return '价格压力边际降温';
    if (changes.some((value) => value < 0) && changes.some((value) => value > 0)) return '通胀信号分化';
    return '再通胀压力抬升';
  }
  const dr007 = metricValue(values.get('dr007'));
  const cn10y = metricValue(values.get('cn10y'));
  return cn10y > dr007 ? '资金面平稳 · 曲线正斜率' : '期限曲线承压';
}

function metricPhenomenon(item: ChinaMetric) {
  if (item.id === 'tsf') return metricValue(item) >= 7 ? '融资总量仍在扩张' : '信用扩张速度偏弱';
  if (item.id === 'm1m2') return metricValue(item) < 0 ? '资金活化程度偏弱' : '活期资金改善';
  if (item.id === 'official-pmi' || item.id === 'caixin-pmi') return metricValue(item) >= 50 ? '位于扩张区间' : '位于收缩区间';
  if (item.id === 'cpi') return (item.change ?? 0) < 0 ? '消费价格边际降温' : '消费价格压力回升';
  if (item.id === 'ppi') return (item.change ?? 0) < 0 ? '工业品价格环比回落' : '工业品价格环比走强';
  if (item.id === 'dr007') return metricValue(item) < 1.6 ? '银行间资金偏宽' : '资金价格偏紧';
  if (item.id === 'cn10y') return '长端利率定价增长预期';
  if (item.id === 'lpr') return (item.change ?? 0) === 0 ? '贷款报价利率维持' : '贷款报价利率调整';
  return metricSignal(item);
}

function MacroMetricLink({ item, className, children, style }: { item: ChinaMetric; className: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <a
      className={className}
      href={item.sourceUrl}
      target="_blank"
      rel="noreferrer"
      style={style}
      title={`${item.label}\n${item.note || ''}\n${item.period} · ${item.source}`}
    >
      {children}
    </a>
  );
}

function MacroAnchorVisual({ anchor, items }: { anchor: MacroAnchor; items: ChinaMetric[] }) {
  if (anchor.id === 'credit') {
    return (
      <div className="china-credit-pulse">
        {items.map((item) => {
          const fill = item.id === 'tsf'
            ? clamp(metricValue(item) / 12 * 100, 8, 100)
            : clamp(Math.abs(metricValue(item)) / 8 * 100, 8, 100);
          return (
            <MacroMetricLink key={item.id} item={item} className="china-credit-metric" style={{ '--signal-fill': `${fill}%` } as CSSProperties}>
              <span><b>{METRIC_VISUALS[item.id as keyof typeof METRIC_VISUALS]?.label || item.label}</b><em className={`is-${item.status}`} /></span>
              <strong>{item.display}</strong>
              <small>{metricPhenomenon(item)} · {metricPeriodLabel(item.period)}</small>
              <i><u /></i>
            </MacroMetricLink>
          );
        })}
      </div>
    );
  }

  if (anchor.id === 'growth') {
    return (
      <div className="china-pmi-board">
        <div className="china-pmi-axis"><span>45</span><b>50 · 荣枯线</b><span>55</span></div>
        {items.map((item) => {
          const position = clamp((metricValue(item) - 45) / 10 * 100, 2, 98);
          const bandStart = Math.min(50, position);
          const bandWidth = Math.abs(position - 50);
          const distance = Math.abs(metricValue(item) - 50).toFixed(1);
          const expanding = metricValue(item) >= 50;
          return (
            <MacroMetricLink
              key={item.id}
              item={item}
              className={`china-pmi-row ${expanding ? 'is-expansion' : 'is-contraction'}`}
              style={{ '--pmi-position': `${position}%`, '--pmi-band-start': `${bandStart}%`, '--pmi-band-width': `${bandWidth}%` } as CSSProperties}
            >
              <span className="china-pmi-row-head">
                <b>{item.id === 'official-pmi' ? '官方 PMI' : '财新 PMI'}</b>
                <em className={expanding ? 'is-expansion' : 'is-contraction'}>{expanding ? '扩张' : '收缩'}</em>
                <strong>{item.display}</strong>
              </span>
              <div className="china-pmi-track"><i /><em /></div>
              <span className="china-pmi-row-foot">
                <b>{expanding ? '高于' : '低于'}荣枯线 {distance} 点</b>
                <small>较前值 {metricSignal(item)} · {metricPeriodLabel(item.period)}</small>
              </span>
            </MacroMetricLink>
          );
        })}
      </div>
    );
  }

  if (anchor.id === 'inflation') {
    return (
      <div className="china-inflation-radar">
        {items.map((item) => {
          const pressure = clamp(Math.abs(metricValue(item)) / 5 * 100, 6, 100);
          return (
            <MacroMetricLink key={item.id} item={item} className={`china-inflation-metric is-${item.id}`} style={{ '--inflation-pressure': `${pressure * 3.6}deg` } as CSSProperties}>
              <span className="china-inflation-ring"><i><strong>{item.display}</strong><small>同比</small></i></span>
              <span className="china-inflation-copy"><b>{item.id.toUpperCase()}</b><strong>{metricPhenomenon(item)}</strong><small>{metricSignal(item)} · {metricPeriodLabel(item.period)}</small></span>
            </MacroMetricLink>
          );
        })}
      </div>
    );
  }

  const rateItems = items.filter((item) => ['dr007', 'cn10y', 'lpr'].includes(item.id));
  const points = rateItems.map((item, index) => {
    const x = 18 + index * 82;
    const y = 57 - clamp(metricValue(item), 0, 4) / 4 * 38;
    return `${x},${y}`;
  }).join(' ');
  return (
    <div className="china-rate-curve">
      <div className="china-rate-chart" aria-label="当期资金价格横截面">
        <svg viewBox="0 0 200 66" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="57" x2="200" y2="57" />
          <line x1="0" y1="28" x2="200" y2="28" />
          <polyline points={points} />
          {rateItems.map((item, index) => <circle key={item.id} cx={18 + index * 82} cy={57 - clamp(metricValue(item), 0, 4) / 4 * 38} r="3" />)}
        </svg>
        <span>当期资金价格曲线</span>
      </div>
      <div className="china-rate-points">
        {rateItems.map((item) => (
          <MacroMetricLink key={item.id} item={item} className={`china-rate-point is-${item.id}`}>
            <span>{item.id === 'cn10y' ? '10Y 国债' : item.id.toUpperCase()}</span>
            <strong>{item.display}</strong>
            <small>{metricPhenomenon(item)}</small>
          </MacroMetricLink>
        ))}
      </div>
    </div>
  );
}

function MacroAnchorCard({ anchor, metrics }: { anchor: MacroAnchor; metrics: Map<string, ChinaMetric> }) {
  const Icon = anchor.icon;
  const items = anchor.metricIds.map((id) => metrics.get(id)).filter((item): item is ChinaMetric => Boolean(item));
  return (
    <section className={`china-anchor-card is-${anchor.id}`}>
      <header>
        <Icon size={16} />
        <div><small>{anchor.eyebrow}</small><strong>{anchor.title}</strong></div>
        <span className="china-anchor-verdict">{anchorVerdict(anchor.id, items)}</span>
      </header>
      <MacroAnchorVisual anchor={anchor} items={items} />
    </section>
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
  const [selectedProvince, setSelectedProvince] = useState('');
  const [selectedRegion, setSelectedRegion] = useState('');
  const [selectedRegionAdcode, setSelectedRegionAdcode] = useState('');
  const [selectedRegionLevel, setSelectedRegionLevel] = useState<AdministrativeLevel | null>(null);
  const [hoveredProvince, setHoveredProvince] = useState('');
  const [mapMetric, setMapMetric] = useState<MapMetric>('gdp');
  const [provincePanel, setProvincePanel] = useState<ProvincePanel>('economy');
  const [provinceFeed, setProvinceFeed] = useState<ProvinceOfficialFeed | null>(null);
  const [provinceFeedState, setProvinceFeedState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
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
    if (!selectedRegionLevel || !selectedRegion) {
      provinceFeedRequestRef.current = null;
      setProvinceFeed(null);
      setProvinceFeedState('idle');
      return undefined;
    }
    const controller = new AbortController();
    provinceFeedRequestRef.current = controller;
    setProvinceFeedState('loading');
    const params = new URLSearchParams({
      region: selectedRegion,
      level: selectedRegionLevel,
      province: selectedProvince,
      adcode: selectedRegionAdcode,
    });
    void fetch(`/api/china-region-official-feed?${params.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error(`地方政务数据请求失败 (${response.status})`);
      return response.json() as Promise<ProvinceOfficialFeed>;
    }).then((feed) => {
      if (controller.signal.aborted) return;
      setProvinceFeed(feed);
      setProvinceFeedState(feed.sourceStatus === 'live' ? 'ready' : 'unavailable');
    }).catch(() => {
      if (controller.signal.aborted) return;
      setProvinceFeed(null);
      setProvinceFeedState('unavailable');
    }).finally(() => {
      if (provinceFeedRequestRef.current === controller) provinceFeedRequestRef.current = null;
    });
    return () => controller.abort();
  }, [selectedProvince, selectedRegion, selectedRegionAdcode, selectedRegionLevel]);

  const metrics = useMemo(() => new Map((data?.metrics || []).map((item) => [item.id, item])), [data]);
  const mapModel = useMemo(() => {
    if (!geoData) return null;
    const visibleFeatures = geoData.features
      .filter((item) => item.properties?.name)
      .map((item) => normalizeProvinceWinding(item as ProvinceFeature));
    const collection = { ...geoData, features: visibleFeatures } as RegionCollection;
    const projection = geoMercator().fitExtent([[32, 28], [868, 578]], collection);
    const path = geoPath(projection);
    const values = visibleFeatures.map((feature) => {
      if (mapTrail.length <= 1) return provinceValue(CHINA_PROVINCE_ECONOMY[feature.properties?.name || ''], mapMetric);
      const adcode = String(feature.properties?.adcode || '');
      return regionalValue(CHINA_REGIONAL_ECONOMY[adcode], mapMetric);
    }).filter(Boolean);
    return { features: visibleFeatures as ProvinceFeature[], path, maxValue: Math.max(...values, 1) };
  }, [geoData, mapMetric, mapTrail.length]);

  const mapDepth = Math.max(0, mapTrail.length - 1);
  const currentMapLevel = useMemo<AdministrativeLevel | 'mixed'>(() => {
    if (mapDepth === 0) return 'province';
    const levels = new Set((mapModel?.features || []).map((feature) => administrativeLevelForFeature(String(feature.properties?.adcode || ''), mapDepth)));
    return levels.size === 1 ? [...levels][0] : 'mixed';
  }, [mapDepth, mapModel]);
  const activeProvince = selectedRegionLevel === 'province' ? CHINA_PROVINCE_ECONOMY[selectedRegion] : undefined;
  const selectedRegionalProfile = selectedRegionLevel && selectedRegionLevel !== 'province'
    ? CHINA_REGIONAL_ECONOMY[selectedRegionAdcode]
    : undefined;
  const hoveredFeature = mapModel?.features.find((feature) => feature.properties?.name === hoveredProvince);
  const hoveredAdcode = String(hoveredFeature?.properties?.adcode || '');
  const hoveredFeatureLevel = hoveredFeature ? administrativeLevelForFeature(hoveredAdcode, mapDepth) : currentMapLevel;
  const hoveredProvinceProfile = hoveredFeatureLevel === 'province' ? CHINA_PROVINCE_ECONOMY[hoveredProvince] : undefined;
  const hoveredRegionalProfile = hoveredFeatureLevel !== 'province' && hoveredFeatureLevel !== 'mixed' ? CHINA_REGIONAL_ECONOMY[hoveredAdcode] : undefined;
  const provinceRanking = useMemo(() => {
    const rows = Object.values(CHINA_PROVINCE_ECONOMY);
    const gdp = [...rows].sort((left, right) => right.gdpMillionCny - left.gdpMillionCny);
    const perCapita = [...rows].sort((left, right) => right.gdpPerCapitaCny - left.gdpPerCapitaCny);
    return {
      gdp: selectedProvince ? gdp.findIndex((item) => item.name === selectedProvince) + 1 : 0,
      perCapita: selectedProvince ? perCapita.findIndex((item) => item.name === selectedProvince) + 1 : 0,
    };
  }, [selectedProvince]);
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
    const level = administrativeLevelForFeature(adcode, mapDepth);
    setSelectedRegion(name);
    setSelectedRegionAdcode(adcode);
    setSelectedRegionLevel(level);
    if (mapDepth === 0 && CHINA_PROVINCE_ECONOMY[name]) setSelectedProvince(name);
    if (level === 'county' || !/^\d{6}$/.test(adcode)) return;
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
      if (!Array.isArray(nextMap.features) || nextMap.features.length < 1) throw new Error('下一级行政区划暂不可用');
      setGeoData(nextMap);
      setMapTrail((current) => [...current, { label: name, adcode, level, data: nextMap }]);
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
    if (index === 0) {
      setSelectedProvince('');
      setSelectedRegion('');
      setSelectedRegionAdcode('');
      setSelectedRegionLevel(null);
      setProvinceFeed(null);
      setProvinceFeedState('idle');
    } else {
      const level = target.level || (index === 1 ? 'province' : administrativeLevelForFeature(target.adcode || '', index - 1));
      setSelectedRegion(target.label);
      setSelectedRegionAdcode(target.adcode || '');
      setSelectedRegionLevel(level);
      if (level === 'province') setSelectedProvince(target.label);
    }
    setMapView({ scale: 1, x: 0, y: 0 });
    setRegionLoadState('idle');
  };

  const clearRegionSelection = () => {
    setSelectedRegion('');
    setSelectedRegionAdcode('');
    setSelectedRegionLevel(null);
    setProvinceFeed(null);
    setProvinceFeedState('idle');
    setHoveredProvince('');
    setTooltip((current) => ({ ...current, visible: false }));
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
            {ANCHORS.map((anchor) => <MacroAnchorCard key={anchor.id} anchor={anchor} metrics={metrics} />)}
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

        <main className={`china-map-stage${selectedRegion ? ' has-selection' : ''}`}>
          <div className="china-map-title-row">
            <div><span>ADMINISTRATIVE ECONOMIC ATLAS</span><h2>中国区域经济图谱</h2></div>
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
              if ((event.target as Element).closest?.('.china-province')) return;
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
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => { dragRef.current = null; }}
          >
            <div className="china-map-breadcrumb" aria-label="行政区划层级">
              {mapTrail.map((item, index) => (
                <button type="button" key={`${item.label}-${index}`} onClick={() => returnToMapLevel(index)} className={index === mapTrail.length - 1 ? 'is-current' : ''}>
                  {index > 0 ? <ChevronLeft size={11} /> : null}{item.label}
                </button>
              ))}
              <span>{regionLevelLabel(currentMapLevel)}视图</span>
            </div>
            {mapModel ? (
              <svg viewBox="0 0 900 610" role="img" aria-label="中国省级经济地图">
                <defs>
                  <filter id="province-glow"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                </defs>
                <g transform={`translate(${mapView.x} ${mapView.y}) scale(${mapView.scale})`}>
                {mapModel.features.map((feature) => {
                  const name = feature.properties?.name || '';
                  const adcode = String(feature.properties?.adcode || '');
                  const featureLevel = administrativeLevelForFeature(adcode, mapDepth);
                  const item = featureLevel === 'province' ? CHINA_PROVINCE_ECONOMY[name] : undefined;
                  const regionalItem = featureLevel !== 'province' ? CHINA_REGIONAL_ECONOMY[adcode] : undefined;
                  const rawValue = featureLevel === 'province' ? provinceValue(item, mapMetric) : regionalValue(regionalItem, mapMetric);
                  const intensity = rawValue ? Math.sqrt(rawValue / mapModel.maxValue) : 0.18;
                  const hasMapData = rawValue > 0;
                  const active = name === hoveredProvince || (selectedRegionLevel === featureLevel && selectedRegionAdcode === adcode);
                  const centroid = mapModel.path.centroid(feature);
                  const showLabel = mapDepth > 0 || mapView.scale >= 1.7;
                  return (
                    <g key={String(feature.properties?.adcode || name)}>
                    <path
                      d={mapModel.path(feature) || undefined}
                      className={`china-province${active ? ' is-active' : ''}${hasMapData ? '' : ' has-no-data'}`}
                      aria-label={name}
                      style={{
                        '--province-intensity': intensity,
                        fill: provinceFill(intensity, active, hasMapData),
                      } as CSSProperties}
                      tabIndex={0}
                      onMouseDown={(event) => event.preventDefault()}
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
                <small>{hoveredFeatureLevel === 'county' ? '区县级 · 点击查看本级数据' : `${regionLevelLabel(hoveredFeatureLevel)} · 点击进入下一级`}</small>
                <strong>{hoveredProvince || selectedRegion || '行政区域'}</strong>
                <span>{hoveredProvinceProfile
                  ? provinceMetricText(hoveredProvinceProfile, mapMetric)
                  : hoveredRegionalProfile
                    ? regionalMetricText(hoveredRegionalProfile, mapMetric)
                    : `${regionLevelLabel(hoveredFeatureLevel)}行政区 · 暂无本级指标`}</span>
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
          {selectedRegion ? <section className="china-province-inspector">
            <header>
              <MapPinned size={17} />
              <div><small>SELECTED REGION</small><strong>{selectedRegion}</strong></div>
              <span>{selectedRegionLevel === 'province' ? '省级' : selectedRegionLevel === 'city' ? '地市级' : '区县级'} · {selectedRegionAdcode || '行政区划码待核验'}</span>
              <button type="button" className="china-inspector-close" onClick={clearRegionSelection} title="关闭区域详情"><X size={14} /></button>
            </header>
            <div className="china-province-tabs">
              {PROVINCE_PANEL_TABS.map(({ id, label, icon: Icon }) => (
                <button type="button" key={id} onClick={() => setProvincePanel(id)} className={provincePanel === id ? 'is-active' : ''}>
                  <Icon size={14} />{label}
                </button>
              ))}
            </div>
            {activeProvince && selectedRegionLevel === 'province' ? (
              <div className="china-province-panel">
                {provincePanel === 'government' ? <>
                  <div><span>官方门户</span><strong>{activeProvince.governmentUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}</strong><small>链接直接指向该省级人民政府网站</small></div>
                  <div><span>官方政策</span><strong>{provinceFeedState === 'loading' ? '获取中' : `${provinceFeed?.policies.length || 0} 条`}</strong><small>{provinceFeedState === 'ready' ? '已解析官方页面有效链接' : '未成功取得官方条目，不使用占位内容'}</small></div>
                  <div><span>政务新闻</span><strong>{provinceFeedState === 'loading' ? '获取中' : `${provinceFeed?.news.length || 0} 条`}</strong><small>{provinceFeedState === 'ready' ? '已解析官方页面有效链接' : '未成功取得官方条目，不使用占位内容'}</small></div>
                  <a href={activeProvince.governmentUrl} target="_blank" rel="noreferrer">打开官方门户<ArrowUpRight size={12} /></a>
                </> : null}
                {provincePanel === 'economy' ? <>
                  <div><span>地区生产总值</span><strong>{formatNumber(activeProvince.gdpMillionCny / 100, 1)} 亿元</strong><small>{activeProvince.period} 年国家统计局统一核算口径</small></div>
                  <div><span>人均 GDP</span><strong>¥{formatNumber(activeProvince.gdpPerCapitaCny, 0)}</strong><small>31 地区第 {provinceRanking.perCapita} 位</small></div>
                  <div><span>经济总量位次</span><strong>第 {provinceRanking.gdp} 位</strong><small>按 31 个省、自治区、直辖市比较</small></div>
                  <div><span>统计基期</span><strong>{activeProvince.period} 年</strong><small>不跨年份拼接，不使用其他地区数据补位</small></div>
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
            ) : selectedRegionalProfile ? <RegionalEconomyPanel profile={selectedRegionalProfile} panel={provincePanel} /> : <div className="china-region-data-empty">
              <Database size={18} />
              <div><strong>{selectedRegion}暂无同口径结构化数据</strong><span>当前已严格切换到所选{selectedRegionLevel === 'city' ? '城市' : '区县'}，不会继续显示{selectedProvince || '父级'}数据，也不会用模板或其他年份补齐。</span></div>
            </div>}
            <div className="china-local-intel">
              <section>
                <header><Landmark size={13} /><strong>地方政策</strong><span>{provinceFeedState === 'loading' ? '获取中' : provinceFeedState === 'ready' ? `${provinceFeed?.policies.length || 0} 条官方链接` : '暂无官方条目'}</span></header>
                <div className="china-local-intel-list">
                  {(provinceFeed?.policies || []).map((item) => <a key={item.id} href={item.url} target="_blank" rel="noreferrer"><span>{item.title}</span><ArrowUpRight size={11} /></a>)}
                  {provinceFeedState !== 'loading' && !(provinceFeed?.policies.length) ? <p>暂无可核验的官方政策条目</p> : null}
                </div>
              </section>
              <section>
                <header><Database size={13} /><strong>地方新闻</strong><span>{provinceFeedState === 'loading' ? '获取中' : provinceFeedState === 'ready' ? `${provinceFeed?.news.length || 0} 条官方链接` : '暂无官方条目'}</span></header>
                <div className="china-local-intel-list">
                  {(provinceFeed?.news || []).map((item) => <a key={item.id} href={item.url} target="_blank" rel="noreferrer"><span>{item.title}</span><ArrowUpRight size={11} /></a>)}
                  {provinceFeedState !== 'loading' && !(provinceFeed?.news.length) ? <p>暂无可核验的官方新闻条目</p> : null}
                </div>
              </section>
            </div>
            {activeProvince && selectedRegionLevel === 'province' ? <a href={(provincePanel === 'fiscal' ? CHINA_PROVINCE_DATA_SOURCES.fiscal : provincePanel === 'population' ? CHINA_PROVINCE_DATA_SOURCES.population : CHINA_PROVINCE_DATA_SOURCES.economy).url} target="_blank" rel="noreferrer">
              {(provincePanel === 'fiscal' ? CHINA_PROVINCE_DATA_SOURCES.fiscal : provincePanel === 'population' ? CHINA_PROVINCE_DATA_SOURCES.population : CHINA_PROVINCE_DATA_SOURCES.economy).label}<ArrowUpRight size={13} />
            </a> : null}
          </section> : null}
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
              <b>TOP 5</b>
            </div>
            <div className="china-news-list">
              {(data?.news || []).length ? data!.news.slice(0, 5).map((item, index) => (
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
