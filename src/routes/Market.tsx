import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  ArrowUpRight,
  BrainCircuit,
  CheckCircle2,
  Database,
  FileText,
  LoaderCircle,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react';
import { PageTransition } from '../components/PageTransition';
import { TradingViewHeatmap } from '../components/TradingViewHeatmap';
import { buildAiPayload, loadIntegrationSettings, type NewsItem } from '../lib/integrations';

type MarketIndexSnapshot = {
  id: string;
  code: string;
  name: string;
  region: 'CN' | 'HK' | 'US';
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

type InvestorLens = {
  id: string;
  name: string;
  principle: string;
  score: number;
  confidence: '高' | '中' | '低';
  read: string;
  watch: string;
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
  lenses: InvestorLens[];
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

type AsyncState = 'idle' | 'loading' | 'success' | 'error';

export function Market() {
  const [data, setData] = useState<MarketIntelligence | null>(null);
  const [loadState, setLoadState] = useState<AsyncState>('loading');
  const [error, setError] = useState('');
  const [aiState, setAiState] = useState<AsyncState>('idle');
  const [aiRead, setAiRead] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  const loadMarket = useCallback(async () => {
    setLoadState('loading');
    setError('');
    try {
      const response = await fetch('/api/market-intelligence');
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.error || '市场情报接口不可用');
      setData(payload as MarketIntelligence);
      setLoadState('success');
    } catch (requestError) {
      setLoadState('error');
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  }, []);

  useEffect(() => {
    void loadMarket();
  }, [loadMarket]);

  const latestAt = useMemo(() => {
    if (!data) return '--';
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(data.generatedAt));
  }, [data]);

  const runAiAnalysis = async () => {
    if (!data) return;
    const settings = loadIntegrationSettings();
    if (!settings.ai.apiKey || !settings.ai.model) {
      setActionMessage('请先在右上角头像 → 设置中填写 AI API Key 和模型。');
      return;
    }
    setAiState('loading');
    setActionMessage('');
    try {
      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildAiPayload(settings, buildMarketPrompt(data))),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.error || 'AI 分析失败');
      setAiRead(String(payload.text || '模型没有返回文本。'));
      setAiState('success');
    } catch (requestError) {
      setAiState('error');
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
      const response = await fetch('/api/obsidian-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vaultPath: settings.obsidian.vaultPath,
          folder: settings.obsidian.folder,
          title: 'MarketLens 市场情报',
          markdown: buildMarketMarkdown(data, aiRead),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.error || '写入失败');
      setActionMessage(`已写入 Obsidian：${payload.relativePath}`);
    } catch (requestError) {
      setActionMessage(requestError instanceof Error ? requestError.message : String(requestError));
    }
  };

  return (
    <PageTransition>
      <section className="min-h-screen bg-black px-4 pb-12 pt-[calc(var(--nav-height)+24px)] text-white md:px-8">
        <div className="mx-auto w-full max-w-7xl">
          <header className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#8ad7ff]/68">
                <Database size={14} />
                可核验市场研究台
              </div>
              <h1 className="text-4xl font-semibold leading-none md:text-6xl">MarketLens</h1>
              <p className="mt-3 text-sm text-white/46">实时行情、中文新闻、板块资金与券商研报的综合研判</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill data={data} loadState={loadState} latestAt={latestAt} />
              <IconButton label="刷新真实数据" onClick={() => void loadMarket()} disabled={loadState === 'loading'}>
                <RefreshCw size={16} className={loadState === 'loading' ? 'animate-spin' : ''} />
              </IconButton>
              <IconButton label="写入 Obsidian" onClick={() => void saveToObsidian()} disabled={!data}>
                <Save size={16} />
              </IconButton>
            </div>
          </header>

          {error ? <ErrorPanel message={error} onRetry={() => void loadMarket()} /> : null}
          {actionMessage ? (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-[#ffd27a]/20 bg-[#ffd27a]/8 px-4 py-3 text-sm text-[#ffe2a8]">
              <TriangleAlert className="mt-0.5 shrink-0" size={15} />
              <span>{actionMessage}</span>
            </div>
          ) : null}

          {data ? (
            <motion.div
              className="relative overflow-hidden rounded-lg border border-white/10 bg-[#050506] shadow-[0_20px_90px_rgba(0,0,0,0.5)]"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.48 }}
            >
              <div className="relative z-10 border-b border-white/10 p-3 sm:p-4 lg:p-5">
                <IndexStrip indices={data.indices} />
              </div>

              <div className="relative z-10 grid gap-4 p-3 sm:p-4 xl:grid-cols-[minmax(0,1fr)_350px] lg:p-5">
                <div className="h-[min(660px,70vh)] min-h-[520px] overflow-hidden rounded-lg border border-white/10 bg-black">
                  <MarketPanelHeader data={data} />
                  <div className="h-[calc(100%-73px)]">
                    <TradingViewHeatmap mode="stocks" />
                  </div>
                </div>
                <aside className="order-first grid content-start gap-4 xl:order-none">
                  <ScoreCard data={data} onAnalyze={() => void runAiAnalysis()} aiState={aiState} />
                  <BreadthCard data={data} />
                </aside>
              </div>

              <div className="relative z-10 border-t border-white/10 p-4 lg:p-5">
                {data.warning ? (
                  <div className="mb-4 flex items-start gap-2 rounded-lg border border-[#ffd27a]/16 bg-[#ffd27a]/6 px-4 py-3 text-xs leading-5 text-[#ffe2a8]/80">
                    <TriangleAlert className="mt-0.5 shrink-0" size={14} />
                    <span>{data.warning} {data.errors.join('；')}</span>
                  </div>
                ) : null}
                <ScoreBreakdown scores={data.scores} />
                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                  <SectorBoard title="资金流入前列" items={data.sectors.leaders} mode="leader" />
                  <SectorBoard title="资金流出前列" items={data.sectors.laggards} mode="laggard" />
                </div>
                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                  <NewsBoard items={data.news} />
                  <ResearchBoard items={data.reports} />
                </div>
                <InvestorLensBoard lenses={data.lenses} />
                {aiRead ? <AiAnalysisPanel text={aiRead} /> : null}
                <SourceBoard sources={data.sources} disclaimer={data.summary.disclaimer} />
              </div>
            </motion.div>
          ) : loadState === 'loading' ? <LoadingPanel /> : null}
        </div>
      </section>
    </PageTransition>
  );
}

