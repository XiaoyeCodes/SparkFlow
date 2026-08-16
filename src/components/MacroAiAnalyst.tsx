import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, BrainCircuit, CalendarDays, Check, ChevronRight, Clock3, Copy, History, RefreshCw, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { buildAiPayload, loadIntegrationSettings } from '../lib/integrations';
import { buildMacroAiPrompt } from '../lib/macroAiPrompt';
import './MacroAiAnalyst.css';

export type MacroAiRunState = 'idle' | 'connecting' | 'analyzing' | 'completed' | 'error';

type StoredMessage = {
  role: string;
  content: string;
  linked_attempt_id?: string;
};

type StoredReport = {
  id: string;
  markdown: string;
  generatedAt: string;
  title: string;
  status: 'running' | 'completed';
  sessionId?: string;
  attemptId?: string;
};

type AnalystView = 'home' | 'report';

const LEGACY_REPORT_STORAGE_KEY = 'sparkflow.macro-ai-report.v1';
const REPORT_HISTORY_STORAGE_KEY = 'sparkflow.macro-ai-history.v2';
const MAX_REPORT_HISTORY = 20;
const ANALYSIS_STAGES = [
  '正在导入全球宏观经济数据',
  '正在引入神经网络引擎分析',
  '跨市场神经图谱正在成形',
  '市场风险传导路径推演中',
  '正在执行多资产量化演算',
  '宏观经济情报生成中',
] as const;
type GatewayPoint = readonly [number, number];

const GATEWAY_LANES = [
  [[0, 5], [13, 9], [27, 17], [39, 25]],
  [[0, 15], [14, 17], [28, 21], [39, 27]],
  [[0, 24], [15, 24], [29, 25], [39, 29]],
  [[0, 36], [15, 36], [29, 35], [39, 31]],
  [[0, 45], [14, 43], [28, 39], [39, 33]],
  [[0, 55], [13, 51], [27, 43], [39, 35]],
] as const satisfies readonly (readonly GatewayPoint[])[];

const GATEWAY_NODES = [
  [5, 8], [8, 51], [13, 19], [14, 40], [20, 12], [20, 29], [21, 47],
  [27, 19], [27, 40], [33, 24], [33, 35], [37, 28], [37, 32],
] as const satisfies readonly GatewayPoint[];

const GATEWAY_EDGES = [
  [0, 2], [1, 3], [2, 4], [2, 5], [3, 5], [3, 6], [4, 7], [5, 7], [5, 8],
  [6, 8], [7, 9], [7, 10], [8, 9], [8, 10], [9, 11], [10, 12], [11, 12],
] as const;

function gatewayPath(points: readonly GatewayPoint[], mirrored = false) {
  return points
    .map(([x, y], index) => `${index ? 'L' : 'M'} ${mirrored ? 100 - x : x} ${y}`)
    .join(' ');
}

