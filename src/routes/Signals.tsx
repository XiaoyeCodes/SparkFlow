import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  ChevronDown,
  ExternalLink,
  Flame,
  Languages,
  Loader2,
  Newspaper,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  X
} from 'lucide-react';
import { PageTransition } from '../components/PageTransition';
import { Link, useSearchParams } from 'react-router-dom';
import {
  buildNewsMarkdown,
  type NewsFeed,
  type NewsItem
} from '../lib/integrations';
import {
  formatNewsSync,
  formatNewsTime,
  getNewsCategory,
  newsCategoryCounts,
  newsPriority,
  newsForSource,
  newsSortOptions,
  newsTimestamp,
  selectNewsItems,
  type NewsCategoryFilter,
  type NewsSortMode
} from '../lib/newsPresentation';
import './Signals.css';
import { SignalsSourceManager } from './SignalsSourceManager';

const NEWS_PORTALS = [
  { id: 'jin10', name: '金十数据', mark: 'J10', descriptor: '全球快讯终端', scope: 'CN · REALTIME', href: 'https://www.jin10.com/' },
  { id: 'wallstreetcn', name: '华尔街见闻', mark: 'WSCN', descriptor: '市场与宏观情报', scope: 'CN · MARKETS', href: 'https://wallstreetcn.com/' },
  { id: 'yicai', name: '第一财经', mark: 'YICAI', descriptor: '商业与产业纵深', scope: 'CN · BUSINESS', href: 'https://www.yicai.com/' },
  { id: 'wsj', name: '华尔街日报', mark: 'WSJ', descriptor: '金融与商业报道', scope: 'US · GLOBAL', href: 'https://www.wsj.com/' },
  { id: 'nyt', name: '纽约时报', mark: 'NYT', descriptor: '世界与经济观察', scope: 'US · WORLD', href: 'https://www.nytimes.com/' },
  { id: 'bbc', name: 'BBC 新闻', mark: 'BBC', descriptor: '全球公共新闻', scope: 'UK · WORLD', href: 'https://www.bbc.com/news' },
  { id: 'reuters', name: '路透社', mark: 'RTR', descriptor: '事实驱动通讯社', scope: 'GLOBAL · WIRE', href: 'https://www.reuters.com/' }
] as const;

const CHINESE_TEXT_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

function isChineseNewsItem(item: NewsItem) {
  return CHINESE_TEXT_PATTERN.test(item.title);
}

