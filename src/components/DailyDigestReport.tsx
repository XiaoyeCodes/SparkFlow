import { useMemo, type ReactNode } from 'react';
import { ArrowUpRight, ArrowUp, BookOpen } from 'lucide-react';
import type { DigestArticle, DigestMarketRow, DigestMarketSnapshot } from '../lib/dailyDigestTypes';
import './DailyDigestReport.css';

const dateTime = (s: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(s));
const signed = (v: number, digits = 2) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;
const number = (v: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

// Parse inside an inert template. Only text and the small semantic tag allowlist
// are rendered; styles, scripts, images and source event handlers never enter React.
function newsContent(markup: string): { content: ReactNode; sections: string[] } {
  const template = document.createElement('template');
  template.innerHTML = markup;
  const headings = [...template.content.querySelectorAll('h2')];
  const sections = headings.map(h => h.textContent ?? '');
  headings.forEach((h, i) => h.id = `report-section-${i}`);
  const allowed = new Set(['div','p','h2','h3','h4','blockquote','strong','b','em','i','ul','ol','li','span','a','br']);
  const render = (node: Node, key: number): ReactNode => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (!(node instanceof HTMLElement) || !allowed.has(node.tagName.toLowerCase())) return null;
    const children = [...node.childNodes].map(render);
    const tag = node.tagName.toLowerCase();
    const props = { key, ...(tag === 'h2' ? { id: node.id } : {}) };
    switch (tag) {
      case 'h2': return <h2 {...props}>{children}</h2>;
      case 'h3': return <h3 {...props}>{children}</h3>;
      case 'h4': return <h4 {...props}>{children}</h4>;
      case 'p': return <p {...props}>{children}</p>;
      case 'blockquote': return <blockquote {...props}>{children}</blockquote>;
      case 'strong': case 'b': return <strong {...props}>{children}</strong>;
      case 'em': case 'i': return <em {...props}>{children}</em>;
      case 'ul': return <ul {...props}>{children}</ul>;
      case 'ol': return <ol {...props}>{children}</ol>;
      case 'li': return <li {...props}>{children}</li>;
      case 'br': return <br {...props} />;
      case 'a': {
        const href = node.getAttribute('href') ?? '';
        return /^https:\/\/[^/]+/i.test(href) ? <a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span {...props}>{children}</span>;
      }
      case 'span': return <span {...props}>{children}</span>;
      default: return <div {...props}>{children}</div>;
    }
  };
  return { sections, content: [...template.content.childNodes].map(render) };
}

function MarketRow({ row }: { row: DigestMarketRow }) {
  const q = row.quote;
  const change = q ? q.changeBp !== undefined ? `${signed(q.changeBp, 1)} bp` : `${signed(q.changePercent)}%` : '—';
  const detail = q ? `${q.instrument}\n${q.basis}\n${q.delay}\n${q.quotedAt ? '来源报价：' + dateTime(q.quotedAt) : q.observationDate ? '官方公布：' + q.observationDate : '来源未给统计快照时刻'}\n本期采集：${dateTime(q.checkedAt)}` : row.error ?? '本期行情正在准备';
  return <a className={`digest-market-cell${row.state === 'cached' ? ' is-cached' : ''}`} href={q?.sourceUrl} target="_blank" rel="noopener noreferrer" title={detail} aria-label={`${row.name} ${q ? number(q.price) + ' ' + row.unit + ' ' + change + '，' + q.source : '暂无报价'}`}>
    <div className="digest-market-label"><span>{row.name}</span><small>{row.id === 'MAGS' ? 'MAGS' : row.id === 'BRENT' ? '期货' : row.unit}</small></div>
    <div className="digest-market-value"><strong>{q ? number(q.price) + (row.unit === '%' ? '%' : '') : '—'}</strong><span className={q && (q.changeBp ?? q.changePercent) > 0 ? 'is-up' : q && (q.changeBp ?? q.changePercent) < 0 ? 'is-down' : ''}>{change}</span></div>
    <div className="digest-market-provenance"><span>{q?.source ?? '等待本期采集'}{row.state === 'cached' ? ' · 缓存' : ''}</span><time>{q?.quotedAt ? dateTime(q.quotedAt) : q?.observationDate ? q.observationDate.slice(5) + ' 公布' : q ? '24h统计' : ''}</time></div>
  </a>;
}

function MarketOverview({ snapshot }: { snapshot?: DigestMarketSnapshot }) {
  return <section className="digest-market-overview" id="report-markets" aria-label="本期九项市场行情">
    <div className="digest-section-heading"><h2>市场一览</h2><span>{snapshot?.checkedAt ? `本期采集 ${dateTime(snapshot.checkedAt)} · 北京时间` : '随本期日报生成'}</span></div>
    {snapshot?.rows?.length ? <div className="digest-market-grid">{snapshot.rows.map(row => <MarketRow key={row.id} row={row} />)}</div> : <p className="digest-inline-empty">正在准备本期行情，完成后与正文一起缓存。</p>}
    <p className="digest-market-note">股指与 ETF 较前收盘，BTC 为美元现货 24h 口径，黄金为现货，布伦特为期货，美债为日度 CMT。悬停或打开来源可查具体口径与时间。</p>
  </section>;
}