function extractReportTitle(markdown: string) {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]
    || markdown.match(/^##\s+(.+)$/m)?.[1]
    || '全球宏观市场快照简报';
  return heading.replace(/[*_`#]/g, '').trim().slice(0, 42) || '全球宏观市场快照简报';
}

function normalizeStoredReport(value: unknown): StoredReport | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<StoredReport>;
  if (typeof candidate.generatedAt !== 'string') return null;
  const status = candidate.status === 'running' ? 'running' : 'completed';
  const markdown = typeof candidate.markdown === 'string' ? candidate.markdown : '';
  if (status === 'completed' && !markdown.trim()) return null;
  return {
    id: typeof candidate.id === 'string' ? candidate.id : `report-${candidate.generatedAt}`,
    markdown,
    generatedAt: candidate.generatedAt,
    title: status === 'running'
      ? '全球宏观经济分析生成中'
      : typeof candidate.title === 'string' && candidate.title.trim()
      ? candidate.title.trim()
      : extractReportTitle(markdown),
    status,
    sessionId: typeof candidate.sessionId === 'string' ? candidate.sessionId : undefined,
    attemptId: typeof candidate.attemptId === 'string' ? candidate.attemptId : undefined,
  };
}

function readStoredReports(): StoredReport[] {
  try {
    const historyValue = window.localStorage.getItem(REPORT_HISTORY_STORAGE_KEY);
    if (historyValue) {
      const parsed = JSON.parse(historyValue) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map(normalizeStoredReport)
          .filter((item): item is StoredReport => Boolean(item))
          .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))
          .slice(0, MAX_REPORT_HISTORY);
      }
    }

    const legacyValue = window.localStorage.getItem(LEGACY_REPORT_STORAGE_KEY);
    if (!legacyValue) return [];
    const legacyReport = normalizeStoredReport(JSON.parse(legacyValue));
    return legacyReport ? [legacyReport] : [];
  } catch {
    return [];
  }
}

function persistReports(reports: StoredReport[]) {
  try {
    window.localStorage.setItem(REPORT_HISTORY_STORAGE_KEY, JSON.stringify(reports.slice(0, MAX_REPORT_HISTORY)));
  } catch {
    // History persistence is a convenience; analysis must still complete if storage is unavailable.
  }
}

function upsertStoredReport(report: StoredReport) {
  const current = readStoredReports();
  const next = [report, ...current.filter((item) => item.id !== report.id)]
    .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))
    .slice(0, MAX_REPORT_HISTORY);
  persistReports(next);
  return next;
}

function removeStoredReport(id: string) {
  const next = readStoredReports().filter((item) => item.id !== id);
  persistReports(next);
  return next;
}

function readableError(value: unknown, fallback = '请求失败'): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const messages: string[] = value.map((item): string => readableError(item, '')).filter(Boolean);
    return messages.join('；') || fallback;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const message: string = readableError(record.message ?? record.msg ?? record.error ?? record.detail, '');
    if (message) {
      const location = Array.isArray(record.loc) ? record.loc.map(String).join('.') : '';
      return location ? `${location}：${message}` : message;
    }
    try {
      const serialized = JSON.stringify(value);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // Fall through to the human-readable fallback.
    }
  }
  return fallback;
}

function requestJson<T>(url: string, init?: RequestInit) {
  return fetch(url, init).then(async (response) => {
    const payload = await response.json().catch(() => ({})) as T & { detail?: unknown; message?: unknown; error?: unknown };
    if (!response.ok) {
      throw new Error(readableError(payload.detail ?? payload.message ?? payload.error, `请求失败：HTTP ${response.status}`));
    }
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

function normalizeMarkdown(value: string) {
  return value.trim()
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function formatReportDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '日期未知';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatReportClock(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function NeuralInference({ stage, elapsed }: { stage: string; elapsed: number }) {
  return (
    <div className="macro-ai-gateway" aria-label="AI 深空神经网络正在运行">
      <div className="macro-ai-gateway-depth depth-left"><i /><i /><i /><i /></div>
      <div className="macro-ai-gateway-depth depth-right"><i /><i /><i /><i /></div>
      <svg className="macro-ai-gateway-network" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="macro-ai-gateway-lane" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#4dcab6" stopOpacity=".04" />
            <stop offset=".58" stopColor="#5adfc7" stopOpacity=".34" />
            <stop offset="1" stopColor="#9dfff0" stopOpacity=".72" />
          </linearGradient>
          <linearGradient id="macro-ai-gateway-lane-mirror" x1="1" y1="0" x2="0" y2="0">
            <stop offset="0" stopColor="#4dcab6" stopOpacity=".04" />
            <stop offset=".58" stopColor="#5adfc7" stopOpacity=".34" />
            <stop offset="1" stopColor="#9dfff0" stopOpacity=".72" />
          </linearGradient>
          <linearGradient id="macro-ai-gateway-pulse" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#65d5ff" stopOpacity="0" />
            <stop offset=".48" stopColor="#7ce5ff" stopOpacity=".92" />
            <stop offset="1" stopColor="#59f0cf" stopOpacity="0" />
          </linearGradient>
          <filter id="macro-ai-gateway-glow"><feGaussianBlur stdDeviation=".85" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <filter id="macro-ai-particle-glow"><feGaussianBlur stdDeviation="1.6" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>

        <g className="macro-ai-gateway-grid">
          {[8, 18, 28, 38].map((x) => (
            <g key={x}>
              <line x1={x} y1="0" x2="39" y2="30" />
              <line x1={100 - x} y1="0" x2="61" y2="30" />
              <line x1={x} y1="60" x2="39" y2="30" />
              <line x1={100 - x} y1="60" x2="61" y2="30" />
            </g>
          ))}
          {[7, 16, 25, 35, 44, 53].map((y) => <line key={y} x1="0" y1={y} x2="100" y2={y} />)}
        </g>

        <g className="macro-ai-gateway-lanes">
          {GATEWAY_LANES.map((points, index) => (
            <g key={index} style={{ '--lane-delay': `${index * .13}s` } as CSSProperties}>
              <path className="lane-base lane-left" d={gatewayPath(points)} />
              <path className="lane-base lane-right" d={gatewayPath(points, true)} />
              <path className="lane-energy" pathLength="1" d={gatewayPath(points)} />
              <path className="lane-energy" pathLength="1" d={gatewayPath(points, true)} />
            </g>
          ))}
        </g>

        <g className="macro-ai-gateway-connectors">
          {GATEWAY_EDGES.map(([from, to], index) => {
            const [x1, y1] = GATEWAY_NODES[from];
            const [x2, y2] = GATEWAY_NODES[to];
            return (
              <g key={`${from}-${to}`} style={{ '--edge-delay': `${(index % 7) * .16}s` } as CSSProperties}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} />
                <line x1={100 - x1} y1={y1} x2={100 - x2} y2={y2} />
              </g>
            );
          })}
        </g>

        <g className="macro-ai-gateway-nodes" filter="url(#macro-ai-gateway-glow)">
          {GATEWAY_NODES.map(([x, y], index) => (
            <g key={`${x}-${y}`} style={{ '--node-delay': `${(index % 6) * .19}s` } as CSSProperties}>
              <circle cx={x} cy={y} r={index > 8 ? .48 : .34} />
              <circle cx={100 - x} cy={y} r={index > 8 ? .48 : .34} />
            </g>
          ))}
        </g>

        <g className="macro-ai-gateway-particles" filter="url(#macro-ai-particle-glow)">
          {[0, 2, 3, 5].map((laneIndex, index) => (
            <g key={laneIndex}>
              <circle r={index % 2 ? .32 : .42}>
                <animateMotion dur={`${1.8 + index * .23}s`} begin={`${index * -.41}s`} repeatCount="indefinite" path={gatewayPath(GATEWAY_LANES[laneIndex])} />
              </circle>
              <circle r={index % 2 ? .32 : .42}>
                <animateMotion dur={`${1.8 + index * .23}s`} begin={`${index * -.41}s`} repeatCount="indefinite" path={gatewayPath(GATEWAY_LANES[laneIndex], true)} />
              </circle>
            </g>
          ))}
        </g>

        <g className="macro-ai-gateway-aperture">
          <path d="M 39 14 C 35 21, 35 39, 39 46" />
          <path d="M 61 14 C 65 21, 65 39, 61 46" />
          <path d="M 41 19 C 38 25, 38 35, 41 41" />
          <path d="M 59 19 C 62 25, 62 35, 59 41" />
        </g>
      </svg>

      <div className="macro-ai-gateway-label label-left"><span>INPUT STREAM</span><i /> MIRROR NODE ARRAY · L</div>
      <div className="macro-ai-gateway-label label-right"><span>INPUT STREAM</span><i /> MIRROR NODE ARRAY · R</div>

      <div className="macro-ai-gateway-safe">
        <div className="macro-ai-gateway-coordinate coordinate-top">SYNTHETIC COGNITION / ONLINE</div>
        <div className="macro-ai-gateway-core">
          <span className="gateway-ring ring-one" />
          <span className="gateway-ring ring-two" />
          <span className="gateway-ring ring-three" />
          <span className="gateway-bracket bracket-left" />
          <span className="gateway-bracket bracket-right" />
          <div className="macro-ai-gateway-lens">
            <BrainCircuit size={37} strokeWidth={1.05} />
            <span className="macro-ai-gateway-orbit"><i /><b /></span>
          </div>
        </div>
        <div className="macro-ai-gateway-coordinate coordinate-bottom">CORE CHANNEL · 07</div>
      </div>

      <div className="macro-ai-stage-copy">
        <span><i /> NEURAL MARKET INFERENCE <i /></span>
        <strong>{stage}</strong>
        <small><b>{elapsed.toString().padStart(2, '0')}s</b><i /><span>多维市场信号正在并行计算</span><i /><span>CHANNELS SYMMETRIC</span></small>
      </div>
    </div>
  );
}

function MacroAiMarkdown({ content }: { content: string }) {
  return (
    <div className="macro-ai-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a>,
          table: ({ children }) => <div className="macro-ai-table-wrap"><table>{children}</table></div>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function MacroAiAnalyst({
  open,
  snapshot,
  onClose,
  onStateChange,
}: {
  open: boolean;
  snapshot: string;
  onClose: () => void;
  onStateChange?: (state: MacroAiRunState) => void;
}) {
  const initialHistory = useRef(readStoredReports());
  const [state, setState] = useState<MacroAiRunState>('idle');
  const [view, setView] = useState<AnalystView>('home');
  const [history, setHistory] = useState<StoredReport[]>(initialHistory.current);
  const [report, setReport] = useState('');
  const [generatedAt, setGeneratedAt] = useState('');
  const [stage, setStage] = useState<string>(ANALYSIS_STAGES[0]);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const liveTextRef = useRef('');
  const completedAnalysisIdsRef = useRef(new Set<string>());
  const activeAnalysisIdRef = useRef<string | null>(null);
  const stageIndexRef = useRef(0);
  const stateRef = useRef<MacroAiRunState>(state);
  const wasOpenRef = useRef(false);
  const mountedRef = useRef(true);

  const transitionState = useCallback((next: MacroAiRunState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const advanceStage = useCallback((nextIndex: number) => {
    const safeIndex = Math.max(0, Math.min(nextIndex, ANALYSIS_STAGES.length - 1));
    if (safeIndex < stageIndexRef.current) return;
    stageIndexRef.current = safeIndex;
    setStage(ANALYSIS_STAGES[safeIndex]);
  }, []);

  useEffect(() => onStateChange?.(state), [onStateChange, state]);
  useEffect(() => {
    persistReports(initialHistory.current);
  }, []);
  useEffect(() => {
    const syncHistory = () => setHistory(readStoredReports());
    const timer = window.setInterval(syncHistory, 1500);
    window.addEventListener('storage', syncHistory);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('storage', syncHistory);
    };
  }, []);
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!justOpened || stateRef.current === 'connecting' || stateRef.current === 'analyzing') return;
    setView('home');
    setError('');
    transitionState('idle');
  }, [open, transitionState]);
  useEffect(() => {
    if (state !== 'connecting' && state !== 'analyzing') return;
    const startedAt = Date.now() - elapsed * 1000;
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [state]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      eventSourceRef.current?.close();
    };
  }, []);

  const complete = useCallback((markdown: string, analysisId?: string, reveal = true) => {
    const normalized = normalizeMarkdown(markdown);
    if (!normalized) return;
    const resolvedId = analysisId || activeAnalysisIdRef.current || `report-${Date.now()}`;
    if (completedAnalysisIdsRef.current.has(resolvedId)) return;
    completedAnalysisIdsRef.current.add(resolvedId);
    const existing = readStoredReports().find((item) => item.id === resolvedId);
    const completedAt = new Date().toISOString();
    const completedReport: StoredReport = {
      id: resolvedId,
      markdown: normalized,
      generatedAt: existing?.generatedAt || completedAt,
      title: extractReportTitle(normalized),
      status: 'completed',
    };
    const next = upsertStoredReport(completedReport);
    if (!mountedRef.current) return;
    setHistory(next);
    if (!reveal || activeAnalysisIdRef.current !== resolvedId) return;
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setReport(normalized);
    setGeneratedAt(completedReport.generatedAt);
    setView('report');
    setStage('宏观经济情报生成完成');
    transitionState('completed');
  }, [transitionState]);

  const recoverReport = useCallback(async (sessionId: string, attemptId: string, analysisId: string, reveal = true) => {
    for (let index = 0; index < 240; index += 1) {
      if (completedAnalysisIdsRef.current.has(analysisId)) return;
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      try {
        const messages = await requestJson<StoredMessage[]>(`/api/vibe/research/messages?sessionId=${encodeURIComponent(sessionId)}`);
        const answer = messages.find((message) => message.role === 'assistant' && message.linked_attempt_id === attemptId);
        if (answer?.content) {
          complete(answer.content, analysisId, reveal);
          return;
        }
      } catch {
        // The SSE stream remains primary; polling only repairs a missed completion event.
      }
    }
  }, [complete]);

  const connectStream = useCallback((sessionId: string, analysisId: string, reveal = true) => new Promise<void>((resolve, reject) => {
    eventSourceRef.current?.close();
    const source = new EventSource(`/api/vibe/research/events?sessionId=${encodeURIComponent(sessionId)}`);
    eventSourceRef.current = source;
    let opened = false;
    const timeout = window.setTimeout(() => {
      if (opened) return;
      source.close();
      reject(new Error('AI 分析事件流连接超时'));
    }, 12_000);
    source.onopen = () => {
      opened = true;
      window.clearTimeout(timeout);
      advanceStage(1);
      resolve();
    };
    source.onerror = () => {
      if (opened) return;
      window.clearTimeout(timeout);
      source.close();
      reject(new Error('无法连接 AI 分析师事件流'));
    };
    source.addEventListener('attempt.started', () => {
      advanceStage(2);
      transitionState('analyzing');
    });
    source.addEventListener('reasoning_delta', () => advanceStage(3));
    source.addEventListener('tool_call', () => advanceStage(4));
    source.addEventListener('text_delta', (event) => {
      const data = parseEvent(event);
      liveTextRef.current += String(data.delta || '');
      advanceStage(5);
    });
    source.addEventListener('attempt.completed', (event) => {
      const data = parseEvent(event);
      complete(String(data.summary || liveTextRef.current), analysisId, reveal);
    });
    source.addEventListener('attempt.failed', (event) => {
      const data = parseEvent(event);
      source.close();
      const next = removeStoredReport(analysisId);
      if (mountedRef.current) setHistory(next);
      if (!reveal || activeAnalysisIdRef.current !== analysisId || !mountedRef.current) return;
      setError(readableError(data.error, 'AI 市场分析执行失败'));
      transitionState('error');
    });
  }), [advanceStage, complete, transitionState]);

  const startAnalysis = useCallback(async () => {
    if (stateRef.current === 'connecting' || stateRef.current === 'analyzing') return;
    const settings = loadIntegrationSettings();
    if (Boolean(settings.ai.apiKey.trim()) !== Boolean(settings.ai.model.trim())) {
      setError('请先在右上角“设置”中同时填写 AI API Key 与模型名称。');
      transitionState('error');
      return;
    }
    const analysisId = `analysis-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const startedAt = new Date().toISOString();
    activeAnalysisIdRef.current = analysisId;
    completedAnalysisIdsRef.current.delete(analysisId);
    liveTextRef.current = '';
    stageIndexRef.current = 0;
    setElapsed(0);
    setError('');
    setStage(ANALYSIS_STAGES[0]);
    setView('home');
    transitionState('connecting');
    const runningReport: StoredReport = {
      id: analysisId,
      markdown: '',
      generatedAt: startedAt,
      title: '全球宏观经济分析生成中',
      status: 'running',
    };
    setHistory(upsertStoredReport(runningReport));
    const prompt = buildMacroAiPrompt(snapshot);
    try {
      const prepared = await requestJson<{ sessionId: string }>('/api/vibe/research/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...buildAiPayload(settings, prompt), sessionId: '' }),
      });
      const withSession = { ...runningReport, sessionId: prepared.sessionId };
      const sessionHistory = upsertStoredReport(withSession);
      if (mountedRef.current) setHistory(sessionHistory);
      const sent = await requestJson<{ attempt_id: string }>('/api/vibe/research/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: prepared.sessionId, prompt }),
      });
      const activeReport = { ...withSession, attemptId: sent.attempt_id };
      const activeHistory = upsertStoredReport(activeReport);
      if (mountedRef.current) {
        setHistory(activeHistory);
        transitionState('analyzing');
      }
      if (mountedRef.current) void connectStream(prepared.sessionId, analysisId).catch(() => undefined);
      void recoverReport(prepared.sessionId, sent.attempt_id, analysisId);
    } catch (reason) {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      const next = removeStoredReport(analysisId);
      if (mountedRef.current) setHistory(next);
      if (mountedRef.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
        transitionState('error');
      }
    }
  }, [connectStream, recoverReport, snapshot, transitionState]);

  useEffect(() => {
    initialHistory.current
      .filter((item) => item.status === 'running' && item.sessionId && item.attemptId)
      .forEach((item) => {
        void recoverReport(item.sessionId!, item.attemptId!, item.id, false);
      });
  }, [recoverReport]);

  const resumeRunningAnalysis = useCallback(async (item: StoredReport) => {
    activeAnalysisIdRef.current = item.id;
    completedAnalysisIdsRef.current.delete(item.id);
    liveTextRef.current = '';
    const runningFor = Math.max(0, Math.floor((Date.now() - Date.parse(item.generatedAt)) / 1000));
    const inferredStage = Math.min(ANALYSIS_STAGES.length - 1, Math.floor(runningFor / 9));
    stageIndexRef.current = inferredStage;
    setElapsed(runningFor);
    setStage(ANALYSIS_STAGES[inferredStage]);
    setError('');
    setView('home');
    transitionState(item.sessionId && item.attemptId ? 'analyzing' : 'connecting');

    let resumable = item;
    for (let index = 0; index < 20 && (!resumable.sessionId || !resumable.attemptId); index += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      resumable = readStoredReports().find((candidate) => candidate.id === item.id) || resumable;
    }
    if (!resumable.sessionId || !resumable.attemptId) {
      setError('分析任务正在初始化，请稍后重新进入。');
      transitionState('error');
      return;
    }
    transitionState('analyzing');
    void connectStream(resumable.sessionId, resumable.id).catch(() => undefined);
    void recoverReport(resumable.sessionId, resumable.attemptId, resumable.id);
  }, [connectStream, recoverReport, transitionState]);

  const copyReport = async () => {
    await navigator.clipboard.writeText(report);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const openHistoricalReport = (item: StoredReport) => {
    if (item.status === 'running') {
      void resumeRunningAnalysis(item);
      return;
    }
    setReport(item.markdown);
    setGeneratedAt(item.generatedAt);
    setError('');
    setView('report');
    transitionState('completed');
  };

  const returnHome = () => {
    setView('home');
    setError('');
    transitionState('idle');
  };

  const running = state === 'connecting' || state === 'analyzing';

  return (
    <AnimatePresence>
      {open ? (
        <motion.section
          className="macro-ai-panel"
          role="dialog"
          aria-modal="true"
          aria-label="AI 市场分析舱"
          initial={{ opacity: 0, scale: .988 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: .992 }}
          transition={{ duration: .22, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <header className="macro-ai-header">
            <div className="macro-ai-brand">
              <span><BrainCircuit size={17} strokeWidth={1.45} /></span>
              <div><small>NEURAL MARKET INTELLIGENCE</small><strong>AI 宏观分析舱</strong></div>
            </div>
            <div className="macro-ai-header-state">
              <span className={running ? 'active' : view === 'report' ? 'completed' : ''}><i />{running ? '神经网络运行中' : view === 'report' ? '分析报告' : '系统待命'}</span>
              <button type="button" onClick={onClose} title="关闭 AI 分析舱" aria-label="关闭 AI 分析舱"><X size={16} /></button>
            </div>
          </header>

          <div className="macro-ai-surface">
            {running ? <NeuralInference stage={stage} elapsed={elapsed} /> : null}

            {!running && view === 'home' ? (
              <div className="macro-ai-home">
                <div className="macro-ai-launch">
                  <div className="macro-ai-launch-brain"><BrainCircuit size={51} strokeWidth={1.05} /><i /><b /></div>
                  <span>QUANT SIGNAL SYNTHESIS</span>
                  <h2>让 AI 读取此刻的全球市场</h2>
                  <p>汇总宏观、利率、流动性、全球股指、商品、汇率、加密资产与今日要闻，生成一份 30 秒可扫读的决策简报。</p>
                  {error ? <div className="macro-ai-error">{error}</div> : null}
                  <button type="button" onClick={() => void startAnalysis()}>
                    <Sparkles size={16} />
                    <span>{state === 'error' ? '重新开始分析' : '开始 LLM 分析市场'}</span>
                    <i>RUN</i>
                  </button>
                  <small>分析只使用当前页面快照 · 复用 AI 助手引擎</small>
                </div>

                <section className="macro-ai-history" aria-label="历史分析报告">
                  <div className="macro-ai-history-title">
                    <div><History size={15} /><span><small>ARCHIVE</small><strong>历史分析</strong></span></div>
                    <em>{history.length.toString().padStart(2, '0')} REPORTS</em>
                  </div>
                  {history.length ? (
                    <div className="macro-ai-history-list">
                      {history.map((item, index) => (
                        <button
                          type="button"
                          key={item.id}
                          className={item.status === 'running' ? 'is-running' : undefined}
                          onClick={() => openHistoricalReport(item)}
                        >
                          <span className="macro-ai-history-index">{String(index + 1).padStart(2, '0')}</span>
                          <span className="macro-ai-history-copy">
                            <strong>{item.title}</strong>
                            <small><CalendarDays size={11} />{formatReportDate(item.generatedAt)}<i /><Clock3 size={11} />{formatReportClock(item.generatedAt)}</small>
                          </span>
                          {item.status === 'running' ? (
                            <span className="macro-ai-history-running"><i />分析中<ChevronRight size={14} /></span>
                          ) : (
                            <span className="macro-ai-history-open">查看报告<ChevronRight size={14} /></span>
                          )}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="macro-ai-history-empty"><BrainCircuit size={22} /><span>尚无历史分析</span><small>完成第一份市场简报后，将自动归档在这里</small></div>
                  )}
                </section>
              </div>
            ) : null}

            {!running && view === 'report' ? (
              <motion.div className="macro-ai-report" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                <div className="macro-ai-report-head">
                  <div><button type="button" className="macro-ai-report-back" onClick={returnHome} title="返回分析首页"><ArrowLeft size={14} /></button><span><i /> ANALYSIS REPORT</span><strong>{extractReportTitle(report)}</strong><small>{formatReportDate(generatedAt)} {formatReportClock(generatedAt)} · AI 分析师</small></div>
                  <div>
                    <button type="button" onClick={() => void copyReport()} title="复制 Markdown">{copied ? <Check size={14} /> : <Copy size={14} />}<span>{copied ? '已复制' : '复制'}</span></button>
                    <button type="button" onClick={() => void startAnalysis()} title="使用最新页面数据重新分析"><RefreshCw size={14} /><span>重新分析</span></button>
                  </div>
                </div>
                <MacroAiMarkdown content={report} />
              </motion.div>
            ) : null}
          </div>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
