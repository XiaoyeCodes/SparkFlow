import { motion, useScroll, useTransform } from 'framer-motion';
import { ArrowUpRight, Bot, ChartNoAxesCombined, ChartPie, FileChartColumn, Globe2, Newspaper, type LucideIcon } from 'lucide-react';
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { EarthScene } from '../components/EarthScene';
import { PageTransition } from '../components/PageTransition';
import { primaryNavigation } from '../data/navigation';
import './Home.css';

const gatewayIcons: Record<string, LucideIcon> = {
  '/terminal': Globe2,
  '/market': ChartNoAxesCombined,
  '/council': FileChartColumn,
  '/signals': Newspaper,
  '/assistant': Bot,
  '/trader': ChartPie
};

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

          <div className="home-product-panel">
            <motion.aside className="home-product-copy" style={{ opacity: panelOpacity, x: panelX }}>
              <p className="home-product-eyebrow">SparkFlow</p>
              <h2 className="home-product-title">全球市场。<br /><span>一处洞察。</span></h2>
              <p className="home-product-description">
                连接宏观数据、全球行情与 AI 研究。
                从市场观察到 ETF 配置，<strong>让每一次投资判断，更有依据。</strong>
              </p>
            </motion.aside>

            <motion.nav className="home-gateways" aria-label="首页快捷入口" style={{ opacity: tabsOpacity, y: tabsY }}>
              {primaryNavigation.map((item) => {
                const Icon = gatewayIcons[item.path] || Globe2;
                const content = (
                  <>
                    <Icon className="home-gateway-icon" size={20} strokeWidth={1.5} aria-hidden="true" />
                    <span className="home-gateway-label">{item.label}</span>
                    {item.disabled
                      ? <span className="home-gateway-pending">暂未开放</span>
                      : <ArrowUpRight className="home-gateway-arrow" size={15} strokeWidth={1.5} aria-hidden="true" />}
                  </>
                );

                return item.disabled ? (
                  <button key={item.path} type="button" className="home-gateway" disabled title={`${item.label}暂未开放`}>
                    {content}
                  </button>
                ) : (
                  <Link key={item.path} to={item.path} className="home-gateway">{content}</Link>
                );
              })}
            </motion.nav>
          </div>

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