export function Signals() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [feed, setFeed] = useState<NewsFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState('');
  const [aiText, setAiText] = useState('');
  const category = getNewsCategory(searchParams.get('category'));
  const sortParam = searchParams.get('sort');
  const sortMode: NewsSortMode = newsSortOptions.find(([id]) => id === sortParam)?.[0] ?? 'weight';
  const sourceFilter = searchParams.get('source') || 'all';
  const onlyChinese = searchParams.get('lang') !== 'all';
  const [displayLimit, setDisplayLimit] = useState(60);
  const setSortMode = (mode: NewsSortMode) => setSearchParams((current) => {
    const params = new URLSearchParams(current);
    params.set('sort', mode);
    return params;
  });
  const [now, setNow] = useState(Date.now);
  const currentItems = useMemo(() => newsForSource(feed?.items || [], 'all', now), [feed?.items, now]);
  const languageItems = useMemo(() => onlyChinese ? currentItems.filter(isChineseNewsItem) : currentItems, [currentItems, onlyChinese]);
  const chineseItemCount = useMemo(() => newsForSource(currentItems, sourceFilter, now).filter(isChineseNewsItem).length, [currentItems, sourceFilter, now]);

  const visibleItems = useMemo(() => {
    return selectNewsItems(languageItems, category, sortMode, sourceFilter, now);
  }, [category, languageItems, sortMode, sourceFilter, now]);

  const markdown = useMemo(() => buildNewsMarkdown(visibleItems), [visibleItems]);
  const categories = useMemo(() => newsCategoryCounts(newsForSource(languageItems, sourceFilter, now)), [languageItems, sourceFilter, now]);
  const selectedSource = feed?.sources.find((source) => source.id === sourceFilter);
  const sourceOptions = useMemo<SourceSelectOption[]>(() => [
    { value: 'all', label: '全部来源 · 聚合去重', tone: 'aggregate' },
    { value: 'international', label: '国际媒体 · 聚合去重', tone: 'aggregate' },
    ...(sourceFilter !== 'all' && sourceFilter !== 'international' && !selectedSource
      ? [{ value: sourceFilter, label: '未知来源', tone: 'warning' as const }]
      : []),
    ...(feed?.sources.map((source) => ({
      value: source.id,
      label: source.label,
      meta: source.stale ? '缓存' : !source.ok ? '暂不可用' : undefined,
      tone: source.stale || !source.ok ? 'warning' as const : 'source' as const
    })) || [])
  ], [feed?.sources, selectedSource, sourceFilter]);
  const dailyMissing = !onlyChinese && selectedSource?.delivery === 'official-daily' && !newsForSource(currentItems, sourceFilter, now).length;
  const sourceEmptyMessage = selectedSource?.ok && !newsForSource(currentItems, sourceFilter, now).length ? selectedSource.emptyMessage : undefined;
  const displayedItems = visibleItems.slice(0, displayLimit);
  const topWeight = currentItems.reduce((max, item) => Math.max(max, item.weight), 0);
  const connectedSources = feed?.sources.filter((source) => source.ok).length ?? 0;
  const failedSources = feed?.sources.filter((source) => !source.ok).length ?? 0;
  const sortLabel = newsSortOptions.find(([id]) => id === sortMode)?.[1];
  const tickerItems = useMemo(() => selectNewsItems(languageItems, 'all', 'heat', 'all', now).slice(0, 5), [languageItems, now]);

  const changeCategory = (next: NewsCategoryFilter) => {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (next === 'all') params.delete('category');
      else params.set('category', next);
      return params;
    });
  };

  const changeSource = (source: string) => {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (source === 'all') params.delete('source');
      else params.set('source', source);
      params.delete('category');
      params.set('sort', ['all', 'international'].includes(source) ? 'weight' : 'source');
      return params;
    });
  };

  const toggleChineseOnly = () => {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (onlyChinese) params.set('lang', 'all');
      else params.delete('lang');
      return params;
    });
  };

  useEffect(() => { setDisplayLimit(60); }, [category, sourceFilter, sortMode, onlyChinese, feed]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    let midnightTimer: number;
    const scheduleMidnight = () => { midnightTimer = window.setTimeout(() => { setNow(Date.now()); scheduleMidnight(); }, 86_400_000 - ((Date.now() + 8 * 3600_000) % 86_400_000) + 5); };
    const updateTime = () => setNow(Date.now());
    scheduleMidnight();
    document.addEventListener('visibilitychange', updateTime);
    return () => { window.clearInterval(timer); window.clearTimeout(midnightTimer); document.removeEventListener('visibilitychange', updateTime); };
  }, []);

  const fetchNews = async (force = false) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(force ? '/api/news-feed?refresh=1' : '/api/news-feed');
      const payload = (await response.json()) as NewsFeed & { detail?: string };
      if (!response.ok) throw new Error(payload.detail || '新闻源拉取失败');
      setFeed(payload);
      setNow(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews();
  }, []);

  const summarizeWithAi = async () => {
    if (!visibleItems.length) return;
    setAiLoading(true);
    setError('');
    setAiText('');
    try {
      const prompt = [
        '请把以下新闻压缩成 SparkFlow 星图情报简报。',
        '要求：1. 按分类给主信号；2. 解释权重最高的原因；3. 标注噪声与待验证问题；4. 给出下一步行动。',
        '',
        markdown
      ].join('\n');
      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      const payload = (await response.json()) as { text?: string; detail?: string };
      if (!response.ok) throw new Error(payload.detail || 'AI 摘要失败');
      setAiText(payload.text || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <PageTransition>
      <div className="signals-page">
        <div className="signals-shell">
          <header className="signals-hud">
            <span className="signals-corner signals-corner--tl" aria-hidden="true" />
            <span className="signals-corner signals-corner--tr" aria-hidden="true" />
            <span className="signals-corner signals-corner--bl" aria-hidden="true" />
            <span className="signals-corner signals-corner--br" aria-hidden="true" />
            <div className="signals-hud-row">
              <div>
                <p className="signals-eyebrow"><span className="signals-live-dot" /> SIGNALS <span>·</span> 实时新闻情报</p>
                <h1>今日新闻</h1>
              </div>
              <div className="signals-actions">
                <ActionButton onClick={() => fetchNews(true)} loading={loading} icon={<RefreshCw size={14} />} label="刷新新闻" />
                <ActionButton onClick={summarizeWithAi} loading={aiLoading} icon={<Sparkles size={14} />} label="AI 摘要" disabled={!visibleItems.length} />
              </div>
            </div>
            <div className="signals-hud-command-row">
              <dl className="signals-stats">
                <div><dt>新闻条目</dt><dd>{feed ? currentItems.length : '—'}<small>条</small></dd></div>
                <div><dt>最高权重</dt><dd className="signals-accent">{feed?.items.length ? topWeight : '—'}<small>/ 100</small></dd></div>
                <div><dt>已连接数据源</dt><dd>{feed ? connectedSources : '—'}<small>{feed ? `/ ${feed.sources.length}` : ''}</small></dd></div>
                <div><dt>最近同步</dt><dd className="signals-sync" title={feed ? formatNewsTime(feed.generatedAt) : undefined}>{loading ? '同步中…' : formatNewsSync(feed?.generatedAt, now)}</dd></div>
              </dl>

              <section className="signals-hud-portals" aria-labelledby="signals-hud-portals-title">
                <header className="signals-hud-portals-heading">
                  <span id="signals-hud-portals-title">快速情报入口</span>
                  <small>8 CHANNELS · DIRECT ACCESS</small>
                </header>
                <nav className="signals-hud-portals-grid" aria-label="热榜与权威媒体官网">
                  <Link
                    className="signals-media-card is-hud-card is-dailyhot"
                    to={{ pathname: '/signals/daily-hot', search: searchParams.toString() }}
                    aria-label="打开今日热榜"
                    style={{ '--portal-order': 0 } as CSSProperties}
                  >
                    <span className="signals-media-texture" aria-hidden="true" />
                    <span className="signals-media-card-top">
                      <span className="signals-media-mark"><Flame size={11} /> HOT</span>
                      <span className="signals-media-scope">ALL · TREND</span>
                    </span>
                    <strong>今日热榜</strong>
                    <span className="signals-media-description">全网榜单聚合</span>
                    <span className="signals-media-card-foot"><span><i aria-hidden="true" /> LIVE</span><ArrowUpRight size={13} aria-hidden="true" /></span>
                  </Link>
                  {NEWS_PORTALS.map((portal, index) => (
                    <a
                      key={portal.id}
                      className={`signals-media-card is-hud-card is-${portal.id}`}
                      href={portal.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`打开${portal.name}官网`}
                      style={{ '--portal-order': index + 1 } as CSSProperties}
                    >
                      <span className="signals-media-texture" aria-hidden="true" />
                      <span className="signals-media-card-top">
                        <span className="signals-media-mark">{portal.mark}</span>
                        <span className="signals-media-scope">{portal.scope}</span>
                      </span>
                      <strong>{portal.name}</strong>
                      <span className="signals-media-description">{portal.descriptor}</span>
                      <span className="signals-media-card-foot"><span><i aria-hidden="true" /> OFFICIAL</span><ArrowUpRight size={13} aria-hidden="true" /></span>
                    </a>
                  ))}
                </nav>
              </section>
            </div>
          </header>

          <SignalsSourceManager feed={feed} onChanged={async (id) => { await fetchNews(true); changeSource(id || 'all'); }} />

          <div className="signals-layout">
            <aside className="signals-sidebar" aria-label="新闻筛选与来源">
              <div className="signals-sidebar-inner">
                <h2 className="signals-section-label">新闻分类 <span>CHANNELS</span></h2>
                <nav className="signals-categories" aria-label="新闻分类">
                  {categories.map((item) => (
                    <button key={item.id} type="button" className={`signals-category ${category === item.id ? 'is-active' : ''}`}
                      onClick={() => changeCategory(item.id)} aria-pressed={category === item.id} aria-controls="signals-news-list">
                      <span>{item.label}</span><span className="signals-category-count">{feed ? item.count : '—'}</span>
                    </button>
                  ))}
                </nav>
                <div className="signals-sidebar-meta">
                  <h2 className="signals-section-label">阅读优先级</h2>
                  <div className="signals-legend"><span className="signals-priority is-high" /><span>高优先</span><small>≥ 78</small></div>
                  <div className="signals-legend"><span className="signals-priority is-mid" /><span>值得看</span><small>58–77</small></div>
                  <div className="signals-legend"><span className="signals-priority is-low" /><span>观察 / 低噪</span><small>&lt; 58</small></div>
                  <p className="signals-scoring-note">原榜名次与本站重要程度分开计算。点击权重查看评分依据，热度不代表可信度。</p>
                  {feed ? (
                    <details className="signals-sources">
                      <summary><span className={failedSources ? 'signals-source-dot is-warning' : 'signals-source-dot'} /><span>{connectedSources} / {feed.sources.length} 数据源已连接</span><ChevronDown size={12} /></summary>
                      <ul>
                        {feed.sources.map((source) => (
                          <li key={source.id} title={source.ok ? `拉取 ${source.count} 条` : source.error || '连接失败'}>
                            <span>{source.label}</span><small className={source.ok ? '' : 'is-warning'}>{source.ok ? '已连接' : source.stale ? '缓存' : '未连接'}</small>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              </div>
            </aside>

            <section className="signals-main" aria-label="新闻列表">
              {error ? (
                <div className="signals-message is-error" role="alert">
                  <AlertCircle size={16} /><p>{error}</p>
                  <button type="button" aria-label="关闭错误提示" onClick={() => setError('')}><X size={14} /></button>
                </div>
              ) : null}
              {failedSources > 0 ? (
                <div className="signals-source-notice"><AlertCircle size={13} />{failedSources} 个新闻源更新失败；如有保留内容，会标记为缓存。</div>
              ) : null}
              {aiLoading || aiText ? (
                <section className="signals-ai" aria-label="AI 新闻摘要" aria-busy={aiLoading}>
                  <div className="signals-ai-heading"><Sparkles size={15} /><h2>AI 新闻摘要</h2><span>AI BRIEF</span>
                    {!aiLoading ? <button type="button" aria-label="关闭 AI 摘要" onClick={() => setAiText('')}><X size={14} /></button> : null}
                  </div>
                  {aiLoading ? <p className="signals-ai-loading" role="status"><Loader2 size={15} className="signals-spin" />正在梳理当前新闻的主要信号…</p> : <p className="signals-ai-text">{aiText}</p>}
                </section>
              ) : null}

              <div className="signals-feed-controls">
                <div className="signals-feed-filter-group">
                  <SourceSelect value={sourceFilter} options={sourceOptions} onChange={changeSource} />
                  <button
                    type="button"
                    role="switch"
                    aria-checked={onlyChinese}
                    className={`signals-language-toggle${onlyChinese ? ' is-active' : ''}`}
                    onClick={toggleChineseOnly}
                  >
                    <span className="signals-language-icon" aria-hidden="true"><Languages size={17} /></span>
                    <span className="signals-language-copy">
                      <strong>只看中文</strong>
                      <small>{onlyChinese ? `已筛选 ${visibleItems.length} 条` : `可筛选 ${chineseItemCount} 条`}</small>
                    </span>
                    <span className="signals-switch-track" aria-hidden="true"><i /></span>
                  </button>
                </div>
                <details className="signals-ranking-guide">
                  <summary>排序规则 <ChevronDown size={12} /></summary>
                  <div>
                    <p><b>原榜顺序</b>：选择来源后保留其原始名次；全部来源按来源分组。RSS、每日论文与早报只保留原始条目顺序，不虚构热榜名次。</p>
                    <p><b>综合权重</b>：重要程度 55% + 时效 25% + 热度 20%；缺少的维度不参与加权。无发布时间扣 8 分，缓存内容扣 10 分。</p>
                    <p><b>重要程度</b>：来源基准 35% + 事件影响 65%，由规则估算；预测、观点及娱乐话题限制得分，不把热搜名次当作事实可信度。</p>
                    <p><b>热度优先</b>：原榜名次按 100 × exp(−(名次−1)/20) 归一化；无榜单但有热度时按来源内指标归一化。原始热度另行保留，不直接比较 Stars、点赞数与搜索量。</p>
                    <p>无发布时间显示“时间待核验”。刷新共享缓存 2 分钟，手动刷新最短间隔 15 秒；失败缓存最多保留 30 分钟。</p>
                  </div>
                </details>
              </div>
              {selectedSource ? <div className="signals-source-context"><span>{selectedSource.note || (selectedSource.rankingKind ? `保留${selectedSource.rankingKind}原始名次` : '该来源未提供热榜名次，原榜顺序按来源条目顺序显示')}{!selectedSource.ok ? ` 更新失败：${selectedSource.error}` : selectedSource.count === 0 ? ' 当前时间范围内暂无条目。' : ''}</span><a href={selectedSource.homepage} target="_blank" rel="noreferrer">查看来源 <ExternalLink size={11} /></a></div> : null}
              {sourceFilter === 'international' ? <p className="signals-source-context">国际媒体聚合 · 内置源仅展示近 24 小时报道，自定义源保留订阅原始日期。官方 RSS 与 Google News 检索分别标注，英文内容保留原文。</p> : null}
              {sortMode === 'source' && ['all', 'international'].includes(sourceFilter) ? <p className="signals-source-context">按来源分组展示原始顺序，不将不同榜单的名次直接混排。</p> : null}
              <div className="signals-topbar">
                <p role="status" aria-live="polite">当前显示 <b>{displayedItems.length}</b>{displayedItems.length < visibleItems.length ? ` / ${visibleItems.length}` : ''} 条<span className="signals-sort-description"> · 按<b>{sortLabel}</b>排序</span></p>
                <div className="signals-sort" role="group" aria-label="新闻排序">
                  {newsSortOptions.map(([id, label]) => (
                    <button key={id} type="button" onClick={() => setSortMode(id)} aria-pressed={sortMode === id}
                      className={sortMode === id ? 'is-active' : ''}>{label}</button>
                  ))}
                </div>
              </div>

              <div id="signals-news-list" className="signals-list" aria-busy={loading}>
                {displayedItems.map((item, index) => <NewsRow key={item.id} item={item} index={index} onSelectSource={changeSource} sortMode={sortMode} />)}
                {loading && !feed ? (
                  <div className="signals-loading">
                    <p role="status"><Loader2 size={16} className="signals-spin" />正在连接新闻源…</p>
                    {[0, 1, 2, 3].map((index) => <div className="signals-skeleton" key={index} aria-hidden="true"><i /><i /><i /></div>)}
                  </div>
                ) : null}
                {!loading && !visibleItems.length ? (
                  <div className="signals-empty">
                    <Newspaper size={28} strokeWidth={1.25} />
                    <h2>{!feed && error ? '暂时无法获取新闻' : selectedSource && !selectedSource.ok ? '该来源更新失败' : onlyChinese ? '当前条件下暂无中文新闻' : dailyMissing ? '暂无可用日报' : sourceFilter === 'x-trends-zh' && sourceEmptyMessage ? '暂无匹配的中文话题' : category === 'all' ? '暂无新闻' : '该分类下暂无新闻'}</h2>
                    <p>{!feed && error ? '请检查网络连接后重试。' : selectedSource && !selectedSource.ok ? selectedSource.error : onlyChinese ? '可关闭“只看中文”，或切换数据来源和新闻分类。' : sourceEmptyMessage || '稍后刷新，或切换分类看看其他资讯。'}</p>
                    <button type="button" onClick={onlyChinese ? toggleChineseOnly : category === 'all' ? () => fetchNews(true) : () => changeCategory('all')}>{onlyChinese ? '显示全部语言' : category === 'all' ? '重新加载' : '查看全部新闻'}</button>
                  </div>
                ) : null}
              </div>
              {displayedItems.length < visibleItems.length ? <button type="button" className="signals-load-more" onClick={() => setDisplayLimit((limit) => limit + 60)}>加载更多 · 还有 {visibleItems.length - displayedItems.length} 条</button> : visibleItems.length ? <p className="signals-list-end"><span />已显示当前筛选全部 {visibleItems.length} 条新闻<span /></p> : null}
            </section>
          </div>
          {tickerItems.length ? <NewsTicker items={tickerItems} /> : null}
        </div>
      </div>
    </PageTransition>
  );
}

type SourceSelectOption = {
  value: string;
  label: string;
  meta?: string;
  tone?: 'aggregate' | 'source' | 'warning';
};

function SourceSelect({ value, options, onChange }: {
  value: string;
  options: SourceSelectOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = options[selectedIndex] || options[0];

  useEffect(() => {
    setActiveIndex(selectedIndex);
  }, [selectedIndex]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    window.addEventListener('pointerdown', closeOnOutsidePress);
    return () => window.removeEventListener('pointerdown', closeOnOutsidePress);
  }, [open]);

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const choose = (option: SourceSelectOption) => {
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const moveActive = (direction: 1 | -1) => {
    setActiveIndex((current) => (current + direction + options.length) % options.length);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(selectedIndex);
      } else {
        moveActive(event.key === 'ArrowDown' ? 1 : -1);
      }
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      if (!open) return;
      event.preventDefault();
      setActiveIndex(event.key === 'Home' ? 0 : options.length - 1);
      return;
    }

    if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault();
      choose(options[activeIndex]);
    }
  };

  return (
    <div className="signals-source-select" ref={rootRef}>
      <span className="signals-source-select-label">数据来源</span>
      <button
        ref={triggerRef}
        type="button"
        className={`signals-source-trigger${open ? ' is-open' : ''}`}
        aria-label="选择新闻数据源"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="signals-source-options"
        aria-activedescendant={open ? `signals-source-option-${activeIndex}` : undefined}
        onClick={() => {
          setOpen((current) => !current);
          setActiveIndex(selectedIndex);
        }}
        onKeyDown={onKeyDown}
      >
        <span className={`signals-source-indicator is-${selected?.tone || 'source'}`} aria-hidden="true" />
        <span className="signals-source-trigger-copy">
          <strong>{selected?.label || '选择来源'}</strong>
          <small>{selected?.meta || (selected?.tone === 'aggregate' ? '已启用跨源去重' : '保持来源原始排序')}</small>
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>

      <div
        id="signals-source-options"
        className={`signals-source-menu${open ? ' is-open' : ''}`}
        role="listbox"
        aria-label="新闻数据源"
        aria-hidden={!open}
      >
        <div className="signals-source-menu-heading">
          <span>选择数据来源</span>
          <small>{options.length} SOURCES</small>
        </div>
        <div className="signals-source-option-list">
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return (
              <button
                ref={(element) => { optionRefs.current[index] = element; }}
                id={`signals-source-option-${index}`}
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                tabIndex={-1}
                className={`signals-source-option${isSelected ? ' is-selected' : ''}${isActive ? ' is-active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option)}
              >
                <span className={`signals-source-indicator is-${option.tone || 'source'}`} aria-hidden="true" />
                <span className="signals-source-option-copy">
                  <strong>{option.label}</strong>
                  {option.meta ? <small>{option.meta}</small> : null}
                </span>
                <span className="signals-source-option-check" aria-hidden="true">
                  {isSelected ? <Check size={15} /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ActionButton({ onClick, loading, disabled, icon, label, primary = false }: {
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  primary?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={loading || disabled} aria-busy={loading}
      className={`signals-action ${primary ? 'is-primary' : ''}`}>
      {loading ? <Loader2 size={14} className="signals-spin" /> : icon}{label}
    </button>
  );
}

function NewsRow({ item, index, onSelectSource, sortMode }: { item: NewsItem; index: number; onSelectSource: (source: string) => void; sortMode: NewsSortMode }) {
  const reducedMotion = useReducedMotion();
  const priority = newsPriority(item.weight);
  const metricLabel = sortMode === 'importance' ? '重要' : sortMode === 'heat' ? '热度' : sortMode === 'source' ? (item.sourceRank ? '榜序' : '序号') : '权重';
  const metric = sortMode === 'importance' ? item.importance : sortMode === 'heat' ? (item.sourceRank || item.sourceHeat ? item.heat : '—') : sortMode === 'source' ? (item.sourceRank || item.sourceOrder || '—') : item.weight;
  return (
    <motion.article className="signals-item"
      initial={reducedMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.02, 0.16) }}>
      <span className={`signals-priority is-${priority}`} title={item.weightLabel} aria-label={item.weightLabel} />
      <div className="signals-item-body">
        <div className="signals-item-meta">
          <time dateTime={newsTimestamp(item.publishedAt) ? item.publishedAt : undefined}>{formatNewsTime(item.publishedAt)}</time>
          <span className="signals-item-category">{item.categoryLabel}</span>
          <span className="signals-item-source">{item.source}<span> · {item.route === 'proxy' ? 'VPN' : '直连'}</span></span>
          {item.delivery ? <span className={`signals-delivery ${['google-news', 'third-party'].includes(item.delivery) ? 'is-aggregated' : ''}`}>{item.delivery === 'google-news' ? 'Google News 检索' : item.delivery === 'custom-rss' ? '自定义 RSS' : item.delivery === 'third-party' ? `${item.providerName || '第三方'} 聚合` : item.delivery === 'official-daily' ? '最新 AI 日报' : item.delivery === 'community-rss' ? '社区官方 RSS' : '官方 RSS'}</span> : null}
          {item.boardObservedAt ? <span title="榜单采样时间，不是话题发布时间">榜单采样 {formatNewsTime(item.boardObservedAt)}</span> : null}
          {item.sourceRank ? <button type="button" className="signals-original-rank" onClick={() => item.sourceId && onSelectSource(item.sourceId)} title="按该来源原榜顺序查看">{item.sourceRankLabel} #{item.sourceRank}</button> : null}
          {item.stale ? <span className="signals-cached" title={`上次成功获取：${formatNewsTime(item.observedAt)}`}>缓存</span> : null}
        </div>
        <h2><a href={item.url} target="_blank" rel="noreferrer">{item.title}<ExternalLink size={13} aria-hidden="true" /></a></h2>
        {item.summary ? <p className="signals-item-summary" title={item.summary}>{item.summary}</p> : null}
        {item.sourceHeat || item.discussionUrl || (item.appearances?.length || 0) > 1 ? <div className="signals-item-extra">
          {item.sourceHeat ? <span>原始热度 {item.sourceHeat}</span> : null}
          {item.discussionUrl ? <a href={item.discussionUrl} target="_blank" rel="noreferrer">查看讨论 ↗</a> : null}
          {(item.appearances?.length || 0) > 1 ? <details><summary>{item.appearances!.length} 个来源收录</summary><div>{item.appearances!.map((entry) => <button type="button" key={entry.sourceId} onClick={() => entry.sourceId && onSelectSource(entry.sourceId)}>{entry.source}{entry.sourceRank ? ` #${entry.sourceRank}` : ''}</button>)}</div></details> : null}
        </div> : null}
      </div>
      <details className={`signals-score is-${priority}${sortMode === 'source' ? ' is-source' : ''}`}>
        <summary aria-label={`${metricLabel} ${metric}，查看评分详情`}><span>{metricLabel}</span><strong>{metric}</strong><ChevronDown size={10} /></summary>
        <div className="signals-score-popover">
          <p>{item.weightLabel}</p>
          <dl><div><dt>综合权重</dt><dd>{item.weight}</dd></div><div><dt>时效</dt><dd>{item.publishedAt ? item.recency : '待核验'}</dd></div><div><dt>重要程度（估算）</dt><dd>{item.importance}</dd></div><div><dt>热度（归一化）</dt><dd>{item.sourceRank || item.sourceHeat ? item.heat : '未提供'}</dd></div></dl>
          {item.ranking ? <ul>{item.ranking.importanceReasons.map((reason) => <li key={reason}>{reason}</li>)}<li>{item.ranking.heatBasis}</li></ul> : null}
          <small>各项得分满分 100</small>
        </div>
      </details>
    </motion.article>
  );
}

function NewsTicker({ items }: { items: NewsItem[] }) {
  const [paused, setPaused] = useState(false);
  return (
    <section className={`signals-ticker ${paused ? 'is-paused' : ''}`} aria-label="热点新闻速览">
      <div className="signals-ticker-badge"><span />GLOBAL ALERT</div>
      <div className="signals-ticker-window">
        <div className="signals-ticker-track">
          <div className="signals-ticker-group">{items.map((item) => <a key={item.id} href={item.url} target="_blank" rel="noreferrer"><b>热点</b>{item.title}</a>)}</div>
          <div className="signals-ticker-group" aria-hidden="true">{items.map((item) => <span key={item.id}><b>热点</b>{item.title}</span>)}</div>
        </div>
      </div>
      <button type="button" onClick={() => setPaused((value) => !value)} aria-label={paused ? '播放热点滚动' : '暂停热点滚动'} aria-pressed={paused}>
        {paused ? <Play size={13} /> : <Pause size={13} />}
      </button>
    </section>
  );
}
