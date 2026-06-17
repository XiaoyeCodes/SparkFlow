import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div
      className="page-enter min-h-screen pt-[var(--nav-height)]"
      initial={{ opacity: 0, y: 24, filter: 'blur(12px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: -18, filter: 'blur(10px)' }}
      transition={{ duration: 0.72, ease: [0.19, 1, 0.22, 1] }}
    >
      {children}
    </motion.div>
  );
}
