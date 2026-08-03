import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowUpRight,
  Bitcoin,
  Bot,
  Building2,
  CheckCircle2,
  Database,
  Download,
  FileText,
  Gauge,
  Landmark,
  LoaderCircle,
  Newspaper,
  Radar,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react';
import { ChinaMarketHeatmap, CryptoMarketHeatmap, HongKongMarketHeatmap, UsMarketHeatmap } from '../components/ChinaMarketHeatmap';
import { MarketTemperaturePanel } from '../components/MarketTemperaturePanel';
import { MarketRiskWhitepaperLauncher } from '../components/MarketRiskWhitepaper';
import { PageTransition } from '../components/PageTransition';
import { buildAiPayload, loadIntegrationSettings, type NewsItem } from '../lib/integrations';
import { getMarketSessionStatus, type MarketSessionTone } from '../lib/marketSessions';

type MarketChartMode = 'china' | 'hongkong' | 'us' | 'crypto';

type UsMarketSystemStatus = {
  state: 'normal' | 'halted' | 'unknown';
  message: string;
  updatedAt: string;
  sourceUrl: string;
};

type MarketIndexSnapshot = {
  id: string;
  code: string;
  name: string;
  region: 'CN' | 'HK' | 'US' | 'CRYPTO';
  market: MarketChartMode;
  proxyFor?: string;
  price: number;
  change: number;
  changePercent: number;
  turnover?: number;
  advancers?: number;
  decliners?: number;
  flat?: number;
  updatedAt?: string;
  sourceUrl: string;
  validation: {
    status: 'verified' | 'review' | 'single-source';
    source: string;
    price?: number;
    deviationPercent?: number;
  };
};

type SectorPulse = {
  code: string;
  name: string;
  changePercent: number;
  mainNetInflow: number;
  mainNetRatio: number;
};

type RotationMetric = 'fund-flow' | 'market-cap' | 'turnover';

type MarketRotationItem = {
  code: string;
  name: string;
  changePercent: number;
  scaleValue: number;
  advanceRatio: number;
  memberCount: number;
};

type MarketRotation = {
  generatedAt: string;
  source: string;
  sourceUrl: string;
  metric: RotationMetric;
  currency: 'CNY' | 'HKD' | 'USD' | 'USDT';
  coverage: string;
  leaders: MarketRotationItem[];
  laggards: MarketRotationItem[];
};

type RegionalHeatmapResponse = {
  generatedAt: string;
  count: number;
  coverage: string;
  source: string;
  sourceUrl: string;
  stocks: Array<{
    code: string;
    name: string;
    changePercent: number;
    marketCap: number;
    industry: string;
  }>;
};

type ResearchReport = {
  id: string;
  title: string;
  stockCode: string;
  stockName: string;
  institution: string;
  analysts: string;
  publishedAt?: string;
  rating: string;
  industry: string;
  epsThisYear?: number;
  epsNextYear?: number;
  url: string;
};

type RegionalMarketContent = {
  market: 'hongkong' | 'us';
  generatedAt: string;
  news: NewsItem[];
  reports: ResearchReport[];
  sources: Array<{ label: string; url: string }>;
  note: string;
};

type InstitutionRating = {
  market: 'hongkong' | 'us';
  symbol: string;
  companyName: string;
  price: number;
  consensus: string;
  summary: string;
  analystCount: number;
  targetPrice: { low?: number; average?: number; high?: number };
  distribution: { buy: number; hold: number; sell: number };
  brokers: string[];
  reports: Array<{
    id: string;
    title: string;
    institution: string;
    publishedAt?: string;
    rating: string;
    url: string;
  }>;
  sourceLabel: string;
  sourceUrl: string;
  updatedAt: string;
  note: string;
};

type ScoreDimension = {
  id: string;
  label: string;
  score: number;
  weight: number;
  summary: string;
  evidence: string[];
};

type MarketIntelligence = {
  generatedAt: string;
  dataMode: 'live' | 'partial' | 'limited';
  confidence: number;
  confidenceLabel: string;
  warning: string;
  errors: string[];
  summary: {
    score: number;
    scoreLabel: string;
    stance: string;
    riskLevel: string;
    headline: string;
    disclaimer: string;
  };
  indices: MarketIndexSnapshot[];
  breadth: {
    advancers: number;
    decliners: number;
    flat: number;
    advanceRatio: number;
  };
  sectors: {
    total: number;
    sampleSize: number;
    positiveRatio: number;
    flowBalance: number;
    leaders: SectorPulse[];
    laggards: SectorPulse[];
  };
  reports: ResearchReport[];
  news: NewsItem[];
  scores: ScoreDimension[];
  sources: Array<{
    id: string;
    label: string;
    url: string;
    secondaryUrl?: string;
    provider: string;
    ok: boolean;
    note: string;
  }>;
};

type ValuationAnchorSnapshot = {
  id: string;
  name: string;
  current: {
    pb: number;
    fairPb: number;
    pbPercentile: number;
    premiumPercent: number;
    status: string;
    updatedAt: string;
  };
};

type AShareValuationSnapshot = {
  overall: {
    temperature: number;
    temperatureDelta: number;
    zoneLabel: string;
    currentPe: number;
    updatedAt: string;
  };
  bookValueAnchor?: ValuationAnchorSnapshot;
  bookValueAnchors?: ValuationAnchorSnapshot[];
};

type ToolStep = {
  id: string;
  tool: string;
  status: 'running' | 'ok' | 'error';
  elapsedMs?: number;
};

type ResearchState = {
  sessionId: string;
  attemptId: string;
  targetLabel: string;
  running: boolean;
  connecting: boolean;
  report: string;
  liveText: string;
  tools: ToolStep[];
  error: string;
  lastEventId: string;
  updatedAt: string;
};

type ResearchMap = Record<MarketChartMode, ResearchState>;
type AsyncState = 'idle' | 'loading' | 'success' | 'error';

const EMPTY_RESEARCH: ResearchState = {
  sessionId: '',
  attemptId: '',
  targetLabel: '',
  running: false,
  connecting: false,
  report: '',
  liveText: '',
  tools: [],
  error: '',
  lastEventId: '',
  updatedAt: '',
};

type ResearchTarget = {
  kind: 'market' | 'index' | 'sector';
  name: string;
  code?: string;
  description?: string;
};

const A_SHARE_INDEX_TARGETS = [
  { name: '中证全指', code: '000985', description: '覆盖沪深北市场主要A股，用作全市场长期估值锚。' },
  { name: '沪深300', code: '000300', description: '沪深市场大盘核心资产代表。' },
  { name: '中证500', code: '000905', description: '剔除沪深300后具有代表性的中小市值公司。' },
  { name: '中证A500', code: '000510', description: '强调行业代表性并覆盖各行业核心公司。' },
  { name: '创业板综', code: '399102', description: '覆盖创业板市场的综合指数。' },
  { name: '科创50', code: '000688', description: '科创板中市值大、流动性好的50只代表性证券。' },
] as const;

const HONG_KONG_INDEX_TARGETS = [
  { name: '恒生指数', code: 'HSI', description: '香港市场最具代表性的大盘蓝筹指数。' },
  { name: '恒生科技指数', code: 'HSTECH', description: '覆盖香港上市、与科技主题高度相关的龙头公司。' },
  { name: '恒生中国企业指数', code: 'HSCEI', description: '衡量香港上市中国内地企业的核心表现。' },
  { name: '恒生综合指数', code: 'HSCI', description: '覆盖香港主板大部分市值，用作港股全市场宽基参考。' },
] as const;

const US_INDEX_TARGETS = [
  { name: '标普500', code: 'SPX', description: '覆盖美国大型上市公司的核心宽基指数。' },
  { name: '纳斯达克100', code: 'NDX', description: '以大型非金融成长与科技公司为主的宽基指数。' },
  { name: '道琼斯工业指数', code: 'DJIA', description: '由美国大型蓝筹公司构成的价格加权指数。' },
  { name: '费城半导体指数', code: 'SOX', description: '覆盖全球主要半导体设计、制造与设备公司。' },
] as const;

const INDEX_RESEARCH_TARGETS: Record<MarketChartMode, readonly { name: string; code: string; description: string }[]> = {
  china: A_SHARE_INDEX_TARGETS,
  hongkong: HONG_KONG_INDEX_TARGETS,
  us: US_INDEX_TARGETS,
  crypto: [],
};

const MARKET_META: Record<MarketChartMode, { label: string; short: string; chart: string; description: string }> = {
  china: {
    label: 'A股',
    short: 'A股市场',
    chart: 'A 股大盘热力图',
    description: 'A 股全市场 · 重点板块增强 · 市值加权 · 当日涨跌',
  },
  hongkong: {
    label: '港股',
    short: '港股市场',
    chart: '港股大盘热力图',
    description: '港股主板 · 行业分组 · 市值加权 · 当日涨跌',
  },
  us: {
    label: '美股',
    short: '美股市场',
    chart: '美股大盘热力图',
    description: '纳斯达克与纽交所主要公司 · 行业分组 · 市值面积 · 当日涨跌',
  },
  crypto: {
    label: '加密',
    short: '加密市场',
    chart: '加密货币热力图',
    description: '主流加密资产 · 市值面积 · 24 小时涨跌 · 全天候市场',
  },
};

const researchStorageKey = (mode: MarketChartMode) => `sparkflow.market.research.v2.${mode}`;

function readStoredResearch(mode: MarketChartMode): ResearchState {
  try {
    const raw = window.localStorage.getItem(researchStorageKey(mode));
    if (!raw) return { ...EMPTY_RESEARCH };
    const parsed = JSON.parse(raw) as Partial<ResearchState>;
    return {
      ...EMPTY_RESEARCH,
      ...parsed,
      tools: Array.isArray(parsed.tools) ? parsed.tools : [],
    };
  } catch {
    return { ...EMPTY_RESEARCH };
  }
}

function requestJson<T>(url: string, init?: RequestInit) {
  return fetch(url, init).then(async (response) => {
    const payload = (await response.json().catch(() => ({}))) as T & { detail?: string; error?: string };
    if (!response.ok) throw new Error(payload.detail || payload.error || `请求失败：HTTP ${response.status}`);
    return payload;
  });
}

