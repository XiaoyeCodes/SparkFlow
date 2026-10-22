import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { BookOpenText, Download, ExternalLink, Newspaper, X } from 'lucide-react';
import { DAILY_DIGESTS, type DailyDigestId, type DigestArticle, type DigestIndex } from '../lib/dailyDigestTypes';
import { DailyDigestReport } from './DailyDigestReport';
import './DailyNewsDialog.css';

let rememberedIndex: DigestIndex | null = null;
const articleCache = new Map<string, DigestArticle>();
const descriptions: Record<DailyDigestId, string> = {
  jin10: '全球财经与市场脉搏',
  daily60: '六十秒，读懂今日世界',
  aibase: '人工智能的每日进展',
};

function validArticle(article: DigestArticle, selected: DailyDigestId) {
  if (article.id !== selected || !article.revision || !/^\d{4}-\d{2}-\d{2}$/.test(article.sourceDate) || !/^https:\/\//.test(article.sourceUrl)) return false;
  const data = article.data as Record<string, any> | null;
  if (selected === 'jin10') return typeof data?.news?.article_html === 'string';
  if (selected === 'daily60') return Array.isArray(data?.news?.news) && data.news.news.length > 0 && data.news.news.every((text: unknown) => typeof text === 'string');
  return Array.isArray(data?.items) && data.items.length > 0 && data.items.every((story: any) => typeof story?.heading === 'string' && Array.isArray(story.bullets) && story.bullets.every((text: unknown) => typeof text === 'string'));
}

export function DailyNewsDialog({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState<DailyDigestId>('jin10');
  const [index, setIndex] = useState<DigestIndex | null>(rememberedIndex);
  const [indexError, setIndexError] = useState('');
  const [article, setArticle] = useState<DigestArticle | null>(null);
  const [articleError, setArticleError] = useState('');
  const [retry, setRetry] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const reader = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();
  const spec = DAILY_DIGESTS.find(item => item.id === selected)!;
  const summary = index?.items.find(item => item.id === selected);
  const revision = summary?.edition?.revision;
  const visibleArticle = article?.id === selected ? article : null;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const element = dialog.current!;
    element.showModal();
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus({ preventScroll: true });
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    const poll = async () => {
      controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 12_000);
      let interval = 30_000;
      try {
        const response = await fetch('/api/daily-digests', { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('读取日报状态失败');
        const result: DigestIndex = await response.json();
        if (result.timezone !== 'Asia/Shanghai' || !Array.isArray(result.items)) throw new Error('日报状态格式不正确');
        if (disposed) return;
        rememberedIndex = result;
        setIndex(result);
        setIndexError('');
        if (result.items.some(item => item.state === 'generating')) interval = 10_000;
      } catch {
        if (!disposed) setIndexError('暂时无法读取日报更新，稍后自动重试。');
      } finally {
        clearTimeout(deadline);
        if (!disposed) timer = setTimeout(() => { void poll(); }, interval);
      }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, [retry]);

  useEffect(() => { reader.current?.scrollTo({ top: 0 }); }, [selected]);

  useEffect(() => {
    setArticleError('');
    if (!revision) return;
    const cached = articleCache.get(`${selected}:${revision}`);
    if (cached) { setArticle(cached); return; }
    setArticle(previous => previous?.id === selected ? previous : null);
    const controller = new AbortController();
    let disposed = false;
    const deadline = setTimeout(() => controller.abort(), 15_000);
    void (async () => {
      try {
        const response = await fetch(`/api/daily-digests/${selected}/article?v=${encodeURIComponent(revision)}`, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('读取正文失败');
        const content: DigestArticle = await response.json();
        if (!validArticle(content, selected)) throw new Error('正文格式不正确');
        if (disposed) return;
        articleCache.set(`${selected}:${content.revision}`, content);
        if (articleCache.size > 9) articleCache.delete(articleCache.keys().next().value!);
        setArticle(content);
      } catch {
        if (!disposed) setArticleError('暂时无法读取本期正文，请重试。');
      } finally { clearTimeout(deadline); }
    })();
    return () => { disposed = true; clearTimeout(deadline); controller.abort(); };
  }, [selected, revision, retry]);

  const changeTab = (event: KeyboardEvent<HTMLButtonElement>, position: number) => {
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? DAILY_DIGESTS.length - 1
      : ['ArrowDown', 'ArrowRight'].includes(event.key) ? (position + 1) % DAILY_DIGESTS.length
        : ['ArrowUp', 'ArrowLeft'].includes(event.key) ? (position + DAILY_DIGESTS.length - 1) % DAILY_DIGESTS.length : null;
    if (next === null) return;
    event.preventDefault();
    setSelected(DAILY_DIGESTS[next].id);
    tabs.current[next]?.focus();
  };
  const notice = articleError || indexError || (visibleArticle && summary?.edition?.sourceDate !== summary?.dueDate
    ? `当前展示 ${visibleArticle.sourceDate} 期，最新一期尚未发布或仍在准备。` : '');

  const keepFocusInside = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Tab') return;
    const elements = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex]')]
      .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);
    const last = elements[elements.length - 1];
    const target = event.shiftKey ? last : elements[0];
    if (target && document.activeElement === (event.shiftKey ? elements[0] : last)) {
      event.preventDefault();
      target.focus();
    }
  };

  return createPortal(
    <dialog ref={dialog} className="daily-news-dialog" aria-labelledby={`${id}-title`}
      onKeyDown={keepFocusInside}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="daily-news-layout">
        <aside className="daily-news-sidebar">
          <p className="daily-news-eyebrow">THE DAILY EDITION</p>
          <h2 id={`${id}-title`}>每日新闻</h2>
          <p className="daily-news-sidebar-intro">从财经、世界到 AI，<br />在这里读完今天。</p>
          <div className="daily-news-tabs" role="tablist" aria-label="日报来源" aria-orientation="vertical">
            {DAILY_DIGESTS.map((item, position) => <button key={item.id} ref={element => { tabs.current[position] = element; }}
              type="button" role="tab" id={`${id}-tab-${item.id}`} aria-selected={selected === item.id}
              aria-controls={`${id}-panel`} tabIndex={selected === item.id ? 0 : -1}
              onKeyDown={event => changeTab(event, position)} onClick={() => setSelected(item.id)}>
              <span className="daily-news-tab-number">0{position + 1}</span>
              <span><b>{item.name}</b><small>{descriptions[item.id]}</small></span>
            </button>)}
          </div>
          <div className="daily-news-sidebar-foot"><span>三份日报 · 一个阅读空间</span><span>按来源原文呈现</span></div>
        </aside>
        <section className="daily-news-main">
          <header className="daily-news-toolbar">
            <div><BookOpenText size={18} /><span>{spec.name}</span></div>
            <div className="daily-news-tools">
              {visibleArticle ? <>
                <a href={`/api/daily-digests/${selected}/text`} download aria-label="下载日报文本" title="下载文本"><Download size={16} /></a>
                <a href={visibleArticle.sourceUrl} target="_blank" rel="noopener noreferrer" className="daily-news-source"><span>查看原文</span><ExternalLink size={13} /></a>
              </> : null}
              <button ref={closeButton} type="button" onClick={onClose} aria-label="关闭每日新闻"><X size={19} /></button>
            </div>
          </header>
          {notice ? <div className="daily-news-notice" role="status">{notice}{articleError || indexError ? <button type="button" onClick={() => setRetry(value => value + 1)}>重试</button> : null}</div> : null}
          <div ref={reader} className="daily-news-reader" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${selected}`} tabIndex={0}>
            {visibleArticle ? <DailyDigestReport article={visibleArticle} appearance="paper" />
              : <div className="daily-news-empty" role="status"><Newspaper size={38} strokeWidth={1.2} />
                <p className="daily-news-eyebrow">{spec.id === 'jin10' ? 'FINANCE' : spec.id === 'daily60' ? 'THE WORLD' : 'ARTIFICIAL INTELLIGENCE'}</p>
                <h3>{articleError ? '正文暂时无法加载' : revision ? '正在打开本期日报' : summary?.state === 'generating' ? '本期日报正在准备' : indexError ? '暂时无法读取日报' : '等待本期日报'}</h3>
                <p>{articleError ? '可以重试读取，或切换到其他日报。' : revision ? '请稍候，完整内容即将呈现。' : `每日 ${String(spec.hour).padStart(2, '0')}:00 更新（北京时间）。`}</p>
                {summary?.state === 'waiting' ? <p>来源尚未发布本期内容，发布后会自动更新。</p> : summary?.state === 'error' ? <p>来源暂时不可用，系统会自动重试。</p> : null}
              </div>}
          </div>
        </section>
      </div>
    </dialog>, document.body,
  );
}
