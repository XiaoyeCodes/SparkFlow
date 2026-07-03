import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { ArrowUpRight, Gauge, Radio, Route, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Hyperspeed } from '../components/Hyperspeed';
import { InfiniteMenu } from '../components/InfiniteMenu';
import { PageTransition } from '../components/PageTransition';
import { realtimeWindows } from '../data/realtimeWindows';

const hyperspeedOptions = {
  length: 460,
  roadWidth: 9.6,
  lanesPerRoad: 4,
  fov: 88,
  speedUp: 2.6,
  colors: {
    roadColor: 0x050507,
    background: 0x000000,
    shoulderLines: 0xf4f8ff,
    brokenLines: 0x8ad7ff,
    leftCars: [0xf0f7ff, 0x8ad7ff, 0x5e6cff],
    rightCars: [0xb9ffdc, 0x03b3c3, 0x1b4f8f],
    sticks: 0x8ad7ff
  }
};

const systemCards: Array<[string, string, LucideIcon]> = [
  ['低延迟入口', '把高频视觉动势压在背景层，前景只保留最必要的导航判断。', Gauge],
  ['信号隧道', '适合承接市场、新闻、AI 助手等模块之间的高速跳转感。', Route],
  ['冷光轨迹', '用蓝白光线维持 SparkFlow 的工业感，不破坏主站黑色克制。', Radio]
];

export function HyperspeedRoute() {
  return (
    <PageTransition>
      <section className="relative min-h-[calc(100vh-var(--nav-height))] overflow-hidden bg-black text-white">
        <Hyperspeed effectOptions={hyperspeedOptions} />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(138,215,255,0.12),transparent_28%),linear-gradient(90deg,rgba(0,0,0,0.86),rgba(0,0,0,0.25)_48%,rgba(0,0,0,0.84)),linear-gradient(180deg,rgba(0,0,0,0.05),rgba(0,0,0,0.86)_88%)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black to-transparent" />

        <div className="relative z-10 mx-auto flex min-h-[calc(100vh-var(--nav-height))] w-full max-w-7xl flex-col px-5 pb-8 pt-10 md:px-8 lg:pt-14">
          <motion.div
            className="max-w-3xl"
            initial={{ opacity: 0, y: 26, filter: 'blur(12px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.72, ease: [0.19, 1, 0.22, 1] }}
          >
            <p className="mb-5 inline-flex items-center gap-2 border-l border-[#8ad7ff]/50 pl-3 text-xs font-semibold uppercase tracking-[0.22em] text-[#8ad7ff]/76">
              <Zap size={15} strokeWidth={1.8} />
              Hyperspeed Corridor
            </p>
            <h1 className="max-w-4xl text-balance text-6xl font-semibold leading-[0.88] text-white md:text-8xl">
              极速通道
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-8 text-white/62 md:text-lg">
              一页只负责速度、方向和进入系统的瞬间。背景使用 React Bits 风格的 Hyperspeed 光轨，让 SparkFlow 多一个更硬核的视觉入口。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/market"
                className="group inline-flex h-11 items-center justify-center gap-2 rounded-full border border-[#8ad7ff]/28 bg-[#8ad7ff]/10 px-5 text-sm font-semibold text-white transition hover:border-[#8ad7ff]/58 hover:bg-[#8ad7ff]/16"
              >
                进入股票市场
                <ArrowUpRight size={16} strokeWidth={1.8} className="transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
              <Link
                to="/assistant"
                className="inline-flex h-11 items-center justify-center rounded-full border border-white/12 bg-white/[0.045] px-5 text-sm font-semibold text-white/72 transition hover:border-white/26 hover:text-white"
              >
                打开 AI 助手
              </Link>
            </div>
          </motion.div>

          <motion.div
            className="mt-10 min-h-[560px] overflow-hidden rounded-lg border border-white/10 bg-black/30 shadow-[0_30px_120px_rgba(0,0,0,0.42)] backdrop-blur-xl md:min-h-[640px]"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.62, delay: 0.14, ease: [0.19, 1, 0.22, 1] }}
          >
            <InfiniteMenu items={realtimeWindows} scale={1.05} />
          </motion.div>

          <motion.div
            className="mt-4 grid gap-3 md:grid-cols-3 lg:max-w-4xl"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.58, delay: 0.2, ease: [0.19, 1, 0.22, 1] }}
          >
            {systemCards.map(([title, body, Icon]) => (
              <article key={title as string} className="rounded-lg border border-white/10 bg-black/38 p-5 backdrop-blur-2xl">
                <Icon className="text-[#8ad7ff]" size={19} strokeWidth={1.7} />
                <h2 className="mt-5 text-lg font-semibold text-white">{title}</h2>
                <p className="mt-3 text-sm leading-6 text-white/54">{body}</p>
              </article>
            ))}
          </motion.div>
        </div>
      </section>
    </PageTransition>
  );
}