function parseEvent(event: Event) {
  try {
    return JSON.parse((event as MessageEvent<string>).data || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function Market() {
  const navigate = useNavigate();
  const [activeMarket, setActiveMarket] = useState<MarketChartMode>('china');
  const [data, setData] = useState<MarketIntelligence | null>(null);
  const [valuationSnapshots, setValuationSnapshots] = useState<Partial<Record<'china' | 'hongkong' | 'us', AShareValuationSnapshot>>>({});
  const [loadState, setLoadState] = useState<AsyncState>('loading');
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [regionalRotations, setRegionalRotations] = useState<Partial<Record<MarketChartMode, MarketRotation>>>({});
  const [regionalContent, setRegionalContent] = useState<Partial<Record<'hongkong' | 'us', RegionalMarketContent>>>({});
  const [regionalContentState, setRegionalContentState] = useState<AsyncState>('idle');
  const [regionalContentError, setRegionalContentError] = useState('');
  const [rotationLoadState, setRotationLoadState] = useState<AsyncState>('idle');
  const [rotationError, setRotationError] = useState('');
  const [rotationReloadKey, setRotationReloadKey] = useState(0);
  const [usMarketSystem, setUsMarketSystem] = useState<UsMarketSystemStatus>({
    state: 'unknown',
    message: '正在读取 Nasdaq 系统状态',
    updatedAt: '',
    sourceUrl: 'https://www.nasdaqtrader.com/Trader.aspx?id=MarketSystemStatusToday',
  });
  const [research, setResearch] = useState<ResearchMap>(() => ({
    china: readStoredResearch('china'),
    hongkong: readStoredResearch('hongkong'),
    us: readStoredResearch('us'),
    crypto: readStoredResearch('crypto'),
  }));
  const researchRef = useRef(research);
  const eventSourcesRef = useRef(new Map<MarketChartMode, EventSource>());
  const pollingRef = useRef(new Map<MarketChartMode, number>());
  const quoteRequestRef = useRef(false);
  const reportRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    researchRef.current = research;
  }, [research]);

  const updateResearch = useCallback(
    (mode: MarketChartMode, updater: (current: ResearchState) => ResearchState) => {
      const next = updater(researchRef.current[mode]);
      const nextMap = { ...researchRef.current, [mode]: next };
      researchRef.current = nextMap;
      setResearch(nextMap);
      window.localStorage.setItem(researchStorageKey(mode), JSON.stringify({ ...next, liveText: next.liveText.slice(-5000), tools: next.tools.slice(-80) }));
      return next;
    },
    [],
  );

  const loadMarket = useCallback(async () => {
    setLoadState('loading');
    setError('');
    try {
      const payload = await requestJson<MarketIntelligence>('/api/market-intelligence');
      setData(payload);
      setLoadState('success');
    } catch (requestError) {
      setLoadState('error');
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  }, []);

  useEffect(() => {
    void loadMarket();
  }, [loadMarket]);

  useEffect(() => {
    if (activeMarket === 'crypto') return;
    let cancelled = false;
    requestJson<AShareValuationSnapshot>(`/api/valuation-temperature?market=${activeMarket}`)
      .then((payload) => {
        if (!cancelled) setValuationSnapshots((current) => ({ ...current, [activeMarket]: payload }));
      })
      .catch(() => {
        if (!cancelled) setValuationSnapshots((current) => {
          const next = { ...current };
          delete next[activeMarket];
          return next;
        });
      });
    return () => {
      cancelled = true;
    };
  }, [activeMarket]);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    const refreshQuotes = async () => {
      if (quoteRequestRef.current || document.visibilityState !== 'visible') return;
      quoteRequestRef.current = true;
      try {
        const payload = await requestJson<{ indices: MarketIndexSnapshot[] }>('/api/market-quotes');
        if (!cancelled && payload.indices.length) {
          setData((current) => (current ? { ...current, generatedAt: new Date().toISOString(), indices: payload.indices } : current));
        }
      } catch {
        // The 45-second intelligence snapshot remains available when a live quote poll misses.
      } finally {
        quoteRequestRef.current = false;
      }
    };
    const timer = window.setInterval(() => void refreshQuotes(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [Boolean(data)]);

  useEffect(() => {
    if (activeMarket !== 'us') return;
    let cancelled = false;
    const refreshSystemStatus = async () => {
      try {
        const payload = await requestJson<UsMarketSystemStatus>('/api/us-market-system-status');
        if (!cancelled) setUsMarketSystem(payload);
      } catch {
        if (!cancelled) {
          setUsMarketSystem((current) => ({
            ...current,
            state: 'unknown',
            message: 'Nasdaq 系统状态暂时不可用',
          }));
        }
      }
    };
    void refreshSystemStatus();
    const timer = window.setInterval(() => void refreshSystemStatus(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeMarket]);

  useEffect(() => {
    if (activeMarket !== 'hongkong' && activeMarket !== 'us') return;
    let cancelled = false;
    setRegionalContentState('loading');
    setRegionalContentError('');
    requestJson<RegionalMarketContent>(`/api/regional-market-content?market=${activeMarket}`)
      .then((payload) => {
        if (cancelled) return;
        setRegionalContent((current) => ({ ...current, [activeMarket]: payload }));
        setRegionalContentState('success');
      })
      .catch((requestError) => {
        if (cancelled) return;
        setRegionalContentState('error');
        setRegionalContentError(requestError instanceof Error ? requestError.message : String(requestError));
      });
    return () => {
      cancelled = true;
    };
  }, [activeMarket]);

  const stopPolling = useCallback((mode: MarketChartMode) => {
    const timer = pollingRef.current.get(mode);
    if (timer) window.clearInterval(timer);
    pollingRef.current.delete(mode);
  }, []);

  const finishResearch = useCallback(
    (mode: MarketChartMode, report: string) => {
      eventSourcesRef.current.get(mode)?.close();
      eventSourcesRef.current.delete(mode);
      stopPolling(mode);
      updateResearch(mode, (current) => ({
        ...current,
        running: false,
        connecting: false,
        report: report || current.liveText,
        liveText: '',
        tools: current.tools.map((tool) => (tool.status === 'running' ? { ...tool, status: 'ok' } : tool)),
        error: '',
        updatedAt: new Date().toISOString(),
      }));
    },
    [stopPolling, updateResearch],
  );

  const pollResearchResult = useCallback(
    (mode: MarketChartMode, sessionId: string, attemptId: string) => {
      stopPolling(mode);
      let checks = 0;
      const timer = window.setInterval(async () => {
        checks += 1;
        if (checks > 240 || !researchRef.current[mode].running) {
          stopPolling(mode);
          return;
        }
        try {
          const messages = await requestJson<Array<{ role: string; content: string; linked_attempt_id?: string }>>(
            `/api/vibe/research/messages?sessionId=${encodeURIComponent(sessionId)}`,
          );
          const answer = [...messages].reverse().find(
            (message) => message.role === 'assistant' && (!attemptId || message.linked_attempt_id === attemptId),
          );
          if (answer?.content) finishResearch(mode, answer.content);
        } catch {
          // SSE is primary. Polling only repairs a missed completion event after navigation.
        }
      }, 1800);
      pollingRef.current.set(mode, timer);
    },
    [finishResearch, stopPolling],
  );

  const connectResearchStream = useCallback(
    (mode: MarketChartMode, sessionId: string) =>
      new Promise<void>((resolve, reject) => {
        eventSourcesRef.current.get(mode)?.close();
        const state = researchRef.current[mode];
        const source = new EventSource(
          `/api/vibe/research/events?sessionId=${encodeURIComponent(sessionId)}${state.lastEventId ? `&lastEventId=${encodeURIComponent(state.lastEventId)}` : ''}`,
        );
        eventSourcesRef.current.set(mode, source);
        let opened = false;
        const timeout = window.setTimeout(() => {
          if (!opened) {
            source.close();
            reject(new Error('Vibe-Trading 研究事件流连接超时'));
          }
        }, 10000);

        const withEventId = (event: Event, updater: (current: ResearchState, payload: Record<string, unknown>) => ResearchState) => {
          const payload = parseEvent(event);
          const eventId = (event as MessageEvent<string>).lastEventId || '';
          updateResearch(mode, (current) => ({
            ...updater(current, payload),
            lastEventId: eventId || current.lastEventId,
          }));
          return payload;
        };

        source.onopen = () => {
          opened = true;
          window.clearTimeout(timeout);
          resolve();
        };
        source.onerror = () => {
          if (!opened) {
            window.clearTimeout(timeout);
            source.close();
            reject(new Error('无法连接 Vibe-Trading 研究事件流'));
          }
        };
        source.addEventListener('attempt.created', (event) => {
          withEventId(event, (current, payload) => ({
            ...current,
            attemptId: String(payload.attempt_id || current.attemptId),
            connecting: false,
            running: true,
          }));
        });
        source.addEventListener('attempt.started', (event) => {
          withEventId(event, (current, payload) => ({
            ...current,
            attemptId: String(payload.attempt_id || current.attemptId),
            connecting: false,
            running: true,
          }));
        });
        source.addEventListener('text_delta', (event) => {
          withEventId(event, (current, payload) => ({
            ...current,
            liveText: current.liveText + String(payload.delta || ''),
          }));
        });
        source.addEventListener('stream_reset', (event) => {
          withEventId(event, (current) => ({ ...current, liveText: '' }));
        });
        source.addEventListener('tool_call', (event) => {
          withEventId(event, (current, payload) => {
            const tool = String(payload.tool || 'research_tool');
            return {
              ...current,
              tools: [...current.tools, { id: `${tool}-${Date.now()}-${current.tools.length}`, tool, status: 'running' }],
            };
          });
        });
        source.addEventListener('tool_result', (event) => {
          withEventId(event, (current, payload) => {
            const tool = String(payload.tool || 'research_tool');
            let matched = false;
            const tools = [...current.tools].reverse().map((item) => {
              if (!matched && item.tool === tool && item.status === 'running') {
                matched = true;
                return { ...item, status: payload.status === 'ok' ? 'ok' as const : 'error' as const, elapsedMs: Number(payload.elapsed_ms || 0) };
              }
              return item;
            }).reverse();
            return { ...current, tools };
          });
        });
        source.addEventListener('attempt.completed', (event) => {
          const payload = withEventId(event, (current) => ({ ...current, running: false, connecting: false }));
          finishResearch(mode, String(payload.summary || researchRef.current[mode].liveText));
        });
        source.addEventListener('attempt.failed', (event) => {
          const payload = withEventId(event, (current) => ({
            ...current,
            running: false,
            connecting: false,
            error: String(parseEvent(event).error || '研究任务执行失败'),
          }));
          source.close();
          eventSourcesRef.current.delete(mode);
          stopPolling(mode);
          if (payload.error) setActionMessage(String(payload.error));
        });
      }),
    [finishResearch, stopPolling, updateResearch],
  );

  useEffect(() => {
    (Object.keys(MARKET_META) as MarketChartMode[]).forEach((mode) => {
      const state = researchRef.current[mode];
      if (!state.running || !state.sessionId) return;
      void connectResearchStream(mode, state.sessionId)
        .then(() => pollResearchResult(mode, state.sessionId, state.attemptId))
        .catch(() => pollResearchResult(mode, state.sessionId, state.attemptId));
    });
    return () => {
      eventSourcesRef.current.forEach((source) => source.close());
      eventSourcesRef.current.clear();
      pollingRef.current.forEach((timer) => window.clearInterval(timer));
      pollingRef.current.clear();
    };
  }, [connectResearchStream, pollResearchResult]);

  const activeIndices = useMemo(
    () => (data?.indices || []).filter((item) => item.market === activeMarket),
    [activeMarket, data?.indices],
  );
  const activeRotation = useMemo(() => {
    if (!data) return undefined;
    if (activeMarket === 'china') return buildChinaRotation(data);
    if (activeMarket === 'crypto') return buildCryptoRotation(activeIndices);
    return regionalRotations[activeMarket];
  }, [activeIndices, activeMarket, data, regionalRotations]);
  const activeResearch = research[activeMarket];
  const activeValuation = activeMarket === 'crypto' ? null : valuationSnapshots[activeMarket] || null;
  const activeRegionalContent = activeMarket === 'hongkong' || activeMarket === 'us'
    ? regionalContent[activeMarket]
    : undefined;
  const activeNews = activeRegionalContent?.news || data?.news || [];
  const activeReports = activeRegionalContent?.reports || data?.reports || [];
  const activeSources = activeRegionalContent
    ? [
        ...(data?.sources.filter((source) => source.id === 'indices') || []),
        ...activeRegionalContent.sources.map((source, index) => ({
          id: `regional-content-${index}`,
          label: source.label,
          url: source.url,
          provider: activeMarket === 'hongkong' ? '港股公开数据与中文索引' : '美股公开数据与中文索引',
          ok: activeRegionalContent.news.length > 0 || activeRegionalContent.reports.length > 0,
          note: `${activeRegionalContent.news.length} 条新闻 · ${activeRegionalContent.reports.length} 份公开研究`,
        })),
      ]
    : data?.sources || [];

  useEffect(() => {
    if (activeMarket === 'china' || activeMarket === 'crypto') {
      setRotationLoadState('success');
      setRotationError('');
      return;
    }

    const controller = new AbortController();
    const endpoint = activeMarket === 'hongkong'
      ? '/api/hong-kong-market-heatmap'
      : '/api/us-market-heatmap';
    const currency = activeMarket === 'hongkong' ? 'HKD' : 'USD';

    setRotationLoadState('loading');
    setRotationError('');
    requestJson<RegionalHeatmapResponse>(endpoint, { signal: controller.signal })
      .then((payload) => {
        const rotation = buildRegionalRotation(payload, currency);
        setRegionalRotations((current) => ({ ...current, [activeMarket]: rotation }));
        setRotationLoadState('success');
      })
      .catch((requestError) => {
        if (controller.signal.aborted) return;
        setRotationLoadState('error');
        setRotationError(requestError instanceof Error ? requestError.message : String(requestError));
      });

    return () => controller.abort();
  }, [activeMarket, rotationReloadKey]);

  const runVibeResearch = async (target: ResearchTarget) => {
    if (!data || activeResearch.running || activeResearch.connecting) return;
    const settings = loadIntegrationSettings();
    if (Boolean(settings.ai.apiKey.trim()) !== Boolean(settings.ai.model.trim())) {
      setActionMessage('请从右上角头像进入“设置”，同时填写 AI API Key 和模型名称。');
      return;
    }
    const prompt = buildDeepResearchPrompt(activeMarket, target);
    setActionMessage('');
    updateResearch(activeMarket, () => ({
      ...EMPTY_RESEARCH,
      targetLabel: target.kind === 'market' ? `${MARKET_META[activeMarket].short}整体` : target.name,
      connecting: true,
      running: true,
      updatedAt: new Date().toISOString(),
    }));
    try {
      const prepared = await requestJson<{ sessionId: string }>('/api/vibe/research/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildAiPayload(settings, prompt)),
      });
      updateResearch(activeMarket, (current) => ({ ...current, sessionId: prepared.sessionId }));
      await connectResearchStream(activeMarket, prepared.sessionId);
      const sent = await requestJson<{ attempt_id: string }>('/api/vibe/research/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: prepared.sessionId, prompt }),
      });
      updateResearch(activeMarket, (current) => ({
        ...current,
        attemptId: sent.attempt_id,
        connecting: false,
        running: true,
      }));
      pollResearchResult(activeMarket, prepared.sessionId, sent.attempt_id);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : String(requestError);
      updateResearch(activeMarket, (current) => ({ ...current, connecting: false, running: false, error: message }));
      setActionMessage(message);
    }
  };

  const saveToObsidian = async () => {
    if (!data) return;
    const settings = loadIntegrationSettings();
    if (!settings.obsidian.vaultPath) {
      setActionMessage('请先在右上角头像 → 设置中填写 Obsidian 仓库路径。');
      return;
    }
    setActionMessage('正在写入 Obsidian…');
    try {
      const payload = await requestJson<{ relativePath: string }>('/api/obsidian-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vaultPath: settings.obsidian.vaultPath,
          folder: settings.obsidian.folder,
          title: `${MARKET_META[activeMarket].short} 估值与逆向信号日报`,
          markdown: buildMarketMarkdown(data, activeMarket, activeResearch.report, activeRotation, activeValuation),
        }),
      });
      setActionMessage(`已写入 Obsidian：${payload.relativePath}`);
    } catch (requestError) {
      setActionMessage(requestError instanceof Error ? requestError.message : String(requestError));
    }
  };

  const exportPdf = async () => {
    if (!data || !reportRef.current) return;
    setActionMessage('正在排版 PDF 报告…');
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
      const reportElement = reportRef.current;
      await document.fonts.ready;
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      const pageElements = Array.from(reportElement.querySelectorAll<HTMLElement>('[data-pdf-page]'));
      const exportPages = pageElements.length ? pageElements : [reportElement];
      const pageCanvases = await Promise.all(exportPages.map((pageElement) => html2canvas(pageElement, {
        scale: 2.6,
        backgroundColor: '#f3f0e7',
        useCORS: true,
        logging: false,
      })));
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const runningHeaderHeight = 17;
      const runningFooterHeight = 13;

      const exportDate = new Date().toISOString().slice(0, 10);
      pageCanvases.forEach((pageCanvas, pageIndex) => {
        if (pageIndex > 0) pdf.addPage();
        pdf.setFillColor(245, 246, 243);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');

        if (pageIndex > 0) {
          pdf.setFillColor(8, 29, 50);
          pdf.rect(0, 0, pageWidth, 15.4, 'F');
          pdf.setFillColor(195, 164, 87);
          pdf.rect(0, 15.4, pageWidth, 0.8, 'F');
          pdf.setTextColor(216, 189, 121);
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(7.4);
          pdf.text('SPARKFLOW INVESTMENT RESEARCH', 12, 6.3);
          pdf.setTextColor(255, 255, 255);
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(5.6);
          pdf.text('VALUATION & CONTRARIAN SIGNALS', 12, 10.8);
          pdf.setTextColor(255, 255, 255);
          pdf.setFontSize(5.2);
          pdf.text('MARKET INTELLIGENCE', pageWidth - 12, 6.3, { align: 'right' });
          pdf.setTextColor(216, 189, 121);
          pdf.text(`CONTINUED · ${String(pageIndex + 1).padStart(2, '0')}`, pageWidth - 12, 10.8, { align: 'right' });
        }

        const contentTop = pageIndex === 0 ? 0 : runningHeaderHeight;
        const availableContentHeight = pageHeight - contentTop - runningFooterHeight;
        const naturalSliceHeight = pageCanvas.height * pageWidth / pageCanvas.width;
        const contentScale = Math.min(1, availableContentHeight / naturalSliceHeight);
        const sliceWidth = pageWidth * contentScale;
        const sliceHeight = naturalSliceHeight * contentScale;
        const sliceLeft = (pageWidth - sliceWidth) / 2;
        pdf.addImage(pageCanvas.toDataURL('image/png'), 'PNG', sliceLeft, contentTop, sliceWidth, sliceHeight);

        const footerTop = pageHeight - runningFooterHeight;
        pdf.setFillColor(245, 246, 243);
        pdf.rect(0, footerTop, pageWidth, runningFooterHeight, 'F');
        pdf.setDrawColor(16, 38, 59);
        pdf.setLineWidth(0.2);
        pdf.line(12, footerTop + 2, pageWidth - 12, footerTop + 2);
        pdf.setFillColor(178, 142, 62);
        pdf.rect(12, footerTop + 5, 1.2, 1.2, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(5.2);
        pdf.setTextColor(16, 38, 59);
        pdf.text('SPARKFLOW INVESTMENT RESEARCH', 15.2, pageHeight - 6.2);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(95, 106, 115);
        pdf.text('RESEARCH REFERENCE ONLY', pageWidth / 2, pageHeight - 6.2, { align: 'center' });
        pdf.text(`${exportDate}  |  ${String(pageIndex + 1).padStart(2, '0')} / ${String(pageCanvases.length).padStart(2, '0')}`, pageWidth - 12, pageHeight - 6.2, { align: 'right' });
      });
      const marketSlug: Record<MarketChartMode, string> = {
        china: 'China-A',
        hongkong: 'Hong-Kong',
        us: 'US',
        crypto: 'Crypto',
      };
      pdf.save(`SparkFlow-${marketSlug[activeMarket]}-Market-${exportDate}.pdf`);
      setActionMessage('PDF 报告已导出。');
    } catch (requestError) {
      setActionMessage(requestError instanceof Error ? requestError.message : 'PDF 导出失败');
    }
  };

  const latestAt = data ? formatDateTime(data.generatedAt, true) : '--';

  return (
    <PageTransition>
      <section className="min-h-screen bg-[#030405] px-3 pb-16 pt-[calc(var(--nav-height)+20px)] text-white sm:px-5 lg:px-7">
        <div className="mx-auto w-full max-w-[1540px]">
          <header className="mb-5 flex flex-col gap-5 border-b border-white/10 pb-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#69d5ff]">
                <Radar size={14} />
                Market Intelligence Command
              </div>
              <h1 className="mt-3 text-3xl font-semibold leading-none sm:text-4xl">市场情报与策略研究台</h1>
              <p className="mt-3 text-sm text-white/46">实时指数、资金风向、中文新闻、券商研报与 Vibe-Trading 深度研究</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill data={data} loadState={loadState} latestAt={latestAt} />
              <IconButton label="刷新完整情报" onClick={() => void loadMarket()} disabled={loadState === 'loading'}>
                <RefreshCw size={16} className={loadState === 'loading' ? 'animate-spin' : ''} />
              </IconButton>
              <IconButton label="写入 Obsidian" onClick={() => void saveToObsidian()} disabled={!data}>
                <Save size={16} />
              </IconButton>
              <button
                type="button"
                onClick={() => void exportPdf()}
                disabled={!data}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-[#c5a761]/35 bg-[#c5a761]/8 px-3 text-xs font-semibold text-[#ead9a6] transition hover:bg-[#c5a761]/15 disabled:opacity-35"
              >
                <Download size={14} /> 导出策略 PDF
              </button>
            </div>
          </header>

          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-stretch lg:justify-between">
            <div className="flex w-full border border-white/10 bg-white/[0.035] p-1 lg:max-w-[620px]">
              {(Object.keys(MARKET_META) as MarketChartMode[]).map((mode) => (
                <button
                  type="button"
                  key={mode}
                  onClick={() => setActiveMarket(mode)}
                  className={`flex min-h-11 flex-1 items-center justify-center gap-2 px-4 text-sm font-semibold transition ${
                    activeMarket === mode ? 'bg-white text-black' : 'text-white/52 hover:text-white'
                  }`}
                >
                  {mode === 'china'
                    ? <Landmark size={15} />
                    : mode === 'hongkong'
                      ? <Building2 size={15} />
                      : mode === 'crypto'
                        ? <Bitcoin size={15} />
                        : <Activity size={15} />}
                  {MARKET_META[mode].label}
                </button>
              ))}
            </div>
            <MarketSessionIndicator
              mode={activeMarket}
              usSystemState={usMarketSystem.state}
              usSystemMessage={usMarketSystem.message}
            />
          </div>

          {error ? <ErrorPanel message={error} onRetry={() => void loadMarket()} /> : null}
          {actionMessage ? (
            <div className="mb-4 flex items-start gap-2 border border-[#d6b566]/25 bg-[#d6b566]/8 px-4 py-3 text-sm text-[#ead9a6]">
              <TriangleAlert className="mt-0.5 shrink-0" size={15} />
              <span>{actionMessage}</span>
            </div>
          ) : null}

          {data ? (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.42 }}>
              <IndexStrip indices={activeIndices} />

              <div className="mt-4 grid min-h-[650px] gap-4 xl:grid-cols-[minmax(0,1fr)_410px]">
                <section className="flex min-h-[560px] flex-col overflow-hidden border border-white/10 bg-[#050608]">
                  <div className="flex min-h-[68px] shrink-0 flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3 sm:flex-nowrap sm:px-5">
                    <div className="shrink-0">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <Activity size={16} className="text-[#69d5ff]" />
                        {MARKET_META[activeMarket].chart} · {activeMarket === 'crypto' ? 'CoinGecko + Binance' : '东方财富实时数据'}
                      </div>
                      <p className="mt-1 text-xs text-white/38">{MARKET_META[activeMarket].description}</p>
                    </div>
                    <div
                      id={
                        activeMarket === 'china'
                          ? 'china-market-search-slot'
                          : activeMarket === 'hongkong'
                            ? 'hong-kong-market-search-slot'
                            : activeMarket === 'us'
                              ? 'us-market-search-slot'
                              : 'crypto-market-search-slot'
                      }
                      className="order-3 w-full sm:order-none sm:mx-3 sm:min-w-[220px] sm:max-w-xl sm:flex-1"
                    />
                    <a
                      href={
                        activeMarket === 'china'
                          ? 'https://quote.eastmoney.com/center/gridlist.html#hs_a_board'
                          : activeMarket === 'hongkong'
                            ? 'https://quote.eastmoney.com/center/hkstock.html'
                          : activeMarket === 'crypto'
                            ? 'https://www.coingecko.com/zh'
                            : 'https://quote.eastmoney.com/center/mgsc.html'
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-9 w-9 items-center justify-center text-white/50 transition hover:text-white"
                      aria-label={
                        activeMarket !== 'crypto' ? '在东方财富打开' : '在 CoinGecko 打开'
                      }
                      title={
                        activeMarket !== 'crypto' ? '在东方财富打开' : '在 CoinGecko 打开'
                      }
                    >
                      <ArrowUpRight size={17} />
                    </a>
                  </div>
                  <div className="min-h-[500px] flex-1">
                    {activeMarket === 'china' ? (
                      <ChinaMarketHeatmap />
                    ) : activeMarket === 'hongkong' ? (
                      <HongKongMarketHeatmap />
                    ) : activeMarket === 'us' ? (
                      <UsMarketHeatmap />
                    ) : (
                      <CryptoMarketHeatmap />
                    )}
                  </div>
                </section>

                <VibeResearchPanel
                  mode={activeMarket}
                  data={data}
                  state={activeResearch}
                  onRun={(target) => void runVibeResearch(target)}
                  onOpenAssistant={(sessionId) => navigate('/assistant', { state: { sessionId } })}
                />
              </div>

              {data.warning ? (
                <div className="mt-4 flex items-start gap-2 border border-[#d6b566]/20 bg-[#d6b566]/7 px-4 py-3 text-xs leading-5 text-[#ead9a6]/80">
                  <TriangleAlert className="mt-0.5 shrink-0" size={14} />
                  <span>{data.warning} {data.errors.join('；')}</span>
                </div>
              ) : null}

              <div className="mt-8 border-t border-white/10 pt-7">
                <SectionHeading
                  eyebrow="Capital Rotation"
                  title={getRotationTitle(activeMarket)}
                  icon={<Gauge size={15} />}
                />
                <div className="-mt-2 mb-4 flex flex-wrap items-center justify-between gap-3 text-xs leading-5 text-white/36">
                  <p>{activeRotation?.coverage || getRotationLoadingText(activeMarket)}</p>
                  {activeRotation ? (
                    <a
                      href={activeRotation.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-white/46 transition hover:text-white"
                    >
                      {activeRotation.source} · {formatDateTime(activeRotation.generatedAt, true)}
                    </a>
                  ) : null}
                </div>
                {activeRotation ? (
                  <div className="grid gap-4 xl:grid-cols-2">
                    <SectorBoard
                      title={activeMarket === 'china' ? '资金流入前列' : activeMarket === 'crypto' ? '领涨赛道' : '领涨板块'}
                      items={activeRotation.leaders}
                      mode="leader"
                      metric={activeRotation.metric}
                      currency={activeRotation.currency}
                    />
                    <SectorBoard
                      title={activeMarket === 'china' ? '资金流出前列' : activeMarket === 'crypto' ? '落后赛道' : '落后板块'}
                      items={activeRotation.laggards}
                      mode="laggard"
                      metric={activeRotation.metric}
                      currency={activeRotation.currency}
                    />
                  </div>
                ) : rotationLoadState === 'error' ? (
                  <div className="flex min-h-40 items-center justify-center border border-[#d6b566]/20 bg-[#d6b566]/[0.04] px-5 text-center">
                    <div>
                      <TriangleAlert className="mx-auto text-[#d6b566]" size={20} />
                      <p className="mt-3 text-sm text-white/68">{rotationError || '板块数据暂时不可用'}</p>
                      <button
                        type="button"
                        onClick={() => setRotationReloadKey((current) => current + 1)}
                        className="mt-3 inline-flex h-8 items-center gap-2 border border-white/14 px-3 text-xs font-semibold text-white/64 transition hover:border-white/30 hover:text-white"
                      >
                        <RefreshCw size={13} /> 重试
                      </button>
                    </div>
                  </div>
                ) : (
                  <RotationSkeleton />
                )}
              </div>

              <div className="mt-7 grid gap-4 xl:grid-cols-2">
                <NewsBoard items={activeNews} />
                <ResearchBoard items={activeReports} />
              </div>

              {(activeMarket === 'hongkong' || activeMarket === 'us') ? (
                <>
                  {regionalContentState === 'error' ? (
                    <p className="mt-3 text-xs text-[#e4aa7d]">市场内容更新失败：{regionalContentError}</p>
                  ) : activeRegionalContent?.note ? (
                    <p className="mt-3 text-[11px] text-white/30">{activeRegionalContent.note}</p>
                  ) : null}
                  <InstitutionRatingBoard market={activeMarket} />
                </>
              ) : null}

              {activeMarket !== 'crypto' ? (
                <MarketTemperaturePanel mode={activeMarket as 'china' | 'hongkong' | 'us'} />
              ) : null}
              <div aria-hidden="true" className="pointer-events-none fixed left-[-10000px] top-0 w-[820px]">
                <MarketReport
                  ref={reportRef}
                  data={data}
                  mode={activeMarket}
                  rotation={activeRotation}
                  valuation={activeValuation}
                />
              </div>

              <SourceBoard sources={activeSources} disclaimer={data.summary.disclaimer} />
              <MarketDisciplineMotto />
            </motion.div>
          ) : loadState === 'loading' ? <LoadingPanel /> : null}
        </div>
      </section>
    </PageTransition>
  );
}

function VibeResearchPanel({
  mode,
  data,
  state,
  onRun,
  onOpenAssistant,
}: {
  mode: MarketChartMode;
  data: MarketIntelligence;
  state: ResearchState;
  onRun: (target: ResearchTarget) => void;
  onOpenAssistant: (sessionId: string) => void;
}) {
  const [researchKind, setResearchKind] = useState<ResearchTarget['kind']>('market');
  const [sectorName, setSectorName] = useState('');
  const [selectedIndexCode, setSelectedIndexCode] = useState<string>(A_SHARE_INDEX_TARGETS[0].code);
  const running = state.running || state.connecting;
  const indexTargets = INDEX_RESEARCH_TARGETS[mode];
  const sectorSuggestions = useMemo(() => {
    const regionalDefaults: Record<MarketChartMode, string[]> = {
      china: [],
      hongkong: ['互联网科技', '金融', '医药', '消费', '地产', '央企红利'],
      us: ['大型科技', '半导体', '金融', '医疗', '能源', '工业', '必需消费', '可选消费'],
      crypto: ['Bitcoin', 'Ethereum', 'DeFi', 'Layer 2', 'AI 加密资产'],
    };
    const liveSectors = mode === 'china'
      ? [...data.sectors.leaders, ...data.sectors.laggards].map((item) => item.name)
      : [];
    return [...new Set([...liveSectors, ...regionalDefaults[mode]])].slice(0, 16);
  }, [data.sectors.laggards, data.sectors.leaders, mode]);
  const selectedIndex = indexTargets.find((item) => item.code === selectedIndexCode) || indexTargets[0];
  const requestedTarget: ResearchTarget = researchKind === 'market'
    ? { kind: 'market', name: MARKET_META[mode].short }
    : researchKind === 'index' && selectedIndex
      ? { kind: 'index', ...selectedIndex }
      : { kind: 'sector', name: sectorName.trim() };
  const targetActionLabel = requestedTarget.kind === 'market'
    ? `${MARKET_META[mode].short}整体`
    : requestedTarget.kind === 'index'
      ? `${requestedTarget.name}指数`
      : requestedTarget.name
        ? `${requestedTarget.name}板块`
        : '指定板块';
  const canRun = !running && (requestedTarget.kind === 'market' || Boolean(requestedTarget.name));
  const statusLabel = running
    ? '研究中'
    : state.report
      ? '研究已完成'
      : state.error
        ? '研究失败'
        : '尚未开始研究';
  const assistantActionLabel = running
    ? '前往 AI 助手查看进度'
    : state.report
      ? '前往 AI 助手查看报告'
      : '在 AI 助手中打开研究';

  useEffect(() => {
    setResearchKind('market');
    setSectorName('');
    setSelectedIndexCode(INDEX_RESEARCH_TARGETS[mode][0]?.code || '');
  }, [mode]);

  return (
    <aside className="flex min-h-[650px] flex-col border border-white/10 bg-[#090a0c]">
      <div className="border-b border-white/10 px-5 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#75e6b1]">
              <Bot size={14} /> Vibe-Trading Research
            </div>
            <h2 className="mt-2 text-xl font-semibold">估值与逆向信号研究</h2>
            <p className="mt-1 text-[11px] text-white/36">
              {state.targetLabel ? `最近研究：${state.targetLabel}` : `当前市场：${MARKET_META[mode].short}`}
            </p>
          </div>
          <span className="border border-white/10 px-2 py-1 font-mono text-xs text-white/48">数据置信 {data.confidence}%</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden border border-white/10 bg-white/10">
          <Metric label="报告首屏" value="表格结论" />
          <Metric label="估值口径" value={mode === 'crypto' ? '链上与资金代理' : 'PE / PB 分位'} />
          <Metric label="逆向信号" value="逃顶 · 抄底" />
          <Metric label="大众破圈热度" value={mode === 'china' ? '韭菜指数' : '公众关注度'} />
        </div>

        <div className="mt-4 border border-white/10 bg-black/20 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/34">研究对象</p>
          <div className={`mt-2 grid gap-px bg-white/10 ${indexTargets.length ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <button
              type="button"
              onClick={() => setResearchKind('market')}
              disabled={running}
              aria-pressed={researchKind === 'market'}
              className={`inline-flex h-9 items-center justify-center gap-2 text-xs font-semibold transition ${
                researchKind === 'market'
                  ? 'bg-[#75e6b1]/12 text-[#b8f5d7]'
                  : 'bg-[#090a0c] text-white/46 hover:text-white/75'
              }`}
            >
              <Landmark size={13} /> 整体市场
            </button>
            {indexTargets.length ? (
              <button
                type="button"
                onClick={() => setResearchKind('index')}
                disabled={running}
                aria-pressed={researchKind === 'index'}
                className={`inline-flex h-9 items-center justify-center gap-2 text-xs font-semibold transition ${
                  researchKind === 'index'
                    ? 'bg-[#75e6b1]/12 text-[#b8f5d7]'
                    : 'bg-[#090a0c] text-white/46 hover:text-white/75'
                }`}
              >
                <Activity size={13} /> 宽基指数
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setResearchKind('sector')}
              disabled={running}
              aria-pressed={researchKind === 'sector'}
              className={`inline-flex h-9 items-center justify-center gap-2 text-xs font-semibold transition ${
                researchKind === 'sector'
                  ? 'bg-[#75e6b1]/12 text-[#b8f5d7]'
                  : 'bg-[#090a0c] text-white/46 hover:text-white/75'
              }`}
            >
              <Building2 size={13} /> 行业板块
            </button>
          </div>
          {researchKind === 'index' && indexTargets.length ? (
            <div className="mt-2 grid grid-cols-2 gap-px border border-white/10 bg-white/10">
              {indexTargets.map((item) => {
                const selected = item.code === selectedIndexCode;
                return (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => setSelectedIndexCode(item.code)}
                    disabled={running}
                    aria-pressed={selected}
                    title={item.description}
                    className={`min-h-11 px-3 py-2 text-left transition ${selected ? 'bg-[#15342c] text-[#c8f6df]' : 'bg-[#08090b] text-white/48 hover:text-white/78'}`}
                  >
                    <span className="block text-[11px] font-semibold">{item.name}</span>
                    <span className="mt-0.5 block font-mono text-[9px] opacity-45">{item.code}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {researchKind === 'sector' ? (
            <>
              <input
                type="text"
                value={sectorName}
                onChange={(event) => setSectorName(event.target.value)}
                disabled={running}
                list={`market-sector-suggestions-${mode}`}
                placeholder={mode === 'crypto' ? '输入币种或赛道，例如 Ethereum' : '输入板块，例如 半导体、银行、白酒'}
                className="mt-2 h-10 w-full border border-white/12 bg-[#08090b] px-3 text-xs text-white outline-none transition placeholder:text-white/24 focus:border-[#75e6b1]/45"
                aria-label="输入研究板块"
              />
              <datalist id={`market-sector-suggestions-${mode}`}>
                {sectorSuggestions.map((item) => <option key={item} value={item} />)}
              </datalist>
            </>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => onRun(requestedTarget)}
          disabled={!canRun}
          className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-[#75e6b1]/35 bg-[#75e6b1]/10 px-4 text-sm font-semibold text-[#b8f5d7] transition hover:bg-[#75e6b1]/16 disabled:cursor-wait disabled:opacity-55"
        >
          {running ? <LoaderCircle size={16} className="animate-spin" /> : <Radar size={16} />}
          {state.connecting
            ? '正在连接研究引擎'
            : state.running
              ? `正在研究${state.targetLabel || '市场'}`
              : `研究${targetActionLabel}`}
        </button>
      </div>

      <div className="min-h-0 flex-1 px-5 py-5">
        {state.sessionId ? (
          <div className="flex h-full min-h-52 flex-col">
            <div className="flex items-start gap-3 border-b border-white/10 pb-5">
              <span className="relative mt-1.5 h-2.5 w-2.5 shrink-0">
                {running ? <span className="absolute inset-0 animate-ping rounded-full bg-[#d6b566]/70" /> : null}
                <span className={`absolute inset-0 rounded-full ${
                  state.error
                    ? 'bg-[#ff8a8a]'
                    : running
                      ? 'animate-pulse bg-[#d6b566]'
                      : state.report
                        ? 'bg-[#75e6b1]'
                        : 'bg-white/25'
                }`} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white/88">{statusLabel}</p>
                <p className="mt-1 text-xs leading-5 text-white/38">
                  {state.targetLabel ? `研究对象：${state.targetLabel}` : `当前市场：${MARKET_META[mode].short}`}
                </p>
                {state.updatedAt ? (
                  <p className="mt-1 font-mono text-[10px] text-white/26">更新于 {formatDateTime(state.updatedAt, true)}</p>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              onClick={() => onOpenAssistant(state.sessionId)}
              className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 border border-[#75e6b1]/35 bg-[#75e6b1]/10 px-4 text-sm font-semibold text-[#b8f5d7] transition hover:border-[#75e6b1]/55 hover:bg-[#75e6b1]/16"
            >
              {running ? <LoaderCircle size={16} className="animate-spin" /> : <Bot size={16} />}
              <span>{assistantActionLabel}</span>
              <ArrowUpRight size={15} />
            </button>
            <p className="mt-3 text-center text-[11px] leading-5 text-white/30">
              完整研究过程、引用来源与最终报告仅在 AI 助手中展示
            </p>
          </div>
        ) : (
          <div className="space-y-4 text-sm leading-6 text-white/42">
            <p>
              {mode === 'crypto'
                ? '研究将主动检索币价趋势、ETF 与稳定币资金、合约杠杆、链上指标及监管事件，并把事实、推断和缺失证据分开呈现。'
                : '报告开头先给表格结论，再展开估值、热度、逃顶抄底、情绪拥挤、资金和基本面证据。'}
            </p>
            <ul className="space-y-2 border-l border-white/12 pl-4">
              <li>首屏总表：点位、估值、逆向信号与大众破圈热度</li>
              <li>指数可选：整体市场或{indexTargets.length || '主要'}个代表性宽基分别研究</li>
              <li>行动纪律：追高、观望、再平衡或分批投入</li>
            </ul>
          </div>
        )}
        {state.error ? <p className="mt-4 text-sm text-[#ff9f9f]">{state.error}</p> : null}
      </div>
    </aside>
  );
}

const MARKET_SESSION_TONES: Record<MarketSessionTone, { dot: string; ring: string; label: string; border: string; background: string }> = {
  live: {
    dot: 'bg-[#35d6aa]',
    ring: 'bg-[#35d6aa]/45',
    label: 'text-[#75e6b1]',
    border: 'border-[#35d6aa]/30',
    background: 'bg-[#35d6aa]/[0.055]',
  },
  auction: {
    dot: 'bg-[#69d5ff]',
    ring: 'bg-[#69d5ff]/40',
    label: 'text-[#9de5ff]',
    border: 'border-[#69d5ff]/28',
    background: 'bg-[#69d5ff]/[0.05]',
  },
  extended: {
    dot: 'bg-[#d6b566]',
    ring: 'bg-[#d6b566]/35',
    label: 'text-[#ead9a6]',
    border: 'border-[#d6b566]/28',
    background: 'bg-[#d6b566]/[0.05]',
  },
  paused: {
    dot: 'bg-[#e5a95e]',
    ring: 'bg-[#e5a95e]/35',
    label: 'text-[#f0c98d]',
    border: 'border-[#e5a95e]/28',
    background: 'bg-[#e5a95e]/[0.045]',
  },
  closed: {
    dot: 'bg-white/28',
    ring: 'bg-white/12',
    label: 'text-white/55',
    border: 'border-white/12',
    background: 'bg-white/[0.025]',
  },
  halted: {
    dot: 'bg-[#ff3348]',
    ring: 'bg-[#ff3348]/45',
    label: 'text-[#ff7b87]',
    border: 'border-[#ff3348]/38',
    background: 'bg-[#ff3348]/[0.075]',
  },
};

function MarketSessionIndicator({
  mode,
  usSystemState,
  usSystemMessage,
}: {
  mode: MarketChartMode;
  usSystemState: UsMarketSystemStatus['state'];
  usSystemMessage: string;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [mode]);
  const status = useMemo(
    () => getMarketSessionStatus(mode, now, usSystemState),
    [mode, now, usSystemState],
  );
  const tone = MARKET_SESSION_TONES[status.tone];
  const pulsing = status.tone === 'live' || status.tone === 'auction' || status.tone === 'halted';
  const marketName = mode === 'crypto' ? '加密市场' : `${MARKET_META[mode].label}市场`;

  return (
    <a
      href={status.sourceUrl}
      target="_blank"
      rel="noreferrer"
      aria-label={`${marketName}当前状态：${status.label}`}
      title={mode === 'us' ? `${status.detail}；${usSystemMessage}` : `${status.detail}；查看官方交易时段`}
      className={`group flex min-h-[64px] w-full min-w-0 items-center gap-4 border px-4 py-3 transition hover:bg-white/[0.055] lg:w-[520px] ${tone.border} ${tone.background}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="relative flex h-3 w-3 shrink-0 items-center justify-center">
          {pulsing ? <span className={`absolute h-3 w-3 animate-ping rounded-full ${tone.ring}`} /> : null}
          <span className={`relative h-2 w-2 rounded-full ${tone.dot}`} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-white/34">{marketName}</p>
          <div className="mt-0.5 flex min-w-0 items-baseline gap-2">
            <p aria-live="polite" className={`shrink-0 text-sm font-semibold ${tone.label}`}>{status.label}</p>
            <p className="truncate text-[11px] text-white/36">{status.detail}</p>
          </div>
        </div>
      </div>
      <div className="min-w-0 shrink-0 text-right">
        <p className="font-mono text-[11px] text-white/62">{status.location} · {status.localTime}</p>
        <p className="mt-1 max-w-[220px] truncate text-[10px] text-white/32">{status.nextLabel}</p>
      </div>
      <ArrowUpRight size={14} className="shrink-0 text-white/24 transition group-hover:text-white/60" />
    </a>
  );
}

function indexChangeColor(changePercent: number) {
  const magnitude = Math.abs(changePercent);
  if (magnitude < 0.1) return 'text-white/42';
  if (changePercent > 0) {
    if (magnitude >= 2.5) return 'text-[#ff3348]';
    if (magnitude >= 1) return 'text-[#ff6673]';
    return 'text-[#c9787f]';
  }
  if (magnitude >= 2.5) return 'text-[#00d68f]';
  if (magnitude >= 1) return 'text-[#35d6aa]';
  return 'text-[#69a891]';
}

function IndexStrip({ indices }: { indices: MarketIndexSnapshot[] }) {
  return (
    <div className={`grid grid-flow-col auto-cols-[172px] gap-px overflow-x-auto border border-white/10 bg-white/10 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden xl:grid-flow-row ${indices.length >= 6 ? 'xl:grid-cols-6' : 'xl:grid-cols-5'}`}>
      {indices.map((item) => {
        const changeColor = indexChangeColor(item.changePercent);
        return (
          <a key={item.id} href={item.sourceUrl} target="_blank" rel="noreferrer" className="min-w-0 bg-[#08090b] px-4 py-3.5 transition hover:bg-white/[0.055]">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-white/72">{item.name}</p>
                <p className="mt-1 truncate text-[9px] uppercase text-white/28">{item.proxyFor || item.region}</p>
              </div>
              {item.validation.status === 'verified' ? (
                <CheckCircle2 size={12} className="shrink-0 text-[#75e6b1]" />
              ) : (
                <TriangleAlert size={12} className="shrink-0 text-[#d6b566]" />
              )}
            </div>
            <div className="mt-3 flex items-end justify-between gap-3">
              <p className={`truncate font-mono text-lg font-semibold transition-colors ${changeColor}`}>{formatNumber(item.price)}</p>
              <p className={`shrink-0 font-mono text-xs font-semibold transition-colors ${changeColor}`}>
                {item.changePercent > 0 ? '+' : ''}{item.changePercent.toFixed(2)}%
              </p>
            </div>
          </a>
        );
      })}
    </div>
  );
}

function SectorBoard({
  title,
  items,
  mode,
  metric,
  currency,
}: {
  title: string;
  items: MarketRotationItem[];
  mode: 'leader' | 'laggard';
  metric: RotationMetric;
  currency: MarketRotation['currency'];
}) {
  return (
    <section className="border border-white/10 bg-white/[0.025] p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/34">
            {mode === 'leader' ? <TrendingUp size={14} /> : <TrendingDown size={14} />} 板块风向
          </div>
          <h3 className="mt-2 text-xl font-semibold">{title}</h3>
        </div>
        <span className={`h-2 w-2 ${mode === 'leader' ? 'bg-[#ff8585]' : 'bg-[#75e6b1]'}`} />
      </div>
      <div className={`mt-5 grid gap-px overflow-hidden border border-white/10 bg-white/10 ${
        items.length <= 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
      }`}>
        {items.slice(0, 8).map((item) => (
          <div key={item.code} className="flex items-center justify-between gap-4 bg-[#090a0c] px-3.5 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white/78">{item.name}</p>
              <p className="mt-1 text-[10px] text-white/34">
                {metric === 'fund-flow'
                  ? `主力占比 ${item.advanceRatio.toFixed(2)}%`
                  : metric === 'turnover'
                    ? `上涨 ${Math.round(item.advanceRatio * item.memberCount / 100)}/${item.memberCount}`
                    : `上涨占比 ${item.advanceRatio.toFixed(0)}% · ${item.memberCount} 个样本`}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className={`font-mono text-xs ${item.changePercent >= 0 ? 'text-[#ff8585]' : 'text-[#75e6b1]'}`}>
                {item.changePercent >= 0 ? '+' : ''}{item.changePercent.toFixed(2)}%
              </p>
              <p className="mt-1 font-mono text-[10px] text-white/38">
                {metric === 'fund-flow'
                  ? formatMoney(item.scaleValue)
                  : metric === 'turnover'
                    ? `24h ${formatMarketValue(item.scaleValue, currency)}`
                    : `市值 ${formatMarketValue(item.scaleValue, currency)}`}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RotationSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-2" aria-label="正在加载板块数据">
      {[0, 1].map((board) => (
        <div key={board} className="min-h-48 animate-pulse border border-white/10 bg-white/[0.025] p-5">
          <div className="h-3 w-20 bg-white/8" />
          <div className="mt-3 h-6 w-32 bg-white/10" />
          <div className="mt-5 grid gap-px border border-white/8 bg-white/8 sm:grid-cols-2">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="h-[66px] bg-[#090a0c] p-3">
                <div className="h-3 w-20 bg-white/8" />
                <div className="mt-2 h-2 w-28 bg-white/5" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function NewsBoard({ items }: { items: NewsItem[] }) {
  return (
    <section className="border border-white/10 bg-white/[0.025] p-5">
      <SectionHeading eyebrow="Chinese Market News" title="高权重市场催化" icon={<Newspaper size={15} />} />
      <div className="divide-y divide-white/8">
        {items.slice(0, 8).map((item) => (
          <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="block py-3.5 first:pt-0 last:pb-0">
            <div className="flex items-center gap-2 text-[10px] text-white/34">
              <span>{item.source}</span>
              <span>{formatDateTime(item.publishedAt)}</span>
              <span className="ml-auto border border-white/8 px-1.5 py-0.5">权重 {item.weight}</span>
            </div>
            <p className="mt-2 text-sm font-semibold leading-6 text-white/76 transition hover:text-white">{item.title}</p>
          </a>
        ))}
        {!items.length ? <p className="py-5 text-sm text-white/40">当前没有可用的中文市场新闻。</p> : null}
      </div>
    </section>
  );
}

function ResearchBoard({ items }: { items: ResearchReport[] }) {
  return (
    <section className="border border-white/10 bg-white/[0.025] p-5">
      <SectionHeading eyebrow="Broker Research" title="最新公开研报覆盖" icon={<FileText size={15} />} />
      <div className="divide-y divide-white/8">
        {items.slice(0, 8).map((item) => (
          <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="block py-3.5 first:pt-0 last:pb-0">
            <div className="flex items-center gap-2 text-[10px] text-white/34">
              <span>{item.institution || '机构未标注'}</span>
              <span>{item.publishedAt || '日期未知'}</span>
              <span className="ml-auto border border-[#d6b566]/18 px-1.5 py-0.5 text-[#d6b566]">{item.rating || '未评级'}</span>
            </div>
            <p className="mt-2 text-sm font-semibold leading-6 text-white/76 transition hover:text-white">
              {item.stockName ? `${item.stockName}：` : ''}{item.title}
            </p>
            <p className="mt-1 text-xs text-white/34">{item.industry || '行业未标注'}</p>
          </a>
        ))}
        {!items.length ? <p className="py-5 text-sm text-white/40">当前没有可用的公开研报。</p> : null}
      </div>
    </section>
  );
}

function translateConsensus(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes('strong buy')) return '强力买入';
  if (normalized.includes('buy')) return '买入';
  if (normalized.includes('hold')) return '持有';
  if (normalized.includes('sell')) return '卖出';
  return value;
}

function InstitutionRatingBoard({ market }: { market: 'hongkong' | 'us' }) {
  const defaultQuery = market === 'hongkong' ? '00700' : 'AAPL';
  const [query, setQuery] = useState(defaultQuery);
  const [result, setResult] = useState<InstitutionRating | null>(null);
  const [state, setState] = useState<AsyncState>('idle');
  const [error, setError] = useState('');

  const loadRating = useCallback(async (value: string) => {
    if (!value.trim()) return;
    setState('loading');
    setError('');
    try {
      const payload = await requestJson<InstitutionRating>(
        `/api/institution-rating?market=${market}&query=${encodeURIComponent(value.trim())}`,
      );
      setResult(payload);
      setState('success');
    } catch (requestError) {
      setResult(null);
      setState('error');
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  }, [market]);

  useEffect(() => {
    const next = market === 'hongkong' ? '00700' : 'AAPL';
    setQuery(next);
    void loadRating(next);
  }, [loadRating, market]);

  const targetUpside = result?.targetPrice.average && result.price > 0
    ? (result.targetPrice.average / result.price - 1) * 100
    : undefined;

  return (
    <section className="mt-7 border border-white/10 bg-white/[0.025] p-5 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <SectionHeading eyebrow="Public analyst rating" title="机构个股评级公开档案" icon={<Landmark size={15} />} />
        <form
          className="flex w-full max-w-xl gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void loadRating(query);
          }}
        >
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/28" size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={market === 'hongkong' ? '输入 00700 或 腾讯' : '输入 AAPL 或 Apple'}
              className="h-10 w-full border border-white/12 bg-[#090a0c] pl-9 pr-3 text-sm text-white outline-none transition placeholder:text-white/24 focus:border-[#74c9dd]/55"
            />
          </label>
          <button
            type="submit"
            disabled={state === 'loading'}
            className="inline-flex h-10 min-w-24 items-center justify-center gap-2 border border-[#74c9dd]/35 px-4 text-xs font-semibold text-[#9adbea] transition hover:border-[#74c9dd]/70 disabled:opacity-50"
          >
            {state === 'loading' ? <LoaderCircle className="animate-spin" size={14} /> : <Search size={14} />}
            查询
          </button>
        </form>
      </div>

      {error ? <p className="mt-5 border border-[#d04b5a]/25 bg-[#d04b5a]/[0.05] p-4 text-sm text-[#ed8e99]">{error}</p> : null}
      {result ? (
        <div className="mt-5 grid gap-4 xl:grid-cols-[0.9fr_1.35fr]">
          <div className="border border-white/10 bg-[#090a0c] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs text-white/36">{result.symbol} · {result.sourceLabel}</p>
                <h3 className="mt-1 text-xl font-bold text-white">{result.companyName}</h3>
              </div>
              <span className="border border-[#d6b566]/25 px-2.5 py-1 text-xs font-semibold text-[#e6cd8e]">
                {translateConsensus(result.consensus)}
              </span>
            </div>
            <p className="mt-4 text-sm leading-6 text-white/56">{result.summary}</p>
            <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden border border-white/8 bg-white/8">
              <div className="bg-[#0c0e11] p-3">
                <p className="text-[10px] text-white/32">当前价格</p>
                <p className="mt-1 font-mono text-lg font-semibold text-white/82">{result.price.toLocaleString()}</p>
              </div>
              <div className="bg-[#0c0e11] p-3">
                <p className="text-[10px] text-white/32">平均目标价</p>
                <p className="mt-1 font-mono text-lg font-semibold text-[#9adbea]">
                  {result.targetPrice.average?.toLocaleString() || '--'}
                </p>
              </div>
              <div className="bg-[#0c0e11] p-3">
                <p className="text-[10px] text-white/32">隐含空间</p>
                <p className={`mt-1 font-mono text-lg font-semibold ${targetUpside === undefined ? 'text-white/50' : targetUpside >= 0 ? 'text-[#6ed5b7]' : 'text-[#ed8e99]'}`}>
                  {targetUpside === undefined ? '--' : `${targetUpside >= 0 ? '+' : ''}${targetUpside.toFixed(1)}%`}
                </p>
              </div>
              <div className="bg-[#0c0e11] p-3">
                <p className="text-[10px] text-white/32">公开样本</p>
                <p className="mt-1 font-mono text-lg font-semibold text-white/82">{result.analystCount}</p>
              </div>
            </div>
            {(result.distribution.buy + result.distribution.hold + result.distribution.sell) > 0 ? (
              <div className="mt-4">
                <div className="flex justify-between text-[10px] text-white/38">
                  <span>买入 {result.distribution.buy}</span>
                  <span>持有 {result.distribution.hold}</span>
                  <span>卖出 {result.distribution.sell}</span>
                </div>
                <div className="mt-2 flex h-1.5 overflow-hidden bg-white/8">
                  {(['buy', 'hold', 'sell'] as const).map((key) => {
                    const total = result.distribution.buy + result.distribution.hold + result.distribution.sell;
                    const colors = { buy: '#1aa382', hold: '#d6b566', sell: '#d04b5a' };
                    return <span key={key} style={{ width: `${result.distribution[key] / total * 100}%`, backgroundColor: colors[key] }} />;
                  })}
                </div>
              </div>
            ) : null}
          </div>

          <div className="border border-white/10 bg-[#090a0c] p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-white/52">公开机构与评级记录</p>
              <a href={result.sourceUrl} target="_blank" rel="noreferrer" className="text-[10px] text-[#74c9dd] hover:text-[#a7e7f4]">
                查看原始来源 ↗
              </a>
            </div>
            {result.reports.length ? (
              <div className="mt-3 divide-y divide-white/8">
                {result.reports.slice(0, 7).map((report) => (
                  <a key={report.id} href={report.url} target="_blank" rel="noreferrer" className="block py-3 first:pt-0">
                    <div className="flex items-center gap-2 text-[10px] text-white/32">
                      <span>{report.institution}</span><span>{report.publishedAt || '日期未标注'}</span>
                      <span className="ml-auto text-[#e6cd8e]">{report.rating}</span>
                    </div>
                    <p className="mt-1.5 text-sm leading-6 text-white/68 hover:text-white">{report.title}</p>
                  </a>
                ))}
              </div>
            ) : (
              <div className="mt-4">
                <p className="text-xs leading-5 text-white/42">覆盖机构</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {result.brokers.slice(0, 14).map((broker) => (
                    <span key={broker} className="border border-white/8 px-2 py-1 text-[10px] text-white/46">{broker}</span>
                  ))}
                </div>
              </div>
            )}
            <p className="mt-4 border-t border-white/8 pt-3 text-[10px] leading-5 text-white/28">{result.note}</p>
          </div>
        </div>
      ) : state === 'loading' ? (
        <div className="mt-5 h-56 animate-pulse border border-white/8 bg-white/[0.025]" />
      ) : null}
    </section>
  );
}

type DailyBriefTone = 'positive' | 'neutral' | 'warning';

type DailyBriefWatchItem = {
  title: string;
  current: string;
  condition: string;
  status: string;
  tone: DailyBriefTone;
};

function buildDailyBrief(
  data: MarketIntelligence,
  mode: MarketChartMode,
  rotation?: MarketRotation,
  valuation?: AShareValuationSnapshot | null,
) {
  const indices = data.indices.filter((item) => item.market === mode);
  const sortedIndices = indices.slice().sort((left, right) => right.changePercent - left.changePercent);
  const strongest = sortedIndices[0];
  const averageChange = indices.length
    ? indices.reduce((sum, item) => sum + item.changePercent, 0) / indices.length
    : 0;
  const isChina = mode === 'china';
  const breadthPercent = isChina
    ? data.breadth.advanceRatio * 100
    : indices.length
      ? indices.filter((item) => item.changePercent > 0.03).length / indices.length * 100
      : 50;
  const normalizedFlow = isChina
    ? (data.sectors.flowBalance + 1) / 2 * 100
    : Math.max(0, Math.min(100, 50 + averageChange * 10));
  const positiveSectorRatio = isChina ? data.sectors.positiveRatio * 100 : breadthPercent;
  const crowdScore = Math.max(0, Math.min(100,
    breadthPercent * 0.45 + positiveSectorRatio * 0.25 + normalizedFlow * 0.30,
  ));
  const leader = rotation?.leaders[0];
  const anchors = valuation?.bookValueAnchors?.length
    ? valuation.bookValueAnchors
    : valuation?.bookValueAnchor
      ? [valuation.bookValueAnchor]
      : [];
  const primaryAnchor = valuation?.bookValueAnchor || anchors[0];
  const valuationAvailable = Boolean(primaryAnchor);
  const currentPb = primaryAnchor?.current.pb;
  const fairPb = primaryAnchor?.current.fairPb;
  const pbPercentile = primaryAnchor?.current.pbPercentile ?? 50;
  const premiumPercent = primaryAnchor?.current.premiumPercent ?? 0;
  const shortHeat = valuationAvailable ? valuation!.overall.temperature : 50;
  const shortHeatDelta = valuationAvailable ? valuation!.overall.temperatureDelta : 0;
  const topRisk = valuationAvailable
    ? pbPercentile * 0.50 + shortHeat * 0.30 + crowdScore * 0.20
    : 50;
  const bottomOpportunity = valuationAvailable
    ? (100 - pbPercentile) * 0.50 + (100 - shortHeat) * 0.30 + (100 - crowdScore) * 0.20
    : 50;
  const greedConfirmed = crowdScore >= 75;
  const fearConfirmed = crowdScore <= 25;
  const topConfirmed = valuationAvailable && pbPercentile >= 80 && shortHeat >= 80 && greedConfirmed;
  const bottomConfirmed = valuationAvailable && pbPercentile <= 20 && shortHeat <= 20 && fearConfirmed;
  const hotAnchors = anchors.filter((item) => item.current.pbPercentile >= 80);
  const coldAnchors = anchors.filter((item) => item.current.pbPercentile <= 20);

  const contrarian = !valuationAvailable
    ? {
        title: '长期估值数据尚未接入',
        action: '不输出逃顶或抄底结论',
        detail: '当前市场缺少可比的长期PB历史，因此只保留行情观察。',
        tone: 'neutral' as DailyBriefTone,
      }
    : topConfirmed
      ? {
          title: '高估与一致乐观共振',
          action: '停止追高，分批降低超出目标仓位的部分',
          detail: '长期PB、短期估值温度与市场情绪同时进入高位区，逃顶风险信号已触发；不建议一次性清仓。',
          tone: 'warning' as DailyBriefTone,
        }
      : bottomConfirmed
        ? {
            title: '低估与市场恐慌共振',
            action: '在既定风险预算内，分批提高基础定投',
            detail: '长期PB、短期估值温度与市场情绪同时进入低位区，逆向买入信号已触发；不建议一次性重仓。',
            tone: 'positive' as DailyBriefTone,
          }
        : hotAnchors.length && shortHeat >= 70
          ? {
              title: '局部高估，短期情绪偏热',
              action: '停止追高高估方向，分批再平衡超配板块',
              detail: `${hotAnchors.map((item) => item.name).join('、')}已进入PB历史高分位，但全市场尚未形成全面逃顶信号。`,
              tone: 'warning' as DailyBriefTone,
            }
          : coldAnchors.length && shortHeat <= 30
            ? {
                title: '局部低估，情绪仍然低迷',
                action: '维持基础定投，低估方向可分批增加',
                detail: `${coldAnchors.map((item) => item.name).join('、')}处于PB历史低分位，但仍需等待市场恐慌与估值形成更强共振。`,
                tone: 'positive' as DailyBriefTone,
              }
            : shortHeat >= 70 && greedConfirmed
              ? {
                  title: '短期拥挤，长期估值尚未过热',
                  action: '不追高，维持核心仓位并等待估值确认',
                  detail: '市场情绪已经热起来，但长期PB尚未进入高估区，不宜仅凭上涨情绪全面卖出。',
                  tone: 'neutral' as DailyBriefTone,
                }
              : shortHeat <= 30 && fearConfirmed
                ? {
                    title: '短期低迷，长期估值尚未极低',
                    action: '保持基础定投，不因低迷一次性重仓',
                    detail: '市场情绪低迷，但长期PB尚未进入极低区，抄底信号仍需等待估值确认。',
                    tone: 'neutral' as DailyBriefTone,
                  }
                : {
                    title: '估值与情绪均未进入极端区',
                    action: '维持基础仓位，等待赔率进一步倾斜',
                    detail: '当前没有满足双重确认的逃顶或抄底信号。',
                    tone: 'neutral' as DailyBriefTone,
                  };

  const watchItems: DailyBriefWatchItem[] = [
    {
      title: '全市场逃顶风险',
      current: valuationAvailable ? `PB分位 ${pbPercentile.toFixed(1)}% · 温度 ${shortHeat.toFixed(0)}° · 情绪 ${crowdScore.toFixed(0)}°` : '估值数据暂缺',
      condition: 'PB分位≥80%、短期温度≥80°且情绪≥75°时触发；只分批处理超配仓位。',
      status: topConfirmed ? '已触发' : '未触发',
      tone: topConfirmed ? 'warning' : 'neutral',
    },
    {
      title: '局部高估提醒',
      current: hotAnchors.length ? hotAnchors.map((item) => `${item.name} ${item.current.pbPercentile.toFixed(1)}%`).join(' · ') : '暂无指数进入80%以上',
      condition: '单个宽基PB分位≥80%先视为局部风险，不直接推导全市场见顶。',
      status: hotAnchors.length ? '局部触发' : '未触发',
      tone: hotAnchors.length ? 'warning' : 'neutral',
    },
    {
      title: '全市场抄底机会',
      current: valuationAvailable ? `PB分位 ${pbPercentile.toFixed(1)}% · 温度 ${shortHeat.toFixed(0)}° · 情绪 ${crowdScore.toFixed(0)}°` : '估值数据暂缺',
      condition: 'PB分位≤20%、短期温度≤20°且情绪≤25°时触发；采用分批定投而非一次性押注。',
      status: bottomConfirmed ? '已触发' : '未触发',
      tone: bottomConfirmed ? 'positive' : 'neutral',
    },
    {
      title: '市场情绪确认',
      current: `${breadthPercent.toFixed(1)}%上涨 · 情绪温度 ${crowdScore.toFixed(0)}°${leader ? ` · ${leader.name}资金居前` : ''}`,
      condition: '情绪只用于确认估值信号；高涨不等于立即见顶，恐慌也不等于立即见底。',
      status: greedConfirmed ? '一致乐观' : fearConfirmed ? '明显恐慌' : '中性',
      tone: greedConfirmed ? 'warning' : fearConfirmed ? 'positive' : 'neutral',
    },
  ];

  return {
    indices,
    breadthPercent,
    normalizedFlow,
    crowdScore,
    currentPb,
    fairPb,
    pbPercentile,
    premiumPercent,
    shortHeat,
    shortHeatDelta,
    topRisk,
    bottomOpportunity,
    topConfirmed,
    bottomConfirmed,
    contrarian,
    valuationAvailable,
    anchors,
    hotAnchors,
    coldAnchors,
    strongest,
    watchItems,
    leaders: rotation?.leaders.slice(0, 3) || [],
    laggards: rotation?.laggards.slice(0, 3) || [],
  };
}

const MarketReport = forwardRef<HTMLElement, {
  data: MarketIntelligence;
  mode: MarketChartMode;
  rotation?: MarketRotation;
  valuation?: AShareValuationSnapshot | null;
}>(function MarketReport({ data, mode, rotation, valuation }, ref) {
  const brief = buildDailyBrief(data, mode, rotation, valuation);
  const indexTimestamps = brief.indices
    .map((item) => item.updatedAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  const marketTimestamp = valuation?.overall.updatedAt || indexTimestamps[indexTimestamps.length - 1] || data.generatedAt;
  const reportDate = formatChineseReportDate(marketTimestamp);
  const conclusionStyle = {
    positive: 'border-[#147557] bg-[#147557]/8 text-[#11664d]',
    neutral: 'border-[#b28e3e] bg-[#b28e3e]/8 text-[#765d24]',
    warning: 'border-[#a33333] bg-[#a33333]/8 text-[#8e2929]',
  }[brief.contrarian.tone];

  return (
    <section ref={ref} className="mx-auto mt-9 w-full max-w-[820px] overflow-hidden bg-[#f5f6f3] text-[#10263b] shadow-[0_26px_100px_rgba(0,0,0,0.38)]">
      <div data-pdf-page="overview" className="bg-[#f5f6f3]">
        <header data-pdf-block className="border-b-[4px] border-[#c3a457] bg-[#081d32] px-5 py-6 text-white sm:px-8 sm:py-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[#d8bd79]">SparkFlow Contrarian Valuation</p>
            <h2 className="mt-3 text-2xl font-semibold sm:text-[28px]">{MARKET_META[mode].short}估值与逆向信号日报</h2>
            <p className="mt-2 text-xs text-white/58">当前估值 · 逃顶风险 · 抄底机会 · 分批行动</p>
          </div>
          <div className="flex items-end justify-between gap-8 sm:text-right">
            <div>
              <p className="font-mono text-2xl font-semibold text-[#ef9a9a]">{Math.round(brief.topRisk)}<span className="ml-1 text-xs text-white/38">/100</span></p>
              <p className="mt-1 text-[9px] text-white/42">逃顶风险</p>
            </div>
            <div>
              <p className="font-mono text-2xl font-semibold text-[#7dc9ad]">{Math.round(brief.bottomOpportunity)}<span className="ml-1 text-xs text-white/38">/100</span></p>
              <p className="mt-1 text-[9px] text-white/42">抄底机会</p>
            </div>
          </div>
        </div>
        <p className="mt-5 border-t border-white/10 pt-3 text-[10px] text-white/42">{reportDate} · 概率预警，不是顶部或底部断言</p>
        </header>

        <ReportIndexStrip indices={brief.indices} />

        <div className="px-5 py-6 sm:px-8 sm:py-7">
        <div data-pdf-block className={`border-l-[3px] px-4 py-4 sm:px-5 ${conclusionStyle}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.16em] opacity-70">今日逆向判断</p>
              <p className="mt-2 text-lg font-semibold leading-7">{brief.contrarian.title}</p>
            </div>
            <span className="w-fit border border-current/30 px-2 py-1 text-[9px] font-semibold">
              {brief.topConfirmed ? '逃顶预警已触发' : brief.bottomConfirmed ? '抄底信号已触发' : '全市场极端信号未触发'}
            </span>
          </div>
          <p className="mt-3 text-sm font-semibold leading-6 text-[#10263b]">行动：{brief.contrarian.action}</p>
          <p className="mt-1.5 text-[11px] leading-5 text-[#10263b]/58">{brief.contrarian.detail}</p>
        </div>

        <div data-pdf-block className="mt-5 grid grid-cols-2 border-l border-t border-[#10263b]/14 sm:grid-cols-4">
          <ReportMetric label="当前 PB" value={brief.valuationAvailable ? `${brief.currentPb?.toFixed(2)}x` : '--'} note={brief.valuationAvailable ? `历史中枢 ${brief.fairPb?.toFixed(2)}x` : '长期估值待接入'} />
          <ReportMetric label="PB 历史分位" value={brief.valuationAvailable ? `${brief.pbPercentile.toFixed(1)}%` : '--'} note={getValuationBand(brief.pbPercentile)} />
          <ReportMetric label="短期估值温度" value={brief.valuationAvailable ? `${brief.shortHeat.toFixed(0)}°` : '--'} note={brief.valuationAvailable ? `20日变化 ${formatSignedNumber(brief.shortHeatDelta, 1)}°` : '短期热度待接入'} />
          <ReportMetric label="市场情绪温度" value={`${brief.crowdScore.toFixed(0)}°`} note={brief.crowdScore >= 75 ? '一致乐观' : brief.crowdScore <= 25 ? '明显低迷' : '尚未极端'} />
        </div>

        <div data-pdf-block className="mt-7">
          <ReportHeading index="01" title="逃顶与抄底雷达" />
          <div className="border-y border-[#10263b]/14 py-4">
            <SignalGauge label="逃顶风险" score={brief.topRisk} tone="warning" status={brief.topConfirmed ? '已触发' : '未触发'} />
            <SignalGauge label="抄底机会" score={brief.bottomOpportunity} tone="positive" status={brief.bottomConfirmed ? '已触发' : '未触发'} />
            <p className="mt-4 text-[9px] leading-4 text-[#10263b]/46">
              计算口径：长期 PB 历史分位 50% + 短期估值温度 30% + 市场情绪 20%。只有估值与情绪同时进入极端区才触发行动，避免在上涨途中盲目逃顶，也避免在下跌途中一次性抄底。
            </p>
          </div>
        </div>
        </div>
      </div>

      <div data-pdf-page="details" className="bg-[#f5f6f3] px-5 py-6 sm:px-8 sm:py-7">
        <ValuationTable anchors={brief.anchors} />

        <div data-pdf-block className="mt-7">
          <ReportHeading index="03" title="市场情绪只做确认" />
          <div className="grid grid-cols-2 border-l border-t border-[#10263b]/14 sm:grid-cols-4">
            <ReportMetric label="上涨家数占比" value={`${brief.breadthPercent.toFixed(1)}%`} note={brief.breadthPercent >= 70 ? '叫好声偏高' : brief.breadthPercent <= 30 ? '低迷扩散' : '涨跌分化'} />
            <ReportMetric label="正向板块占比" value={`${(data.sectors.positiveRatio * 100).toFixed(1)}%`} note="观察乐观扩散" />
            <ReportMetric label="资金强弱" value={`${brief.normalizedFlow.toFixed(0)}/100`} note={brief.normalizedFlow >= 65 ? '流入偏强' : brief.normalizedFlow <= 35 ? '流出偏强' : '方向有限'} />
            <ReportMetric label="最强指数" value={brief.strongest?.name || '--'} note={brief.strongest ? formatSignedPercent(brief.strongest.changePercent) : '行情待接入'} />
          </div>
          <p className="mt-3 text-[9px] leading-4 text-[#10263b]/46">上涨家数、板块扩散与资金强弱用于判断市场是否“一致叫好”或“普遍低迷”；它们不能脱离长期估值单独构成卖出或买入理由。</p>
        </div>

        <div data-pdf-block className="mt-7">
          <ReportHeading index="04" title="触发条件与行动清单" />
          <div className="border-y border-[#10263b]/16">
            {brief.watchItems.map((item, index) => (
              <ReportWatchRow key={item.title} index={index + 1} item={item} />
            ))}
          </div>
        </div>

        <footer data-pdf-block className="mt-7 border-t border-[#10263b]/18 pt-4 text-[9px] leading-4 text-[#10263b]/46">
          <p><strong className="text-[#10263b]/72">数据说明：</strong>估值截至 {formatDateTime(marketTimestamp, true)}；报告生成于 {formatDateTime(data.generatedAt, true)}。PB 分位反映相对历史位置，不等同企业内在价值。</p>
          <p className="mt-1"><strong className="text-[#10263b]/72">行动纪律：</strong>逃顶与抄底均为概率预警，只处理偏离目标仓位的部分；高估时分批再平衡，低估时按风险预算分批投入，不使用一次性清仓或满仓表达。</p>
          <p className="mt-1"><strong className="text-[#10263b]/72">风险声明：</strong>{data.summary.disclaimer}</p>
        </footer>
      </div>
    </section>
  );
});

function SourceBoard({ sources, disclaimer }: { sources: MarketIntelligence['sources']; disclaimer: string }) {
  return (
    <section className="mt-7 border-t border-white/10 pt-6">
      <SectionHeading eyebrow="Data Lineage" title="来源与校验状态" icon={<Database size={15} />} />
      <div className="grid gap-px overflow-hidden border border-white/10 bg-white/10 md:grid-cols-2">
        {sources.map((source) => (
          <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="flex items-start gap-3 bg-[#07080a] p-4 transition hover:bg-white/[0.045]">
            {source.ok ? <CheckCircle2 className="mt-0.5 shrink-0 text-[#75e6b1]" size={14} /> : <TriangleAlert className="mt-0.5 shrink-0 text-[#d6b566]" size={14} />}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white/76">{source.label}</p>
              <p className="mt-1 text-xs text-white/38">{source.provider}</p>
              <p className="mt-1 text-[11px] leading-5 text-white/28">{source.note}</p>
            </div>
            <ArrowUpRight className="ml-auto shrink-0 text-white/25" size={13} />
          </a>
        ))}
      </div>
      <p className="mt-4 text-xs leading-5 text-white/28">{disclaimer}</p>
    </section>
  );
}

function MarketDisciplineMotto() {
  return (
    <section
      aria-labelledby="market-discipline-title"
      className="mt-12 border-y border-[#d6b566]/25 bg-[#d6b566]/[0.025]"
    >
      <div className="grid gap-7 px-5 py-8 sm:px-7 sm:py-10 lg:grid-cols-[230px_1fr] lg:gap-10 lg:px-9">
        <div className="border-b border-[#d6b566]/20 pb-6 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-9">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#d6b566]">
            <ShieldCheck size={15} /> Market Discipline
          </div>
          <h2 id="market-discipline-title" className="mt-3 text-xl font-semibold text-white">
            永恒的风险提醒
          </h2>
          <p className="mt-3 text-xs leading-5 text-white/34">
            先求生存，再谈收益。仓位、杠杆与谦逊，是穿越周期的底线。
          </p>
        </div>

        <blockquote className="min-w-0">
          <p className="text-sm leading-7 text-white/62 sm:text-[15px] sm:leading-8">
            先算失败的后果，再算成功的收益。即便某笔交易拥有60%对40%的胜率优势，一旦违背凯利公式进行过度下注，在长期的方差波动下，最终结果必然是资金归零。无论交易员的个人才华多么出众，一旦无视仓位管理与杠杆风险，市场将会让自以为天才的人，为其傲慢付出惨痛的代价。
          </p>
          <p className="mt-6 border-l-2 border-[#d6b566] pl-4 text-lg font-semibold leading-8 text-[#ead59d] sm:text-xl">
            投资的第一条准则是永远不要亏损；第二条准则是永远不要忘记第一条。
          </p>
          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-[9px] uppercase tracking-[0.14em] text-white/24">
              <span>Capital Preservation</span>
              <span>Position Sizing</span>
              <span>Leverage Control</span>
              <span>Humility</span>
            </div>
            <MarketRiskWhitepaperLauncher />
          </div>
        </blockquote>
      </div>
    </section>
  );
}

function StatusPill({ data, loadState, latestAt }: { data: MarketIntelligence | null; loadState: AsyncState; latestAt: string }) {
  const live = data?.dataMode === 'live';
  return (
    <div className="inline-flex h-9 items-center gap-2 border border-white/10 bg-white/[0.035] px-3 text-xs text-white/48">
      <span className={`h-2 w-2 ${live ? 'bg-[#75e6b1]' : 'bg-[#d6b566]'}`} />
      {loadState === 'loading' ? '正在更新' : `每 3 秒轮询 · ${latestAt}`}
    </div>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-9 w-9 items-center justify-center border border-white/10 bg-white/[0.035] text-white/58 transition hover:border-[#69d5ff]/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function SectionHeading({ icon, eyebrow, title }: { icon: React.ReactNode; eyebrow: string; title: string }) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#69d5ff]/70">{icon}{eyebrow}</div>
      <h2 className="mt-2 text-xl font-semibold text-white">{title}</h2>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0b0d0f] px-3 py-3">
      <p className="text-[9px] uppercase text-white/28">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white/74">{value}</p>
    </div>
  );
}

function ReportIndexStrip({ indices }: { indices: MarketIndexSnapshot[] }) {
  if (!indices.length) {
    return <p data-pdf-block className="border-b border-[#10263b]/14 bg-[#eef0ec] px-6 py-5 text-[11px] text-[#10263b]/48">今日主要指数行情暂未接入。</p>;
  }

  const visibleIndices = indices.slice(0, 5);
  const indexTimestamps = visibleIndices
    .map((index) => index.updatedAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  const latestTimestamp = indexTimestamps[indexTimestamps.length - 1];

  return (
    <div data-pdf-block className="border-b border-[#10263b]/14 bg-[#eef0ec] px-4 pb-4 pt-3 sm:px-6">
      <div className="mb-2.5 flex items-center justify-between border-b border-[#10263b]/12 pb-2">
        <div className="flex items-center gap-2">
          <span className="h-3 w-0.5 bg-[#b28e3e]" />
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#8b6e2e]">今日主要指数</p>
        </div>
        <p className="font-mono text-[8px] text-[#10263b]/38">数据截至 {formatDateTime(latestTimestamp, true)}</p>
      </div>
      <div className="grid border-l border-t border-[#10263b]/12" style={{ gridTemplateColumns: `repeat(${visibleIndices.length}, minmax(0, 1fr))` }}>
        {visibleIndices.map((index) => {
          const changeTone = index.changePercent > 0.03
            ? 'text-[#a33333]'
            : index.changePercent < -0.03
              ? 'text-[#147557]'
              : 'text-[#10263b]/68';
          return (
            <div key={index.id} className="min-w-0 overflow-visible border-b border-r border-[#10263b]/12 bg-[#f8f8f4] px-3 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p
                    className="min-h-[20px] overflow-visible whitespace-nowrap py-px text-[10px] font-semibold leading-[18px] text-[#10263b]"
                    style={{ fontFamily: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif' }}
                  >
                    {index.name}
                  </p>
                  <p className="mt-0.5 font-mono text-[7px] text-[#10263b]/38">{index.code} · {index.region}</p>
                </div>
                <span className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${index.validation.status === 'verified' ? 'bg-[#62c9a5]' : 'bg-[#d8bd79]'}`} />
              </div>
              <div className="mt-3">
                <p className={`whitespace-nowrap font-mono text-[14px] font-semibold ${changeTone}`}>{formatNumber(index.price)}</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="whitespace-nowrap font-mono text-[7px] text-[#10263b]/34">涨跌额 {formatSignedNumber(index.change, 2)}</p>
                  <p className={`shrink-0 whitespace-nowrap font-mono text-[8px] font-semibold ${changeTone}`}>{formatSignedPercent(index.changePercent)}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReportMetric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="border-b border-r border-[#10263b]/14 bg-[#f5f6f3] px-3 py-3.5">
      <p className="text-[8px] font-semibold uppercase tracking-[0.1em] text-[#10263b]/42">{label}</p>
      <p className="mt-1.5 font-mono text-base font-semibold text-[#10263b]">{value}</p>
      <p className="mt-1 text-[9px] text-[#10263b]/42">{note}</p>
    </div>
  );
}

function ReportHeading({ index, title }: { index: string; title: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="font-mono text-xs font-semibold text-[#9b7b32]">{index}</span>
      <h3 className="text-lg font-semibold text-[#071b31]">{title}</h3>
      <span className="h-px flex-1 bg-[#0a2038]/15" />
    </div>
  );
}

function SignalGauge({
  label,
  score,
  status,
  tone,
}: {
  label: string;
  score: number;
  status: string;
  tone: 'positive' | 'warning';
}) {
  const value = Math.max(0, Math.min(100, score));
  const colors = tone === 'warning'
    ? { bar: 'bg-[#b44444]', text: 'text-[#963333]', track: 'bg-[#a33333]/10' }
    : { bar: 'bg-[#238467]', text: 'text-[#147557]', track: 'bg-[#147557]/10' };

  return (
    <div className="grid gap-2 py-2 sm:grid-cols-[92px_1fr_82px] sm:items-center">
      <div className="flex items-baseline justify-between gap-3 sm:block">
        <p className={`text-xs font-semibold ${colors.text}`}>{label}</p>
        <p className="font-mono text-lg font-semibold text-[#10263b] sm:mt-1">{Math.round(value)}<span className="text-[10px] text-[#10263b]/36">/100</span></p>
      </div>
      <div className={`relative h-2 ${colors.track}`}>
        <span className={`absolute inset-y-0 left-0 ${colors.bar}`} style={{ width: `${value}%` }} />
        <span className="absolute inset-y-[-3px] left-1/2 w-px bg-[#10263b]/28" />
      </div>
      <p className={`text-right text-[10px] font-semibold ${colors.text}`}>{status}</p>
    </div>
  );
}

function ValuationTable({ anchors }: { anchors: ValuationAnchorSnapshot[] }) {
  if (!anchors.length) {
    return (
      <div data-pdf-block className="mt-7">
        <ReportHeading index="02" title="宽基估值分位" />
        <p className="border-y border-[#10263b]/14 py-5 text-[11px] text-[#10263b]/48">当前市场尚未接入可比的长期 PB 历史数据。</p>
      </div>
    );
  }

  return (
    <div data-pdf-block className="mt-1">
      <ReportHeading index="02" title="宽基估值分位" />
      <ValuationTablePart anchors={anchors} />
    </div>
  );
}

function ValuationTablePart({ anchors }: { anchors: ValuationAnchorSnapshot[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-left text-[11px]">
        <thead>
          <tr className="border-y border-[#10263b]/18 text-[#10263b]/48">
            <th className="px-2 py-2.5 font-semibold">宽基指数</th>
            <th className="px-2 py-2.5 text-right font-semibold">当前 PB</th>
            <th className="px-2 py-2.5 text-right font-semibold">历史分位</th>
            <th className="px-2 py-2.5 text-right font-semibold">相对中枢</th>
            <th className="px-2 py-2.5 text-right font-semibold">估值状态</th>
          </tr>
        </thead>
        <tbody>
          {anchors.map((anchor) => {
            const percentile = anchor.current.pbPercentile;
            const tone = percentile >= 80 ? 'text-[#a33333]' : percentile <= 20 ? 'text-[#147557]' : percentile >= 60 ? 'text-[#a5683f]' : 'text-[#8b6e2e]';
            return (
              <tr key={anchor.id} className="border-b border-[#10263b]/10">
                <td className="px-2 py-2.5 font-semibold text-[#10263b]">{anchor.name}</td>
                <td className="px-2 py-2.5 text-right font-mono">{anchor.current.pb.toFixed(2)}x</td>
                <td className={`px-2 py-2.5 text-right font-mono font-semibold ${tone}`}>{percentile.toFixed(1)}%</td>
                <td className={`px-2 py-2.5 text-right font-mono ${anchor.current.premiumPercent >= 0 ? 'text-[#a33333]' : 'text-[#147557]'}`}>{formatSignedPercent(anchor.current.premiumPercent)}</td>
                <td className={`px-2 py-2.5 text-right font-semibold ${tone}`}>{getValuationBand(percentile)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReportWatchRow({ index, item }: { index: number; item: DailyBriefWatchItem }) {
  const tone = {
    positive: { dot: 'bg-[#147557]', text: 'text-[#147557]' },
    neutral: { dot: 'bg-[#b28e3e]', text: 'text-[#8b6e2e]' },
    warning: { dot: 'bg-[#a33333]', text: 'text-[#a33333]' },
  }[item.tone];
  return (
    <div className="grid gap-2 border-b border-[#10263b]/10 py-3 last:border-b-0 sm:grid-cols-[26px_1.05fr_0.75fr_1.5fr] sm:items-center">
      <span className="font-mono text-[10px] text-[#8b6e2e]">{String(index).padStart(2, '0')}</span>
      <p className="text-xs font-semibold text-[#10263b]">{item.title}</p>
      <div className={`flex items-center gap-1.5 text-[10px] font-semibold ${tone.text}`}>
        <span className={`h-1.5 w-1.5 ${tone.dot}`} /> {item.status}
      </div>
      <div>
        <p className="text-[10px] font-semibold text-[#10263b]/70">{item.current}</p>
        <p className="mt-0.5 text-[9px] leading-4 text-[#10263b]/46">{item.condition}</p>
      </div>
    </div>
  );
}

function LoadingPanel() {
  return (
    <div className="grid min-h-[560px] place-items-center border border-white/10 bg-[#050608]">
      <div className="text-center">
        <LoaderCircle className="mx-auto animate-spin text-[#69d5ff]" size={25} />
        <p className="mt-4 text-sm text-white/52">正在核对行情、资金、新闻与研报…</p>
      </div>
    </div>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mb-4 flex flex-col gap-3 border border-[#ff8585]/20 bg-[#ff8585]/7 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 text-sm text-[#ffb0b0]">
        <TriangleAlert className="mt-0.5 shrink-0" size={16} />
        <span>{message}</span>
      </div>
      <button type="button" onClick={onRetry} className="inline-flex h-9 items-center justify-center gap-2 border border-white/12 px-3 text-xs font-semibold text-white/72 hover:text-white">
        <RefreshCw size={14} /> 重试
      </button>
    </div>
  );
}

function buildDeepResearchPrompt(
  mode: MarketChartMode,
  target: ResearchTarget,
) {
  const researchTarget = target.kind === 'market'
    ? `${MARKET_META[mode].short}整体市场`
    : target.kind === 'index'
      ? `${target.name}指数（${target.code}）`
      : `${MARKET_META[mode].short} · ${target.name}板块`;
  const targetInstruction = target.kind === 'market'
    ? mode === 'china'
      ? '整体A股以中证全指为主要价格与长期估值锚，同时比较沪深300、中证500、中证A500、创业板综、科创50；必须指出全市场结论与局部宽基风险的差异。'
      : mode === 'hongkong'
        ? '整体港股以恒生指数与恒生综合指数为主要价格和估值锚，同时比较恒生科技与恒生中国企业指数；必须指出大盘、科技和中国企业板块估值分化，不能用单一指数代表全市场。'
        : mode === 'us'
          ? '整体美股以标普500为主要价格和估值锚，同时比较纳斯达克100、道琼斯工业指数和费城半导体指数；必须指出大盘、成长、蓝筹和半导体估值分化，不能用七巨头代表全市场。'
          : '研究整体市场，必须同时评价主要资产、内部赛道分化、流动性和风险溢价，不能用单一资产代表全市场。'
    : target.kind === 'index'
      ? `研究对象严格限定为${target.name}（代码${target.code}）。${target.description || ''} 价格、PE、PB、盈利、历史分位和信号均以该指数口径为主；可与${mode === 'china' ? '中证全指及A股同类宽基' : mode === 'hongkong' ? '恒生综合指数及港股同类宽基' : '标普500及美股同类宽基'}比较，但不得用其他指数数据替代目标指数。先核验指数代码与官方编制方。`
      : `研究“${target.name}”板块整体而非单家公司，并与全市场、同类板块及自身历史估值比较，说明龙头与普通公司的估值分化。`;
  const modeInstruction =
    mode === 'crypto'
      ? '加密资产没有股票式PE/PB，改用MVRV、实现市值、稳定币供给、ETF净流量、资金费率、期货基差、未平仓量、清算和链上活跃度；不得用A股数据替代。'
      : mode === 'us'
        ? '美股资金使用宽基/行业ETF流量、市场宽度、Put/Call、VIX、信用利差、回购和机构披露；注明13F等数据滞后，不得用A股资金替代。'
        : mode === 'hongkong'
          ? '港股重点核验恒生指数、恒生科技、南向资金、卖空成交、衍生品持仓、市场宽度和港元流动性；不得用A股资金替代。'
          : 'A股资金重点核验宽基/行业ETF申赎、融资融券、机构席位或大宗交易、市场宽度、股债风险溢价及长期资金；主力资金只是一种代理，不等同全部机构。';
  const researchDataInstruction = mode === 'crypto'
    ? '主动获取最新价格、现货和衍生品资金、ETF流量、链上指标、重要新闻与监管事件。'
    : '主动获取目标最新点位与涨跌、20/60/120/250日走势、PE/PB/股息率及1/3/5/10年历史分位、盈利增速、ROE、资金流、市场宽度、重要新闻和权威机构观点。';
  const prompt = [
    `你是中文机构市场策略研究员。研究“${researchTarget}”，为持有期3年以上的投资者输出通俗、可核验的Markdown报告。`,
    targetInstruction,
    `${researchDataInstruction} ${modeInstruction}`,
    '【输出硬规则】报告第一行必须是“## 一页结论”，不得先写前言、过程或免责声明。紧接一张Markdown表格，列为“指标｜当前读数｜评分/分位｜状态｜对投资者的含义｜截止日与来源”。按顺序必须包含：目标指数价格与当日涨跌、价格热度、PE及历史分位、PB及历史分位、股息率/盈利、逃顶指数、抄底指数、韭菜指数（大众破圈热度）、聪明钱方向、市场宽度、逆向立场、当前行动。缺失项保留并写“证据不足”，不得删除或猜数。',
    '表格后立即给“## 现在该怎么做”，只用一张表写：市场阶段、逆向立场（应该贪婪/略偏贪婪/中性/略偏恐惧/应该恐惧）、当前动作（停止追高/维持/分批再平衡/分批投入）、触发条件、失效条件。再用三句话概括：现在贵不贵、市场是否一致叫好或普遍低迷、为什么采取该动作。',
    '【评分定义】价格热度0-100综合20/60/120/250日均线偏离、RSI(14)、成交与一年价格分位。逃顶指数0-100：估值高位35%、技术过热20%、韭菜破圈与乐观一致性20%、聪明钱流出或价资背离15%、盈利/宽度恶化10%。抄底指数0-100：估值低位35%、技术超卖20%、大众冷落与市场恐慌20%、聪明钱企稳15%、盈利/宽度止跌10%。两者独立评分，不强制相加为100。',
    '“韭菜指数”是非官方的“大众破圈热度”，专门判断股票是否从专业投资圈扩散到平时不关注市场的小白和普通大众，不等同价格热度、估值或市场宽度。0-100综合：百度/微信等泛大众搜索趋势30%、非财经社媒与大众话题提及25%、新增开户/散户成交等参与代理20%、非财经媒体和情绪化标题15%、可靠调查或线下讨论代理10%。必须列出每个分项、原始证据和覆盖率；无法获得线下讨论时明确缺失，按可用权重重算并降低置信度，绝不凭感觉打分。0-20无人问津，20-40仅投资圈关注，40-60大众开始留意，60-80明显破圈，80-100全民热议。',
    '聪明钱只能写“代理方向”，至少交叉验证两类独立证据；单日主力净流入、单一ETF或滞后持仓不能直接称为机构一致行为。技术超买超卖至少由RSI、均线偏离和市场宽度交叉验证，仅多个指标同向且处于历史极端时使用“严重”。',
    `首屏之后再专业展开：1价格与估值；2逃顶/抄底评分拆解；3韭菜指数的大众破圈证据；4市场宽度、聪明钱和资金证据；5盈利质量与长期基本面；6技术趋势；7分批行动框架；8风险、失效条件、来源与数据缺口。整体市场报告另附${mode === 'china' ? '六个A股宽基' : mode === 'hongkong' ? '恒指、恒科、国企和恒生综合' : mode === 'us' ? '标普、纳指、道指和费城半导体' : '主要资产'}估值对比表；单指数报告只把同类指数作为比较基准。`,
    '严格区分已核验事实、合理推断和数据缺口。价格、估值、资金与新闻注明日期及可点击来源，优先指数公司、交易所和权威数据源；估值至少两种口径。不得使用前端快照或未核验缓存冒充证据。逃顶、抄底只是概率预警；便宜不等于见底，昂贵不等于马上见顶，证据冲突选“中性”。不提供日内指令、满仓/清仓建议或收益承诺。',
  ].filter(Boolean).join('\n\n');
  return prompt.slice(0, 4900);
}

function buildMarketMarkdown(
  data: MarketIntelligence,
  mode: MarketChartMode,
  deepReport: string,
  rotation?: MarketRotation,
  valuation?: AShareValuationSnapshot | null,
) {
  const brief = buildDailyBrief(data, mode, rotation, valuation);
  const anchorRows = brief.anchors.length
    ? brief.anchors.map((anchor) => `| ${anchor.name} | ${anchor.current.pb.toFixed(2)}x | ${anchor.current.pbPercentile.toFixed(1)}% | ${formatSignedPercent(anchor.current.premiumPercent)} | ${getValuationBand(anchor.current.pbPercentile)} |`)
    : ['| 暂无可比数据 | -- | -- | -- | -- |'];
  return [
    `# ${MARKET_META[mode].short}估值与逆向信号日报`,
    '',
    `- 生成时间：${formatDateTime(data.generatedAt, true)}`,
    `- 逃顶风险：${Math.round(brief.topRisk)}/100（${brief.topConfirmed ? '已触发' : '未触发'}）`,
    `- 抄底机会：${Math.round(brief.bottomOpportunity)}/100（${brief.bottomConfirmed ? '已触发' : '未触发'}）`,
    `- 数据置信度：${data.confidence}%（${data.confidenceLabel}）`,
    '',
    '## 今日逆向判断',
    '',
    `**${brief.contrarian.title}**`,
    '',
    `行动：${brief.contrarian.action}`,
    '',
    brief.contrarian.detail,
    '',
    '## 当前估值',
    '',
    `- 当前 PB：${brief.valuationAvailable ? `${brief.currentPb?.toFixed(2)}x` : '数据待接入'}`,
    `- 历史 PB 中枢：${brief.valuationAvailable ? `${brief.fairPb?.toFixed(2)}x` : '数据待接入'}`,
    `- PB 历史分位：${brief.valuationAvailable ? `${brief.pbPercentile.toFixed(1)}%（${getValuationBand(brief.pbPercentile)}）` : '数据待接入'}`,
    `- 短期估值温度：${brief.valuationAvailable ? `${brief.shortHeat.toFixed(0)}°（20日 ${formatSignedNumber(brief.shortHeatDelta, 1)}°）` : '数据待接入'}`,
    `- 市场情绪温度：${brief.crowdScore.toFixed(0)}°`,
    '',
    '## 逃顶与抄底雷达',
    '',
    `- **逃顶风险 ${Math.round(brief.topRisk)}/100**：${brief.topConfirmed ? '长期估值、短期温度与一致乐观已形成共振；只分批降低超配仓位。' : '全市场条件尚未同时满足。'}`,
    `- **抄底机会 ${Math.round(brief.bottomOpportunity)}/100**：${brief.bottomConfirmed ? '低估、低温与市场恐慌已形成共振；按风险预算分批投入。' : '全市场条件尚未同时满足。'}`,
    '- 计算口径：长期 PB 历史分位 50% + 短期估值温度 30% + 市场情绪 20%。',
    '',
    '## 宽基估值分位',
    '',
    '| 宽基指数 | 当前 PB | 历史分位 | 相对中枢 | 状态 |',
    '| --- | ---: | ---: | ---: | --- |',
    ...anchorRows,
    '',
    '## 情绪确认',
    '',
    `- 上涨家数占比：${brief.breadthPercent.toFixed(1)}%`,
    `- 正向板块占比：${(data.sectors.positiveRatio * 100).toFixed(1)}%`,
    `- 资金强弱：${brief.normalizedFlow.toFixed(0)}/100`,
    `- 最强指数：${brief.strongest ? `${brief.strongest.name} ${formatSignedPercent(brief.strongest.changePercent)}` : '数据暂缺'}`,
    '- 情绪只用于确认估值信号，不能脱离估值单独构成买卖理由。',
    '',
    '## 触发条件与行动清单',
    '',
    ...brief.watchItems.map((item, index) => `${index + 1}. **${item.title}｜${item.status}**：${item.current}。${item.condition}`),
    '',
    '## AI 深度研究状态',
    '',
    deepReport
      ? '完整研究已经生成。研究正文、引用来源与推理过程请前往 SparkFlow AI 助手查看。'
      : '本期尚未运行深度研究；日报不使用静态文案替代AI结论。',
    '',
    '## 风险声明',
    '',
    '逃顶与抄底是概率预警，不是顶部或底部断言。高估时只分批再平衡偏离目标仓位的部分，低估时只按风险预算分批投入。',
    '',
    data.summary.disclaimer,
  ].join('\n');
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
}

function formatChineseReportDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get('year')}年${byType.get('month')}月${byType.get('day')}日 · ${byType.get('weekday')}`;
}

function formatSignedPercent(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatSignedNumber(value: number, digits = 0) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function getValuationBand(percentile: number) {
  if (percentile <= 20) return '明显偏低';
  if (percentile <= 40) return '略偏低';
  if (percentile < 60) return '中性';
  if (percentile < 80) return '略偏高';
  return '明显偏高';
}

function formatMoney(value: number) {
  const amount = Math.abs(value);
  const sign = value >= 0 ? '+' : '-';
  if (amount >= 100_000_000) return `${sign}${(amount / 100_000_000).toFixed(2)} 亿`;
  if (amount >= 10_000) return `${sign}${(amount / 10_000).toFixed(1)} 万`;
  return `${sign}${amount.toFixed(0)}`;
}

function formatMarketValue(value: number, currency: MarketRotation['currency']) {
  const suffix = {
    CNY: '元',
    HKD: '港元',
    USD: '美元',
    USDT: ' USDT',
  }[currency];
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)} 万亿${suffix}`;
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)} 亿${suffix}`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)} 万${suffix}`;
  return `${value.toFixed(0)}${suffix}`;
}

function getRotationTitle(mode: MarketChartMode) {
  if (mode === 'china') return 'A 股行业资金流向';
  if (mode === 'hongkong') return '港股行业强弱';
  if (mode === 'us') return '美股行业强弱';
  return '加密资产赛道强弱';
}

function getRotationLoadingText(mode: MarketChartMode) {
  if (mode === 'china') return '正在加载 A 股行业主力资金';
  if (mode === 'hongkong') return '正在按港股样本市值聚合行业表现';
  if (mode === 'us') return '正在按美股样本市值聚合行业表现';
  return '正在聚合主流加密资产 24 小时赛道表现';
}

function buildChinaRotation(data: MarketIntelligence): MarketRotation {
  const source = data.sources.find((item) => item.id === 'sectors');
  const mapItem = (item: SectorPulse): MarketRotationItem => ({
    code: item.code,
    name: item.name,
    changePercent: item.changePercent,
    scaleValue: item.mainNetInflow,
    advanceRatio: item.mainNetRatio,
    memberCount: 1,
  });
  return {
    generatedAt: data.generatedAt,
    source: source?.provider || '东方财富',
    sourceUrl: source?.url || 'https://data.eastmoney.com/bkzj/',
    metric: 'fund-flow',
    currency: 'CNY',
    coverage: `东方财富行业主力净流入 · 覆盖 ${data.sectors.total} 个行业，展示双端 ${data.sectors.sampleSize} 个样本`,
    leaders: data.sectors.leaders.map(mapItem),
    laggards: data.sectors.laggards.map(mapItem),
  };
}

function buildRegionalRotation(
  payload: RegionalHeatmapResponse,
  currency: 'HKD' | 'USD',
): MarketRotation {
  const industries = new Map<string, RegionalHeatmapResponse['stocks']>();
  for (const stock of payload.stocks) {
    const name = stock.industry.trim() || '其他';
    const members = industries.get(name) || [];
    members.push(stock);
    industries.set(name, members);
  }

  const items = [...industries.entries()].flatMap(([name, members]) => {
    const marketCap = members.reduce((sum, stock) => sum + stock.marketCap, 0);
    if (!marketCap) return [];
    const weightedChange = members.reduce(
      (sum, stock) => sum + stock.changePercent * stock.marketCap,
      0,
    ) / marketCap;
    const advancers = members.filter((stock) => stock.changePercent > 0.03).length;
    return [{
      code: name,
      name,
      changePercent: weightedChange,
      scaleValue: marketCap,
      advanceRatio: members.length ? advancers / members.length * 100 : 0,
      memberCount: members.length,
    }];
  }).sort((left, right) => right.changePercent - left.changePercent);

  return {
    generatedAt: payload.generatedAt,
    source: payload.source,
    sourceUrl: payload.sourceUrl,
    metric: 'market-cap',
    currency,
    coverage: `${payload.coverage} · 按行业样本市值加权，展示涨跌强弱而非虚构资金净流入`,
    leaders: items.slice(0, 8),
    laggards: items.slice(-8).reverse(),
  };
}

function buildCryptoRotation(indices: MarketIndexSnapshot[]): MarketRotation | undefined {
  const categories = [
    { code: 'store-of-value', name: '储值资产', symbols: ['BTC'] },
    { code: 'smart-contracts', name: '智能合约', symbols: ['ETH'] },
    { code: 'exchange-ecosystem', name: '交易平台生态', symbols: ['BNB'] },
    { code: 'high-performance-l1', name: '高性能公链', symbols: ['SOL'] },
    { code: 'payments', name: '跨境支付', symbols: ['XRP'] },
    { code: 'meme', name: 'Meme', symbols: ['DOGE'] },
  ];
  const bySymbol = new Map(indices.map((item) => [item.code.toUpperCase(), item]));
  const items = categories.flatMap((category) => {
    const members = category.symbols
      .map((symbol) => bySymbol.get(symbol))
      .filter((item): item is MarketIndexSnapshot => Boolean(item));
    if (!members.length) return [];
    const totalTurnover = members.reduce((sum, item) => sum + (item.turnover || 0), 0);
    const weightedChange = totalTurnover
      ? members.reduce((sum, item) => sum + item.changePercent * (item.turnover || 0), 0) / totalTurnover
      : members.reduce((sum, item) => sum + item.changePercent, 0) / members.length;
    return [{
      code: category.code,
      name: category.name,
      changePercent: weightedChange,
      scaleValue: totalTurnover,
      advanceRatio: members.filter((item) => item.changePercent > 0.03).length / members.length * 100,
      memberCount: members.length,
    }];
  }).sort((left, right) => right.changePercent - left.changePercent);
  if (!items.length) return undefined;

  const updateTimes = indices
    .map((item) => item.updatedAt || '')
    .filter(Boolean)
    .sort();
  const updatedAt = updateTimes[updateTimes.length - 1];
  return {
    generatedAt: updatedAt || new Date().toISOString(),
    source: 'Binance + OKX',
    sourceUrl: 'https://www.binance.com/en/markets/overview',
    metric: 'turnover',
    currency: 'USDT',
    coverage: `主流加密资产 ${indices.length} 个 · 按 24 小时成交额聚合赛道表现，不等同于链上资金净流入`,
    leaders: items.slice(0, 3),
    laggards: items.slice(-3).reverse(),
  };
}

function formatDateTime(value?: string, withSeconds = false) {
  if (!value) return '时间未知';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined,
    hour12: false,
  }).format(date);
}
