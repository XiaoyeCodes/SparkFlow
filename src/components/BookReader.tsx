import { useEffect, useRef, useState } from 'react';
import { BookOpenText, ChevronLeft, ChevronRight, ExternalLink, Minus, Plus, RotateCw, X } from 'lucide-react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import type { Book } from '../data/content';
import './BookReader.css';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

export default function BookReader({ book, onClose, onDetails }: { book: Book; onClose: () => void; onDetails: () => void }) {
  const documents = book.documents!;
  const [version, setVersion] = useState(0);
  const file = documents[version];
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [zoom, setZoom] = useState(1);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState('');
  const [availableSize, setAvailableSize] = useState({ width: 600, height: 600 });
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled)');
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trapFocus);
    return () => { document.removeEventListener('keydown', trapFocus); previousFocus?.focus(); };
  }, []);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      // contentRect already excludes padding; leave one pixel for fractional rounding.
      const width = Math.max(1, Math.floor(entry.contentRect.width) - 1);
      const height = Math.max(1, Math.floor(entry.contentRect.height) - 1);
      setAvailableSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPdf(undefined); setLoading(true); setRendering(true); setError(''); setPage(1); setPageInput('1'); setZoom(1);
    const task = getDocument({
      url: file.readerUrl, isEvalSupported: false,
      cMapUrl: new URL('/api/books/pdf-assets/cmaps/', window.location.href).href,
      cMapPacked: true,
      standardFontDataUrl: new URL('/api/books/pdf-assets/standard_fonts/', window.location.href).href,
    });
    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      cancelled = true; setLoading(false); setError('读取本地书籍超时，请重试或打开原始文件。');
      void task.destroy();
    }, 45_000);
    void task.promise.then(document => {
      if (!cancelled) { window.clearTimeout(timeout); setPdf(document); setLoading(false); }
    }).catch(() => {
      if (!cancelled) { window.clearTimeout(timeout); setLoading(false); setError('本地书籍暂时无法读取，请重试；文件缺失或损坏时需重新下载。'); }
    });
    return () => { cancelled = true; window.clearTimeout(timeout); void task.destroy(); };
  }, [file.url, retry]);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    let task: RenderTask | undefined;
    setRendering(true); setError('');
    viewport.current?.scrollTo({ top: 0, left: 0 });
    void pdf.getPage(page).then(pdfPage => {
      if (cancelled || !canvas.current) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const scale = Math.min(availableSize.width / base.width, availableSize.height / base.height) * zoom;
      const display = pdfPage.getViewport({ scale });
      // Bound raster memory on tablets and unusually large scanned pages.
      const ratio = Math.min(window.devicePixelRatio || 1, 2, 4096 / Math.max(display.width, display.height));
      const target = canvas.current;
      target.width = Math.ceil(display.width * ratio); target.height = Math.ceil(display.height * ratio);
      target.style.width = `${display.width}px`; target.style.height = `${display.height}px`;
      task = pdfPage.render({ canvasContext: target.getContext('2d')!, viewport: pdfPage.getViewport({ scale: scale * ratio }) });
      return task.promise;
    }).then(() => { if (!cancelled) setRendering(false); }).catch(() => {
      if (!cancelled) { setRendering(false); setError('当前页无法显示，请重新加载或打开原始文件。'); }
    });
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, page, availableSize, zoom]);

  useEffect(() => { setPageInput(String(page)); }, [page]);

  const goToPage = () => {
    const value = Number(pageInput);
    if (pdf && Number.isInteger(value) && value >= 1 && value <= pdf.numPages) setPage(value);
    else setPageInput(String(page));
  };

  return (
    <div className="book-reader-overlay">
      <section ref={panel} className="book-reader" role="dialog" aria-modal="true" aria-labelledby="book-reader-title"
        onKeyDown={event => {
          if ((event.target as HTMLElement).matches('input, select') || !pdf) return;
          if (event.key === 'ArrowLeft') { event.preventDefault(); setPage(value => Math.max(1, value - 1)); }
          if (event.key === 'ArrowRight') { event.preventDefault(); setPage(value => Math.min(pdf.numPages, value + 1)); }
        }}>
        <aside className="book-reader-sidebar" aria-label="书籍与翻页">
          <header className="book-reader-header">
            <span>在线阅读 · PDF</span><h2 id="book-reader-title">{book.title}</h2><p>{book.author}</p>
          </header>
          <div className="book-reader-pages">
            <div className="book-reader-page-count">
              <label>第 <input aria-label="页码" type="number" min={1} max={pdf?.numPages ?? 1} value={pageInput} disabled={!pdf}
                onChange={event => setPageInput(event.target.value)} onBlur={goToPage} onKeyDown={event => { if (event.key === 'Enter') goToPage(); }} /> 页</label>
              <span aria-label="总页数">/ {pdf?.numPages ?? '—'}</span>
            </div>
            <div className="book-reader-page-buttons">
              <button type="button" aria-label="上一页" title="上一页（←）" disabled={!pdf || page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={19} /></button>
              <button type="button" aria-label="下一页" title="下一页（→）" disabled={!pdf || page >= pdf.numPages} onClick={() => setPage(value => value + 1)}><ChevronRight size={19} /></button>
            </div>
          </div>
          <div className="book-reader-options">
            {documents.length > 1 ? <select aria-label="书籍版本" value={version} onChange={event => setVersion(Number(event.target.value))}>
              {documents.map((document, index) => <option key={document.url} value={index}>{document.label}</option>)}
            </select> : <span className="book-reader-edition">{file.label}</span>}
          </div>
          <footer className="book-reader-footer"><span>来源：Financial_freedom</span><a href={file.sourceUrl} target="_blank" rel="noopener noreferrer">查看来源 <ExternalLink size={12} /></a></footer>
        </aside>
        <div ref={viewport} className="book-reader-viewport" aria-busy={loading || rendering}>
          {error ? <div className="book-reader-message" role="alert"><BookOpenText size={30} /><p>{error}</p>
            <button type="button" onClick={() => setRetry(value => value + 1)}><RotateCw size={16} />重新加载</button>
            <a href={file.readerUrl} target="_blank" rel="noopener noreferrer">打开本地 PDF <ExternalLink size={14} /></a>
          </div> : null}
          {!error && (loading || rendering) ? <p className="book-reader-loading" role="status">{loading ? `正在打开书籍 · ${(file.sizeBytes / 1048576).toFixed(1)} MB` : '正在显示页面…'}</p> : null}
          <canvas ref={canvas} role="img" aria-label={`${book.title} 第 ${page} 页`} style={{ display: pdf && !error ? 'block' : 'none', visibility: rendering ? 'hidden' : 'visible' }} />
        </div>
        <aside className="book-reader-controls" aria-label="阅读工具">
          <div className="book-reader-actions">
            <button ref={close} type="button" onClick={onClose} aria-label="关闭阅读器" title="关闭阅读器（Esc）"><X size={21} /></button>
            <button type="button" onClick={onDetails} aria-label="查看书籍介绍" title="书籍介绍"><BookOpenText size={18} /></button>
            <a href={file.readerUrl} target="_blank" rel="noopener noreferrer" aria-label="打开原始 PDF" title="打开本地 PDF"><ExternalLink size={18} /></a>
          </div>
          <div className="book-reader-zoom">
            <button type="button" aria-label="缩小" title="缩小" disabled={!pdf || zoom <= 0.6} onClick={() => setZoom(value => Math.max(0.6, +(value - 0.2).toFixed(1)))}><Minus size={17} /></button>
            <button type="button" disabled={!pdf} onClick={() => setZoom(1)} aria-label="整页适应窗口" title="整页适应窗口">{zoom === 1 ? '整页' : `${Math.round(zoom * 100)}%`}</button>
            <button type="button" aria-label="放大" title="放大" disabled={!pdf || zoom >= 2} onClick={() => setZoom(value => Math.min(2, +(value + 0.2).toFixed(1)))}><Plus size={17} /></button>
          </div>
        </aside>
      </section>
    </div>
  );
}
