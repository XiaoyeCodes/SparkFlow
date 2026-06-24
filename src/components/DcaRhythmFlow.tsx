import { useEffect, useMemo, useRef } from 'react';
import { drawFlowRows, makePreparedFlowText, type FlowObstacle } from '../engine/pretextFlow';

const FLOW_FONT = '500 13px Inter, "SF Pro Display", "Segoe UI", Arial';
const MICRO_FONT = '600 11px Inter, "SF Pro Display", "Segoe UI", Arial';

const rhythmCopy = [
  '定投节奏不是预测价格，而是让现金流穿过波动。',
  '低位买到更多份额，高位买到更少份额，时间负责把噪音摊平。',
  '固定现金流 / 低价多买份额 / 波动转化为积累',
  '缓慢再平衡，记录每一条规则，在回撤中持续在场',
  'SparkFlow 读取曲线，但行动只由周期、现金流和风险预算触发。'
].join('   ');

const rhythmStats = [
  ['月度现金流', '¥ 4,000', '固定投入'],
  ['回撤缓冲', '18 个月', '现金安全垫'],
  ['再平衡阈值', '± 6%', '规则触发']
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

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
  const prepared = useMemo(() => makePreparedFlowText(rhythmCopy.repeat(26), FLOW_FONT), []);

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
      ctx.strokeStyle = 'rgba(255,255,255,0.055)';
      ctx.lineWidth = 1;

      for (let x = 56; x < width; x += 72) {
        ctx.beginPath();
        ctx.moveTo(x, height * 0.22);
        ctx.lineTo(x, height * 0.86);
        ctx.stroke();
      }

      for (let y = height * 0.28; y < height * 0.86; y += 58) {
        ctx.beginPath();
        ctx.moveTo(width * 0.06, y);
        ctx.lineTo(width * 0.94, y);
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
      gradient.addColorStop(0, 'rgba(138,215,255,0.18)');
      gradient.addColorStop(0.38, 'rgba(185,255,220,0.92)');
      gradient.addColorStop(0.72, 'rgba(243,214,160,0.78)');
      gradient.addColorStop(1, 'rgba(138,215,255,0.28)');

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

    const drawCurveText = (time: number) => {
      const words = ['低位多买份额', '规则执行', '现金流入', '再平衡', '穿越噪音'];
      ctx.save();
      ctx.font = MICRO_FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      words.forEach((word, index) => {
        const progress = ((time * 0.00004 + index / words.length) % 1) * 0.84 + 0.08;
        const x = width * progress;
        const y = waveY(x, width, height, time) - 34 - (index % 2) * 18;
        ctx.fillStyle = index % 2 === 0 ? 'rgba(185,255,220,0.62)' : 'rgba(138,215,255,0.48)';
        ctx.fillText(word, x, y);
      });

      ctx.restore();
    };

    const tick = (time: number) => {
      raf = window.requestAnimationFrame(tick);
      if (document.hidden || time - lastDraw < 16) return;
      lastDraw = time;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(5,5,6,0.92)';
      ctx.fillRect(0, 0, width, height);

      const glow = ctx.createRadialGradient(width * 0.5, height * 0.54, 0, width * 0.5, height * 0.54, Math.max(width, height) * 0.58);
      glow.addColorStop(0, 'rgba(185,255,220,0.14)');
      glow.addColorStop(0.42, 'rgba(138,215,255,0.055)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      drawGrid();

      const obstacle: FlowObstacle = {
        x: width * 0.14,
        y: height * 0.34,
        width: width * 0.72,
        height: height * 0.32,
        padding: clamp(width * 0.025, 20, 48)
      };

      drawFlowRows({
        ctx,
        prepared,
        font: FLOW_FONT,
        width,
        height,
        lineHeight: 24,
        margin: Math.max(22, Math.min(76, width * 0.055)),
        obstacle,
        scroll: time * 0.018,
        color: 'rgba(255,255,255,0.095)'
      });

      drawContributionTicks(time);
      drawCurve(time);
      drawCurveText(time);
    };

    resize();
    window.addEventListener('resize', resize);
    document.fonts?.ready.then(resize).catch(() => undefined);
    raf = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [prepared]);

  return (
    <div className="relative min-h-[660px] overflow-hidden rounded-lg border border-white/10 bg-[#050506]">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(185,255,220,0.10),transparent_34%),linear-gradient(to_bottom,rgba(0,0,0,0.08),rgba(0,0,0,0.48))]" />

      <div className="relative z-10 flex h-full min-h-[660px] flex-col justify-between p-5 md:p-7">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b9ffdc]/72">
              定投节奏流
            </p>
            <h2 className="mt-2 max-w-3xl text-3xl font-semibold leading-tight text-white md:text-5xl">
              定投节奏流线
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/54 md:text-base">
              把价格波动看作一条会呼吸的边界：现金流按月进入，低位自然积累更多份额，高位保持纪律，最终让规则替代择时。
            </p>
          </div>

          <div className="grid gap-2 text-right font-mono text-[11px] uppercase text-white/36">
            <span>节奏 / 每月</span>
            <span>波动 / 接受</span>
            <span>执行 / 规则驱动</span>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {rhythmStats.map(([label, value, caption]) => (
            <div key={label} className="rounded-lg border border-white/10 bg-black/32 p-4 backdrop-blur-md">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/34">{label}</p>
              <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
              <p className="mt-1 text-xs text-[#b9ffdc]/58">{caption}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
