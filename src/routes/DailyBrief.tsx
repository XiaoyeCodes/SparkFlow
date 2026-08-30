import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BookOpenText,
  BriefcaseBusiness,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  Gauge,
  Newspaper,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DailyBriefMarket, DailyBriefResponse, DailyBriefSnapshot } from '../lib/dailyBriefTypes';
import './DailyBrief.css';

type BriefTab = 'overview' | 'sentiment' | 'portfolio' | 'news';

type LiveQuotePayload = {
  generatedAt?: string;
  ticker?: Array<Record<string, unknown>>;
  coreIndices?: Array<Record<string, unknown>>;
  macro?: Array<Record<string, unknown>>;
  commodities?: Array<Record<string, unknown>>;
};

const tabs: Array<{ id: BriefTab; label: string; Icon: typeof Gauge }> = [
  { id: 'overview', label: '总览', Icon: Gauge },
  { id: 'sentiment', label: '市场情绪', Icon: Activity },
  { id: 'portfolio', label: '我的持仓', Icon: BriefcaseBusiness },
  { id: 'news', label: '重点新闻', Icon: Newspaper },
];

const liveMarketIds = ['china', 'hongkong', 'nasdaq', 'sp500', 'vix', 'gold', 'bitcoin'];

function currentTab(): BriefTab {
  const hash = window.location.hash.replace(/^#/, '');
  return tabs.some((tab) => tab.id === hash) ? hash as BriefTab : 'overview';
}

async function requestJson<T>(url: string) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const payload = await response.json() as T & { detail?: string };
  if (!response.ok) throw new Error(payload.detail || `请求失败（${response.status}）`);
  return payload;
}

function toFinite(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLiveMarket(item: Record<string, unknown>, id: string): DailyBriefMarket {
  const value = toFinite(item.price ?? item.value);
  return {
    id,
    name: String(item.name || item.label || item.symbol || id),
    symbol: String(item.symbol || '').replace(/^\^/, ''),
    value,
    display: typeof item.display === 'string'
      ? item.display
      : value === null ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: value >= 1000 ? 2 : 4 }).format(value),
    changePercent: toFinite(item.changePercent ?? item.change),
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : undefined,
    sourceUrl: typeof item.sourceUrl === 'string' ? item.sourceUrl : undefined,
    status: typeof item.status === 'string' ? item.status : undefined,
  };
}

function extractLiveMarkets(payload: LiveQuotePayload) {
  const pools = [payload.ticker || [], payload.coreIndices || [], payload.macro || [], payload.commodities || []].flat();
  return liveMarketIds.flatMap((id) => {
    const item = pools.find((candidate) => candidate.id === id);
    return item ? [normalizeLiveMarket(item, id)] : [];
  });
}

