import { motion } from 'framer-motion';
import { ModuleFrame } from '../components/ModuleFrame';
import { books } from '../data/content';

export function Stack() {
  return (
    <ModuleFrame title="推荐书籍" kicker="Stack">
      <div className="grid gap-3 md:grid-cols-2">
        {books.map(([title, author], index) => (
          <motion.article
            key={title}
            className="group rounded-lg border border-white/10 bg-[#11100f] p-7 transition hover:border-white/22"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.52, delay: index * 0.05 }}
          >
            <h2 className="origin-left text-3xl font-semibold leading-[1.02] text-white transition duration-300 group-hover:scale-x-[1.018] group-hover:skew-x-[1deg] md:text-5xl">
              {title}
            </h2>
            <p className="mt-6 font-serif text-xl italic text-white/50">{author}</p>
          </motion.article>
        ))}
      </div>
    </ModuleFrame>
  );
}