function StatusPill({ data, loadState, latestAt }: { data: MarketIntelligence | null; loadState: AsyncState; latestAt: string }) {
  const live = data?.dataMode === 'live';
  return (
    <div className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-3 text-xs text-white/54">
      <span className={`h-2 w-2 rounded-full ${live ? 'bg-[#75e6b1]' : 'bg-[#ffd27a]'}`} />
      {loadState === 'loading' ? '正在更新' : `${live ? '实时' : '部分在线'} · ${latestAt}`}
    </div>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.045] text-white/60 transition hover:border-[#8ad7ff]/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function IndexStrip({ indices }: { indices: MarketIndexSnapshot[] }) {
  return (
    <div className="grid grid-flow-col auto-cols-[148px] grid-cols-none gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:grid-flow-row sm:auto-cols-auto sm:grid-cols-4 sm:overflow-visible sm:pb-0 xl:grid-cols-7">
      {indices.map((item) => {
        const positive = item.changePercent >= 0;
        return (
          <a key={item.id} href={item.sourceUrl} target="_blank" rel="noreferrer" className="min-w-0 rounded-lg border border-white/10 bg-white/[0.035] px-3 py-3 transition hover:border-white/20">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[11px] text-white/44">{item.name}</p>
              {item.validation.status === 'verified' ? <CheckCircle2 size={12} className="shrink-0 text-[#75e6b1]" /> : <TriangleAlert size={12} className="shrink-0 text-[#ffd27a]" />}
            </div>
            <p className="mt-2 truncate font-mono text-base font-semibold text-white">{formatNumber(item.price)}</p>
            <p className={`mt-1 text-xs font-semibold ${positive ? 'text-[#ff7f7f]' : 'text-[#75e6b1]'}`}>
              {positive ? '+' : ''}{item.changePercent.toFixed(2)}%
            </p>
          </a>
        );
      })}
    </div>
  );
}

function MarketPanelHeader({ data }: { data: MarketIntelligence }) {
  return (
    <div className="flex h-[73px] items-center justify-between border-b border-white/10 bg-white/[0.045] px-5 backdrop-blur-xl">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-[#8ad7ff]" />
          <p className="truncate text-sm font-semibold">标普 500 实时热力图</p>
        </div>
        <p className="mt-1 truncate text-xs text-white/42">{data.summary.headline}</p>
      </div>
      <a href="https://www.tradingview.com/heatmap/stock/" target="_blank" rel="noreferrer" className="ml-4 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 text-white/58 transition hover:text-white" aria-label="打开 TradingView 热力图" title="打开 TradingView 热力图">
        <ArrowUpRight size={16} />
      </a>
    </div>
  );
}

function ScoreCard({ data, onAnalyze, aiState }: { data: MarketIntelligence; onAnalyze: () => void; aiState: AsyncState }) {
  const scoreColor = getScoreColor(data.summary.score);
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.045] p-5 backdrop-blur-xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/40">综合市场评分</p>
          <div className="mt-3 flex items-end gap-3">
            <span className={`font-mono text-6xl font-semibold leading-none ${scoreColor}`}>{data.summary.score}</span>
            <span className="mb-1 text-sm font-semibold text-white/58">/ 100 · {data.summary.scoreLabel}</span>
          </div>
        </div>
        <span className="rounded-full border border-white/10 bg-black/28 px-3 py-1.5 text-xs text-white/58">置信度 {data.confidence}%</span>
      </div>
      <h2 className="mt-5 text-xl font-semibold leading-7 text-white">{data.summary.stance}</h2>
      <p className="mt-2 text-sm leading-6 text-white/52">{data.summary.headline}</p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Metric label="数据置信" value={data.confidenceLabel} />
        <Metric label="风险水平" value={data.summary.riskLevel} />
      </div>
      <button
        type="button"
        onClick={onAnalyze}
        disabled={aiState === 'loading'}
        className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#8ad7ff]/30 bg-[#8ad7ff]/10 px-4 text-sm font-semibold text-white transition hover:bg-[#8ad7ff]/16 disabled:cursor-wait disabled:opacity-60"
      >
        {aiState === 'loading' ? <LoaderCircle size={16} className="animate-spin" /> : <BrainCircuit size={16} />}
        {aiState === 'loading' ? '正在核对证据…' : 'AI 深度解读'}
      </button>
    </div>
  );
}

