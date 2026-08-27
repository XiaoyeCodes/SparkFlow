import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { gsap } from 'gsap';
import './StrokeText.css';

type StrokeTextProps = {
  text?: string;
  strokeColor?: string;
  strokeWidth?: number;
  drawDuration?: number;
  stagger?: number;
  fontSize?: number;
  fontWeight?: number;
  onComplete?: () => void;
};

type TextBox = { x: number; y: number; width: number; height: number };

// Mount-only TypeScript adaptation of the supplied React Bits StrokeText.
export function StrokeText({
  text = 'SparkFlow',
  strokeColor = '#63d6b5',
  strokeWidth = 1.4,
  drawDuration = 1.1,
  stagger = 0.025,
  fontSize = 128,
  fontWeight = 650,
  onComplete,
}: StrokeTextProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const strokeRef = useRef<SVGTextElement>(null);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const [box, setBox] = useState<TextBox | null>(null);
  const characters = useMemo(() => Array.from(text), [text]);
  const dash = Math.max(fontSize * 7, 200);
  const fontStyle: CSSProperties = { fontSize, fontWeight, letterSpacing: 0 };

  useLayoutEffect(() => {
    let cancelled = false;
    let measured = false;
    const measure = () => {
      if (cancelled || measured || !strokeRef.current) return;
      try {
        const bounds = strokeRef.current.getBBox();
        if (!bounds.width || !bounds.height) return;
        const pad = Math.max(strokeWidth, fontSize * 0.1);
        measured = true;
        setBox({ x: bounds.x - pad, y: bounds.y - pad, width: bounds.width + pad * 2, height: bounds.height + pad * 2 });
      } catch {
        // The startup gate has its own deadline if SVG measurement is unavailable.
      }
    };
    void document.fonts.ready.then(measure, measure);
    const fallback = window.setTimeout(measure, 750);
    return () => { cancelled = true; window.clearTimeout(fallback); };
  }, [text, fontSize, fontWeight, strokeWidth]);

  useLayoutEffect(() => {
    if (!rootRef.current || !box) return;
    const root = rootRef.current;
    const strokes = root.querySelectorAll('[data-stroke-char]');
    const context = gsap.context(() => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.set(strokes, { strokeDashoffset: 0 });
        completeRef.current?.();
        return;
      }
      const timeline = gsap.timeline({ onComplete: () => completeRef.current?.() });
      gsap.set(strokes, { strokeDasharray: dash, strokeDashoffset: dash });
      timeline.to(strokes, { strokeDashoffset: 0, duration: drawDuration, ease: 'sine.inOut', stagger });
    }, root);
    return () => context.revert();
  }, [box, dash, drawDuration, stagger, characters.length]);

  return (
    <span ref={rootRef} className="stroke-text" role="img" aria-label={text}
      style={{ visibility: box ? 'visible' : 'hidden' }}>
      <svg className="stroke-text__svg" aria-hidden="true" preserveAspectRatio="xMidYMid meet"
        viewBox={box ? `${box.x} ${box.y} ${box.width} ${box.height}` : `0 -128 680 164`}>
        <text ref={strokeRef} x="0" y="0" fill="none" stroke={strokeColor} strokeWidth={strokeWidth}
          strokeLinejoin="round" strokeLinecap="round" style={fontStyle}>
          {characters.map((char, index) => <tspan data-stroke-char key={index} strokeDasharray={dash} strokeDashoffset={dash}>{char}</tspan>)}
        </text>
      </svg>
    </span>
  );
}
