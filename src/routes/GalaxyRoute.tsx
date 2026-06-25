import { motion } from 'framer-motion';
import { ArrowUpRight, Orbit, Radio, Sparkles, Telescope } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Galaxy } from '../components/Galaxy';
import { PageTransition } from '../components/PageTransition';

const orbitNotes = [
  ['星云观测', '把散落灵感放进同一个缓慢旋转的背景里，先保留方向感。'],
  ['低噪记录', '适合承接 Obsidian、读书笔记和长期主题，不急着变成行动。'],
  ['回到信号', '当某条线索足够明亮，再推回星图情报或今日新闻里处理。']
];

export function GalaxyRoute() {
  return (
    <PageTransition>
      <section className="relative min-h-[calc(100vh-var(--nav-height))] overflow-hidden bg-black text-white">
        <div className="absolute inset-0">
          <Galaxy
            focal={[0.48, 0.48]}
            rotation={[0.92, 0.22]}
            density={1.45}
            glowIntensity={0.42}
            saturation={0.72}
            hueShift={218}
            starSpeed={0.55}
            speed={0.42}
            rotationSpeed={0.035}
            twinkleIntensity={0.44}
            repulsionStrength={1.35}
            mouseRepulsion
            transparent={false}
          />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_48%_42%,rgba(138,215,255,0.10),transparent_26%),linear-gradient(90deg,rgba(0,0,0,0.82),rgba(0,0,0,0.28)_52%,rgba(0,0,0,0.76)),linear-gradient(180deg,rgba(0,0,0,0.08),rgba(0,0,0,0.88)_88%)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black to-transparent" />

        <div className="relative z-10 mx-auto flex min-h-[calc(100vh-var(--nav-height))] w-full max-w-7xl flex-col justify-between px-5 pb-8 pt-10 md:px-8 lg:pt-14">
          <motion.div
            className="max-w-3xl"
            initial={{ opacity: 0, y: 24, filter: 'blur(12px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.7, ease: [0.19, 1, 0.22, 1] }}
          >
            <p className="mb-5 inline-flex items-center gap-2 border-l border-[#b9ffdc]/42 pl-3 text-xs font-semibold uppercase tracking-[0.22em] text-[#b9ffdc]/72">
              <Orbit size={15} strokeWidth={1.7} />
              Galaxy Harbor
            </p>
            <h1 className="max-w-4xl text-balance text-6xl font-semibold leading-[0.9] text-white md:text-8xl">
              星河航道
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-8 text-white/62 md:text-lg">
              一页用来安放尚未归类的想法、线索和长期主题。让信息先在低速星场里漂浮，等它们自己显出轨道。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/starmap"
                className="group inline-flex h-11 items-center justify-center gap-2 rounded-full border border-[#8ad7ff]/24 bg-[#8ad7ff]/10 px-5 text-sm font-semibold text-white transition hover:border-[#8ad7ff]/52 hover:bg-[#8ad7ff]/16"
              >
                推进到星图情报
                <ArrowUpRight size={16} strokeWidth={1.8} className="transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
              <Link
                to="/stack"
                className="inline-flex h-11 items-center justify-center rounded-full border border-white/12 bg-white/[0.045] px-5 text-sm font-semibold text-white/72 transition hover:border-white/26 hover:text-white"
              >
                打开阅读栈
              </Link>
            </div>
          </motion.div>

          <motion.div
            className="mt-14 grid gap-3 md:grid-cols-3 lg:max-w-4xl"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.18, ease: [0.19, 1, 0.22, 1] }}
          >
            {orbitNotes.map(([title, body], index) => {
              const Icon = index === 0 ? Telescope : index === 1 ? Sparkles : Radio;

              return (
                <article key={title} className="rounded-lg border border-white/10 bg-black/34 p-5 backdrop-blur-2xl">
                  <Icon className="text-[#8ad7ff]" size={19} strokeWidth={1.7} />
                  <h2 className="mt-5 text-lg font-semibold text-white">{title}</h2>
                  <p className="mt-3 text-sm leading-6 text-white/54">{body}</p>
                </article>
              );
            })}
          </motion.div>
        </div>
      </section>
    </PageTransition>
  );
}
