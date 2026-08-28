import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  AlertCircle,
  ArrowUpRight,
  ChevronDown,
  ExternalLink,
  Flame,
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
  buildAiPayload,
  buildNewsMarkdown,
  loadIntegrationSettings,
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
  const [displayLimit, setDisplayLimit] = useState(60);
  const setSortMode = (mode: NewsSortMode) => setSearchParams((current) => {
    const params = new URLSearchParams(current);
    params.set('sort', mode);
    return params;
  });
  const [now, setNow] = useState(Date.now);
  const currentItems = useMemo(() => newsForSource(feed?.items || [], 'all', now), [feed?.items, now]);

  const visibleItems = useMemo(() => {
    return selectNewsItems(currentItems, category, sortMode, sourceFilter, now);
  }, [category, currentItems, sortMode, sourceFilter, now]);

  const markdown = useMemo(() => buildNewsMarkdown(visibleItems), [visibleItems]);
  const categories = useMemo(() => newsCategoryCounts(newsForSource(currentItems, sourceFilter, now)), [currentItems, sourceFilter, now]);
  const selectedSource = feed?.sources.find((source) => source.id === sourceFilter);
  const dailyMissing = selectedSource?.delivery === 'official-daily' && !newsForSource(currentItems, sourceFilter, now).length;
  const sourceEmptyMessage = selectedSource?.ok && !newsForSource(currentItems, sourceFilter, now).length ? selectedSource.emptyMessage : undefined;
  const displayedItems = visibleItems.slice(0, displayLimit);
  const topWeight = currentItems.reduce((max, item) => Math.max(max, item.weight), 0);
  const connectedSources = feed?.sources.filter((source) => source.ok).length ?? 0;
  const failedSources = feed?.sources.filter((source) => !source.ok).length ?? 0;
  const sortLabel = newsSortOptions.find(([id]) => id === sortMode)?.[1];
  const tickerItems = useMemo(() => selectNewsItems(currentItems, 'all', 'heat', 'all', now).slice(0, 5), [currentItems, now]);

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

  useEffect(() => { setDisplayLimit(60); }, [category, sourceFilter, sortMode, feed]);

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
    const settings = loadIntegrationSettings();
    if (!settings.ai.apiKey || !settings.ai.model) {
      setError('请先从右上角头像菜单进入“设置”，填写 AI API Key 和模型。');
      return;
    }

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
        body: JSON.stringify(buildAiPayload(settings, prompt))
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
            <dl className="signals-stats">
              <div><dt>新闻条目</dt><dd>{feed ? currentItems.length : '—'}<small>条</small></dd></div>
              <div><dt>最高权重</dt><dd className="signals-accent">{feed?.items.length ? topWeight : '—'}<small>/ 100</small></dd></div>
              <div><dt>已连接数据源</dt><dd>{feed ? connectedSources : '—'}<small>{feed ? `/ ${feed.sources.length}` : ''}</small></dd></div>
              <div><dt>最近同步</dt><dd className="signals-sync" title={feed ? formatNewsTime(feed.generatedAt) : undefined}>{loading ? '同步中…' : formatNewsSync(feed?.generatedAt, now)}</dd></div>
            </dl>
          </header>

          <Link className="signals-hot-card" to={{ pathname: '/signals/daily-hot', search: searchParams.toString() }} aria-label="打开今日热榜">
            <span className="signals-hot-icon" aria-hidden="true"><Flame size={25} /></span>
            <span className="signals-hot-body">
              <span className="signals-hot-title">今日热榜 <span>DAILYHOT</span></span>
              <span className="signals-hot-description">全网热点，一屏速览。进入 DailyHot，浏览各平台热门榜单。</span>
              <span className="signals-hot-platforms" aria-label="平台示例"><span>微博</span><span>知乎</span><span>哔哩哔哩</span><span>抖音</span><span>更多平台</span></span>
            </span>
            <span className="signals-hot-action">打开热榜 <ArrowUpRight size={18} aria-hidden="true" /></span>
          </Link>

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
                <label>数据来源
                  <select aria-label="选择新闻数据源" value={sourceFilter} onChange={(event) => changeSource(event.target.value)}>
                    <option value="all">全部来源 · 聚合去重</option>
                    <option value="international">国际媒体 · 聚合去重</option>
                    {sourceFilter !== 'all' && sourceFilter !== 'international' && !selectedSource ? <option value={sourceFilter}>未知来源</option> : null}
                    {feed?.sources.map((source) => <option key={source.id} value={source.id}>{source.label}{source.stale ? '（缓存）' : !source.ok ? '（暂不可用）' : ''}</option>)}
                  </select>
                </label>
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
                    <h2>{!feed && error ? '暂时无法获取新闻' : selectedSource && !selectedSource.ok ? '该来源更新失败' : dailyMissing ? '暂无可用日报' : sourceFilter === 'x-trends-zh' && sourceEmptyMessage ? '暂无匹配的中文话题' : category === 'all' ? '暂无新闻' : '该分类下暂无新闻'}</h2>
                    <p>{!feed && error ? '请检查网络连接后重试。' : selectedSource && !selectedSource.ok ? selectedSource.error : sourceEmptyMessage || '稍后刷新，或切换分类看看其他资讯。'}</p>
                    <button type="button" onClick={category === 'all' ? () => fetchNews(true) : () => changeCategory('all')}>{category === 'all' ? '重新加载' : '查看全部新闻'}</button>
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
