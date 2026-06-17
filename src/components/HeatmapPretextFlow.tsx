import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { drawFlowRows, makePreparedFlowText, type FlowObstacle } from '../engine/pretextFlow';

const FLOW_FONT = '500 13px Inter, "SF Pro Display", "Segoe UI", Arial';

const heatmapCopy = [
  'Heatmaps compress market breadth into a single field of pressure.',
  'Red is not panic. Green is not permission. Sector rotation must be read with liquidity, volatility, and time.',
  'SPX500 blocks show relative attention. ETF maps reveal where allocation is drifting.',
  'SparkFlow keeps TradingView as an external macro lens while the strategy engine stays calm.',
  '定投不是追逐颜色，而是在波动、估值、现金流之间保持节奏。'
].join('   ');

export function HeatmapPretextFlow({ obstacleRef }: { obstacleRef: RefObject<HTMLElement> }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const prepared = useMemo(() => makePreparedFlowText(heatmapCopy.repeat(22), FLOW_FONT), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
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

    const getObstacle = (): FlowObstacle | null => {
      const host = canvas.parentElement;
      const obstacle = obstacleRef.current;
      if (!host || !obstacle) return null;

      const hostRect = host.getBoundingClientRect();
      const obstacleRect = obstacle.getBoundingClientRect();

      return {
        x: obstacleRect.left - hostRect.left,
        y: obstacleRect.top - hostRect.top,
        width: obstacleRect.width,
        height: obstacleRect.height,
        padding: 30
      };
    };

    const tick = (time: number) => {
      ctx.clearRect(0, 0, width, height);
      drawFlowRows({
        ctx,
        prepared,
        font: FLOW_FONT,
        width,
        height,
        lineHeight: 24,
        margin: Math.max(22, Math.min(76, width * 0.055)),
        obstacle: getObstacle(),
        scroll: time * 0.012,
        color: 'rgba(255,255,255,0.105)'
      });
      frame = window.requestAnimationFrame(tick);
    };

    resize();
    window.addEventListener('resize', resize);
    frame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }, [obstacleRef, prepared]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />;
}
