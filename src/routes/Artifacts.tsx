import { motion } from 'framer-motion';
import { ModuleFrame } from '../components/ModuleFrame';
import { projects } from '../data/content';

export function Artifacts() {
  return (
    <ModuleFrame title="个人项目集" kicker="Artifacts">
      <div className="grid gap-3 md:grid-cols-2">
        {projects.map(([title, desc], index) => (
          <motion.article
            key={title}
            layout
            className="group relative min-h-[300px] overflow-hidden rounded-lg border border-white/10 bg-[#101114] p-7"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ scale: 1.015 }}
            transition={{ duration: 0.55, delay: index * 0.04, ease: [0.19, 1, 0.22, 1] }}
          >
            <div className="absolute inset-0 opacity-70">
              <div className="grid h-full grid-cols-6 gap-px">
                {Array.from({ length: 30 }, (_, cell) => (
                  <span
                    key={cell}
                    className="bg-white/[0.035] transition group-hover:bg-white/[0.06]"
                    style={{ opacity: 0.35 + ((cell + index) % 6) * 0.09 }}
                  />
                ))}
              </div>
            </div>
            <div className="relative mt-auto flex h-full flex-col justify-end">
              <h2 className="text-4xl font-semibold leading-none text-white">{title}</h2>
              <p className="mt-4 text-base text-white/56">{desc}</p>
            </div>
          </motion.article>
        ))}
      </div>
    </ModuleFrame>
  );
}
