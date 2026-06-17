import { motion } from 'framer-motion';
import { ModuleFrame } from '../components/ModuleFrame';
import { signals } from '../data/content';

export function Signals() {
  return (
    <ModuleFrame title="今日新闻" kicker="Signals">
      <div className="divide-y divide-white/10 border-y border-white/10">
        {signals.map(([time, text], index) => (
          <motion.article
            key={time}
            className="group grid gap-5 px-1 py-7 md:grid-cols-[140px_1fr]"
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: index * 0.06 }}
          >
            <time className="font-mono text-sm text-[#8ad7ff]/75">{time}</time>
            <p className="text-balance text-2xl font-medium leading-[1.16] text-white/80 transition group-hover:text-white group-hover:[text-shadow:0_0_30px_rgba(138,215,255,0.42)] md:text-4xl">
              {text}
            </p>
          </motion.article>
        ))}
      </div>
    </ModuleFrame>
  );
}
