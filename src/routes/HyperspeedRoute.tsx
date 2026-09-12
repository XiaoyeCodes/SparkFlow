import { motion } from 'framer-motion';
import { Zap } from 'lucide-react';
import { Hyperspeed } from '../components/Hyperspeed';
import { PageTransition } from '../components/PageTransition';

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
          </motion.div>
        </div>
      </section>
    </PageTransition>
  );
}
