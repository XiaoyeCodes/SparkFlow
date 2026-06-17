import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { gateways, type Gateway } from '../data/content';

const toneClass: Record<Gateway['tone'], string> = {
  blue: 'from-[#8ad7ff]/16 to-white/0 text-[#8ad7ff]',
  green: 'from-[#b9ffdc]/16 to-white/0 text-[#b9ffdc]',
  white: 'from-white/14 to-white/0 text-white',
  silver: 'from-[#d7dce5]/14 to-white/0 text-[#d7dce5]',
  warm: 'from-[#f4d7a1]/14 to-white/0 text-[#f4d7a1]'
};

const iconToneClass: Record<Gateway['tone'], string> = {
  blue: 'text-[#8ad7ff]',
  green: 'text-[#b9ffdc]',
  white: 'text-white',
  silver: 'text-[#d7dce5]',
  warm: 'text-[#f4d7a1]'
};

export function BentoGateways() {
  return (
    <section className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-3 px-4 pb-8 md:grid-cols-6 md:px-8 lg:gap-4">
      {gateways.map((gateway, index) => {
        const Icon = gateway.Icon;
        const isLarge = index === 0 || index === 1;

        return (
          <motion.div
            key={gateway.path}
            layoutId={`gateway-${gateway.path}`}
            className={isLarge ? 'md:col-span-3' : 'md:col-span-2'}
          >
            <Link
              to={gateway.path}
              className="group relative flex h-[240px] overflow-hidden rounded-lg border border-white/10 bg-[#111113] p-6 outline-none transition duration-500 hover:border-white/22 focus-visible:border-white/60 md:h-[300px]"
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${toneClass[gateway.tone]} opacity-80`} />
              <div className="absolute inset-x-7 top-7 flex items-center justify-between text-[11px] font-semibold uppercase text-white/42">
                <span>{gateway.eyebrow}</span>
                <Icon size={18} strokeWidth={1.5} className={iconToneClass[gateway.tone]} />
              </div>
              <div className="relative mt-auto w-full">
                {gateway.path === '/trader' ? <MiniNavLine /> : null}
                {gateway.path === '/signals' ? <SignalBars /> : null}
                {gateway.path === '/stack' ? <BookGlyph /> : null}
                {gateway.path === '/artifacts' ? <ArtifactGlyph /> : null}
                {gateway.path === '/logs' ? <LogGlyph /> : null}
                <div className="mt-8 text-xl font-semibold text-white md:text-2xl">{gateway.title}</div>
              </div>
            </Link>
          </motion.div>
        );
      })}
    </section>
  );
}

function MiniNavLine() {
  return (
    <svg viewBox="0 0 420 96" className="h-24 w-full text-[#b9ffdc]/70" aria-hidden="true">
      <path
        d="M0 62 C42 55 54 24 96 34 S158 86 206 56 268 28 314 43 366 74 420 35"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function SignalBars() {
  return (
    <div className="flex h-24 items-end gap-2 text-[#8ad7ff]/70" aria-hidden="true">
      {[28, 48, 34, 72, 42, 88, 58, 64, 38].map((height, index) => (
        <span
          key={index}
          className="w-full rounded-full bg-current opacity-70 transition group-hover:opacity-100"
          style={{ height }}
        />
      ))}
    </div>
  );
}

function BookGlyph() {
  return (
    <div className="grid h-24 w-full grid-cols-3 gap-3 text-[#f4d7a1]/70" aria-hidden="true">
      {[0, 1, 2].map((item) => (
        <span key={item} className="rounded-sm border border-current/40 bg-current/5" />
      ))}
    </div>
  );
}

function ArtifactGlyph() {
  return (
    <div className="grid h-24 w-full grid-cols-4 gap-2 text-[#d7dce5]/70" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((item) => (
        <span key={item} className="rounded-sm bg-current/15" />
      ))}
    </div>
  );
}

function LogGlyph() {
  return (
    <div className="space-y-3 text-white/52" aria-hidden="true">
      <span className="block h-px w-11/12 bg-current" />
      <span className="block h-px w-2/3 bg-current" />
      <span className="block h-px w-5/6 bg-current" />
      <span className="block h-px w-1/2 bg-current" />
    </div>
  );
}
