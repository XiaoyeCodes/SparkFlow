import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import {
  Bot,
  BookMarked,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleStop,
  Copy,
  History,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  SendHorizontal,
  XCircle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useLocation } from 'react-router-dom';
import { Strands } from '../components/Strands';
import { buildAiPayload, loadIntegrationSettings } from '../lib/integrations';

type AssistantRouteState = {
  starmapContext?: string;
};

type RunState = 'idle' | 'connecting' | 'researching' | 'completed' | 'error';

type ResearchMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attemptId?: string;
};

type ToolProgress = {
  stage?: string;
  message?: string;
  current?: number;
  total?: number;
};

type ToolCall = {
  id: string;
  tool: string;
  status: 'running' | 'ok' | 'error';
  elapsedMs?: number;
  elapsedSeconds?: number;
  preview?: string;
  progress?: ToolProgress;
};

type StoredVibeMessage = {
  message_id: string;
  role: string;
  content: string;
  linked_attempt_id?: string;
};

type VibeSession = {
  session_id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  last_attempt_id?: string | null;
  last_attempt_status?: string | null;
};

type ResearchSnapshot = {
  tools: ToolCall[];
  liveText: string;
  notice: string;
  runState: RunState;
  lastEventId?: string;
};

const sessionStorageKey = 'sparkflow.vibe.session.v1';
const sidebarStorageKey = 'sparkflow.vibe.history-sidebar-collapsed.v1';
const progressStoragePrefix = 'sparkflow.vibe.progress.v1.';

const starterPrompts = [
  '汇总今日市场、资金风向与重要新闻，给出风险优先的投资观察',
  '分析腾讯、阿里、小米和美团的长期投资价值与当前估值吸引力',
  '用巴菲特、芒格和段永平的框架评估我关注的公司',
];

const toolLabels: Record<string, string> = {
  run_swarm: '运行多智能体研究',
  web_search: '检索公开信息',
  search_web: '检索公开信息',
  market_snapshot: '获取市场快照',
  get_market_snapshot: '获取市场快照',
  fetch_market_data: '获取市场数据',
  company_research: '研究公司基本面',
  search_research_reports: '检索研报',
  run_backtest: '运行历史回测',
  render_shadow_report: '生成策略报告',
  calculate_metrics: '计算投资指标',
};

function toolLabel(tool: string) {
  return toolLabels[tool] || tool.replace(/_/g, ' ');
}

function findLastRunningToolIndex(tools: ToolCall[], tool: string) {
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    if (tools[index].tool === tool && tools[index].status === 'running') return index;
  }
  return -1;
}