function ReadingOrnament({ side }: { side: 'left' | 'right' }) {
  return <aside className={`digest-reading-ornament is-${side}`} aria-hidden="true">
    <svg viewBox={side === 'left' ? '0 0 180 320' : '0 0 180 520'} fill="none" focusable="false">
      <g stroke="currentColor" strokeWidth=".7" strokeLinecap="round" strokeLinejoin="round">
        {side === 'left' ? <>
          <path d="M90 18v44m0 144v34M15 135h30m90 0h30" />
          <circle cx="90" cy="135" r="61" /><circle cx="90" cy="135" r="42" strokeDasharray="2 7" />
          <ellipse cx="90" cy="135" rx="83" ry="24" transform="rotate(-35 90 135)" />
          <ellipse cx="90" cy="135" rx="24" ry="61" transform="rotate(-35 90 135)" />
          <circle cx="90" cy="135" r="3" /><circle cx="148" cy="95" r="3" />
          <path d="M42 256h96v36H42zM42 268h96m-96 12h96m-72-24v36m24-36v36m24-36v36" opacity=".65" />
          <path d="M30 256H18v12m120 36h12v-12" />
        </> : <>
          <path d="m90 44 66 38-66 38-66-38 66-38Zm-66 62 66 38 66-38M24 130l66 38 66-38M90 120v48M24 82v48m132-48v48M90 190v92" />
          <path d="M26 370a64 64 0 0 1 128 0M42 370a48 48 0 0 1 96 0M58 370a32 32 0 0 1 64 0M74 370a16 16 0 0 1 32 0M14 370h152M90 298v137" />
          <circle cx="90" cy="370" r="3" /><path d="M42 405v16m24-12v24m48-24v24m24-28v16M90 459v39m-17-19h34" />
        </>}
      </g>
    </svg>
  </aside>;
}

export function DailyDigestReport({ article, appearance = 'dark' }: { article: DigestArticle; appearance?: 'dark' | 'paper' }) {
  const data = article.data as Record<string, any>;
  const parsed = useMemo(() => newsContent(data.news?.article_html ?? ''), [article]);
  const isJin10 = article.id === 'jin10';
  const isDaily60 = article.id === 'daily60';
  const title = isJin10 ? '财经早餐' : isDaily60 ? '每日60秒' : 'AIBase 日报';
  const source = isJin10 ? '金十数据' : isDaily60 ? '每日60秒' : 'AIBase';
  const intro = isJin10 ? data.news?.introduction : isDaily60
    ? [data.calendar?.weekday, data.calendar?.lunar_year && data.calendar?.lunar_date ? `农历 ${data.calendar.lunar_year}${data.calendar.lunar_date}` : null].filter(Boolean).join(' · ')
    : data.article_title;
  return <div className={`digest-reading-stage${appearance === 'paper' ? ' is-paper' : ''}`}><ReadingOrnament side="left" />
    <article className={`digest-editorial digest-editorial-${article.id}`} aria-label={`${title} · ${article.sourceDate}`}>
    <header className="digest-report-heading" id="report-top">
      <div className="digest-report-eyebrow"><span><BookOpen size={13} />{source}</span><span>DAILY JOURNAL</span></div>
      <div className="digest-report-title"><h1>{title}</h1><time dateTime={article.sourceDate}><b>{article.sourceDate.slice(5).replace('-', ' / ')}</b><span>{article.sourceDate.slice(0, 4)} · 北京时间</span></time></div>
      {intro ? <p className="digest-report-intro">{intro.trim()}</p> : null}
      <div className="digest-report-byline"><span>{isJin10 ? '全球财经 · 完整原文' : isDaily60 ? '每日新闻 · 看见世界' : 'AI 动态 · 原文提要'}</span><a href={article.sourceUrl} target="_blank" rel="noopener noreferrer">阅读来源 <ArrowUpRight size={12} /></a></div>
    </header>
      {isJin10 ? <><MarketOverview snapshot={data.market} />
      <div className="digest-news-layout">
        <aside className="digest-report-index" aria-label="报告章节"><span>本期目录</span>{parsed?.sections.map((heading, i) => <a key={heading} href={`#report-section-${i}`} onClick={event => { event.preventDefault(); document.getElementById(`report-section-${i}`)?.scrollIntoView({ block: 'start' }); }}><small>{String(i + 1).padStart(2, '0')}</small>{heading}</a>)}</aside>
        <div className="digest-report-prose">{parsed?.content}</div>
      </div>
      {data.news?.disclaimer ? <p className="digest-report-disclaimer">{data.news.disclaimer}</p> : null}</>
        : isDaily60 ? <>
          <ol className="digest-sixty-stories">{(data.news?.news ?? []).map((text: string, position: number) => <li key={position}><span aria-hidden="true">{String(position + 1).padStart(2, '0')}</span><p>{text}</p></li>)}</ol>
          {data.news?.tip ? <aside className="digest-daily-tip"><span>每日寄语</span><p>{data.news.tip}</p></aside> : null}
        </> : <section aria-label="AIBase 新闻正文">{(data.items ?? []).map((story: { heading: string; bullets: string[] }, position: number) => <section className="digest-ai-story" key={position}>
          <span className="digest-story-number" aria-hidden="true">{String(position + 1).padStart(2, '0')}</span>
          <div><h2>{story.heading.replace(/^\s*\d+[、.．]\s*/, '')}</h2>{story.bullets.map((text, part) => <p key={part}>{text}</p>)}</div>
        </section>)}</section>}
    <footer className="digest-report-end"><span>{source} · {article.sourceDate}</span><a href="#report-top" onClick={event => { event.preventDefault(); document.getElementById('report-top')?.scrollIntoView({ block: 'start' }); }}>回到开篇 <ArrowUp size={12} /></a></footer>
  </article><ReadingOrnament side="right" /></div>;
}