function BreadthCard({ data }: { data: MarketIntelligence }) {
  const advancePercent = data.breadth.advanceRatio * 100;
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-white/42">
          <Activity size={15} /> 市场宽度
        </div>
        <span className="font-mono text-sm text-[#8ad7ff]">{advancePercent.toFixed(1)}%</span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#75e6b1]/20">
        <div className="h-full bg-[#ff7373]" style={{ width: `${Math.max(0, Math.min(100, advancePercent))}%` }} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Metric label="上涨" value={String(data.breadth.advancers)} compact />
        <Metric label="下跌" value={String(data.breadth.decliners)} compact />
        <Metric label="平盘" value={String(data.breadth.flat)} compact />
      </div>
      <p className="mt-4 text-xs leading-5 text-white/42">行业净流入强度 {(data.sectors.positiveRatio * 100).toFixed(1)}%，基于资金流入与流出双端样本，并与指数方向一起判断行情扩散性。</p>
    </div>
  );
}

function ScoreBreakdown({ scores }: { scores: ScoreDimension[] }) {
  return (
    <section>
      <SectionTitle icon={<ShieldCheck size={15} />} eyebrow="可解释评分" title="每一分从哪里来" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {scores.map((item) => (
          <article key={item.id} className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white/82">{item.label}</p>
              <span className={`font-mono text-xl font-semibold ${getScoreColor(item.score)}`}>{item.score}</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/8">
              <div className="h-full bg-[#8ad7ff]" style={{ width: `${item.score}%` }} />
            </div>
            <p className="mt-3 text-[11px] text-white/34">综合权重 {item.weight}%</p>
            <p className="mt-3 text-xs leading-5 text-white/50">{item.summary}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function SectorBoard({ title, items, mode }: { title: string; items: SectorPulse[]; mode: 'leader' | 'laggard' }) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
      <SectionTitle icon={mode === 'leader' ? <TrendingUp size={15} /> : <TrendingDown size={15} />} eyebrow="板块风向" title={title} compact />
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.code} className="flex items-center justify-between gap-4 rounded-lg border border-white/8 bg-black/24 px-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white/78">{item.name}</p>
              <p className="mt-1 text-[11px] text-white/38">主力占比 {item.mainNetRatio.toFixed(2)}%</p>
            </div>
            <div className="shrink-0 text-right">
              <p className={`font-mono text-sm ${item.changePercent >= 0 ? 'text-[#ff7f7f]' : 'text-[#75e6b1]'}`}>{item.changePercent >= 0 ? '+' : ''}{item.changePercent.toFixed(2)}%</p>
              <p className={`mt-1 text-[11px] ${item.mainNetInflow >= 0 ? 'text-[#ff9b9b]/70' : 'text-[#91eac0]/70'}`}>{formatMoney(item.mainNetInflow)}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function NewsBoard({ items }: { items: NewsItem[] }) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
      <SectionTitle icon={<Activity size={15} />} eyebrow="今日中文新闻" title="高权重市场催化" compact />
      <div className="mt-4 divide-y divide-white/8">
        {items.slice(0, 8).map((item) => (
          <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="block py-3 first:pt-0 last:pb-0">
            <div className="flex items-center gap-2 text-[11px] text-white/36">
              <span>{item.source}</span>
              <span>{formatDateTime(item.publishedAt)}</span>
              <span className="ml-auto rounded-full bg-white/7 px-2 py-1 text-white/52">权重 {item.weight}</span>
            </div>
            <p className="mt-2 text-sm font-semibold leading-6 text-white/78 transition hover:text-white">{item.title}</p>
          </a>
        ))}
        {!items.length ? <p className="py-5 text-sm text-white/40">当前没有可用的中文市场新闻。</p> : null}
      </div>
    </section>
  );
}

function ResearchBoard({ items }: { items: ResearchReport[] }) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
      <SectionTitle icon={<FileText size={15} />} eyebrow="券商研报" title="最新公开研究覆盖" compact />
      <div className="mt-4 divide-y divide-white/8">
        {items.slice(0, 8).map((item) => (
          <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="block py-3 first:pt-0 last:pb-0">
            <div className="flex items-center gap-2 text-[11px] text-white/36">
              <span>{item.institution || '机构未标注'}</span>
              <span>{item.publishedAt || '日期未知'}</span>
              <span className="ml-auto rounded-full bg-[#ffd27a]/9 px-2 py-1 text-[#ffd98f]">{item.rating || '未评级'}</span>
            </div>
            <p className="mt-2 text-sm font-semibold leading-6 text-white/78 transition hover:text-white">{item.stockName ? `${item.stockName}：` : ''}{item.title}</p>
            <p className="mt-1 text-xs text-white/38">{item.industry || '行业未标注'}{item.epsThisYear !== undefined && item.epsNextYear !== undefined ? ` · EPS ${item.epsThisYear} → ${item.epsNextYear}` : ''}</p>
          </a>
        ))}
        {!items.length ? <p className="py-5 text-sm text-white/40">当前没有可用的公开研报。</p> : null}
      </div>
    </section>
  );
}