function parseEvent(event: Event) {
  try {
    return JSON.parse((event as MessageEvent<string>).data || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function requestJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as T & { detail?: string };
  if (!response.ok) throw new Error(payload.detail || `请求失败：HTTP ${response.status}`);
  return payload;
}

function formatSessionTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return '';
  const difference = Date.now() - timestamp;
  if (difference < 60_000) return '刚刚';
  if (difference < 3_600_000) return `${Math.max(1, Math.floor(difference / 60_000))} 分钟前`;
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)} 小时前`;
  if (difference < 604_800_000) return `${Math.floor(difference / 86_400_000)} 天前`;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(value));
}

function readResearchSnapshot(sessionId: string): ResearchSnapshot | null {
  try {
    const raw = window.localStorage.getItem(`${progressStoragePrefix}${sessionId}`);
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as Partial<ResearchSnapshot>;
    if (!Array.isArray(snapshot.tools) || typeof snapshot.liveText !== 'string' || typeof snapshot.notice !== 'string') return null;
    return {
      tools: snapshot.tools as ToolCall[],
      liveText: snapshot.liveText,
      notice: snapshot.notice,
      runState: snapshot.runState === 'researching' || snapshot.runState === 'connecting' || snapshot.runState === 'completed'
        ? snapshot.runState
        : 'idle',
      lastEventId: typeof snapshot.lastEventId === 'string' ? snapshot.lastEventId : undefined,
    };
  } catch {
    return null;
  }
}

function writeResearchSnapshot(sessionId: string, snapshot: ResearchSnapshot) {
  try {
    window.localStorage.setItem(
      `${progressStoragePrefix}${sessionId}`,
      JSON.stringify({ ...snapshot, tools: snapshot.tools.slice(-80), liveText: snapshot.liveText.slice(-2400) }),
    );
  } catch {
    // A live research trace is optional; storage limits should never interrupt the task itself.
  }
}

function clearResearchSnapshot(sessionId: string) {
  window.localStorage.removeItem(`${progressStoragePrefix}${sessionId}`);
}

function updateResearchSnapshot(
  sessionId: string,
  updater: (snapshot: ResearchSnapshot) => ResearchSnapshot,
) {
  const current = readResearchSnapshot(sessionId) || {
    tools: [],
    liveText: '',
    notice: '',
    runState: 'idle' as RunState,
  };
  const next = updater(current);
  writeResearchSnapshot(sessionId, next);
  return next;
}

function ResearchProgress({ tools, running, liveText }: { tools: ToolCall[]; running: boolean; liveText: string }) {
  const [expanded, setExpanded] = useState(true);
  if (!tools.length && !running && !liveText) return null;

  const completed = tools.filter((tool) => tool.status !== 'running').length;
  const hasError = tools.some((tool) => tool.status === 'error');
  const latest = [...tools].reverse().find((tool) => tool.status === 'running') || tools[tools.length - 1];
  const summary = running
    ? latest
      ? `正在${toolLabel(latest.tool)}`
      : '正在规划研究路径'
    : `研究过程完成 · ${completed} 个步骤`;

  return (
    <div className="overflow-hidden rounded-md border border-white/10 bg-white/[0.025]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-xs text-white/62 transition hover:bg-white/[0.03] hover:text-white"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {running ? (
          <Loader2 size={14} className="animate-spin text-[#ff8a1f]" />
        ) : hasError ? (
          <XCircle size={14} className="text-red-300" />
        ) : (
          <CheckCircle2 size={14} className="text-emerald-300" />
        )}
        <span>{summary}</span>
      </button>

      {expanded ? (
        <div className="space-y-1 border-t border-white/8 px-4 py-3">
          {tools.map((tool, index) => {
            const determinate =
              typeof tool.progress?.current === 'number' &&
              typeof tool.progress?.total === 'number' &&
              tool.progress.total > 0;
            const percent = determinate
              ? Math.min(100, Math.round(((tool.progress?.current || 0) / (tool.progress?.total || 1)) * 100))
              : 0;
            return (
              <div key={tool.id} className="py-1.5">
                <div className="flex min-w-0 items-center gap-2 text-xs">
                  <span className="w-4 shrink-0 text-center text-white/20">{index === tools.length - 1 ? '└' : '├'}</span>
                  {tool.status === 'running' ? (
                    <Loader2 size={13} className="shrink-0 animate-spin text-[#ff8a1f]" />
                  ) : tool.status === 'error' ? (
                    <XCircle size={13} className="shrink-0 text-red-300" />
                  ) : (
                    <Circle size={12} className="shrink-0 fill-emerald-300/70 text-emerald-300/70" />
                  )}
                  <span className={tool.status === 'running' ? 'truncate text-white/86' : 'truncate text-white/52'}>
                    {toolLabel(tool.tool)}
                  </span>
                  {tool.elapsedMs ? (
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-white/30">
                      {(tool.elapsedMs / 1000).toFixed(1)}s
                    </span>
                  ) : tool.elapsedSeconds ? (
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-white/30">
                      {Math.round(tool.elapsedSeconds)}s
                    </span>
                  ) : null}
                </div>
                {tool.progress?.stage || tool.progress?.message ? (
                  <div className="ml-10 mt-1.5 min-w-0 text-[11px] text-white/36">
                    <div className="flex items-center gap-2">
                      <span className="truncate">{tool.progress.stage || tool.progress.message}</span>
                      {determinate ? <span className="ml-auto shrink-0 font-mono">{percent}%</span> : null}
                    </div>
                    {determinate ? (
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/8">
                        <div className="h-full bg-[#ff8a1f] transition-[width] duration-200" style={{ width: `${percent}%` }} />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          {liveText ? (
            <p className="line-clamp-3 border-l border-[#8ad7ff]/30 pl-3 text-xs leading-6 text-white/42">
              {liveText.slice(-360)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ResearchReport({ content }: { content: string }) {
  return (
    <div className="research-markdown min-w-0 text-[15px] leading-7 text-white/78">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer" className="text-[#8ad7ff] underline decoration-[#8ad7ff]/30 underline-offset-4 hover:text-white">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="my-5 w-full overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-left text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border border-white/14 bg-white/[0.045] px-3 py-2 font-semibold text-white/82">{children}</th>,
          td: ({ children }) => <td className="border border-white/12 px-3 py-2 align-top text-white/66">{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function Assistant() {
  const location = useLocation();
  const routeState = location.state as AssistantRouteState | null;
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<ResearchMessage[]>([]);
  const [tools, setTools] = useState<ToolCall[]>([]);
  const [liveText, setLiveText] = useState('');
  const [runState, setRunState] = useState<RunState>('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [sessions, setSessions] = useState<VibeSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [historyCollapsed, setHistoryCollapsed] = useState(() => window.localStorage.getItem(sidebarStorageKey) === 'true');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copiedId, setCopiedId] = useState('');
  const [savedId, setSavedId] = useState('');
  const eventSourcesRef = useRef(new Map<string, EventSource>());
  const viewingSessionRef = useRef('');
  const activeAttemptRef = useRef('');
  const completedAttemptsRef = useRef(new Set<string>());
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const isRunning = runState === 'connecting' || runState === 'researching';

  const applyProgressSnapshot = useCallback((sid: string, snapshot: ResearchSnapshot) => {
    writeResearchSnapshot(sid, snapshot);
    if (viewingSessionRef.current !== sid) return;
    setTools(snapshot.tools);
    setLiveText(snapshot.liveText);
    setNotice(snapshot.notice);
    setRunState(snapshot.runState);
  }, []);

  const persistResearchEvent = useCallback(
    (
      sid: string,
      event: Event,
      updater: (snapshot: ResearchSnapshot, data: Record<string, unknown>) => ResearchSnapshot,
    ) => {
      const data = parseEvent(event);
      const eventId = (event as MessageEvent<string>).lastEventId || '';
      const snapshot = updateResearchSnapshot(sid, (current) => ({
        ...updater(current, data),
        lastEventId: eventId || current.lastEventId,
      }));
      if (viewingSessionRef.current === sid) {
        setTools(snapshot.tools);
        setLiveText(snapshot.liveText);
        setNotice(snapshot.notice);
        setRunState(snapshot.runState);
      }
      return { data, snapshot };
    },
    [],
  );

  const loadSessions = useCallback(async () => {
    try {
      const storedSessions = await requestJson<VibeSession[]>('/api/vibe/research/sessions');
      setSessions(storedSessions);
      return storedSessions;
    } catch {
      // The research service may still be booting; submitting a question will surface a useful error if it stays unavailable.
      return [] as VibeSession[];
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const resetResearch = useCallback(() => {
    viewingSessionRef.current = '';
    activeAttemptRef.current = '';
    completedAttemptsRef.current.clear();
    setSessionId('');
    setMessages([]);
    setTools([]);
    setLiveText('');
    setRunState('idle');
    setError('');
    setNotice('');
    window.localStorage.removeItem(sessionStorageKey);
    setHistoryOpen(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const openSession = useCallback(
    async (nextSessionId: string) => {
      if (nextSessionId === sessionId) return;
      setError('');
      try {
        const [history, storedSessions] = await Promise.all([
          requestJson<StoredVibeMessage[]>(`/api/vibe/research/messages?sessionId=${encodeURIComponent(nextSessionId)}`),
          loadSessions(),
        ]);
        const nextSession = storedSessions.find((item) => item.session_id === nextSessionId);
        const lastConversationMessage = [...history].reverse().find(
          (message) => message.role === 'user' || message.role === 'assistant',
        );
        const snapshot = readResearchSnapshot(nextSessionId);
        const snapshotIsRunning =
          snapshot?.runState === 'researching' || snapshot?.runState === 'connecting';
        const shouldResume =
          snapshotIsRunning ||
          nextSession?.last_attempt_status === 'running' ||
          (nextSession?.last_attempt_status !== 'failed' &&
            Boolean(nextSession?.last_attempt_id) &&
            lastConversationMessage?.role === 'user');
        viewingSessionRef.current = nextSessionId;
        activeAttemptRef.current = '';
        completedAttemptsRef.current.clear();
        setSessionId(nextSessionId);
        setTools(snapshot?.tools || []);
        setLiveText(snapshot?.liveText || '');
        setNotice(snapshot?.notice || '');
        setRunState(snapshot?.runState || 'idle');
        setMessages(
          history
            .filter((message) => message.role === 'user' || message.role === 'assistant')
            .map((message) => ({
              id: message.message_id,
              role: message.role as 'user' | 'assistant',
              content: message.content,
              attemptId: message.linked_attempt_id,
            })),
        );
        window.localStorage.setItem(sessionStorageKey, nextSessionId);
        setHistoryOpen(false);
        if (shouldResume && nextSession?.last_attempt_id) {
          activeAttemptRef.current = nextSession.last_attempt_id;
          const resumedSnapshot: ResearchSnapshot = {
            tools: snapshot?.tools || [],
            liveText: snapshot?.liveText || '',
            notice: '正在恢复研究进度',
            runState: 'researching',
            lastEventId: snapshot?.lastEventId,
          };
          applyProgressSnapshot(nextSessionId, resumedSnapshot);
          void connectResearchStream(nextSessionId)
            .then(() => void recoverCompletedAttempt(nextSessionId, nextSession.last_attempt_id || ''))
            .catch((err) => {
              if (viewingSessionRef.current === nextSessionId) {
                setRunState('error');
                setError(err instanceof Error ? err.message : '无法恢复研究进度');
              }
            });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '无法读取这段研究记录');
      }
    },
    [applyProgressSnapshot, loadSessions, sessionId],
  );

  useEffect(() => {
    if (routeState?.starmapContext) {
      setPrompt(`请基于这份星图情报进行深度研究，并给出有证据、可执行的下一步：\n\n${routeState.starmapContext}`);
    }
  }, [routeState?.starmapContext]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      const storedSessionId = window.localStorage.getItem(sessionStorageKey) || '';
      if (!storedSessionId) return;
      try {
        await openSession(storedSessionId);
      } catch {
        if (!cancelled) window.localStorage.removeItem(sessionStorageKey);
      }
    };
    void restore();
    return () => {
      cancelled = true;
      eventSourcesRef.current.forEach((source) => source.close());
      eventSourcesRef.current.clear();
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(sidebarStorageKey, String(historyCollapsed));
  }, [historyCollapsed]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: isRunning ? 'smooth' : 'auto', block: 'end' });
  }, [messages, tools, liveText, isRunning]);

  const finishAttempt = (sid: string, attemptId: string, summary: string) => {
    const source = eventSourcesRef.current.get(sid);
    source?.close();
    eventSourcesRef.current.delete(sid);
    const snapshot = updateResearchSnapshot(sid, (current) => ({
      ...current,
      tools: current.tools.map((tool) => (tool.status === 'running' ? { ...tool, status: 'ok' } : tool)),
      liveText: '',
      runState: 'completed',
    }));
    if (viewingSessionRef.current !== sid || !summary || completedAttemptsRef.current.has(attemptId)) {
      void loadSessions();
      return;
    }
    completedAttemptsRef.current.add(attemptId);
    activeAttemptRef.current = '';
    setMessages((current) =>
      current.some((message) => message.role === 'assistant' && message.attemptId === attemptId)
        ? current
        : [...current, { id: `assistant-${attemptId || Date.now()}`, role: 'assistant', content: summary, attemptId }],
    );
    applyProgressSnapshot(sid, snapshot);
    void loadSessions();
  };

  const recoverCompletedAttempt = async (sid: string, attemptId: string) => {
    for (let index = 0; index < 240; index += 1) {
      if (
        viewingSessionRef.current !== sid ||
        completedAttemptsRef.current.has(attemptId) ||
        activeAttemptRef.current !== attemptId
      ) {
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      try {
        const history = await requestJson<StoredVibeMessage[]>(
          `/api/vibe/research/messages?sessionId=${encodeURIComponent(sid)}`,
        );
        const answer = history.find(
          (message) => message.role === 'assistant' && message.linked_attempt_id === attemptId,
        );
        if (answer?.content) {
          finishAttempt(sid, attemptId, answer.content);
          return;
        }
      } catch {
        // SSE remains the primary transport; polling only repairs missed completion events.
      }
    }
  };

  const connectResearchStream = (sid: string) =>
    new Promise<void>((resolve, reject) => {
      eventSourcesRef.current.get(sid)?.close();
      const lastEventId = readResearchSnapshot(sid)?.lastEventId || '';
      const source = new EventSource(
        `/api/vibe/research/events?sessionId=${encodeURIComponent(sid)}${
          lastEventId ? `&lastEventId=${encodeURIComponent(lastEventId)}` : ''
        }`,
      );
      eventSourcesRef.current.set(sid, source);
      const closeSource = () => {
        source.close();
        if (eventSourcesRef.current.get(sid) === source) eventSourcesRef.current.delete(sid);
      };
      const isViewing = () => viewingSessionRef.current === sid;
      let opened = false;
      const timeout = window.setTimeout(() => {
        if (!opened) {
          closeSource();
          reject(new Error('研究事件流连接超时'));
        }
      }, 10000);

      source.onopen = () => {
        opened = true;
        window.clearTimeout(timeout);
        resolve();
      };
      source.onerror = () => {
        if (!opened) {
          window.clearTimeout(timeout);
          closeSource();
          reject(new Error('无法连接 Vibe-Trading 研究事件流'));
        }
      };

      source.addEventListener('attempt.created', (event) => {
        const { data } = persistResearchEvent(sid, event, (current) => ({
          ...current,
          runState: 'researching',
        }));
        if (isViewing()) {
          const attemptId = String(data.attempt_id || '');
          if (attemptId) activeAttemptRef.current = attemptId;
        }
      });
      source.addEventListener('attempt.started', (event) => {
        const { data } = persistResearchEvent(sid, event, (current) => ({
          ...current,
          runState: 'researching',
        }));
        if (isViewing()) {
          const attemptId = String(data.attempt_id || '');
          if (attemptId) activeAttemptRef.current = attemptId;
        }
      });
      source.addEventListener('reasoning_delta', (event) => {
        persistResearchEvent(sid, event, (current) => ({ ...current, runState: 'researching' }));
      });
      source.addEventListener('stream_reset', (event) => {
        persistResearchEvent(sid, event, (current) => ({ ...current, liveText: '' }));
      });
      source.addEventListener('text_delta', (event) => {
        persistResearchEvent(sid, event, (current, data) => ({
          ...current,
          liveText: current.liveText + String(data.delta || ''),
          runState: 'researching',
        }));
      });
      source.addEventListener('tool_call', (event) => {
        persistResearchEvent(sid, event, (current, data) => {
          const tool = String(data.tool || 'research_tool');
          const eventId = (event as MessageEvent<string>).lastEventId || `${Date.now()}-${current.tools.length}`;
          return {
            ...current,
            tools: [...current.tools, { id: `${tool}-${eventId}`, tool, status: 'running' }],
            runState: 'researching',
          };
        });
      });
      source.addEventListener('tool_result', (event) => {
        persistResearchEvent(sid, event, (current, data) => {
          const tool = String(data.tool || 'research_tool');
          const index = findLastRunningToolIndex(current.tools, tool);
          if (index < 0) {
            const eventId = (event as MessageEvent<string>).lastEventId || Date.now();
            return {
              ...current,
              tools: [
                ...current.tools,
                {
                  id: `${tool}-${eventId}`,
                  tool,
                  status: data.status === 'ok' ? 'ok' : 'error',
                  preview: String(data.preview || ''),
                  elapsedMs: Number(data.elapsed_ms || 0),
                },
              ],
            };
          }
          return {
            ...current,
            tools: current.tools.map((item, itemIndex) =>
              itemIndex === index
                ? {
                    ...item,
                    status: data.status === 'ok' ? 'ok' : 'error',
                    preview: String(data.preview || ''),
                    elapsedMs: Number(data.elapsed_ms || 0),
                    progress: undefined,
                  }
                : item,
            ),
          };
        });
      });
      source.addEventListener('tool_heartbeat', (event) => {
        persistResearchEvent(sid, event, (current, data) => {
          const tool = String(data.tool || '');
          const index = findLastRunningToolIndex(current.tools, tool);
          return {
            ...current,
            tools: current.tools.map((item, itemIndex) =>
              itemIndex === index ? { ...item, elapsedSeconds: Number(data.elapsed_s || 0) } : item,
            ),
          };
        });
      });
      source.addEventListener('tool_progress', (event) => {
        persistResearchEvent(sid, event, (current, data) => {
          const tool = String(data.tool || '');
          const index = findLastRunningToolIndex(current.tools, tool);
          return {
            ...current,
            tools: current.tools.map((item, itemIndex) =>
              itemIndex === index
                ? {
                    ...item,
                    progress: {
                      stage: typeof data.stage === 'string' ? data.stage : undefined,
                      message: typeof data.message === 'string' ? data.message : undefined,
                      current: typeof data.current === 'number' ? data.current : undefined,
                      total: typeof data.total === 'number' ? data.total : undefined,
                    },
                  }
                : item,
            ),
          };
        });
      });
      source.addEventListener('swarm.started', (event) => {
        persistResearchEvent(sid, event, (current) => ({
          ...current,
          notice: '多智能体研究团队已启动',
        }));
      });
      source.addEventListener('swarm.event', (event) => {
        persistResearchEvent(sid, event, (current, data) => {
          const swarmEvent = data.event as Record<string, unknown> | undefined;
          return {
            ...current,
            notice: swarmEvent?.type
              ? `多智能体：${String(swarmEvent.type).replace(/_/g, ' ')}`
              : current.notice,
          };
        });
      });
      source.addEventListener('attempt.completed', (event) => {
        const { data, snapshot } = persistResearchEvent(sid, event, (current) => ({
          ...current,
          tools: current.tools.map((tool) => (tool.status === 'running' ? { ...tool, status: 'ok' } : tool)),
          runState: 'completed',
        }));
        const attemptId = String(data.attempt_id || (isViewing() ? activeAttemptRef.current : '') || 'completed');
        finishAttempt(sid, attemptId, String(data.summary || snapshot.liveText));
      });
      source.addEventListener('attempt.failed', (event) => {
        const { data } = persistResearchEvent(sid, event, (current) => ({
          ...current,
          tools: current.tools.map((tool) => (tool.status === 'running' ? { ...tool, status: 'error' } : tool)),
          runState: 'error',
        }));
        if (isViewing()) {
          const attemptId = String(data.attempt_id || activeAttemptRef.current || 'failed');
          completedAttemptsRef.current.add(attemptId);
          activeAttemptRef.current = '';
          setRunState('error');
          setError(String(data.error || '研究任务执行失败'));
        }
        closeSource();
        void loadSessions();
      });
    });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const question = prompt.trim();
    if (!question || isRunning) return;

    const settings = loadIntegrationSettings();
    if (Boolean(settings.ai.apiKey.trim()) !== Boolean(settings.ai.model.trim())) {
      setError('请从右上角头像进入“设置”，同时填写 AI API Key 和模型名称。');
      return;
    }

    setPrompt('');
    setError('');
    setNotice('正在连接研究引擎');
    setTools([]);
    setLiveText('');
    setRunState('connecting');
    setMessages((current) => [...current, { id: `user-${Date.now()}`, role: 'user', content: question }]);

    let preparedSessionId = '';
    try {
      const prepared = await requestJson<{
        sessionId: string;
      }>('/api/vibe/research/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...buildAiPayload(settings, question), sessionId }),
      });
      preparedSessionId = prepared.sessionId;
      viewingSessionRef.current = prepared.sessionId;
      clearResearchSnapshot(prepared.sessionId);
      setSessionId(prepared.sessionId);
      window.localStorage.setItem(sessionStorageKey, prepared.sessionId);
      void loadSessions();
      applyProgressSnapshot(prepared.sessionId, {
        tools: [],
        liveText: '',
        notice: '研究会话已建立，正在规划任务',
        runState: 'connecting',
      });

      await connectResearchStream(prepared.sessionId);
      const sent = await requestJson<{ attempt_id: string }>('/api/vibe/research/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: prepared.sessionId, prompt: question }),
      });
      if (completedAttemptsRef.current.has(sent.attempt_id)) return;
      activeAttemptRef.current = sent.attempt_id;
      applyProgressSnapshot(
        prepared.sessionId,
        updateResearchSnapshot(prepared.sessionId, (current) => ({
          ...current,
          runState: 'researching',
          notice: 'Vibe-Trading 正在研究',
        })),
      );
      void loadSessions();
      void recoverCompletedAttempt(prepared.sessionId, sent.attempt_id);
    } catch (err) {
      eventSourcesRef.current.get(preparedSessionId)?.close();
      eventSourcesRef.current.delete(preparedSessionId);
      activeAttemptRef.current = '';
      setRunState('error');
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inputRef.current?.focus();
    }
  };

  const cancelResearch = async () => {
    if (!sessionId) return;
    try {
      await requestJson('/api/vibe/research/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      eventSourcesRef.current.get(sessionId)?.close();
      eventSourcesRef.current.delete(sessionId);
      activeAttemptRef.current = '';
      applyProgressSnapshot(
        sessionId,
        updateResearchSnapshot(sessionId, (current) => ({
          ...current,
          runState: 'idle',
          notice: '研究已停止',
        })),
      );
      void loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const copyReport = async (message: ResearchMessage) => {
    await navigator.clipboard.writeText(message.content);
    setCopiedId(message.id);
    window.setTimeout(() => setCopiedId(''), 1400);
  };

  const saveReport = async (message: ResearchMessage) => {
    const settings = loadIntegrationSettings();
    if (!settings.obsidian.vaultPath) {
      setError('请先从右上角头像进入“设置”，填写 Obsidian Vault 本地路径。');
      return;
    }
    try {
      await requestJson('/api/obsidian-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vaultPath: settings.obsidian.vaultPath,
          folder: settings.obsidian.folder,
          title: 'AI 深度研究报告',
          markdown: message.content,
        }),
      });
      setSavedId(message.id);
      window.setTimeout(() => setSavedId(''), 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
      <section className="relative min-h-screen overflow-x-hidden bg-[#08090b] pt-[var(--nav-height)] text-white">
        <button
          type="button"
          title="打开研究历史"
          aria-label="打开研究历史"
          onClick={() => setHistoryOpen(true)}
          className="fixed left-3 top-[calc(var(--nav-height)+12px)] z-30 inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/12 bg-[#111216]/95 text-white/72 shadow-lg shadow-black/30 backdrop-blur-xl transition hover:border-white/24 hover:text-white lg:hidden"
        >
          <History size={17} />
        </button>

        {historyOpen ? (
          <button
            type="button"
            aria-label="关闭研究历史"
            onClick={() => setHistoryOpen(false)}
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          />
        ) : null}

        <aside
          className={`fixed bottom-0 left-0 top-[var(--nav-height)] z-40 flex w-[min(84vw,19rem)] flex-col overflow-hidden border-r border-white/10 bg-[#0b0c0f]/97 backdrop-blur-xl transition-[transform,width] duration-200 lg:translate-x-0 ${
            historyOpen ? 'translate-x-0' : '-translate-x-full'
          } ${historyCollapsed ? 'lg:w-14' : 'lg:w-64'}`}
        >
          {historyCollapsed ? (
            <div className="hidden h-16 shrink-0 items-center justify-center border-b border-white/8 lg:flex">
              <History size={17} className="text-[#ff8a1f]" />
            </div>
          ) : null}
          <div className={`flex min-h-0 flex-1 flex-col ${historyCollapsed ? 'lg:hidden' : ''}`}>
              <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/8 px-3">
                <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-white/84">
                  <History size={16} className="shrink-0 text-[#ff8a1f]" />
                  <span className="truncate">历史研究</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    title="新建研究"
                    aria-label="新建研究"
                    onClick={resetResearch}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white/52 transition hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <Plus size={17} />
                  </button>
                  <button
                    type="button"
                    title="关闭研究历史"
                    aria-label="关闭研究历史"
                    onClick={() => setHistoryOpen(false)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white/52 transition hover:bg-white/[0.07] hover:text-white lg:hidden"
                  >
                    <ChevronLeft size={18} />
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
                {sessionsLoading ? (
                  <div className="space-y-2 px-2 py-1">
                    {[0, 1, 2, 3].map((item) => (
                      <div key={item} className="h-14 animate-pulse rounded-md bg-white/[0.045]" />
                    ))}
                  </div>
                ) : sessions.length ? (
                  <div className="space-y-1">
                    {sessions.map((item) => {
                      const active = item.session_id === sessionId;
                      return (
                        <button
                          key={item.session_id}
                          type="button"
                          onClick={() => void openSession(item.session_id)}
                          title={item.title || '未命名研究'}
                          className={`w-full rounded-md px-3 py-2.5 text-left transition ${
                            active
                              ? 'bg-white/[0.1] text-white'
                              : 'text-white/62 hover:bg-white/[0.06] hover:text-white'
                          }`}
                        >
                          <span className="block truncate text-sm font-medium leading-5">{item.title || '未命名研究'}</span>
                          <span className="mt-1 block text-[11px] text-white/34">{formatSessionTime(item.updated_at)}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="px-4 py-10 text-center text-xs leading-6 text-white/36">开始一项研究后，记录会保存在这里。</div>
                )}
              </div>

              <div className="border-t border-white/8 px-3 py-3 text-[11px] leading-5 text-white/32">研究记录保存在当前设备</div>
          </div>
        </aside>

        <button
          type="button"
          title={historyCollapsed ? '展开研究历史' : '收起研究历史'}
          aria-label={historyCollapsed ? '展开研究历史' : '收起研究历史'}
          onClick={() => setHistoryCollapsed((value) => !value)}
          className={`fixed top-[calc(var(--nav-height)+12px)] z-[45] hidden h-10 w-10 items-center justify-center rounded-md border border-white/12 bg-[#111216]/95 text-white/72 shadow-lg shadow-black/30 backdrop-blur-xl transition hover:border-white/24 hover:text-white lg:inline-flex ${
            historyCollapsed ? 'left-3' : 'left-[calc(16rem-8px)]'
          }`}
        >
          {historyCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>

        <div
          className={`relative z-10 flex min-h-[calc(100vh-var(--nav-height))] w-full flex-col transition-[padding] duration-200 ${
            historyCollapsed ? 'lg:pl-14' : 'lg:pl-64'
          }`}
        >
          <div className="mx-auto flex min-h-[calc(100vh-var(--nav-height))] w-full max-w-5xl flex-col px-4 pb-5 pt-7 md:px-8">
          <div
            aria-hidden="true"
            className="pointer-events-none mx-auto -mb-1 mt-2 h-32 w-full max-w-[680px] overflow-hidden md:h-36"
          >
            <Strands
              colors={['#F97316', '#7C3AED', '#06B6D4']}
              count={3}
              speed={isRunning ? 0.96 : 0.62}
              amplitude={1.06}
              waviness={1.9}
              thickness={0.72}
              glow={2.75}
              taper={3}
              spread={1}
              intensity={0.68}
              saturation={1.45}
              opacity={0.8}
              scale={1.8}
              glass={false}
              refraction={1}
              dispersion={1}
              glassSize={1}
            />
          </div>

          <div className="flex-1 py-7 md:py-9">
            {!messages.length ? (
              <div className="mx-auto flex min-h-[44vh] max-w-2xl flex-col items-center justify-center text-center">
                <Bot size={28} className="text-[#ff8a1f]" strokeWidth={1.5} />
                <h2 className="mt-5 text-3xl font-semibold text-white md:text-4xl">今天想研究什么？</h2>
                <div className="mt-7 grid w-full gap-2">
                  {starterPrompts.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => {
                        setPrompt(item);
                        inputRef.current?.focus();
                      }}
                      className="rounded-md border border-white/10 bg-white/[0.025] px-4 py-3 text-left text-sm leading-6 text-white/54 transition hover:border-[#ff8a1f]/40 hover:bg-white/[0.045] hover:text-white/82"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-9">
                {messages.map((message) =>
                  message.role === 'user' ? (
                    <div key={message.id} className="flex justify-end">
                      <div className="max-w-[86%] rounded-lg bg-[#ff7a12] px-4 py-3 text-sm font-medium leading-6 text-white md:max-w-[72%]">
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      </div>
                    </div>
                  ) : (
                    <motion.article
                      key={message.id}
                      className="grid min-w-0 grid-cols-[32px_minmax(0,1fr)] gap-3 md:grid-cols-[40px_minmax(0,1fr)] md:gap-4"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[#0e7698] text-white md:h-10 md:w-10">
                        <Bot size={17} />
                      </span>
                      <div className="min-w-0">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <span className="text-xs font-semibold text-white/58">Vibe Research</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              title="复制报告"
                              aria-label="复制报告"
                              onClick={() => void copyReport(message)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white/36 transition hover:bg-white/[0.06] hover:text-white"
                            >
                              {copiedId === message.id ? <Check size={15} /> : <Copy size={15} />}
                            </button>
                            <button
                              type="button"
                              title="写入 Obsidian"
                              aria-label="写入 Obsidian"
                              onClick={() => void saveReport(message)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white/36 transition hover:bg-white/[0.06] hover:text-white"
                            >
                              {savedId === message.id ? <Check size={15} /> : <BookMarked size={15} />}
                            </button>
                          </div>
                        </div>
                        <ResearchReport content={message.content} />
                      </div>
                    </motion.article>
                  ),
                )}

                {isRunning ? (
                  <div className="grid min-w-0 grid-cols-[32px_minmax(0,1fr)] gap-3 md:grid-cols-[40px_minmax(0,1fr)] md:gap-4">
                    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[#0e7698] text-white md:h-10 md:w-10">
                      <Bot size={17} />
                    </span>
                    <div className="min-w-0 space-y-3 pt-1">
                      <div className="flex items-center gap-2 text-sm text-white/68">
                        <Loader2 size={15} className="animate-spin text-[#ff8a1f]" />
                        <span>{notice || '正在研究'}</span>
                      </div>
                      <ResearchProgress tools={tools} running liveText={liveText} />
                    </div>
                  </div>
                ) : tools.length ? (
                  <div className="ml-0 md:ml-14">
                    <ResearchProgress tools={tools} running={false} liveText={liveText} />
                  </div>
                ) : null}
              </div>
            )}

            {error ? (
              <div className="mt-6 flex items-start gap-2 rounded-md border border-red-400/20 bg-red-400/[0.07] px-4 py-3 text-sm leading-6 text-red-100/80">
                <XCircle size={16} className="mt-1 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}
            <div ref={endRef} />
          </div>

          <div className="sticky bottom-0 z-20 border-t border-white/10 bg-[#08090b]/95 pb-2 pt-4 backdrop-blur-xl">
            <form
              onSubmit={submit}
              className="flex min-h-16 items-end gap-2 rounded-full border border-white/18 bg-[#111216] py-2 pl-5 pr-2 transition focus-within:border-white/38"
            >
              <textarea
                ref={inputRef}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={handleInputKeyDown}
                maxLength={5000}
                rows={1}
                className="block min-h-10 max-h-28 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-2 text-sm leading-6 text-white outline-none [field-sizing:content] placeholder:text-white/32"
                placeholder="输入公司、市场、策略或投资问题..."
                aria-label="深度研究问题"
              />
              {isRunning ? (
                <button
                  type="button"
                  onClick={() => void cancelResearch()}
                  title="停止研究"
                  aria-label="停止研究"
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/14 text-white/58 transition hover:border-red-300/40 hover:bg-red-300/[0.06] hover:text-red-200"
                >
                  <CircleStop size={18} />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!prompt.trim()}
                  title="开始研究"
                  aria-label="开始研究"
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#ff7a12] text-white transition hover:bg-[#ff8a1f] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <SendHorizontal size={18} />
                </button>
              )}
            </form>
          </div>
          </div>
        </div>
      </section>
  );
}
