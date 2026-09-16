import { useEffect, useRef, useState } from 'react';
import './ValuationWorkspace.css';

/** The exact same self-contained artifact serves both the workbench and HTML export. */
export function ValuationWorkspace() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(900);

  useEffect(() => {
    const iframe = frame.current;
    if (!iframe) return;
    let resizeObserver: ResizeObserver | undefined;
    let mutationObserver: MutationObserver | undefined;
    let animationFrame = 0;

    const measure = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const document = iframe.contentDocument;
        if (!document?.body) return;
        const next = Math.ceil(Math.max(document.body.scrollHeight, document.body.getBoundingClientRect().height));
        if (next > 0) setHeight(current => Math.abs(current - next) > 1 ? next : current);
      });
    };
    const connect = () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      const document = iframe.contentDocument;
      if (!document?.body) return;
      resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(document.body);
      mutationObserver = new MutationObserver(measure);
      mutationObserver.observe(document.body, { attributes: true, childList: true, subtree: true });
      void document.fonts?.ready.then(measure);
      measure();
    };

    iframe.addEventListener('load', connect);
    window.addEventListener('resize', measure);
    if (iframe.contentDocument?.readyState === 'complete') connect();
    return () => {
      iframe.removeEventListener('load', connect);
      window.removeEventListener('resize', measure);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      cancelAnimationFrame(animationFrame);
    };
  }, []);

  return <iframe
    ref={frame}
    className="awb-valuation-frame"
    src="/artifacts/market-valuation.html?embed=1"
    title="大盘估值分位监控"
    data-testid="valuation-frame"
    scrolling="no"
    style={{ height }}
  />;
}
