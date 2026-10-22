import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download, ExternalLink, Newspaper, X } from 'lucide-react';
import { DAILY_DIGESTS, type DigestArticle, type DigestIndex } from '../lib/dailyDigestTypes';
import { DailyDigestReport } from './DailyDigestReport';
import './TerminalDailyDigests.css';

let remembered: DigestIndex | null = null;
const articles = new Map<string, DigestArticle>();

export function TerminalDailyDigests({ onClose }: { onClose: () => void }) {
  const selected = 'jin10';
  const [index, setIndex] = useState<DigestIndex | null>(remembered);
  const [error, setError] = useState('');
  const [article, setArticle] = useState<DigestArticle | null>(null);
  const [articleError, setArticleError] = useState('');
  const [articleRetry, setArticleRetry] = useState(0);
  const reader = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeButton.current?.focus(); }, []);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let request: AbortController | undefined;
    const poll = async () => {
      request = new AbortController();
      const deadline = setTimeout(() => request?.abort(), 12_000);
      let next = 30_000;
      try {
        const response = await fetch('/api/daily-digests', { signal: request.signal, cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result: DigestIndex = await response.json();
        if (result.timezone !== 'Asia/Shanghai' || !Array.isArray(result.items) || !result.items.some(i => i.id === 'jin10')) throw new Error('日报状态格式不正确');
        if (!disposed) { remembered = result; setIndex(result); setError(''); }
        if (result.items.some(i => i.id === 'jin10' && i.state === 'generating')) next = 10_000;
      } catch {
        if (!disposed) setError('暂时无法读取更新状态，已打开的缓存仍可阅读。稍后自动重试。');
      } finally {
        clearTimeout(deadline);
        if (!disposed) timer = setTimeout(() => { void poll(); }, next);
      }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); request?.abort(); };
  }, []);
  const item = index?.items.find(i => i.id === selected);
  const spec = DAILY_DIGESTS.find(i => i.id === selected)!;
  const editionRevision = item?.edition?.revision;
  useEffect(() => {
    reader.current?.scrollTo({ top: 0 });
  }, [selected]);
  useEffect(() => {
    if (!editionRevision) return;
    const key = `${selected}:${editionRevision}`;
    const cached = articles.get(key);
    setArticleError('');
    if (cached) { setArticle(cached); return; }
    setArticle(previous => previous?.id === selected ? previous : null);
    const controller = new AbortController();
    let disposed = false;
    const deadline = setTimeout(() => controller.abort(), 15_000);
    void (async () => {
      try {
        const response = await fetch(`/api/daily-digests/${selected}/article?v=${encodeURIComponent(editionRevision)}`, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('读取失败');
        const content: DigestArticle = await response.json();
        const data = content.data as Record<string, any>;
        const valid = content.id === selected && typeof data?.news?.article_html === 'string';
        if (!valid) throw new Error('正文格式校验失败');
        if (disposed) return;
        articles.set(`${selected}:${content.revision}`, content);
        if (articles.size > 6) articles.delete(articles.keys().next().value!);
        setArticle(content);
      } catch { if (!disposed) setArticleError('暂时无法读取本期正文，请稍后重试。'); }
      finally { clearTimeout(deadline); }
    })();
    return () => { disposed = true; clearTimeout(deadline); controller.abort(); };
  }, [selected, editionRevision, articleRetry]);
  return <section className="terminal-digests" aria-label="财经早餐阅读区" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <button ref={closeButton} className="terminal-digests-close" type="button" onClick={onClose} aria-label="关闭财经早餐，返回地球"><X size={17} /></button>
    <div ref={reader} className="terminal-digests-reader" role="region" aria-label="金十财经早餐正文" tabIndex={0}>
      {article?.id === selected ? <DailyDigestReport article={article} />
        : <div className="terminal-digests-empty"><Newspaper size={34} strokeWidth={1} /><h3>{articleError || (item?.edition ? '正在读取本期内容' : item?.state === 'generating' ? '正在准备可阅读的本期内容' : error ? '暂时无法读取日报缓存' : '本期内容尚未准备好')}</h3>{articleError ? <button type="button" onClick={() => setArticleRetry(n => n + 1)}>重试读取</button> : item?.edition ? <p>读取本机已生成的缓存。</p> : <p>服务会在每日 {String(spec.hour).padStart(2, '0')}:00 自动生成。<br />错过时间后启动项目，会自动补生成；完成后会直接显示在这里。</p>}{item?.state === 'waiting' ? <p>来源尚未发布当天内容，系统会自动检查。</p> : null}</div>}
    </div>
    <footer className="terminal-digests-footer"><button type="button" onClick={onClose}><ArrowLeft size={13} />返回地球</button>{item?.edition ? <div><a href={`/api/daily-digests/${selected}/text`} download><Download size={13} />下载文本</a><a href={item.edition.sourceUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} />来源</a></div> : null}</footer>
  </section>;
}
