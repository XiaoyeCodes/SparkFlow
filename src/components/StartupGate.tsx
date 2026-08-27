import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { gsap } from 'gsap';
import { StrokeText } from './StrokeText';
import './StartupGate.css';

function StartupOverlay({ onComplete }: { onComplete: () => void }) {
  const rootRef = useRef<HTMLElement>(null);
  const wordRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const [phase, setPhase] = useState<'drawing' | 'zooming'>('drawing');
  const beginZoom = useCallback(() => setPhase('zooming'), []);

  useEffect(() => {
    const deadline = window.setTimeout(onComplete, 6_000);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onPreference = () => { if (reduce.matches) onComplete(); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onComplete(); }
    };
    onPreference();
    reduce.addEventListener('change', onPreference);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(deadline);
      reduce.removeEventListener('change', onPreference);
      window.removeEventListener('keydown', onKey);
    };
  }, [onComplete]);

  useLayoutEffect(() => {
    if (phase !== 'zooming') return;
    const context = gsap.context(() => {
      const timeline = gsap.timeline({ delay: 0.05, onComplete });
      timeline.to(skipRef.current, { autoAlpha: 0, duration: 0.12 }, 0);
      timeline.to(wordRef.current, {
        scale: 18, z: 280, duration: 0.65, ease: 'power3.in', force3D: true,
      }, 0);
      timeline.to(wordRef.current, { opacity: 0, duration: 0.33, ease: 'power1.in' }, 0.32);
      timeline.to(backdropRef.current, { opacity: 0, duration: 0.45, ease: 'power2.inOut' }, 0.2);
    }, rootRef);
    return () => context.revert();
  }, [phase, onComplete]);

  return (
    <section ref={rootRef} className="startup-overlay" data-phase={phase} role="dialog" aria-modal="true" aria-label="SparkFlow 开场动画">
      <div ref={backdropRef} className="startup-backdrop" />
      <div className="startup-stage">
        <div ref={wordRef} className="startup-wordmark">
          <StrokeText onComplete={beginZoom} />
        </div>
      </div>
      <button ref={skipRef} type="button" className="startup-skip" onClick={onComplete} aria-label="跳过开场动画" title="跳过开场动画">
        <ArrowRight size={19} strokeWidth={1.5} aria-hidden="true" />
        <span className="startup-skip-tooltip" aria-hidden="true">跳过动画</span>
      </button>
    </section>
  );
}

export function StartupGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [pending, setPending] = useState(() => pathname === '/' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const contentRef = useRef<HTMLDivElement>(null);
  const active = pending && pathname === '/';
  const finish = useCallback(() => setPending(false), []);

  useEffect(() => { if (pathname !== '/') finish(); }, [pathname, finish]);

  useLayoutEffect(() => {
    if (!active || !contentRef.current) return;
    const content = contentRef.current;
    const html = document.documentElement;
    const body = document.body;
    const previous = { htmlOverflow: html.style.overflow, bodyOverflow: body.style.overflow, padding: body.style.paddingRight, inert: content.inert };
    const scrollbar = window.innerWidth - html.clientWidth;
    content.inert = true;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    if (scrollbar > 0) body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight) + scrollbar}px`;
    return () => {
      content.inert = previous.inert;
      html.style.overflow = previous.htmlOverflow;
      body.style.overflow = previous.bodyOverflow;
      body.style.paddingRight = previous.padding;
    };
  }, [active]);

  return (
    <>
      <div ref={contentRef} aria-hidden={active || undefined}>{children}</div>
      {active ? <StartupOverlay onComplete={finish} /> : null}
    </>
  );
}
