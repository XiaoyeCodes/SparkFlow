import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PageTransition } from './PageTransition';

export function ModuleFrame({
  title,
  kicker,
  children
}: {
  title: string;
  kicker: string;
  children: ReactNode;
}) {
  const location = useLocation();
  const hasHeader = Boolean(title || kicker);

  return (
    <PageTransition>
      <motion.section
        layoutId={`gateway-${location.pathname}`}
        className="mx-auto min-h-[calc(100vh-var(--nav-height))] w-full max-w-7xl px-4 py-8 md:px-8 md:py-12"
        transition={{ duration: 0.7, ease: [0.19, 1, 0.22, 1] }}
      >
        {hasHeader ? (
          <div className="mb-10 flex items-center justify-between gap-4">
            <div>
              {kicker ? <p className="mb-3 text-xs font-semibold uppercase text-white/40">{kicker}</p> : null}
              {title ? <h1 className="max-w-4xl text-5xl font-semibold leading-[0.96] text-white md:text-7xl">{title}</h1> : null}
            </div>
            <Link
              to="/"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/5 text-white/70 transition hover:border-white/25 hover:text-white"
              aria-label="Back to home"
            >
              <ArrowLeft size={17} strokeWidth={1.8} />
            </Link>
          </div>
        ) : null}
        {children}
      </motion.section>
    </PageTransition>
  );
}