function formatDate(value?: string, includeDate = true) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    ...(includeDate ? { month: '2-digit', day: '2-digit' } : {}),
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function percentLabel(value: number | null) {
  if (value === null) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function toneLabel(tone?: DailyBriefSnapshot['summary']['tone']) {
  if (tone === 'risk') return '防守';
  if (tone === 'cautious') return '谨慎';
  if (tone === 'calm') return '平稳';
  return '均衡';
}

function MarketCard({ market }: { market: DailyBriefMarket }) {
  const direction = market.changePercent === null ? 'flat' : market.changePercent > 0 ? 'up' : market.changePercent < 0 ? 'down' : 'flat';
  const DirectionIcon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Activity;
  return (
    <article className="brief-market-card">
      <div className="brief-market-card__head">
        <div>
          <p>{market.name}</p>
          <span>{market.symbol || 'MARKET'}</span>
        </div>
        <span className={`brief-market-card__signal is-${direction}`}><DirectionIcon size={14} /></span>
      </div>
      <strong>{market.display}</strong>
      <div className={`brief-change is-${direction}`}>
        <DirectionIcon size={13} /> {percentLabel(market.changePercent)}
      </div>
      <time>{formatDate(market.updatedAt)}</time>
    </article>
  );
}

function ListBlock({ title, items, tone = 'neutral' }: { title: string; items: string[]; tone?: 'neutral' | 'risk' | 'watch' }) {
  return (
    <section className={`brief-list-block is-${tone}`}>
      <p className="brief-list-block__title">{title}</p>
      <ol>
        {items.map((item, index) => (
          <li key={`${title}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><p>{item}</p></li>
        ))}
      </ol>
    </section>
  );
}

export function DailyBrief() {
  const [tab, setTab] = useState<BriefTab>(() => currentTab());
  const [brief, setBrief] = useState<DailyBriefResponse | null>(null);
  const [liveMarkets, setLiveMarkets] = useState<DailyBriefMarket[]>([]);
  const [liveUpdatedAt, setLiveUpdatedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadLiveMarkets = useCallback(async () => {
    const payload = await requestJson<LiveQuotePayload>('/api/global-macro-quotes');
    setLiveMarkets(extractLiveMarkets(payload));
    setLiveUpdatedAt(payload.generatedAt || '');
    return payload;
  }, []);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError('');
    const [briefResult, quoteResult] = await Promise.allSettled([
      requestJson<DailyBriefResponse>('/api/daily-brief'),
      loadLiveMarkets(),
    ]);
    if (briefResult.status === 'fulfilled') setBrief(briefResult.value);
    const failures = [briefResult, quoteResult].filter((result) => result.status === 'rejected') as PromiseRejectedResult[];
    if (failures.length === 2) setError(failures.map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason)).join('；'));
    setLoading(false);
    setRefreshing(false);
  }, [loadLiveMarkets]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => { void loadLiveMarkets().catch(() => undefined); }, 15_000);
    return () => window.clearInterval(timer);
  }, [loadLiveMarkets]);
  useEffect(() => {
    const onHash = () => setTab(currentTab());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const switchTab = (next: BriefTab) => {
    window.history.replaceState(null, '', `${window.location.pathname}#${next}`);
    setTab(next);
    document.querySelector('.daily-brief-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const snapshot = brief?.snapshot;
  const markets = liveMarkets.length ? liveMarkets : snapshot?.markets || [];
  const marketBreadth = useMemo(() => ({
    up: markets.filter((item) => (item.changePercent || 0) > 0).length,
    down: markets.filter((item) => (item.changePercent || 0) < 0).length,
    flat: markets.filter((item) => item.changePercent === null || item.changePercent === 0).length,
  }), [markets]);
  const sourceHealth = snapshot?.sources.filter((source) => source.ok).length || 0;

  return (
    <div className="daily-brief-page">
      <div className="daily-brief-orbit daily-brief-orbit--one" />
      <div className="daily-brief-orbit daily-brief-orbit--two" />
      <div className="daily-brief-shell">
        <header className="daily-brief-hero">
          <div className="daily-brief-hero__copy">
            <p className="daily-brief-eyebrow"><span /> DAILY MARKET BRIEFING · 每日简报</p>
            <h1>看清今天，<br /><em>再做决定。</em></h1>
            <p className="daily-brief-deck">把全球行情、重点新闻与我的持仓收束成一页。没有交易指令，只有需要确认的事实。</p>
          </div>
          <div className="daily-brief-hero__meta">
            <div className="brief-edition">
              <span>{snapshot?.slot === 'evening' ? '晚间简报' : '晨间简报'}</span>
              <strong>{snapshot?.date || new Date().toLocaleDateString('sv-SE')}</strong>
              <small>{snapshot?.summaryMode === 'ai' ? 'AI 总结' : '规则摘要'} · {brief?.cache.hit ? '缓存直读' : '新生成'}</small>
            </div>
            <button type="button" className="brief-refresh" onClick={() => void load(true)} disabled={refreshing}>
              <RefreshCw size={16} className={refreshing ? 'is-spinning' : ''} />
              {refreshing ? '正在刷新行情' : '刷新实时行情'}
            </button>
          </div>
        </header>

        <nav className="daily-brief-tabs" aria-label="每日简报分区">
          {tabs.map(({ id, label, Icon }) => (
            <button key={id} type="button" className={tab === id ? 'is-active' : ''} onClick={() => switchTab(id)}>
              <Icon size={16} /> {label}
            </button>
          ))}
          <div className="daily-brief-tabs__stamp"><Clock3 size={14} /> 实时行情 {formatDate(liveUpdatedAt, false)}</div>
        </nav>

        {error ? <div className="daily-brief-error"><CircleAlert size={17} />{error}</div> : null}

        <section className="brief-market-grid" aria-label="核心市场实时行情">
          {markets.map((market) => <MarketCard market={market} key={market.id} />)}
          {loading && !markets.length ? Array.from({ length: 7 }, (_, index) => <div className="brief-market-card is-loading" key={index} />) : null}
        </section>

        <main className="daily-brief-content">
          {tab === 'overview' ? (
            <div className="brief-overview-grid">
              <section className="brief-primary-panel">
                <div className="brief-section-heading">
                  <div><p><Sparkles size={14} /> TODAY IN ONE PAGE</p><h2>今日结论</h2></div>
                  <span className={`brief-tone is-${snapshot?.summary.tone || 'balanced'}`}>{toneLabel(snapshot?.summary.tone)}</span>
                </div>
                <div className="brief-headline">
                  <span>{snapshot?.summary.regime || '正在整理市场线索'}</span>
                  <h3>{snapshot?.summary.headline || '首次简报正在生成，完成后会自动缓存。'}</h3>
                  <p>生成于 {formatDate(snapshot?.generatedAt)} · {sourceHealth}/{snapshot?.sources.length || 0} 个聚合源可用</p>
                </div>
                <div className="brief-list-grid">
                  <ListBlock title="最值得知道" items={snapshot?.summary.highlights || []} />
                  <ListBlock title="需要留意" items={snapshot?.summary.risks || []} tone="risk" />
                  <ListBlock title="接下来观察" items={snapshot?.summary.watchlist || []} tone="watch" />
                </div>
              </section>

              <aside className="brief-side-panel">
                <div className="brief-section-heading compact"><div><p><Gauge size={14} /> MARKET PULSE</p><h2>市场脉搏</h2></div></div>
                <div className="brief-breadth">
                  <div><strong>{marketBreadth.up}</strong><span>上涨</span></div>
                  <div><strong>{marketBreadth.down}</strong><span>下跌</span></div>
                  <div><strong>{marketBreadth.flat}</strong><span>持平/缺失</span></div>
                </div>
                <div className="brief-mini-metrics">
                  {(snapshot?.macro || []).slice(0, 6).map((item) => (
                    <div key={item.id}><span>{item.name}</span><strong>{item.display}</strong><small className={(item.changePercent || 0) >= 0 ? 'is-up' : 'is-down'}>{percentLabel(item.changePercent)}</small></div>
                  ))}
                </div>
                <button type="button" className="brief-panel-link" onClick={() => switchTab('sentiment')}>查看完整市场情绪 <ChevronRight size={15} /></button>
              </aside>

              <section className="brief-news-preview">
                <div className="brief-section-heading compact">
                  <div><p><Newspaper size={14} /> SIGNALS, NOT NOISE</p><h2>重点新闻</h2></div>
                  <button type="button" onClick={() => switchTab('news')}>全部新闻 <ChevronRight size={14} /></button>
                </div>
                <div className="brief-news-preview__grid">
                  {(snapshot?.news || []).slice(0, 4).map((item, index) => (
                    <a href={item.url} target="_blank" rel="noreferrer" className="brief-news-card" key={item.id}>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <div><small>{item.category} · {item.source}</small><h3>{item.title}</h3><time>{formatDate(item.publishedAt)}</time></div>
                      <ExternalLink size={15} />
                    </a>
                  ))}
                </div>
              </section>

              <section className="brief-portfolio-preview">
                <div className="brief-section-heading compact"><div><p><BriefcaseBusiness size={14} /> MY BOOK</p><h2>持仓关联</h2></div></div>
                <p>{snapshot?.summary.portfolioNotes[0] || '等待读取持仓状态。'}</p>
                <div className="brief-portfolio-preview__status"><ShieldCheck size={17} /><span>{snapshot?.portfolio.connected ? `IBKR 已连接 · ${snapshot.portfolio.positions.length} 个持仓` : 'IBKR 未连接 · 不影响公共市场简报'}</span></div>
                <button type="button" className="brief-panel-link" onClick={() => switchTab('portfolio')}>查看我的持仓 <ChevronRight size={15} /></button>
              </section>
            </div>
          ) : null}

          {tab === 'sentiment' ? (
            <section className="brief-full-panel">
              <div className="brief-section-heading"><div><p><Activity size={14} /> CROSS-ASSET CHECK</p><h2>市场情绪与交叉验证</h2></div><span>不等于交易信号</span></div>
              <div className="brief-sentiment-grid">
                {(snapshot?.macro || markets).map((item) => <MarketCard market={item} key={item.id} />)}
              </div>
              <div className="brief-list-grid is-wide">
                <ListBlock title="当前环境" items={[snapshot?.summary.headline || '—', ...(snapshot?.summary.highlights || [])]} />
                <ListBlock title="风险检查" items={snapshot?.summary.risks || []} tone="risk" />
                <ListBlock title="下一步确认" items={snapshot?.summary.watchlist || []} tone="watch" />
              </div>
            </section>
          ) : null}

          {tab === 'portfolio' ? (
            <section className="brief-full-panel">
              <div className="brief-section-heading"><div><p><BriefcaseBusiness size={14} /> IBKR · READ ONLY</p><h2>我的持仓</h2></div><span>{snapshot?.portfolio.connected ? '已连接' : '未连接'}</span></div>
              {!snapshot?.portfolio.connected ? (
                <div className="brief-empty-state"><BriefcaseBusiness size={28} /><h3>暂未读取 IBKR 持仓</h3><p>请先在本机启动 IB Gateway 模拟盘并启用只读 Socket API。公共市场简报仍可正常使用。</p><a href="/ibkr">打开 IBKR 账户页 <ChevronRight size={15} /></a></div>
              ) : (
                <div className="brief-position-table">
                  <div className="brief-position-row is-head"><span>标的</span><span>类型</span><span>数量</span><span>平均成本</span></div>
                  {snapshot.portfolio.positions.map((position, index) => (
                    <div className="brief-position-row" key={`${position.symbol}-${index}`}>
                      <span><strong>{position.symbol}</strong><small>{position.currency || '—'}</small></span>
                      <span>{position.securityType || '—'}</span>
                      <span>{position.quantity === null ? '—' : position.quantity.toLocaleString('zh-CN')}</span>
                      <span>{position.averageCost === null ? '—' : position.averageCost.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {tab === 'news' ? (
            <section className="brief-full-panel">
              <div className="brief-section-heading"><div><p><Newspaper size={14} /> CURATED NEWS</p><h2>今日重点新闻</h2></div><span>{snapshot?.news.length || 0} 条</span></div>
              <div className="brief-news-list">
                {(snapshot?.news || []).map((item, index) => (
                  <article key={item.id}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <div><p>{item.category} · {item.source} · 权重 {item.weight}</p><h3>{item.title}</h3>{item.summary ? <div>{item.summary}</div> : null}<time>{formatDate(item.publishedAt)}</time></div>
                    <a href={item.url} target="_blank" rel="noreferrer" aria-label={`阅读：${item.title}`}><ExternalLink size={16} /></a>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </main>

        <footer className="daily-brief-footer">
          <div><BookOpenText size={15} /><span>简报快照每日 08:00 / 18:00 更新；行情与热力图保持各自实时频率。</span></div>
          <div><CalendarDays size={15} /><span>架构思路参考 Day1 Global Briefing（MIT），页面由 SparkFlow 独立实现。</span></div>
        </footer>
      </div>
    </div>
  );
}
