import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ExternalLink, Flame, Layers3 } from 'lucide-react';
import { HeatmapPretextFlow } from '../components/HeatmapPretextFlow';
import { ModuleFrame } from '../components/ModuleFrame';
import { TradingViewHeatmap } from '../components/TradingViewHeatmap';

const guideText = '定投纪律沿着净值边界流动。每一次回撤都不是噪声，而是仓位、现金流与时间的重新校准。';

export function Trader() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const heatmapPanelRef = useRef<HTMLDivElement | null>(null);
  const [heatmapMode, setHeatmapMode] = useState<'stocks' | 'etfs'>('stocks');

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

  const revealHeatmap = () => {
    document.getElementById('market-heatmap')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <ModuleFrame title="股票ETF定投软件" kicker="Trader">
      <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
        <div className="overflow-hidden rounded-lg border border-white/10 bg-[#080809]">
          <canvas ref={canvasRef} className="h-[520px] w-full" aria-label="ETF net value boundary preview" />
        </div>
        <aside className="rounded-lg border border-white/10 bg-white/[0.035] p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="font-mono text-sm text-[#b9ffdc]/75">CORE / 510300 / 513100</div>
            <button
              type="button"
              onClick={revealHeatmap}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#b9ffdc]/20 bg-[#b9ffdc]/10 text-[#b9ffdc] transition hover:border-[#b9ffdc]/42 hover:bg-[#b9ffdc]/16"
              aria-label="Reveal market heatmap"
            >
              <Flame size={16} strokeWidth={1.8} />
            </button>
          </div>
          <div className="mt-8 text-6xl font-semibold text-white">12.8%</div>
          <p className="mt-3 text-sm leading-6 text-white/52">Annualized target drift</p>
          <div className="mt-10 space-y-4 text-sm text-white/64">
            <p>回撤触发加仓。</p>
            <p>现金流节奏优先。</p>
            <p>偏离度超过阈值时再平衡。</p>
          </div>
          <button
            type="button"
            onClick={revealHeatmap}
            className="mt-10 inline-flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/[0.045] px-4 py-3 text-left text-sm text-white/74 transition hover:border-[#b9ffdc]/28 hover:text-white"
          >
            <span className="inline-flex items-center gap-2">
              <Layers3 size={16} strokeWidth={1.8} />
              背景市场热力图
            </span>
            <ExternalLink size={15} strokeWidth={1.8} />
          </button>
        </aside>
      </div>

      <motion.section
        id="market-heatmap"
        className="relative mt-4 min-h-[660px] scroll-mt-24 overflow-hidden rounded-lg border border-white/10 bg-[#050506]"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.72, delay: 0.12, ease: [0.19, 1, 0.22, 1] }}
      >
        <HeatmapPretextFlow obstacleRef={heatmapPanelRef} />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(138,215,255,0.12),transparent_38%),linear-gradient(to_bottom,rgba(0,0,0,0.18),rgba(0,0,0,0.74))]" />

        <div className="relative z-10 flex items-center justify-between gap-4 px-5 pt-5 md:px-7 md:pt-7">
          <div>
            <p className="text-[11px] font-semibold uppercase text-[#b9ffdc]/72">TradingView Heatmap</p>
            <h2 className="mt-1 text-2xl font-semibold leading-none text-white md:text-4xl">Market heat field</h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-full border border-white/10 bg-black/35 p-1 backdrop-blur-xl">
              {(['stocks', 'etfs'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setHeatmapMode(mode)}
                  className={[
                    'rounded-full px-3 py-1.5 text-xs font-semibold transition',
                    heatmapMode === mode ? 'bg-white text-black' : 'text-white/52 hover:text-white'
                  ].join(' ')}
                >
                  {mode === 'stocks' ? 'Stocks' : 'ETFs'}
                </button>
              ))}
            </div>
            <a
              href={heatmapMode === 'stocks' ? 'https://www.tradingview.com/heatmap/stock/' : 'https://www.tradingview.com/heatmap/etf/'}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/30 text-white/60 transition hover:border-white/24 hover:text-white"
              aria-label="Open TradingView"
            >
              <ExternalLink size={16} strokeWidth={1.8} />
            </a>
          </div>
        </div>

        <div className="relative z-10 mx-auto mt-8 w-[min(1040px,88vw)] px-4 pb-8 md:mt-10 md:px-0">
          <div
            ref={heatmapPanelRef}
            className="heatmap-ambient-panel relative h-[390px] overflow-hidden rounded-lg border border-white/[0.06] bg-black/25 shadow-[0_0_92px_rgba(138,215,255,0.10)] md:h-[430px]"
          >
            <div className="absolute inset-0 opacity-68 brightness-[0.7] contrast-[1.08] saturate-[0.76] [mask-image:radial-gradient(ellipse_at_center,black_52%,rgba(0,0,0,0.72)_74%,transparent_100%)]">
              <TradingViewHeatmap mode={heatmapMode} />
            </div>
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_42%,rgba(0,0,0,0.34)_72%,rgba(0,0,0,0.78)_100%),linear-gradient(to_bottom,rgba(0,0,0,0.2),transparent_28%,rgba(0,0,0,0.32))]" />
          </div>
          <div className="mt-5 grid gap-3 text-sm text-white/54 md:grid-cols-3">
            <p>热力图作为宏观背景信号，不直接参与定投决策。</p>
            <p>颜色只提示市场宽度，真正的动作仍由净值边界与现金流节奏触发。</p>
            <p>点击右上角外链可以进入 TradingView 原站做完整交互。</p>
          </div>
        </div>
      </motion.section>
    </ModuleFrame>
  );
}
