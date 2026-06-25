import { motion, useScroll, useTransform } from 'framer-motion';
import { ArrowUpRight, BookOpenText, Boxes, ChartNoAxesCombined, Newspaper, Orbit, PenLine, Radar } from 'lucide-react';
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { EarthScene } from '../components/EarthScene';
import { PageTransition } from '../components/PageTransition';

const gatewayItems = [
  {
    title: '今日新闻',
    path: '/signals',
    eyebrow: 'SIGNALS',
    meta: '每日市场、科技与 AI 信号流',
    tone: 'text-[#8ad7ff]',
    Icon: Newspaper
  },
  {
    title: '星图情报',
    path: '/starmap',
    eyebrow: 'STARMAP',
    meta: '信号网、主题雷达与情报扫描台',
    tone: 'text-[#8ad7ff]',
    Icon: Radar
  },
  {
    title: '星河航道',
    path: '/galaxy',
    eyebrow: 'GALAXY',
    meta: '漂浮灵感、长期主题与低噪想法池',
    tone: 'text-[#d7dce5]',
    Icon: Orbit
  },
  {
    title: '股票ETF定投软件',
    path: '/trader',
    eyebrow: 'TRADER',
    meta: '全天候 ETF 配置与复盘工作台',
    tone: 'text-[#b9ffdc]',
    Icon: ChartNoAxesCombined
  },
  {
    title: '推荐书籍',
    path: '/stack',
    eyebrow: 'STACK',
    meta: '阅读地图、书单与思维模型',
    tone: 'text-[#f3d6a0]',
    Icon: BookOpenText
  },
  {
    title: '个人项目集',
    path: '/artifacts',
    eyebrow: 'ARTIFACTS',
    meta: '产品、工具与数字系统作品',
    tone: 'text-[#d7dce5]',
    Icon: Boxes
  },
  {
    title: '个人随笔',
    path: '/logs',
    eyebrow: 'LOGS',
    meta: '长期写作、观察和成长记录',
    tone: 'text-white',
    Icon: PenLine
  }
];

export function Home() {
  const sceneRef = useRef<HTMLElement | null>(null);
  const { scrollY } = useScroll();

  const titleOpacity = useTransform(scrollY, [0, 70, 180], [1, 0.42, 0]);
  const titleY = useTransform(scrollY, [0, 220], ['0vh', '-28vh']);
  const titleScale = useTransform(scrollY, [0, 220], [1, 0.58]);
  const panelOpacity = useTransform(scrollY, [90, 210], [0, 1]);
  const panelX = useTransform(scrollY, [90, 260], [72, 0]);
  const tabsOpacity = useTransform(scrollY, [150, 300], [0, 1]);
  const tabsY = useTransform(scrollY, [150, 300], [36, 0]);
  const telemetryOpacity = useTransform(scrollY, [0, 320, 720], [0.14, 0.48, 0.18]);

  return (
    <PageTransition>
      <section ref={sceneRef} className="orbital-home relative min-h-[220vh] overflow-clip bg-black">
        <div className="sticky top-0 h-screen overflow-hidden">
          <div className="absolute inset-0 z-[1] bg-[radial-gradient(circle_at_50%_48%,rgba(102,188,255,0.18),transparent_24%),radial-gradient(circle_at_82%_40%,rgba(255,255,255,0.05),transparent_24%),linear-gradient(180deg,rgba(0,0,0,0.03),rgba(0,0,0,0.22)_64%,rgba(0,0,0,0.08)_96%)]" />
          <EarthScene />

          <motion.div
            className="pointer-events-none absolute inset-x-0 top-[6.5%] z-10 mx-auto w-[min(82vw,720px)] text-center md:top-[3.5%]"
            style={{ opacity: titleOpacity, y: titleY, scale: titleScale }}
          >
            <motion.h1
              className="font-medium text-white/90"
              style={{ fontSize: 'clamp(2.65rem, 5.9vw, 6.25rem)', lineHeight: 0.9 }}
              initial={{ opacity: 0, scale: 0.96, filter: 'blur(18px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              transition={{ duration: 1.1, ease: [0.19, 1, 0.22, 1] }}
            >
              SparkFlow
            </motion.h1>
          </motion.div>

          <motion.aside
            className="pointer-events-none absolute z-20 px-5 md:px-0"
            style={{
              opacity: panelOpacity,
              x: panelX,
              top: 'clamp(9.5rem, 27vh, 15rem)',
              right: '2rem',
              width: 'min(720px, calc(100vw - 2.5rem))'
            }}
          >
            <div className="mx-auto max-w-xl border-l border-white/14 pl-5 md:pl-7">
              <p className="text-[11px] font-semibold uppercase text-white/40">PROJECT BRIEF</p>
              <h2
                className="mt-4 text-balance font-semibold text-white"
                style={{ fontSize: 'clamp(2.2rem, 4.6vw, 5.1rem)', lineHeight: 0.94 }}
              >
                一个安静但有轨道感的个人操作系统。
              </h2>
              <p className="mt-6 max-w-lg text-balance text-base leading-7 text-white/58 md:text-lg">
                SparkFlow 把新闻信号、ETF 定投、阅读书单、项目作品和长期随笔收束到同一个深色导航系统里。
                首屏保留克制，滚动之后再展开工具入口。
              </p>
            </div>
          </motion.aside>

          <motion.div
            className="absolute z-30 px-5 md:px-0"
            style={{
              opacity: tabsOpacity,
              y: tabsY,
              left: 'auto',
              right: '2rem',
              bottom: '3rem',
              width: 'min(720px, calc(100vw - 2.5rem))'
            }}
          >
            <div className="flex gap-2 overflow-x-auto pb-1 md:grid md:grid-cols-7 md:overflow-visible md:pb-0">
              {gatewayItems.map((item, index) => {
                const Icon = item.Icon;

                return (
                  <motion.div
                    key={item.path}
                    initial={{ opacity: 0, y: 16 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-15% 0px' }}
                    transition={{ delay: index * 0.04, duration: 0.44, ease: [0.19, 1, 0.22, 1] }}
                  >
                    <Link
                      to={item.path}
                      className="group flex h-[96px] w-[178px] shrink-0 flex-col justify-between rounded-lg border border-white/10 bg-black/38 p-3.5 shadow-[0_20px_80px_rgba(0,0,0,0.28)] backdrop-blur-2xl transition duration-500 hover:border-white/28 hover:bg-white/[0.075] md:h-[118px] md:w-auto"
                    >
                      <span className="flex items-center justify-between">
                        <span
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/[0.045] ${item.tone}`}
                        >
                          <Icon size={16} strokeWidth={1.6} />
                        </span>
                        <ArrowUpRight
                          size={15}
                          strokeWidth={1.6}
                          className="text-white/32 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-white"
                        />
                      </span>
                      <span>
                        <span className="block text-[10px] font-semibold uppercase text-white/34">{item.eyebrow}</span>
                        <span className="mt-1 block truncate text-sm font-semibold text-white">{item.title}</span>
                      </span>
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>

          <motion.div
            className="pointer-events-none absolute bottom-9 left-[max(1.25rem,calc((100vw-80rem)/2+2rem))] z-20 hidden w-64 text-left md:block"
            style={{ opacity: telemetryOpacity }}
          >
            <div className="mb-3 h-px w-full bg-gradient-to-r from-white/8 via-white/26 to-transparent" />
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
    </PageTransition>
  );
}
