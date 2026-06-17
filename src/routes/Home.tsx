import { motion } from 'framer-motion';
import { BentoGateways } from '../components/BentoGateways';
import { PageTransition } from '../components/PageTransition';
import { TextFlowCanvas } from '../components/TextFlowCanvas';

export function Home() {
  return (
    <PageTransition>
      <section className="noise-surface relative flex min-h-screen items-center justify-center overflow-hidden bg-black">
        <TextFlowCanvas />
        <div className="pointer-events-none relative z-10 mx-auto flex min-h-screen w-full max-w-7xl flex-col items-center justify-center px-6 pt-[var(--nav-height)]">
          <motion.p
            className="mb-5 text-xs font-semibold uppercase text-white/42"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.15 }}
          >
            LUMENARY
          </motion.p>
          <motion.div
            className="hero-logo-fusion mb-6 w-[min(56vw,360px)]"
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.9, delay: 0.22, ease: [0.19, 1, 0.22, 1] }}
          >
            <img src="/brand/lumenary-logo-v2-transparent.png" alt="LUMENARY" className="w-full" />
          </motion.div>
          <motion.h1
            className="text-center text-[clamp(4.4rem,14vw,13rem)] font-semibold leading-none text-white"
            initial={{ opacity: 0, scale: 0.96, filter: 'blur(18px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            transition={{ duration: 1.1, ease: [0.19, 1, 0.22, 1] }}
          >
            SparkFlow
          </motion.h1>
          <motion.div
            className="mt-8 h-px w-28 bg-white/28"
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={{ duration: 0.9, delay: 0.4, ease: [0.19, 1, 0.22, 1] }}
          />
        </div>
      </section>
      <BentoGateways />
    </PageTransition>
  );
}
