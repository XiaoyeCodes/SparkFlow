import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Maximize2, Minimize2 } from 'lucide-react';
import type { NewsFeed } from '../../lib/newsTypes';
import type { Position } from '../../lib/ibkr/types';
import { fetchNewsEvidence, safeNewsUrl } from '../../lib/ibkr/newsEvidence';
import { fetchMacroEvidence, type MacroEvidenceFeed } from '../../lib/ibkr/macroEvidence';

type Tab = '新闻' | '宏观' | '微观';
type Filter = '全部' | '我的持仓' | '全球宏观' | '行业';

const formatEvidenceTime = (value?: string) => {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(timestamp)) return '时间待核验';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(timestamp);
};

export function IntelligencePanel({ positions, position, expanded, toggleExpanded }: { positions: Position[]; position: Position | null; expanded: boolean; toggleExpanded: () => void }) {
  const [tab, setTab] = useState<Tab>('新闻');
  const [filter, setFilter] = useState<Filter>('全部');
  const [linked, setLinked] = useState(false);
  const [feed, setFeed] = useState<NewsFeed | null>(null);
  const [newsState, setNewsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [newsError, setNewsError] = useState('');
  const [macro, setMacro] = useState<MacroEvidenceFeed | null>(null);
  const [macroError, setMacroError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setNewsState('loading');
    fetchNewsEvidence(controller.signal)
      .then(next => { setFeed(next); setNewsState('ready'); setNewsError(''); })
      .catch(error => {
        if (controller.signal.aborted) return;
        setFeed(null); setNewsState('error'); setNewsError(error instanceof Error ? error.message : '新闻源不可用');
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetchMacroEvidence(controller.signal).then(setMacro).catch(error => {
      if (!controller.signal.aborted) setMacroError(error instanceof Error ? error.message : '宏观源不可用');
    });
    return () => controller.abort();
  }, []);

  const news = useMemo(() => {
    const symbols = positions.map(item => item.symbol.toLocaleUpperCase()).filter(Boolean);
    return (feed?.items ?? []).filter(item => {
      const content = `${item.title} ${item.summary ?? ''}`.toLocaleUpperCase();
      if (filter === '我的持仓') return symbols.some(symbol => content.includes(symbol));
      if (filter === '全球宏观') return item.category === 'world' || /MACRO|宏观|央行|利率|通胀|就业|GDP/.test(content);
      if (filter === '行业') return item.category === 'finance' || item.category === 'tech';
      return true;
    }).slice(0, 20);
  }, [feed, filter, positions]);

  return <section className="ibkr-intelligence" aria-label="新闻与宏微观资讯"><div className="ibkr-intelligence-header"><div className="ibkr-tabs" role="tablist" aria-label="资讯分类">{(['新闻', '宏观', '微观'] as Tab[]).map(item => <button key={item} role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>{item}</button>)}</div><label className="ibkr-ai-link"><input type="checkbox" checked={linked} onChange={event => setLinked(event.target.checked)} />AI 联动 {linked ? '已选上下文 · 尚未分享' : '关闭'}</label><button onClick={toggleExpanded} aria-label={expanded ? '还原资讯区域' : '展开资讯区域'}>{expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button></div>
    <div className="ibkr-intelligence-body" data-testid="intelligence-body"><div className="ibkr-filters">{(['全部', '我的持仓', '全球宏观', '行业'] as Filter[]).map(item => <button key={item} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}{position && <span className="ibkr-pill">关联 {position.symbol} · #{position.conId}</span>}</div>
      {tab === '新闻' ? newsState === 'loading' ? <EvidenceEmpty title="正在读取新闻证据" detail="新闻加载独立于账户、图表、回测与 AI。" /> : newsState === 'error' ? <EvidenceEmpty title="新闻源当前不可用" detail={newsError || '等待新闻聚合服务恢复。'} /> : news.length ? <div className="ibkr-news-grid">{news.map(item => {
        const href = safeNewsUrl(item.url);
        const observedAt = item.observedAt || feed?.sources.find(source => source.id === item.sourceId || source.label === item.source)?.fetchedAt || feed?.generatedAt;
        const content = <><div className="ibkr-news-meta"><b>{item.source}</b>{item.stale && <span>陈旧</span>}</div><h2>{item.title}</h2>{item.summary && <p>{item.summary}</p>}<small>发布 {formatEvidenceTime(item.publishedAt)} · 抓取 {formatEvidenceTime(observedAt)}</small></>;
        return href ? <a className="ibkr-news-card" key={item.id} href={href} target="_blank" rel="noreferrer">{content}<ExternalLink size={12} /></a> : <article className="ibkr-news-card" key={item.id}>{content}</article>;
      })}</div> : <EvidenceEmpty title="没有匹配的可验证新闻" detail={`${filter} · 当前新闻源没有可显示的来源与时间记录。`} />
        : tab === '宏观' ? macro?.items.length ? <div className="ibkr-news-grid">{macro.items.slice(0, 20).map(item => {
          const content = <><div className="ibkr-news-meta"><b>{item.status === 'live' ? '实时源' : item.status === 'delayed' ? '延迟源' : '来源不可用'}</b><span>未映射账户结论</span></div><h2>{item.label}</h2><p>{item.display}</p><small>{item.period ? `统计期 ${item.period}` : '统计期未单列'} · 数据时间 {formatEvidenceTime(item.updatedAt || macro.generatedAt)}</small></>;
          return item.sourceUrl ? <a className="ibkr-news-card" key={item.id} href={item.sourceUrl} target="_blank" rel="noreferrer" aria-label={`${item.label} · 打开宏观来源`}>{content}<ExternalLink size={12} /></a> : <article className="ibkr-news-card" key={item.id}>{content}</article>;
        })}</div> : <EvidenceEmpty title={macroError ? '宏观源当前不可用' : '正在读取宏观证据'} detail={macroError || '宏观加载独立于账户、图表、回测和 AI；数据不会自动变成账户结论。'} />
          : <EvidenceEmpty title="微观数据尚未接入" detail="资金流、期权异动、机构持仓与评级需要各自的数据源及权限。" />}
    </div>
  </section>;
}

function EvidenceEmpty({ title, detail }: { title: string; detail: string }) {
  return <div className="ibkr-intelligence-empty"><span className="ibkr-eyebrow">EVIDENCE STATUS</span><h2>{title}</h2><p>{detail}</p><small>缺失数据保持空态，不使用演示新闻或估算替代事实。</small></div>;
}
