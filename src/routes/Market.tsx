import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  ArrowUpRight,
  Bitcoin,
  Bot,
  CheckCircle2,
  ChevronDown,
  Circle,
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
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChinaMarketHeatmap } from '../components/ChinaMarketHeatmap';
import { PageTransition } from '../components/PageTransition';
import { TradingViewHeatmap } from '../components/TradingViewHeatmap';
import { buildAiPayload, loadIntegrationSettings, type NewsItem } from '../lib/integrations';

type MarketChartMode = 'china' | 'us' | 'crypto';

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

type ToolStep = {
  id: string;
  tool: string;
  status: 'running' | 'ok' | 'error';
  elapsedMs?: number;
};

type ResearchState = {
  sessionId: string;
  attemptId: string;
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
  running: false,
  connecting: false,
  report: '',
  liveText: '',
  tools: [],
  error: '',
  lastEventId: '',
  updatedAt: '',
};

const MARKET_META: Record<MarketChartMode, { label: string; short: string; chart: string; description: string }> = {
  china: {
    label: 'A 股与港股',
    short: '中国市场',
    chart: 'A 股大盘热力图',
    description: 'A 股全市场 · 重点板块增强 · 市值加权 · 当日涨跌',
  },
  us: {
    label: '美国市场',
    short: '美股市场',
    chart: '美股大盘热力图',
    description: '标普 500 成分股 · 行业分组 · 市值面积 · 当日涨跌',
  },
  crypto: {
    label: '加密市场',
    short: '加密市场',
    chart: '加密货币热力图',
    description: '主流加密资产 · 市值面积 · 24 小时涨跌 · 全天候市场',
  },
};