function InvestorLensBoard({ lenses }: { lenses: InvestorLens[] }) {
  return (
    <section className="mt-4">
      <SectionTitle icon={<Sparkles size={15} />} eyebrow="公开方法论映射" title="同一份证据，六种纪律" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {lenses.map((lens) => (
          <article key={lens.id} className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-lg font-semibold text-white">{lens.name}</p>
                <p className="mt-1 text-xs text-[#ffd98f]/72">{lens.principle}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className={`font-mono text-2xl font-semibold ${getScoreColor(lens.score)}`}>{lens.score}</p>
                <p className="mt-1 text-[10px] text-white/32">置信度 {lens.confidence}</p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-white/56">{lens.read}</p>
            <div className="mt-4 border-t border-white/8 pt-3 text-xs leading-5 text-white/40">观察：{lens.watch}</div>
          </article>
        ))}
      </div>
      <p className="mt-3 text-xs leading-5 text-white/32">这些分数是对公开投资原则的规则化映射，不代表相关人物本人观点；价值投资维度缺少个股财务与估值时会主动降低置信度。</p>
    </section>
  );
}

function AiAnalysisPanel({ text }: { text: string }) {
  return (
    <section className="mt-4 rounded-lg border border-[#8ad7ff]/18 bg-[#8ad7ff]/6 p-5">
      <SectionTitle icon={<BrainCircuit size={15} />} eyebrow="用户配置模型" title="AI 证据解读" compact />
      <div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-white/66">{text}</div>
    </section>
  );
}

