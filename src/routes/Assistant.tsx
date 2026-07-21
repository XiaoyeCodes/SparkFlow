import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import {
  Bot,
  BookMarked,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleStop,
  Clock3,
  Copy,
  Loader2,
  Plus,
  SendHorizontal,
  Wrench,
  XCircle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useLocation } from 'react-router-dom';
import { PageTransition } from '../components/PageTransition';
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

type EngineStatus = {
  status: 'connecting' | 'ready' | 'offline';
  provider?: string;
  model?: string;
  baseUrl?: string;
};

type StoredVibeMessage = {
  message_id: string;
  role: string;
  content: string;
  linked_attempt_id?: string;
};

const sessionStorageKey = 'sparkflow.vibe.session.v1';

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
  const [engine, setEngine] = useState<EngineStatus>({ status: 'connecting' });
  const [sessionId, setSessionId] = useState('');
  const [copiedId, setCopiedId] = useState('');
  const [savedId, setSavedId] = useState('');
  const eventSourceRef = useRef<EventSource | null>(null);
  const activeAttemptRef = useRef('');
  const completedAttemptsRef = useRef(new Set<string>());
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const isRunning = runState === 'connecting' || runState === 'researching';

  useEffect(() => {
    if (routeState?.starmapContext) {
      setPrompt(`请基于这份星图情报进行深度研究，并给出有证据、可执行的下一步：\n\n${routeState.starmapContext}`);
    }
  }, [routeState?.starmapContext]);

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      try {
        const status = await requestJson<{ provider: string; model: string; baseUrl: string }>('/api/vibe/status');
        if (!cancelled) setEngine({ status: 'ready', provider: status.provider, model: status.model, baseUrl: status.baseUrl });
      } catch {
        if (!cancelled) setEngine({ status: 'offline' });
      }

      const storedSessionId = window.localStorage.getItem(sessionStorageKey) || '';
      if (!storedSessionId) return;
      try {
        const history = await requestJson<StoredVibeMessage[]>(
          `/api/vibe/research/messages?sessionId=${encodeURIComponent(storedSessionId)}`,
        );
        if (cancelled) return;
        setSessionId(storedSessionId);
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
      } catch {
        window.localStorage.removeItem(sessionStorageKey);
      }
    };
    void restore();
    return () => {
      cancelled = true;
      eventSourceRef.current?.close();
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: isRunning ? 'smooth' : 'auto', block: 'end' });
  }, [messages, tools, liveText, isRunning]);

  const finishAttempt = (attemptId: string, summary: string) => {
    if (!summary || completedAttemptsRef.current.has(attemptId)) return;
    completedAttemptsRef.current.add(attemptId);
    activeAttemptRef.current = '';
    setMessages((current) => [
      ...current,
      { id: `assistant-${attemptId || Date.now()}`, role: 'assistant', content: summary, attemptId },
    ]);
    setTools((current) => current.map((tool) => (tool.status === 'running' ? { ...tool, status: 'ok' } : tool)));
    setLiveText('');
    setRunState('completed');
    eventSourceRef.current?.close();
  };

  const recoverCompletedAttempt = async (sid: string, attemptId: string) => {
    for (let index = 0; index < 240; index += 1) {
      if (completedAttemptsRef.current.has(attemptId) || activeAttemptRef.current !== attemptId) return;
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      try {
        const history = await requestJson<StoredVibeMessage[]>(
          `/api/vibe/research/messages?sessionId=${encodeURIComponent(sid)}`,
        );
        const answer = history.find(
          (message) => message.role === 'assistant' && message.linked_attempt_id === attemptId,
        );
        if (answer?.content) {
          finishAttempt(attemptId, answer.content);
          return;
        }
      } catch {
        // SSE remains the primary transport; polling only repairs missed completion events.
      }
    }
  };

  const connectResearchStream = (sid: string) =>
    new Promise<void>((resolve, reject) => {
      eventSourceRef.current?.close();
      const source = new EventSource(`/api/vibe/research/events?sessionId=${encodeURIComponent(sid)}`);
      eventSourceRef.current = source;
      let opened = false;
      const timeout = window.setTimeout(() => {
        if (!opened) {
          source.close();
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
          source.close();
          reject(new Error('无法连接 Vibe-Trading 研究事件流'));
        }
      };

      source.addEventListener('attempt.created', (event) => {
        const attemptId = String(parseEvent(event).attempt_id || '');
        if (attemptId) activeAttemptRef.current = attemptId;
        setRunState('researching');
      });
      source.addEventListener('attempt.started', (event) => {
        const attemptId = String(parseEvent(event).attempt_id || '');
        if (attemptId) activeAttemptRef.current = attemptId;
        setRunState('researching');
      });
      source.addEventListener('reasoning_delta', () => setRunState('researching'));
      source.addEventListener('stream_reset', () => setLiveText(''));
      source.addEventListener('text_delta', (event) => {
        const data = parseEvent(event);
        setLiveText((current) => current + String(data.delta || ''));
      });
      source.addEventListener('tool_call', (event) => {
        const data = parseEvent(event);
        const tool = String(data.tool || 'research_tool');
        setTools((current) => [
          ...current,
          { id: `${tool}-${Date.now()}-${current.length}`, tool, status: 'running' },
        ]);
      });
      source.addEventListener('tool_result', (event) => {
        const data = parseEvent(event);
        const tool = String(data.tool || 'research_tool');
        setTools((current) => {
          const index = findLastRunningToolIndex(current, tool);
          if (index < 0) {
            return [
              ...current,
              {
                id: `${tool}-${Date.now()}`,
                tool,
                status: data.status === 'ok' ? 'ok' : 'error',
                preview: String(data.preview || ''),
                elapsedMs: Number(data.elapsed_ms || 0),
              },
            ];
          }
          return current.map((item, itemIndex) =>
            itemIndex === index
              ? {
                  ...item,
                  status: data.status === 'ok' ? 'ok' : 'error',
                  preview: String(data.preview || ''),
                  elapsedMs: Number(data.elapsed_ms || 0),
                  progress: undefined,
                }
              : item,
          );
        });
      });
      source.addEventListener('tool_heartbeat', (event) => {
        const data = parseEvent(event);
        const tool = String(data.tool || '');
        setTools((current) => {
          const index = findLastRunningToolIndex(current, tool);
          return current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, elapsedSeconds: Number(data.elapsed_s || 0) } : item,
          );
        });
      });
      source.addEventListener('tool_progress', (event) => {
        const data = parseEvent(event);
        const tool = String(data.tool || '');
        setTools((current) => {
          const index = findLastRunningToolIndex(current, tool);
          return current.map((item, itemIndex) =>
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
          );
        });
      });
      source.addEventListener('swarm.started', () => {
        setNotice('多智能体研究团队已启动');
      });
      source.addEventListener('swarm.event', (event) => {
        const data = parseEvent(event);
        const swarmEvent = data.event as Record<string, unknown> | undefined;
        if (swarmEvent?.type) setNotice(`多智能体：${String(swarmEvent.type).replace(/_/g, ' ')}`);
      });
      source.addEventListener('attempt.completed', (event) => {
        const data = parseEvent(event);
        const attemptId = String(data.attempt_id || activeAttemptRef.current || 'completed');
        finishAttempt(attemptId, String(data.summary || liveText));
      });
      source.addEventListener('attempt.failed', (event) => {
        const data = parseEvent(event);
        const attemptId = String(data.attempt_id || activeAttemptRef.current || 'failed');
        completedAttemptsRef.current.add(attemptId);
        activeAttemptRef.current = '';
        setRunState('error');
        setError(String(data.error || '研究任务执行失败'));
        source.close();
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

    try {
      const prepared = await requestJson<{
        sessionId: string;
        provider: string;
        model: string;
        baseUrl: string;
      }>('/api/vibe/research/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...buildAiPayload(settings, question), sessionId }),
      });
      setSessionId(prepared.sessionId);
      window.localStorage.setItem(sessionStorageKey, prepared.sessionId);
      setEngine({ status: 'ready', provider: prepared.provider, model: prepared.model, baseUrl: prepared.baseUrl });
      setNotice('研究会话已建立，正在规划任务');

      await connectResearchStream(prepared.sessionId);
      const sent = await requestJson<{ attempt_id: string }>('/api/vibe/research/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: prepared.sessionId, prompt: question }),
      });
      if (completedAttemptsRef.current.has(sent.attempt_id)) return;
      activeAttemptRef.current = sent.attempt_id;
      setRunState('researching');
      setNotice('Vibe-Trading 正在研究');
      void recoverCompletedAttempt(prepared.sessionId, sent.attempt_id);
    } catch (err) {
      eventSourceRef.current?.close();
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
      eventSourceRef.current?.close();
      activeAttemptRef.current = '';
      setRunState('idle');
      setNotice('研究已停止');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const startNewConversation = () => {
    eventSourceRef.current?.close();
    activeAttemptRef.current = '';
    completedAttemptsRef.current.clear();
    window.localStorage.removeItem(sessionStorageKey);
    setSessionId('');
    setPrompt('');
    setMessages([]);
    setTools([]);
    setLiveText('');
    setRunState('idle');
    setError('');
    setNotice('');
    inputRef.current?.focus();
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
    <PageTransition>
      <section className="relative min-h-[calc(100vh-var(--nav-height))] overflow-x-hidden bg-[#08090b] text-white">
        <div className="relative z-10 mx-auto flex min-h-[calc(100vh-var(--nav-height))] w-full max-w-5xl flex-col px-4 pb-5 pt-7 md:px-8">
          <header className="flex min-h-16 items-center justify-between gap-4 border-b border-white/10 pb-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/12 bg-black/70">
                <Bot size={18} className="text-[#ff8a1f]" />
              </span>
              <div className="min-w-0">
                <h1 className="text-lg font-semibold text-white">AI 深度研究</h1>
                <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-white/40">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      engine.status === 'ready'
                        ? 'bg-emerald-300'
                        : engine.status === 'connecting'
                          ? 'animate-pulse bg-amber-300'
                          : 'bg-red-300'
                    }`}
                  />
                  <span className="truncate">
                    {engine.status === 'ready'
                      ? `Vibe-Trading · ${engine.provider} / ${engine.model}`
                      : engine.status === 'connecting'
                        ? '正在连接 Vibe-Trading'
                        : '研究引擎离线'}
                  </span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={startNewConversation}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-white/12 bg-black/50 px-3 text-xs font-semibold text-white/64 transition hover:border-white/24 hover:text-white"
            >
              <Plus size={15} />
              新研究
            </button>
          </header>

          <div
            aria-hidden="true"
            className={`pointer-events-none mx-auto -mb-3 mt-1 h-24 w-full max-w-[560px] overflow-hidden transition-opacity duration-500 md:h-28 ${
              isRunning ? 'opacity-100' : 'opacity-[0.82]'
            }`}
          >
            <Strands
              colors={['#F97316', '#7C3AED', '#06B6D4']}
              count={3}
              speed={isRunning ? 0.74 : 0.5}
              amplitude={isRunning ? 1.12 : 1}
              waviness={isRunning ? 1.9 : 1.7}
              thickness={isRunning ? 0.8 : 0.7}
              glow={isRunning ? 3.7 : 2.6}
              taper={3}
              spread={1}
              intensity={isRunning ? 0.88 : 0.6}
              saturation={isRunning ? 1.7 : 1.5}
              opacity={1}
              scale={1.5}
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

          <div className="sticky bottom-0 z-20 border-t border-white/10 bg-[#08090b]/95 pb-1 pt-4 backdrop-blur-xl">
            <form onSubmit={submit} className="rounded-lg border border-white/14 bg-[#111216] p-2 transition focus-within:border-white/28">
              <textarea
                ref={inputRef}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={handleInputKeyDown}
                maxLength={5000}
                rows={2}
                className="block min-h-14 w-full resize-none bg-transparent px-2 py-2 text-sm leading-6 text-white outline-none placeholder:text-white/32"
                placeholder="输入公司、市场、策略或投资问题..."
                aria-label="深度研究问题"
              />
              <div className="flex items-center justify-between gap-3 px-1 pb-1">
                <div className="flex min-w-0 items-center gap-2 text-[11px] text-white/30">
                  {isRunning ? <Clock3 size={13} /> : <Wrench size={13} />}
                  <span className="truncate">{isRunning ? '研究过程中可以查看实时步骤' : 'Vibe-Trading 研究模式'}</span>
                </div>
                {isRunning ? (
                  <button
                    type="button"
                    onClick={() => void cancelResearch()}
                    title="停止研究"
                    aria-label="停止研究"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/12 text-white/58 transition hover:border-red-300/40 hover:text-red-200"
                  >
                    <CircleStop size={17} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!prompt.trim() || engine.status === 'offline'}
                    title="开始研究"
                    aria-label="开始研究"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#ff7a12] text-white transition hover:bg-[#ff8a1f] disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <SendHorizontal size={17} />
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      </section>
    </PageTransition>
  );
}