const researchStorageKey = (mode: MarketChartMode) => `sparkflow.market.research.v2.${mode}`;
const summaryStorageKey = (mode: MarketChartMode) => `sparkflow.market.summary.v2.${mode}`;

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
  const [activeMarket, setActiveMarket] = useState<MarketChartMode>('china');
  const [data, setData] = useState<MarketIntelligence | null>(null);
  const [loadState, setLoadState] = useState<AsyncState>('loading');
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [quickState, setQuickState] = useState<AsyncState>('idle');
  const [quickSummaries, setQuickSummaries] = useState<Record<MarketChartMode, string>>(() => ({
    china: window.localStorage.getItem(summaryStorageKey('china')) || '',
    us: window.localStorage.getItem(summaryStorageKey('us')) || '',
    crypto: window.localStorage.getItem(summaryStorageKey('crypto')) || '',
  }));
  const [research, setResearch] = useState<ResearchMap>(() => ({
    china: readStoredResearch('china'),
    us: readStoredResearch('us'),
    crypto: readStoredResearch('crypto'),
  }));
  const researchRef = useRef(research);
  const eventSourcesRef = useRef(new Map<MarketChartMode, EventSource>());
  const pollingRef = useRef(new Map<MarketChartMode, number>());
  const quoteRequestRef = useRef(false);
  const reportRef = useRef<HTMLDivElement | null>(null);

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
    const timer = window.setInterval(() => void refreshQuotes(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [Boolean(data)]);

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
  const activeResearch = research[activeMarket];
  const activeSummary = quickSummaries[activeMarket];

  const runVibeResearch = async () => {
    if (!data || activeResearch.running || activeResearch.connecting) return;
    const settings = loadIntegrationSettings();
    if (Boolean(settings.ai.apiKey.trim()) !== Boolean(settings.ai.model.trim())) {
      setActionMessage('请从右上角头像进入“设置”，同时填写 AI API Key 和模型名称。');
      return;
    }
    const prompt = buildDeepResearchPrompt(data, activeMarket);
    setActionMessage('');
    updateResearch(activeMarket, () => ({
      ...EMPTY_RESEARCH,
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

  const runQuickSummary = async () => {
    if (!data || quickState === 'loading') return;
    const settings = loadIntegrationSettings();
    if (!settings.ai.apiKey || !settings.ai.model) {
      setActionMessage('请先在右上角头像 → 设置中填写 AI API Key 和模型。');
      return;
    }
    setQuickState('loading');
    setActionMessage('');
    try {
      const payload = await requestJson<{ text: string }>('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildAiPayload(settings, buildQuickSummaryPrompt(data, activeMarket))),
      });
      const summary = payload.text || '模型没有返回内容。';
      setQuickSummaries((current) => ({ ...current, [activeMarket]: summary }));
      window.localStorage.setItem(summaryStorageKey(activeMarket), summary);
      setQuickState('success');
    } catch (requestError) {
      setQuickState('error');
      setActionMessage(requestError instanceof Error ? requestError.message : String(requestError));
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
          title: `${MARKET_META[activeMarket].short} 每日策略报告`,
          markdown: buildMarketMarkdown(data, activeMarket, activeResearch.report, activeSummary),
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
      const canvas = await html2canvas(reportRef.current, {
        scale: 1.7,
        backgroundColor: '#f3f0e7',
        useCORS: true,
        logging: false,
      });
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imageHeight = canvas.height * pageWidth / canvas.width;
      const image = canvas.toDataURL('image/jpeg', 0.94);
      let offset = 0;
      pdf.addImage(image, 'JPEG', 0, offset, pageWidth, imageHeight, undefined, 'FAST');
      while (imageHeight + offset > pageHeight) {
        offset -= pageHeight;
        pdf.addPage();
        pdf.addImage(image, 'JPEG', 0, offset, pageWidth, imageHeight, undefined, 'FAST');
      }
      const marketSlug: Record<MarketChartMode, string> = { china: 'China', us: 'US', crypto: 'Crypto' };
      pdf.save(`SparkFlow-${marketSlug[activeMarket]}-Market-${new Date().toISOString().slice(0, 10)}.pdf`);
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

          <div className="mb-5 flex w-full max-w-[620px] border border-white/10 bg-white/[0.035] p-1">
            {(Object.keys(MARKET_META) as MarketChartMode[]).map((mode) => (
              <button
                type="button"
                key={mode}
                onClick={() => setActiveMarket(mode)}
                className={`flex min-h-11 flex-1 items-center justify-center gap-2 px-4 text-sm font-semibold transition ${
                  activeMarket === mode ? 'bg-white text-black' : 'text-white/52 hover:text-white'
                }`}
              >
                {mode === 'china' ? <Landmark size={15} /> : mode === 'crypto' ? <Bitcoin size={15} /> : <Activity size={15} />}
                {MARKET_META[mode].label}
              </button>
            ))}
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
                <section className="min-h-[560px] overflow-hidden border border-white/10 bg-[#050608]">
                  <div className="flex h-[68px] items-center justify-between border-b border-white/10 px-4 sm:px-5">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <Activity size={16} className="text-[#69d5ff]" />
                        {MARKET_META[activeMarket].chart} · {activeMarket === 'china' ? '东方财富实时数据' : 'TradingView'}
                      </div>
                      <p className="mt-1 text-xs text-white/38">{MARKET_META[activeMarket].description}</p>
                    </div>
                    <a
                      href={
                        activeMarket === 'china'
                          ? 'https://quote.eastmoney.com/center/gridlist.html#hs_a_board'
                          : activeMarket === 'crypto'
                            ? 'https://cn.tradingview.com/heatmap/crypto/'
                            : 'https://cn.tradingview.com/heatmap/stock/?dataset=SPX500'
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-9 w-9 items-center justify-center text-white/50 transition hover:text-white"
                      aria-label={activeMarket === 'china' ? '在东方财富打开' : '在 TradingView 打开'}
                      title={activeMarket === 'china' ? '在东方财富打开' : '在 TradingView 打开'}
                    >
                      <ArrowUpRight size={17} />
                    </a>
                  </div>
                  <div className="h-[calc(100%-68px)] min-h-[500px]">
                    {activeMarket === 'china' ? (
                      <ChinaMarketHeatmap />
                    ) : (
                      <TradingViewHeatmap mode={activeMarket} />
                    )}
                  </div>
                </section>

                <VibeResearchPanel
                  mode={activeMarket}
                  data={data}
                  state={activeResearch}
                  onRun={() => void runVibeResearch()}
                />
              </div>

              {data.warning ? (
                <div className="mt-4 flex items-start gap-2 border border-[#d6b566]/20 bg-[#d6b566]/7 px-4 py-3 text-xs leading-5 text-[#ead9a6]/80">
                  <TriangleAlert className="mt-0.5 shrink-0" size={14} />
                  <span>{data.warning} {data.errors.join('；')}</span>
                </div>
              ) : null}

              <div className="mt-8 border-t border-white/10 pt-7">
                <SectionHeading eyebrow="Capital Rotation" title={activeMarket === 'china' ? 'A 股行业资金流向' : '跨市场资金风险偏好'} icon={<Gauge size={15} />} />
                {activeMarket !== 'china' ? (
                  <p className="-mt-2 mb-4 text-xs leading-5 text-white/36">
                    {activeMarket === 'crypto'
                      ? '当前免费数据源暂未提供统一口径的链上资金净流入，以下 A 股行业资金仅作为传统风险资产偏好的交叉参考，不冒充加密货币资金流。'
                      : '免费数据源暂未提供可靠的美股板块净流入金额，以下 A 股行业资金作为亚洲时段风险偏好的交叉参考，不冒充美股资金流。'}
                  </p>
                ) : null}
                <div className="grid gap-4 xl:grid-cols-2">
                  <SectorBoard title="资金流入前列" items={data.sectors.leaders} mode="leader" />
                  <SectorBoard title="资金流出前列" items={data.sectors.laggards} mode="laggard" />
                </div>
              </div>

              <div className="mt-7 grid gap-4 xl:grid-cols-2">
                <NewsBoard items={data.news} />
                <ResearchBoard items={data.reports} />
              </div>

              <section className="mt-8 border-y border-white/10 py-7">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <SectionHeading eyebrow="Daily Brief" title={`${MARKET_META[activeMarket].short}今日简报`} icon={<Newspaper size={15} />} />
                  <button
                    type="button"
                    onClick={() => void runQuickSummary()}
                    disabled={quickState === 'loading'}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#69d5ff]/30 bg-[#69d5ff]/8 px-4 text-xs font-semibold text-[#b8edff] transition hover:bg-[#69d5ff]/14 disabled:cursor-wait disabled:opacity-55"
                  >
                    {quickState === 'loading' ? <LoaderCircle size={15} className="animate-spin" /> : <Bot size={15} />}
                    {activeSummary ? '更新今日简报' : '生成今日简报'}
                  </button>
                </div>
                <div className="mt-4 min-h-[150px] border-l-2 border-[#69d5ff]/35 bg-white/[0.025] px-5 py-4">
                  {activeSummary ? (
                    <MarkdownContent content={activeSummary} tone="dark" />
                  ) : (
                    <p className="text-sm leading-7 text-white/38">
                      {activeMarket === 'crypto'
                        ? '根据主要币种、24 小时波动、市场新闻与 Vibe 主动检索结果生成简洁的加密市场总结。'
                        : '根据指数、板块资金、中文新闻与公开研报生成简洁的当日市场总结。'}
                    </p>
                  )}
                </div>
              </section>

              <MarketReport
                ref={reportRef}
                data={data}
                mode={activeMarket}
                deepReport={activeResearch.report}
                quickSummary={activeSummary}
              />

              <SourceBoard sources={data.sources} disclaimer={data.summary.disclaimer} />
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
}: {
  mode: MarketChartMode;
  data: MarketIntelligence;
  state: ResearchState;
  onRun: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const running = state.running || state.connecting;
  return (
    <aside className="flex min-h-[650px] flex-col border border-white/10 bg-[#090a0c]">
      <div className="border-b border-white/10 px-5 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#75e6b1]">
              <Bot size={14} /> Vibe-Trading Research
            </div>
            <h2 className="mt-2 text-xl font-semibold">{MARKET_META[mode].short}深度判断</h2>
          </div>
          <span className="border border-white/10 px-2 py-1 font-mono text-xs text-white/48">{data.summary.score}/100</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden border border-white/10 bg-white/10">
          <Metric label="跨市场环境" value={data.summary.scoreLabel} />
          <Metric label="数据置信" value={`${data.confidence}%`} />
          <Metric label="风险状态" value={data.summary.riskLevel} />
          <Metric label={mode === 'crypto' ? '估值代理' : '指数 PE'} value="研究核验" />
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-[#75e6b1]/35 bg-[#75e6b1]/10 px-4 text-sm font-semibold text-[#b8f5d7] transition hover:bg-[#75e6b1]/16 disabled:cursor-wait disabled:opacity-55"
        >
          {running ? <LoaderCircle size={16} className="animate-spin" /> : <Radar size={16} />}
          {state.connecting ? '正在连接研究引擎' : state.running ? '正在执行深度研究' : state.report ? '重新研究当前市场' : '启动 Vibe 深度研究'}
        </button>
      </div>

      {running || state.tools.length ? (
        <div className="border-b border-white/10">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="flex w-full items-center gap-2 px-5 py-3 text-left text-xs text-white/58 hover:text-white"
          >
            <ChevronDown size={14} className={expanded ? '' : '-rotate-90'} />
            {running ? <LoaderCircle size={13} className="animate-spin text-[#75e6b1]" /> : <CheckCircle2 size={13} className="text-[#75e6b1]" />}
            {running ? '研究路径正在运行' : `研究过程完成 · ${state.tools.length} 个步骤`}
          </button>
          {expanded ? (
            <div className="max-h-44 space-y-2 overflow-y-auto border-t border-white/8 px-5 py-3">
              {state.tools.map((tool) => (
                <div key={tool.id} className="flex items-center gap-2 text-[11px] text-white/46">
                  {tool.status === 'running' ? (
                    <LoaderCircle size={12} className="animate-spin text-[#d6b566]" />
                  ) : tool.status === 'error' ? (
                    <TriangleAlert size={12} className="text-[#ff8a8a]" />
                  ) : (
                    <Circle size={10} className="fill-[#75e6b1] text-[#75e6b1]" />
                  )}
                  <span className="truncate">{formatToolName(tool.tool)}</span>
                  {tool.elapsedMs ? <span className="ml-auto font-mono text-white/26">{(tool.elapsedMs / 1000).toFixed(1)}s</span> : null}
                </div>
              ))}
              {!state.tools.length ? <p className="text-xs text-white/34">正在规划研究路径…</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {state.report ? (
          <MarkdownContent content={state.report} tone="dark" />
        ) : state.liveText ? (
          <div className="whitespace-pre-wrap text-sm leading-7 text-white/54">{state.liveText}</div>
        ) : (
          <div className="space-y-4 text-sm leading-6 text-white/42">
            <p>
              {mode === 'crypto'
                ? '研究将主动检索币价趋势、ETF 与稳定币资金、合约杠杆、链上指标及监管事件，并把事实、推断和缺失证据分开呈现。'
                : '研究将主动检索大盘走势、新闻、板块资金、券商观点与指数估值口径，并把事实、推断和缺失证据分开呈现。'}
            </p>
            <ul className="space-y-2 border-l border-white/12 pl-4">
              <li>综合判断：趋势、广度、流动性与事件风险</li>
              <li>{mode === 'crypto' ? '周期判断：估值代理、杠杆拥挤与链上活跃度' : '估值判断：高估风险、低估机会与历史区间'}</li>
              <li>执行观察：关键点位、触发条件与失效条件</li>
            </ul>
          </div>
        )}
        {state.error ? <p className="mt-4 text-sm text-[#ff9f9f]">{state.error}</p> : null}
      </div>
    </aside>
  );
}

function IndexStrip({ indices }: { indices: MarketIndexSnapshot[] }) {
  return (
    <div className={`grid grid-flow-col auto-cols-[172px] gap-px overflow-x-auto border border-white/10 bg-white/10 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden xl:grid-flow-row ${indices.length >= 6 ? 'xl:grid-cols-6' : 'xl:grid-cols-5'}`}>
      {indices.map((item) => {
        const positive = item.changePercent >= 0;
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
              <p className="truncate font-mono text-lg font-semibold text-white">{formatNumber(item.price)}</p>
              <p className={`shrink-0 font-mono text-xs font-semibold ${positive ? 'text-[#ff8585]' : 'text-[#75e6b1]'}`}>
                {positive ? '+' : ''}{item.changePercent.toFixed(2)}%
              </p>
            </div>
          </a>
        );
      })}
    </div>
  );
}

function SectorBoard({ title, items, mode }: { title: string; items: SectorPulse[]; mode: 'leader' | 'laggard' }) {
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
      <div className="mt-5 grid gap-px overflow-hidden border border-white/10 bg-white/10 sm:grid-cols-2">
        {items.slice(0, 8).map((item) => (
          <div key={item.code} className="flex items-center justify-between gap-4 bg-[#090a0c] px-3.5 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white/78">{item.name}</p>
              <p className="mt-1 text-[10px] text-white/34">主力占比 {item.mainNetRatio.toFixed(2)}%</p>
            </div>
            <div className="shrink-0 text-right">
              <p className={`font-mono text-xs ${item.changePercent >= 0 ? 'text-[#ff8585]' : 'text-[#75e6b1]'}`}>
                {item.changePercent >= 0 ? '+' : ''}{item.changePercent.toFixed(2)}%
              </p>
              <p className="mt-1 font-mono text-[10px] text-white/38">{formatMoney(item.mainNetInflow)}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
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

const MarketReport = forwardRef<HTMLDivElement, {
  data: MarketIntelligence;
  mode: MarketChartMode;
  deepReport: string;
  quickSummary: string;
}>(function MarketReport({ data, mode, deepReport, quickSummary }, ref) {
  const indices = data.indices.filter((item) => item.market === mode);
  return (
    <section ref={ref} className="mt-9 overflow-hidden bg-[#f3f0e7] text-[#0a2038] shadow-[0_26px_100px_rgba(0,0,0,0.38)]">
      <div className="border-b-[5px] border-[#b29552] bg-[#071b31] px-6 py-7 text-white sm:px-9">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#d8bd79]">SparkFlow Investment Research</p>
            <h2 className="mt-3 text-2xl font-semibold sm:text-3xl">{MARKET_META[mode].short}每日策略报告</h2>
            <p className="mt-2 text-sm text-white/58">Market Intelligence · Vibe-Trading Deep Research</p>
          </div>
          <div className="text-left sm:text-right">
            <p className="font-mono text-3xl font-semibold text-[#e7cf92]">{data.summary.score}</p>
            <p className="mt-1 text-[10px] uppercase text-white/45">Cross-market environment score</p>
          </div>
        </div>
      </div>
      <div className="px-6 py-7 sm:px-9">
        <div className="grid gap-px overflow-hidden border border-[#0a2038]/15 bg-[#0a2038]/15 sm:grid-cols-3">
          <ReportMetric label="市场立场" value={data.summary.stance} />
          <ReportMetric label="风险水平" value={data.summary.riskLevel} />
          <ReportMetric label="数据置信度" value={`${data.confidence}% · ${data.confidenceLabel}`} />
        </div>
        <div className="mt-7">
          <ReportHeading index="01" title={mode === 'crypto' ? '主要币种快照' : '主要指数快照'} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-y border-[#0a2038]/20 text-[#0a2038]/58">
                  <th className="px-2 py-2.5 font-semibold">{mode === 'crypto' ? '资产' : '指数'}</th>
                  <th className="px-2 py-2.5 font-semibold">{mode === 'crypto' ? '美元价格' : '点位'}</th>
                  <th className="px-2 py-2.5 font-semibold">{mode === 'crypto' ? '24h 涨跌' : '涨跌'}</th>
                  <th className="px-2 py-2.5 font-semibold">交叉校验</th>
                  <th className="px-2 py-2.5 font-semibold">{mode === 'crypto' ? '研究口径' : '估值口径'}</th>
                </tr>
              </thead>
              <tbody>
                {indices.map((item) => (
                  <tr key={item.id} className="border-b border-[#0a2038]/10">
                    <td className="px-2 py-2.5 font-semibold">{item.name}{item.proxyFor ? '（代理）' : ''}</td>
                    <td className="px-2 py-2.5 font-mono">{formatNumber(item.price)}</td>
                    <td className={`px-2 py-2.5 font-mono ${item.changePercent >= 0 ? 'text-[#a33333]' : 'text-[#147557]'}`}>
                      {item.changePercent >= 0 ? '+' : ''}{item.changePercent.toFixed(2)}%
                    </td>
                    <td className="px-2 py-2.5">{item.validation.status === 'verified' ? '双源通过' : '单源/待复核'}</td>
                    <td className="px-2 py-2.5">{mode === 'crypto' ? '链上与衍生品由 Vibe 核验' : '由 Vibe 检索核验'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="mt-8">
          <ReportHeading index="02" title="Vibe-Trading 深度判断" />
          {deepReport ? <MarkdownContent content={deepReport} tone="report" /> : <ReportPlaceholder text="尚未运行深度研究。报告不会用静态文案替代 AI 结论。" />}
        </div>
        <div className="mt-8">
          <ReportHeading index="03" title="今日简报" />
          {quickSummary ? <MarkdownContent content={quickSummary} tone="report" /> : <ReportPlaceholder text="尚未生成今日简报。" />}
        </div>
        <div className="mt-8 border-t border-[#0a2038]/20 pt-5 text-[10px] leading-5 text-[#0a2038]/55">
          <strong className="text-[#0a2038]">风险声明：</strong>{data.summary.disclaimer}
          行情、资金、新闻与研报可能存在延迟、口径差异及来源偏差。指数估值必须由原始发布方或 Vibe 检索结果复核。
        </div>
      </div>
    </section>
  );
});

function MarkdownContent({ content, tone }: { content: string; tone: 'dark' | 'report' }) {
  const dark = tone === 'dark';
  return (
    <div className={`min-w-0 text-sm leading-7 ${dark ? 'text-white/68' : 'text-[#0a2038]/82'}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className={`mb-4 mt-7 text-2xl font-semibold ${dark ? 'text-white' : 'text-[#071b31]'}`}>{children}</h1>,
          h2: ({ children }) => <h2 className={`mb-3 mt-7 border-b pb-2 text-lg font-semibold ${dark ? 'border-white/10 text-white' : 'border-[#0a2038]/15 text-[#071b31]'}`}>{children}</h2>,
          h3: ({ children }) => <h3 className={`mb-2 mt-5 font-semibold ${dark ? 'text-white/90' : 'text-[#071b31]'}`}>{children}</h3>,
          p: ({ children }) => <p className="my-3">{children}</p>,
          ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-5">{children}</ol>,
          strong: ({ children }) => <strong className={dark ? 'font-semibold text-white' : 'font-semibold text-[#071b31]'}>{children}</strong>,
          blockquote: ({ children }) => <blockquote className={`my-4 border-l-2 pl-4 ${dark ? 'border-[#69d5ff]/40 text-white/52' : 'border-[#b29552] text-[#0a2038]/65'}`}>{children}</blockquote>,
          table: ({ children }) => <div className="my-5 overflow-x-auto"><table className="w-full min-w-[560px] border-collapse text-left text-xs">{children}</table></div>,
          th: ({ children }) => <th className={`border px-3 py-2 font-semibold ${dark ? 'border-white/12 bg-white/[0.04] text-white' : 'border-[#0a2038]/18 bg-[#071b31]/6 text-[#071b31]'}`}>{children}</th>,
          td: ({ children }) => <td className={`border px-3 py-2 align-top ${dark ? 'border-white/10' : 'border-[#0a2038]/15'}`}>{children}</td>,
          a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer" className={dark ? 'text-[#69d5ff] underline' : 'text-[#245b86] underline'}>{children}</a>,
          hr: () => <hr className={`my-6 ${dark ? 'border-white/10' : 'border-[#0a2038]/15'}`} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

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

function StatusPill({ data, loadState, latestAt }: { data: MarketIntelligence | null; loadState: AsyncState; latestAt: string }) {
  const live = data?.dataMode === 'live';
  return (
    <div className="inline-flex h-9 items-center gap-2 border border-white/10 bg-white/[0.035] px-3 text-xs text-white/48">
      <span className={`h-2 w-2 ${live ? 'bg-[#75e6b1]' : 'bg-[#d6b566]'}`} />
      {loadState === 'loading' ? '正在更新' : `每秒轮询 · ${latestAt}`}
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

function ReportMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#f3f0e7] px-4 py-4">
      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#0a2038]/45">{label}</p>
      <p className="mt-2 text-sm font-semibold text-[#071b31]">{value}</p>
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

function ReportPlaceholder({ text }: { text: string }) {
  return <div className="border border-[#0a2038]/15 bg-white/35 px-4 py-5 text-sm text-[#0a2038]/55">{text}</div>;
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

function buildDeepResearchPrompt(data: MarketIntelligence, mode: MarketChartMode) {
  const indices = data.indices
    .filter((item) => item.market === mode)
    .map(({ name, price, changePercent, updatedAt, validation, proxyFor }) => ({ name, price, changePercent, updatedAt, validation, proxyFor }));
  const evidence = {
    market: MARKET_META[mode].label,
    generatedAt: data.generatedAt,
    indices,
    aShareBreadth: data.breadth,
    aShareSectorLeaders: data.sectors.leaders.slice(0, 6),
    aShareSectorLaggards: data.sectors.laggards.slice(0, 5),
    chineseNews: data.news.slice(0, 8).map(({ title, source, publishedAt, url, weight }) => ({ title, source, publishedAt, url, weight })),
    brokerReports: data.reports.slice(0, 6).map(({ title, stockName, institution, publishedAt, rating, url }) => ({ title, stockName, institution, publishedAt, rating, url })),
    sourceStatus: data.sources.map(({ id, provider, ok, note }) => ({ id, provider, ok, note })),
  };
  const modeInstruction =
    mode === 'crypto'
      ? '注意：加密资产没有股票式 PE/PB。请自行检索并交叉验证现货与期货成交、资金费率、未平仓合约、强平、稳定币供给、链上活跃度、MVRV 等估值代理、美国现货 ETF 净流量和监管事件。下方 A 股板块资金和券商研报只能作为传统风险偏好参考，不得冒充加密市场数据。'
      : mode === 'us'
        ? '注意：下方板块净流入是 A 股数据，只能作为亚洲时段风险偏好交叉参考，不得冒充美股板块资金；请自行检索美股行业 ETF 或权威美股资金流数据。MAGS 是 Magnificent 7 ETF 代理，不是官方七巨头指数。'
        : '注意：同时覆盖 A 股与港股，清楚区分沪深市场和港股的交易时段、估值与资金口径。';
  const prompt = [
    `你是 Vibe-Trading 的中文机构市场策略研究员。请研究“${MARKET_META[mode].label}”，最终输出精美、可直接发布的中文 Markdown 策略报告。`,
    mode === 'crypto'
      ? '先使用可用研究工具主动获取主要币种价格、市场总市值与主导率、现货和衍生品资金、ETF 流量、链上指标、重要新闻与监管事件。不要只复述下方快照。'
      : '先使用可用研究工具主动获取当前大盘、主要指数、板块资金流入流出、最近重要新闻、券商或权威机构观点，以及指数 PE/PB、历史分位等估值信息。不要只复述下方快照。',
    '严格区分：已核验事实、合理推断、待核验信息。任何 PE、资金净流入金额、点位和新闻都必须注明日期与来源；没有可靠数据就明确写“未取得可靠口径”，不得编造。',
    '报告开头先给出“执行摘要”与综合结论：偏多/中性/偏空、风险等级、估值状态（高估/合理/低估/证据不足）、最重要机会与最大风险。',
    '随后按以下结构输出：1. 指数与市场广度；2. 估值与历史分位；3. 板块资金流；4. 新闻与研报交叉验证；5. 高估风险或低估机会；6. 未来 1-5 个交易日的三种情景；7. 关键观察点位与失效条件；8. 数据缺口与风险声明。',
    modeInstruction,
    '不要给确定收益承诺，不要把规则评分当成事实。报告末尾给出明确但克制的观察建议。',
    `前端已核验快照：\n${JSON.stringify(evidence, null, 2)}`,
  ].join('\n\n');
  return prompt.slice(0, 4950);
}

function buildQuickSummaryPrompt(data: MarketIntelligence, mode: MarketChartMode) {
  const evidence = {
    market: MARKET_META[mode].label,
    generatedAt: data.generatedAt,
    indices: data.indices.filter((item) => item.market === mode).map(({ name, price, changePercent, proxyFor }) => ({ name, price, changePercent, proxyFor })),
    breadth: data.breadth,
    sectorLeaders: data.sectors.leaders.slice(0, 4),
    sectorLaggards: data.sectors.laggards.slice(0, 4),
    news: data.news.slice(0, 6).map(({ title, source, publishedAt }) => ({ title, source, publishedAt })),
  };
  return [
    `请基于下方已提供证据，为“${MARKET_META[mode].label}”输出中文 Markdown 今日简报。`,
    '只写四部分：一句话结论、指数表现、资金与新闻、明日观察。控制在 450 字以内。事实与推断分开；不得补写未提供的数据。',
    mode === 'crypto'
      ? 'A 股板块资金只能作为传统风险偏好参考，不得写成加密货币资金流；加密市场按 24 小时口径表述。'
      : mode === 'us'
        ? 'A 股板块资金只能作为跨市场参考，不得写成美股资金流。'
        : '',
    JSON.stringify(evidence, null, 2),
  ].filter(Boolean).join('\n\n');
}

function buildMarketMarkdown(data: MarketIntelligence, mode: MarketChartMode, deepReport: string, quickSummary: string) {
  const indices = data.indices.filter((item) => item.market === mode);
  return [
    `# ${MARKET_META[mode].short}每日策略报告`,
    '',
    `- 生成时间：${formatDateTime(data.generatedAt, true)}`,
    `- 跨市场环境分：${data.summary.score}/100（${data.summary.scoreLabel}）`,
    `- 市场立场：${data.summary.stance}`,
    `- 数据置信度：${data.confidence}%（${data.confidenceLabel}）`,
    '',
    `## ${mode === 'crypto' ? '主要币种' : '主要指数'}`,
    ...indices.map((item) => `- ${item.name}${item.proxyFor ? '（代理）' : ''}：${formatNumber(item.price)}，${item.changePercent >= 0 ? '+' : ''}${item.changePercent.toFixed(2)}%`),
    '',
    '## Vibe-Trading 深度判断',
    '',
    deepReport || '尚未运行深度研究。',
    '',
    '## 今日简报',
    '',
    quickSummary || '尚未生成今日简报。',
    '',
    '## 风险声明',
    '',
    data.summary.disclaimer,
  ].join('\n');
}

function formatToolName(tool: string) {
  const labels: Record<string, string> = {
    run_swarm: '运行多智能体研究',
    web_search: '检索公开信息',
    search_web: '检索公开信息',
    market_snapshot: '获取市场快照',
    get_market_snapshot: '获取市场快照',
    fetch_market_data: '获取市场数据',
    search_research_reports: '检索公开研报',
    calculate_metrics: '计算市场指标',
  };
  return labels[tool] || tool.replace(/_/g, ' ');
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
}

function formatMoney(value: number) {
  const amount = Math.abs(value);
  const sign = value >= 0 ? '+' : '-';
  if (amount >= 100_000_000) return `${sign}${(amount / 100_000_000).toFixed(2)} 亿`;
  if (amount >= 10_000) return `${sign}${(amount / 10_000).toFixed(1)} 万`;
  return `${sign}${amount.toFixed(0)}`;
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