function SourceBoard({ sources, disclaimer }: { sources: MarketIntelligence['sources']; disclaimer: string }) {
  return (
    <section className="mt-4 rounded-lg border border-white/10 bg-white/[0.025] p-5">
      <SectionTitle icon={<Database size={15} />} eyebrow="数据血缘" title="来源与校验状态" compact />
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {sources.map((source) => (
          <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="flex items-start gap-3 rounded-lg border border-white/8 bg-black/24 p-3 transition hover:border-white/18">
            {source.ok ? <CheckCircle2 className="mt-0.5 shrink-0 text-[#75e6b1]" size={15} /> : <TriangleAlert className="mt-0.5 shrink-0 text-[#ffd27a]" size={15} />}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white/76">{source.label}</p>
              <p className="mt-1 text-xs text-white/40">{source.provider}</p>
              <p className="mt-1 text-[11px] leading-5 text-white/32">{source.note}</p>
            </div>
            <ArrowUpRight className="ml-auto shrink-0 text-white/28" size={14} />
          </a>
        ))}
      </div>
      <p className="mt-4 text-xs leading-5 text-white/32">{disclaimer} 行情和研报可能存在延迟、口径差异与机构乐观偏差，关键交易决定应回到交易所公告、公司披露和原始研报复核。</p>
    </section>
  );
}

function SectionTitle({ icon, eyebrow, title, compact = false }: { icon: React.ReactNode; eyebrow: string; title: string; compact?: boolean }) {
  return (
    <div className={compact ? '' : 'mb-4'}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-white/36">{icon}{eyebrow}</div>
      <h2 className="mt-2 text-xl font-semibold text-white">{title}</h2>
    </div>
  );
}

function Metric({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className="rounded-lg border border-white/8 bg-black/24 p-3">
      <p className="text-[10px] uppercase text-white/34">{label}</p>
      <p className={`mt-2 font-semibold text-white ${compact ? 'text-lg' : 'text-xl'}`}>{value}</p>
    </div>
  );
}

