import { motion, useScroll, useTransform } from 'framer-motion';
import { ArrowUpRight, BookOpenText, Boxes, ChartNoAxesCombined, Newspaper, PenLine } from 'lucide-react';
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { EarthScene } from '../components/EarthScene';
import { PageTransition } from '../components/PageTransition';

const gatewayItems = [
  {
    title: '今日新闻',
    path: '/signals',
    eyebrow: 'SIGNALS',
    meta: 'Live market and technology pulse',
    tone: 'text-[#8ad7ff]',
    Icon: Newspaper
  },
  {
    title: '股票ETF定投软件',
    path: '/trader',
    eyebrow: 'TRADER',
    meta: 'All-weather allocation workspace',
    tone: 'text-[#b9ffdc]',
    Icon: ChartNoAxesCombined
  },
  {
    title: '推荐书籍',
    path: '/stack',
    eyebrow: 'STACK',
    meta: 'Mental models and reading maps',
    tone: 'text-[#f3d6a0]',
    Icon: BookOpenText
  },
  {
    title: '个人项目集',
    path: '/artifacts',
    eyebrow: 'ARTIFACTS',
    meta: 'Systems, products and shipped work',
    tone: 'text-[#d7dce5]',
    Icon: Boxes
  },
  {
    title: '个人随笔',
    path: '/logs',
    eyebrow: 'LOGS',
    meta: 'Essays, notes and field records',
    tone: 'text-white',
    Icon: PenLine
  }
];

export function Home() {
  const sceneRef = useRef<HTMLElement | null>(null);
  const { scrollYProgress } = useScroll({
    target: sceneRef,
    offset: ['start start', 'end start']
  });

  const heroOpacity = useTransform(scrollYProgress, [0, 0.42, 0.66], [1, 0.82, 0.22]);
  const heroY = useTransform(scrollYProgress, [0, 0.72], ['0vh', '-17vh']);
  const heroX = useTransform(scrollYProgress, [0, 0.72], ['0vw', '-24vw']);
  const heroScale = useTransform(scrollYProgress, [0, 0.72], [1, 0.74]);
  const gatewayOpacity = useTransform(scrollYProgress, [0.3, 0.6], [0, 1]);
  const gatewayY = useTransform(scrollYProgress, [0.3, 0.66], [72, 0]);
  const telemetryOpacity = useTransform(scrollYProgress, [0, 0.48, 0.86], [0.1, 0.48, 0.16]);

  return (
    <PageTransition>
      <section ref={sceneRef} className="orbital-home relative min-h-[220vh] overflow-clip bg-black">
        <div className="sticky top-0 h-screen overflow-hidden">
          <div className="absolute inset-0 z-[1] bg-[radial-gradient(circle_at_73%_34%,rgba(102,188,255,0.18),transparent_18%),radial-gradient(circle_at_42%_44%,rgba(255,255,255,0.05),transparent_28%),linear-gradient(180deg,rgba(0,0,0,0.04),rgba(0,0,0,0.28)_62%,#000_95%)]" />
          <EarthScene />

          <motion.div
            className="pointer-events-none absolute inset-x-0 top-[24%] z-10 mx-auto w-[min(88vw,980px)] text-center md:top-[28%]"
            style={{ opacity: heroOpacity, x: heroX, y: heroY, scale: heroScale }}
          >
            <motion.p
              className="mb-5 text-[11px] font-semibold uppercase text-white/44"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.12 }}
            >
              LUMENARY / PERSONAL ORBIT SYSTEM
            </motion.p>
            <motion.h1
              className="text-[clamp(4.7rem,14vw,13.5rem)] font-semibold leading-[0.82] text-white"
              initial={{ opacity: 0, scale: 0.96, filter: 'blur(18px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              transition={{ duration: 1.1, ease: [0.19, 1, 0.22, 1] }}
            >
              SparkFlow
            </motion.h1>
            <motion.p
              className="mx-auto mt-8 max-w-2xl text-balance text-[clamp(1rem,2vw,1.45rem)] leading-[1.55] text-white/58"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, delay: 0.32 }}
            >
              Infrastructure for digital aesthetics, market signals, writing systems and long horizon decisions.
            </motion.p>
          </motion.div>

          <motion.div
            className="absolute inset-x-5 bottom-8 z-20 mx-auto max-w-7xl md:bottom-auto md:left-[max(2rem,calc((100vw-80rem)/2+2rem))] md:right-auto md:top-[34%] md:mx-0 md:w-[min(46vw,620px)]"
            style={{ opacity: gatewayOpacity, y: gatewayY }}
          >
            <div className="mb-6 hidden max-w-lg md:block">
              <p className="text-[11px] font-semibold uppercase text-white/40">MISSION CONTROL</p>
              <h2 className="mt-3 text-[clamp(2.1rem,4.2vw,4.6rem)] font-semibold leading-[0.96] text-white">
                Signals, systems, and artifacts in one quiet orbit.
              </h2>
            </div>

            <div className="grid gap-2.5">
              {gatewayItems.map((item, index) => {
                const Icon = item.Icon;

                return (
                  <motion.div
                    key={item.path}
                    initial={{ opacity: 0, y: 18 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-15% 0px' }}
                    transition={{ delay: index * 0.045, duration: 0.48, ease: [0.19, 1, 0.22, 1] }}
                  >
                    <Link
                      to={item.path}
                      className="group grid min-h-[76px] grid-cols-[auto_1fr_auto] items-center gap-4 rounded-lg border border-white/10 bg-white/[0.055] px-4 py-3 shadow-[0_20px_80px_rgba(0,0,0,0.28)] backdrop-blur-2xl transition duration-500 hover:border-white/28 hover:bg-white/[0.085] md:min-h-[88px] md:px-5"
                    >
                      <span
                        className={`flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-black/34 ${item.tone}`}
                      >
                        <Icon size={18} strokeWidth={1.6} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[10px] font-semibold uppercase text-white/36">{item.eyebrow}</span>
                        <span className="mt-1 block text-base font-semibold text-white md:text-lg">{item.title}</span>
                        <span className="mt-1 hidden truncate text-sm text-white/44 md:block">{item.meta}</span>
                      </span>
                      <ArrowUpRight
                        size={18}
                        strokeWidth={1.6}
                        className="text-white/36 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-white"
                      />
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>

          <motion.div
            className="pointer-events-none absolute bottom-9 right-[max(1.25rem,calc((100vw-80rem)/2+2rem))] z-20 hidden w-64 text-right md:block"
            style={{ opacity: telemetryOpacity }}
          >
            <div className="mb-3 h-px w-full bg-gradient-to-r from-transparent via-white/26 to-white/8" />
            <p className="font-mono text-[10px] uppercase leading-6 text-white/38">
              LOW EARTH ORBIT
              <br />
              SIGNAL DENSITY LOW
              <br />
              SURFACE ALBEDO NOMINAL
            </p>
          </motion.div>
        </div>
      </section>

      <section className="relative border-t border-white/10 bg-black px-5 py-20 md:px-8 md:py-28">
        <div className="mx-auto grid max-w-7xl gap-10 md:grid-cols-[0.8fr_1.2fr] md:items-end">
          <p className="text-[11px] font-semibold uppercase text-white/36">SPARKFLOW INDEX</p>
          <p className="max-w-3xl text-balance text-[clamp(1.55rem,3vw,3.25rem)] font-semibold leading-[1.05] text-white">
            A restrained front door for the tools, reading, projects, and market intelligence that deserve your focus.
          </p>
        </div>
      </section>
    </PageTransition>
  );
}
