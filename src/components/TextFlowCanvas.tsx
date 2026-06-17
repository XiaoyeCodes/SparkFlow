import { useEffect, useMemo, useRef } from 'react';
import { drawFlowRows, makePreparedFlowText } from '../engine/pretextFlow';
import { textFlowCorpus } from '../data/content';

const FLOW_FONT = '500 13px Inter, "SF Pro Display", "Segoe UI", Arial';

export function TextFlowCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const prepared = useMemo(() => makePreparedFlowText(textFlowCorpus.repeat(18), FLOW_FONT), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let frame = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const drawVignette = () => {
      const fade = ctx.createLinearGradient(0, 0, 0, height);
      fade.addColorStop(0, 'rgba(0,0,0,0.72)');
      fade.addColorStop(0.2, 'rgba(0,0,0,0.12)');
      fade.addColorStop(0.72, 'rgba(0,0,0,0.18)');
      fade.addColorStop(1, 'rgba(0,0,0,0.86)');
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, width, height);
    };

    const tick = (time: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
      ctx.font = FLOW_FONT;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      drawFlowRows({
        ctx,
        prepared,
        font: FLOW_FONT,
        width,
        height,
        lineHeight: 24,
        margin: Math.max(18, Math.min(96, width * 0.075)),
        scroll: time * 0.018,
        color: 'rgba(255,255,255,0.105)'
      });
      drawVignette();
      frame = window.requestAnimationFrame(tick);
    };

    resize();
    window.addEventListener('resize', resize);
    document.fonts?.ready.then(resize).catch(() => undefined);
    frame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }, [prepared]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
}