function LoadingPanel() {
  return (
    <div className="grid min-h-[520px] place-items-center rounded-lg border border-white/10 bg-[#050506]">
      <div className="text-center">
        <LoaderCircle className="mx-auto animate-spin text-[#8ad7ff]" size={25} />
        <p className="mt-4 text-sm text-white/54">正在核对行情、资金、新闻与研报…</p>
      </div>
    </div>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border border-[#ff7f7f]/20 bg-[#ff7f7f]/7 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 text-sm text-[#ffb0b0]">
        <TriangleAlert className="mt-0.5 shrink-0" size={16} />
        <span>{message}</span>
      </div>
      <button type="button" onClick={onRetry} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-white/12 px-3 text-xs font-semibold text-white/72 hover:text-white">
        <RefreshCw size={14} />重试
      </button>
    </div>
  );
}

function buildMarketPrompt(data: MarketIntelligence) {
  const evidence = {
    generatedAt: data.generatedAt,
    summary: data.summary,
    confidence: data.confidence,
    scores: data.scores,
    indices: data.indices.map(({ name, price, changePercent, updatedAt, validation }) => ({ name, price, changePercent, updatedAt, validation })),
    breadth: data.breadth,
    sectorLeaders: data.sectors.leaders.slice(0, 6),
    sectorLaggards: data.sectors.laggards.slice(0, 4),
    reports: data.reports.slice(0, 10),
    news: data.news.slice(0, 12).map(({ title, source, publishedAt, url, weight }) => ({ title, source, publishedAt, url, weight })),
    sourceStatus: data.sources,
  };
  return [
    '你是严谨的中文证券研究助手。请只使用下方 JSON 证据，不得补写未提供的价格、财务数据、新闻或因果关系。',
    '先区分事实、推断和未知；至少给出两条反证或失效条件。不要模仿任何投资者本人发言，只能把段永平、巴菲特、芒格、Druckenmiller、Soros、Paul Tudor Jones 的公开方法论作为分析框架。',
    '输出结构：1) 今日市场结论；2) 大盘与资金风向；3) 新闻与研报交叉验证；4) 六种方法论的共识与分歧；5) 风险清单；6) 下一交易日观察条件。结论要写置信度，不给确定性买卖承诺。',
    JSON.stringify(evidence, null, 2),
  ].join('\n\n');
}

function buildMarketMarkdown(data: MarketIntelligence, aiRead: string) {
  const lines = [
    `# MarketLens 市场情报 - ${new Date(data.generatedAt).toLocaleDateString('zh-CN')}`,
    '',
    `- 综合评分：${data.summary.score}/100（${data.summary.scoreLabel}）`,
    `- 行动姿态：${data.summary.stance}`,
    `- 数据置信度：${data.confidence}%（${data.confidenceLabel}）`,
    `- 风险水平：${data.summary.riskLevel}`,
    `- 摘要：${data.summary.headline}`,
    '',
    '## 主要指数',
    ...data.indices.map((item) => `- ${item.name}：${formatNumber(item.price)}，${item.changePercent >= 0 ? '+' : ''}${item.changePercent.toFixed(2)}%（${item.validation.status}）`),
    '',
    '## 评分拆解',
    ...data.scores.map((item) => `- ${item.label}：${item.score}/100，权重 ${item.weight}%\n  - ${item.summary}`),
    '',
    '## 资金风向',
    ...data.sectors.leaders.slice(0, 8).map((item) => `- ${item.name}：${item.changePercent >= 0 ? '+' : ''}${item.changePercent.toFixed(2)}%，主力净流入 ${formatMoney(item.mainNetInflow)}`),
    '',
    '## 今日新闻',
    ...data.news.slice(0, 12).map((item) => `- [${item.title}](${item.url})（${item.source}，权重 ${item.weight}）`),
    '',
    '## 最新研报',
    ...data.reports.slice(0, 12).map((item) => `- [${item.stockName}：${item.title}](${item.url})（${item.institution}，${item.rating || '未评级'}）`),
    '',
    '## 方法论映射',
    ...data.lenses.map((item) => `- ${item.name}：${item.score}/100（置信度 ${item.confidence}）\n  - ${item.read}\n  - 观察：${item.watch}`),
  ];
  if (aiRead) lines.push('', '## AI 深度解读', '', aiRead);
  lines.push('', '## 风险声明', '', data.summary.disclaimer);
  return lines.join('\n');
}

function getScoreColor(score: number) {
  if (score >= 68) return 'text-[#ff8787]';
  if (score >= 48) return 'text-[#ffd98f]';
  return 'text-[#75e6b1]';
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

function formatDateTime(value?: string) {
  if (!value) return '时间未知';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}
