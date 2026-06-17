import { useEffect, useRef } from 'react';
import { ModuleFrame } from '../components/ModuleFrame';

const guideText = '定投纪律沿着净值边界流动。每一次回撤都不是噪声，而是仓位、现金流与时间的重新校准。';

export function Trader() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (time: number) => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#070708';
      ctx.fillRect(0, 0, width, height);

      const points = Array.from({ length: 12 }, (_, index) => {
        const x = 34 + (index / 11) * (width - 68);
        const y =
          height * 0.52 +
          Math.sin(index * 0.92 + time * 0.0007) * 34 +
          Math.cos(index * 0.31) * 26;
        return [x, y] as const;
      });

      ctx.strokeStyle = 'rgba(185,255,220,0.9)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      points.forEach(([x, y], index) => {
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      ctx.font = '500 18px Inter, "SF Pro Display", "Segoe UI", Arial';
      ctx.fillStyle = 'rgba(255,255,255,0.46)';
      ctx.textBaseline = 'middle';
      Array.from({ length: 9 }, (_, index) => {
        const point = points[index + 1];
        const x = point[0] - 42;
        const y = point[1] + (index % 2 === 0 ? -34 : 38);
        ctx.fillText(guideText.slice(index * 5, index * 5 + 14), x, y);
      });

      frame = window.requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener('resize', resize);
    frame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <ModuleFrame title="股票ETF定投软件" kicker="Trader">
      <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
        <div className="overflow-hidden rounded-lg border border-white/10 bg-[#080809]">
          <canvas ref={canvasRef} className="h-[520px] w-full" aria-label="ETF net value boundary preview" />
        </div>
        <aside className="rounded-lg border border-white/10 bg-white/[0.035] p-6">
          <div className="font-mono text-sm text-[#b9ffdc]/75">CORE / 510300 / 513100</div>
          <div className="mt-8 text-6xl font-semibold text-white">12.8%</div>
          <p className="mt-3 text-sm leading-6 text-white/52">Annualized target drift</p>
          <div className="mt-10 space-y-4 text-sm text-white/64">
            <p>回撤触发加仓。</p>
            <p>现金流节奏优先。</p>
            <p>偏离度超过阈值时再平衡。</p>
          </div>
        </aside>
      </div>
    </ModuleFrame>
  );
}
