import { motion } from 'framer-motion';
import { Activity, ArrowUpRight, Binary, BrainCircuit, Crosshair, Radar, Satellite, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BorderGlow } from '../components/BorderGlow';
import { GridScan } from '../components/GridScan';
import { PageTransition } from '../components/PageTransition';

const signalRows = [
  ['宏观轨道', '利率、美元、流动性共振', 'WATCH', '63'],
  ['产业星座', 'AI 算力、电力设备、半导体链', 'ACTIVE', '82'],
  ['舆情噪声', '热点扩散过快，等待二次确认', 'FILTER', '41'],
  ['资产引力', '高质量现金流仍在吸收资金', 'LONG', '76']
];

const intelCards = [
  {
    title: '观测焦点',
    body: '把新闻、行情和长期主题叠到同一张图上，优先寻找正在形成合力的信号。',
    Icon: Crosshair
  },
  {
    title: '情报分层',
    body: '先区分事实、解释、价格反应，再决定它是噪声、线索还是可执行机会。',
    Icon: BrainCircuit
  },
  {
    title: '行动窗口',
    body: '只在证据密度足够时推进下一步，避免被单点刺激拖进临时判断。',
    Icon: Satellite
  }
];

export function Starmap() {
  return (
    <PageTransition>
      <section className="relative min-h-[calc(100vh-var(--nav-height))] overflow-hidden bg-black text-white">
        <div className="absolute inset-0">
          <GridScan
            sensitivity={0.7}
            lineThickness={1.15}
            linesColor="#28506f"
            gridScale={0.078}
            lineStyle="solid"
            lineJitter={0.18}
            scanColor="#8ad7ff"
            scanOpacity={0.55}
            scanDirection="pingpong"
            scanSoftness={1.55}
            scanGlow={0.95}
            scanDuration={2.8}
            scanDelay={1.2}
            bloomIntensity={0.52}
            bloomThreshold={0.02}
            bloomSmoothing={0.18}
            chromaticAberration={0.0017}
            noiseIntensity={0.018}
            scanOnClick
          />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(138,215,255,0.18),transparent_26%),linear-gradient(90deg,rgba(0,0,0,0.74),rgba(0,0,0,0.26)_48%,rgba(0,0,0,0.78)),linear-gradient(180deg,rgba(0,0,0,0.28),rgba(0,0,0,0.82)_82%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#8ad7ff]/50 to-transparent" />

        <div className="relative z-10 mx-auto grid w-full max-w-7xl gap-8 px-5 pb-10 pt-8 md:px-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-end lg:pt-12">
          <motion.div
            initial={{ opacity: 0, y: 22, filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.62, ease: [0.19, 1, 0.22, 1] }}
          >
            <p className="mb-5 inline-flex items-center gap-2 border-l border-[#8ad7ff]/45 pl-3 text-xs font-semibold uppercase tracking-[0.22em] text-[#8ad7ff]/72">
              <Radar size={15} strokeWidth={1.7} />
              Starmap Intelligence
            </p>
            <h1 className="max-w-3xl text-balance text-6xl font-semibold leading-[0.92] text-white md:text-8xl">
              星图情报
            </h1>
            <p className="mt-7 max-w-xl text-base leading-8 text-white/62 md:text-lg">
              用一张动态信号网承接每日信息：从宏观轨道到产业星座，再到可执行的行动窗口。
            </p>

            <motion.div
              className="mt-10 flex max-w-xl justify-center md:justify-start lg:justify-center"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.48, delay: 0.18, ease: [0.19, 1, 0.22, 1] }}
            >
              <BorderGlow
                animated
                edgeSensitivity={48}
                glowColor="198 96 72"
                backgroundColor="rgba(2, 8, 14, 0.78)"
                borderRadius={999}
                glowRadius={42}
                glowIntensity={1.15}
                coneSpread={30}
                fillOpacity={0.36}
                colors={['#8ad7ff', '#b9ffdc', '#f3d6a0']}
                className="starmap-action-glow"
              >
                <Link
                  to="/signals"
                  className="group inline-flex h-14 min-w-[220px] items-center justify-center gap-3 rounded-full px-6 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] outline-none transition hover:text-white focus-visible:ring-2 focus-visible:ring-[#8ad7ff]/70"
                >
                  <span className="tracking-[0.08em]">启动星图扫描</span>
                  <ArrowUpRight size={17} strokeWidth={1.8} className="transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </Link>
              </BorderGlow>
            </motion.div>

            <div className="mt-10 grid max-w-2xl gap-3 sm:grid-cols-3">
              {intelCards.map((item, index) => {
                const Icon = item.Icon;

                return (
                  <motion.article
                    key={item.title}
                    className="rounded-lg border border-white/10 bg-black/34 p-4 backdrop-blur-2xl"
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.42, delay: 0.12 + index * 0.06 }}
                  >
                    <Icon className="text-[#8ad7ff]" size={18} strokeWidth={1.7} />
                    <h2 className="mt-4 text-sm font-semibold text-white">{item.title}</h2>
                    <p className="mt-2 text-xs leading-5 text-white/48">{item.body}</p>
                  </motion.article>
                );
              })}
            </div>
          </motion.div>

          <motion.div
            className="rounded-lg border border-white/10 bg-black/42 p-4 shadow-[0_0_90px_rgba(138,215,255,0.12)] backdrop-blur-2xl md:p-5"
            initial={{ opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.68, delay: 0.1, ease: [0.19, 1, 0.22, 1] }}
          >
            <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-md border border-[#8ad7ff]/28 bg-[#8ad7ff]/10 text-[#8ad7ff]">
                  <Binary size={19} strokeWidth={1.7} />
                </span>
                <div>
                  <h2 className="text-xl font-semibold">情报扫描台</h2>
                  <p className="mt-1 text-xs text-white/42">Signal constellation / live synthesis</p>
                </div>
              </div>
              <a
                href="/signals"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/12 bg-white/5 text-white/68 transition hover:border-white/28 hover:text-white"
                aria-label="Open signal desk"
              >
                <ArrowUpRight size={17} strokeWidth={1.8} />
              </a>
            </div>

            <div className="mt-4 grid gap-3">
              {signalRows.map(([name, body, status, score], index) => (
                <motion.article
                  key={name}
                  className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.045] p-4 md:grid-cols-[1fr_auto]"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.2 + index * 0.055 }}
                >
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#8ad7ff] shadow-[0_0_18px_rgba(138,215,255,0.85)]" />
                      <h3 className="text-base font-semibold text-white">{name}</h3>
                    </div>
                    <p className="text-sm leading-6 text-white/52">{body}</p>
                  </div>
                  <div className="flex items-center gap-3 md:justify-end">
                    <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] font-semibold tracking-[0.12em] text-white/50">
                      {status}
                    </span>
                    <span className="font-mono text-2xl text-[#8ad7ff]">{score}</span>
                  </div>
                </motion.article>
              ))}
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-[#b9ffdc]/18 bg-[#b9ffdc]/8 p-4">
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#b9ffdc]/70">
                  <Sparkles size={15} />
                  Next read
                </div>
                <p className="text-sm leading-6 text-white/62">等待价格、成交量和新闻叙事同步确认后，再把主题推进到行动队列。</p>
              </div>
              <div className="rounded-lg border border-[#ffd27a]/18 bg-[#ffd27a]/8 p-4">
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#ffd27a]/70">
                  <Activity size={15} />
                  Risk note
                </div>
                <p className="text-sm leading-6 text-white/62">热度过高时降低仓位语言，只保留观察、验证和复盘三个动作。</p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>
    </PageTransition>
  );
}
