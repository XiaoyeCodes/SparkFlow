import { useEffect, useRef } from 'react';

const rhythmMilestones = [
  ['01', '现金流入', '工资结余进入投资账户'],
  ['02', '低位多买', '价格下行时自然获得更多份额'],
  ['03', '高位少买', '估值偏热时保持节奏不追涨'],
  ['04', '再平衡', '偏离阈值后按规则校准风险']
];

function waveY(x: number, width: number, height: number, time: number) {
  const nx = x / Math.max(width, 1);
  const center = height * 0.58;
  const amp = Math.min(88, height * 0.16);
  const slow = Math.sin(nx * Math.PI * 2.05 + time * 0.00042) * amp;
  const fast = Math.sin(nx * Math.PI * 6.6 - time * 0.00088) * amp * 0.22;
  const recovery = Math.sin((nx - 0.48) * Math.PI) * amp * 0.18;
  return center + slow + fast + recovery;
}

export function DcaRhythmFlow() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let raf = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let lastDraw = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const makeCurvePath = (time: number) => {
      const path = new Path2D();
      const startX = width * 0.08;
      const endX = width * 0.92;
      const steps = 128;

      for (let i = 0; i <= steps; i += 1) {
        const x = startX + ((endX - startX) * i) / steps;
        const y = waveY(x, width, height, time);
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }

      return path;
    };

    const drawGrid = () => {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.048)';
      ctx.lineWidth = 1;

      for (let x = 48; x < width; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, height * 0.18);
        ctx.lineTo(x, height * 0.9);
        ctx.stroke();
      }

      for (let y = height * 0.24; y < height * 0.88; y += 54) {
        ctx.beginPath();
        ctx.moveTo(width * 0.04, y);
        ctx.lineTo(width * 0.96, y);
        ctx.stroke();
      }

      ctx.restore();
    };

    const drawContributionTicks = (time: number) => {
      const count = 14;
      const startX = width * 0.1;
      const endX = width * 0.9;
      const phase = (time * 0.00008) % 1;

      for (let i = 0; i < count; i += 1) {
        const progress = (i + phase) / count;
        const x = startX + (endX - startX) * progress;
        const y = waveY(x, width, height, time);
        const alpha = 0.16 + Math.sin(progress * Math.PI) * 0.34;

        ctx.strokeStyle = `rgba(185,255,220,${alpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, height * 0.25);
        ctx.lineTo(x, y - 12);
        ctx.stroke();

        ctx.fillStyle = `rgba(185,255,220,${alpha + 0.16})`;
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const drawCurve = (time: number) => {
      const path = makeCurvePath(time);
      const gradient = ctx.createLinearGradient(width * 0.08, 0, width * 0.92, 0);
      gradient.addColorStop(0, 'rgba(217,250,233,0.18)');
      gradient.addColorStop(0.38, 'rgba(185,255,220,0.92)');
      gradient.addColorStop(0.72, 'rgba(127,216,179,0.76)');
      gradient.addColorStop(1, 'rgba(217,250,233,0.28)');

      ctx.save();
      ctx.shadowColor = 'rgba(185,255,220,0.58)';
      ctx.shadowBlur = 28;
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.stroke(path);

      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      ctx.stroke(path);
      ctx.restore();
    };

    const tick = (time: number) => {
      raf = window.requestAnimationFrame(tick);
      if (document.hidden || time - lastDraw < 16) return;
      lastDraw = time;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(4,5,5,0.96)';
      ctx.fillRect(0, 0, width, height);

      const glow = ctx.createRadialGradient(width * 0.5, height * 0.5, 0, width * 0.5, height * 0.5, Math.max(width, height) * 0.62);
      glow.addColorStop(0, 'rgba(185,255,220,0.18)');
      glow.addColorStop(0.36, 'rgba(217,250,233,0.07)');
      glow.addColorStop(0.68, 'rgba(127,216,179,0.035)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      drawGrid();
      drawContributionTicks(time);
      drawCurve(time);
    };

    resize();
    window.addEventListener('resize', resize);
    document.fonts?.ready.then(resize).catch(() => undefined);
    raf = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div className="relative min-h-[700px] overflow-hidden rounded-lg border border-white/10 bg-[#050506] shadow-[0_32px_140px_rgba(0,0,0,0.54)] md:min-h-[780px]">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_36%,rgba(185,255,220,0.16),transparent_30%),radial-gradient(circle_at_72%_62%,rgba(217,250,233,0.10),transparent_28%),linear-gradient(to_bottom,rgba(0,0,0,0.05),rgba(0,0,0,0.34)_58%,rgba(0,0,0,0.72))]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[#b9ffdc]/10 to-transparent" />

      <div className="relative z-10 flex h-full min-h-[700px] flex-col justify-between p-5 md:min-h-[780px] md:p-8 lg:p-10">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-start">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#b9ffdc]/72">
              DCA rhythm engine / 定投节奏流
            </p>
            <h2 className="mt-4 max-w-5xl font-serif text-[clamp(3.2rem,8.2vw,8.8rem)] leading-[0.88] text-white/94">
              让现金流穿过波动。
            </h2>
            <p className="mt-6 max-w-2xl text-sm leading-7 text-white/58 md:text-base">
              把价格波动看作一条会呼吸的边界：现金流按月进入，低位自然积累更多份额，高位保持纪律，最终让规则替代择时冲动。
            </p>
          </div>

          <div className="grid w-full max-w-[260px] gap-2 rounded-lg border border-white/10 bg-black/28 p-4 text-right font-mono text-[11px] uppercase text-white/38 backdrop-blur-md md:mt-2">
            <span>cadence / monthly</span>
            <span>volatility / accepted</span>
            <span>execution / rule driven</span>
          </div>
        </div>

        <div className="h-32 md:h-36" aria-hidden="true" />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/52 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] p-5 md:p-8 lg:p-10">
        <div className="grid gap-2 md:grid-cols-4">
          {rhythmMilestones.map(([step, title, body]) => (
            <div key={step} className="rounded-lg border border-white/10 bg-black/42 px-4 py-3 backdrop-blur-md md:px-4 md:py-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#b9ffdc]/62">{step}</p>
              <p className="mt-2 text-sm font-semibold text-white md:text-base">{title}</p>
              <p className="mt-1.5 text-xs leading-5 text-white/44">{body}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="sr-only">
        {rhythmMilestones.map(([step, title, body]) => (
          <div key={step}>
            {step} {title} {body}
          </div>
        ))}
      </div>
    </div>
  );
}
