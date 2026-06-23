import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  Atom,
  BarChart3,
  BookOpenText,
  Brain,
  ChartNoAxesCombined,
  CircuitBoard,
  Dna,
  Landmark,
  Network,
  Orbit,
  Scale,
  ScrollText,
  Sparkles,
  Sprout,
  X
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ModuleFrame } from '../components/ModuleFrame';
import { bookCategories, books, type Book, type BookVisual } from '../data/content';

const visualStyles: Record<BookVisual, { bg: string; accent: string; Icon: typeof BookOpenText; motif: 'bars' | 'rings' | 'grid' | 'wave' | 'nodes' }> = {
  inequality: { bg: 'from-[#16120a] via-[#221808] to-[#060607]', accent: '#ffd27a', Icon: BarChart3, motif: 'bars' },
  capital: { bg: 'from-[#181006] via-[#2a1608] to-[#060607]', accent: '#ffb86b', Icon: ChartNoAxesCombined, motif: 'wave' },
  justice: { bg: 'from-[#071117] via-[#101b25] to-[#060607]', accent: '#8ad7ff', Icon: Scale, motif: 'rings' },
  history: { bg: 'from-[#130d08] via-[#231407] to-[#070605]', accent: '#d8a85d', Icon: ScrollText, motif: 'grid' },
  china: { bg: 'from-[#0b1114] via-[#11202a] to-[#050607]', accent: '#8ad7ff', Icon: Landmark, motif: 'grid' },
  rural: { bg: 'from-[#07130c] via-[#0d2315] to-[#050706]', accent: '#b9ffdc', Icon: Sprout, motif: 'nodes' },
  game: { bg: 'from-[#0d0d15] via-[#17152a] to-[#060607]', accent: '#c8b7ff', Icon: Network, motif: 'nodes' },
  mind: { bg: 'from-[#111018] via-[#201b2c] to-[#060607]', accent: '#e1c6ff', Icon: Brain, motif: 'rings' },
  gene: { bg: 'from-[#07120f] via-[#10241c] to-[#050607]', accent: '#89f7c2', Icon: Dna, motif: 'wave' },
  human: { bg: 'from-[#10110a] via-[#1e2010] to-[#060607]', accent: '#d7f187', Icon: Orbit, motif: 'rings' },
  poverty: { bg: 'from-[#0c100b] via-[#172112] to-[#060706]', accent: '#b9ffdc', Icon: BarChart3, motif: 'bars' },
  class: { bg: 'from-[#101010] via-[#1b1b1d] to-[#060607]', accent: '#d8d8d8', Icon: Network, motif: 'grid' },
  macro: { bg: 'from-[#091018] via-[#102238] to-[#050607]', accent: '#8ad7ff', Icon: ChartNoAxesCombined, motif: 'wave' },
  crisis: { bg: 'from-[#160908] via-[#2c1110] to-[#060607]', accent: '#ff7f6e', Icon: BarChart3, motif: 'wave' },
  geopolitics: { bg: 'from-[#0a1017] via-[#142236] to-[#050607]', accent: '#83bfff', Icon: Landmark, motif: 'rings' },
  cycle: { bg: 'from-[#111008] via-[#241d0b] to-[#060607]', accent: '#ffd27a', Icon: Orbit, motif: 'rings' },
  system: { bg: 'from-[#07110f] via-[#10251f] to-[#050607]', accent: '#8ff4d0', Icon: CircuitBoard, motif: 'nodes' },
  wisdom: { bg: 'from-[#121008] via-[#211a0c] to-[#060607]', accent: '#ffe08a', Icon: Sparkles, motif: 'grid' },
  finance: { bg: 'from-[#101014] via-[#171b23] to-[#060607]', accent: '#a7d8ff', Icon: ChartNoAxesCombined, motif: 'wave' },
  design: { bg: 'from-[#11100f] via-[#201a14] to-[#060607]', accent: '#ffc48a', Icon: Atom, motif: 'grid' },
  technology: { bg: 'from-[#071015] via-[#0f202a] to-[#050607]', accent: '#8ad7ff', Icon: CircuitBoard, motif: 'nodes' }
};

export function Stack() {
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const categoryStats = useMemo(() => `${bookCategories.length} categories · ${books.length} books`, []);

  const scrollToCategory = (id: string) => {
    document.getElementById(`category-${id}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  };

  useEffect(() => {
    if (!selectedBook) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedBook(null);
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [selectedBook]);

  return (
    <ModuleFrame title="推荐书籍" kicker="Reading Stack">
      <div className="space-y-9">
        <section className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
          <motion.div
            className="relative overflow-hidden rounded-lg border border-white/10 bg-[#0a0a09] p-6 md:p-8"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.48 }}
          >
            <div className="pointer-events-none absolute inset-0 opacity-50 [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:42px_42px]" />
            <div className="relative">
              <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-[#ffd27a]/24 bg-[#ffd27a]/8 px-3 py-1 text-xs font-semibold text-[#ffd27a]">
                <Sparkles size={14} />
                {categoryStats}
              </div>
              <h2 className="max-w-3xl font-serif text-[clamp(2.2rem,5vw,5rem)] leading-[1.02] text-white/90">
                用分类书架建立一套可复用的世界理解框架。
              </h2>
              <p className="mt-7 max-w-2xl text-sm leading-7 text-white/56 md:text-base">
                现在的书单按学科和问题域组织：经济学与不平等、社会阶层、历史中国、认知决策、演化文明、政治秩序、系统技术。每本书都有一张生成式主题图，点击卡片可以展开完整介绍。
              </p>
            </div>
          </motion.div>

          <div className="grid gap-3 md:grid-cols-2">
            {bookCategories.map((category, index) => (
              <motion.button
                type="button"
                onClick={() => scrollToCategory(category.id)}
                key={category.id}
                className="group rounded-lg border border-white/10 bg-white/[0.045] p-5 text-left transition hover:-translate-y-0.5 hover:border-[#ffd27a]/35 focus:outline-none focus:ring-2 focus:ring-[#ffd27a]/40"
                initial={{ opacity: 0, x: 18 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.42, delay: index * 0.04 }}
              >
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/32">{category.books.length} books</p>
                    <h3 className="mt-1 text-xl font-semibold leading-tight text-white">{category.title}</h3>
                  </div>
                  <ArrowRight className="shrink-0 text-[#ffd27a]/72 transition group-hover:translate-x-1" size={19} />
                </div>
                <p className="text-sm leading-6 text-white/52">{category.subtitle}</p>
              </motion.button>
            ))}
          </div>
        </section>

        <section className="space-y-8">
          {bookCategories.map((category, categoryIndex) => (
            <div key={category.id} id={`category-${category.id}`} className="scroll-mt-28">
              <div className="mb-4 flex flex-col justify-between gap-3 border-b border-white/10 pb-4 md:flex-row md:items-end">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/34">
                    {String(categoryIndex + 1).padStart(2, '0')} · {category.books.length} books
                  </p>
                  <h2 className="mt-1 text-3xl font-semibold text-white md:text-4xl">{category.title}</h2>
                </div>
                <p className="max-w-xl text-sm leading-6 text-white/44">{category.subtitle}</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {category.books.map((book, index) => (
                  <BookCard
                    key={book.title}
                    book={book}
                    index={index}
                    sequence={categoryIndex * 4 + index}
                    onSelect={() => setSelectedBook(book)}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>

      {typeof document !== 'undefined'
        ? createPortal(
            <AnimatePresence>
              {selectedBook ? <BookDialog book={selectedBook} onClose={() => setSelectedBook(null)} /> : null}
            </AnimatePresence>,
            document.body
          )
        : null}
    </ModuleFrame>
  );
}

function BookCard({ book, index, sequence, onSelect }: { book: Book; index: number; sequence: number; onSelect: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onSelect}
      className="group grid min-h-[360px] grid-rows-[180px_1fr] overflow-hidden rounded-lg border border-white/10 bg-[#10100e] text-left transition duration-300 hover:-translate-y-0.5 hover:border-[#ffd27a]/38 hover:bg-[#14130f] focus:outline-none focus:ring-2 focus:ring-[#ffd27a]/45"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, delay: sequence * 0.018 }}
    >
      <BookCover book={book} index={index} />
      <div className="flex flex-col p-5">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#ffd27a]/70">
              {book.visual.replace('-', ' ')}
            </p>
            <h3 className="text-2xl font-semibold leading-tight text-white">{book.title}</h3>
          </div>
          <ArrowRight className="mt-1 shrink-0 text-white/28 transition group-hover:translate-x-1 group-hover:text-[#ffd27a]" size={18} />
        </div>
        <p className="font-serif text-base italic text-white/45">{book.author}</p>
        <p className="mt-4 line-clamp-3 text-sm leading-6 text-white/58">{book.note}</p>
        <p className="mt-auto pt-5 text-xs font-semibold uppercase tracking-[0.16em] text-white/30">点击查看详细介绍</p>
      </div>
    </motion.button>
  );
}

function BookCover({ book, index }: { book: Book; index: number }) {
  const style = visualStyles[book.visual];
  const Icon = style.Icon;

  return (
    <div className="relative isolate h-full min-h-[180px] overflow-hidden bg-[#0b0b0a] p-5">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(255,255,255,0.08),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.045),transparent_38%)]" />
      <div className="absolute inset-0 opacity-[0.28] [background-image:linear-gradient(rgba(244,238,225,0.11)_1px,transparent_1px),linear-gradient(90deg,rgba(244,238,225,0.11)_1px,transparent_1px)] [background-size:32px_32px]" />
      <FineLineMotif accent={style.accent} index={index} visual={book.visual} />
      <div className="relative flex h-full flex-col justify-between">
        <div className="flex items-start justify-between gap-4">
          <div className="max-w-[70%]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#e9dfcf]/48">Concept map</p>
            <p className="mt-2 text-xl font-semibold leading-tight text-[#f4eee1] drop-shadow">{book.title}</p>
          </div>
          <div className="grid h-11 w-11 place-items-center rounded-full border border-[#e9dfcf]/18 bg-[#f4eee1]/5" style={{ color: style.accent }}>
            <Icon size={22} strokeWidth={1.8} />
          </div>
        </div>
        <div className="flex items-end justify-between gap-4">
          <div className="h-px flex-1 bg-[#e9dfcf]/18" />
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em]" style={{ color: style.accent }}>
            {book.visual}
          </p>
        </div>
      </div>
    </div>
  );
}

function FineLineMotif({ accent, index, visual }: { accent: string; index: number; visual: BookVisual }) {
  const softLine = 'rgba(244,238,225,0.24)';
  const faintLine = 'rgba(244,238,225,0.12)';
  const paperLine = 'rgba(244,238,225,0.42)';

  if (visual === 'history') {
    return (
      <svg className="absolute inset-0 h-full w-full opacity-90" viewBox="0 0 420 220" aria-hidden="true">
        <path d="M58 50 C76 42, 96 42, 112 50 V172 C94 164, 76 164, 58 172 Z" fill="none" stroke={paperLine} strokeWidth="1.1" />
        <path d="M112 50 H350 V172 H112" fill="none" stroke={faintLine} strokeWidth="1" />
        <path d="M142 72 H322 M142 96 H302 M142 120 H336 M142 144 H284" stroke={softLine} strokeWidth="1" />
        <path d="M132 58 V164" stroke={accent} strokeWidth="1.3" />
        {[76, 102, 128, 154].map((y, tick) => (
          <g key={y}>
            <line x1="124" y1={y} x2="140" y2={y} stroke={tick === index % 4 ? accent : paperLine} strokeWidth="1" />
            <circle cx={132} cy={y} r={tick === index % 4 ? 3.5 : 2.2} fill="none" stroke={tick === index % 4 ? accent : faintLine} />
          </g>
        ))}
        <path d="M238 58 C226 82, 226 112, 238 138 C250 112, 250 82, 238 58 Z" fill="none" stroke={accent} strokeWidth="1" opacity="0.75" />
      </svg>
    );
  }

  if (visual === 'china') {
    return (
      <svg className="absolute inset-0 h-full w-full opacity-90" viewBox="0 0 420 220" aria-hidden="true">
        <path d="M62 164 C102 124, 132 148, 166 110 S250 78, 292 104 S350 118, 376 72" fill="none" stroke={accent} strokeWidth="1.3" />
        <path d="M74 176 H354" stroke={softLine} strokeWidth="1" />
        {[96, 150, 204, 258, 312].map((x, i) => (
          <g key={x}>
            <path d={`M${x} 166 V${118 - (i % 2) * 18}`} stroke={paperLine} strokeWidth="1" />
            <path d={`M${x - 14} ${122 - (i % 2) * 18} H${x + 14} L${x} ${104 - (i % 2) * 18} Z`} fill="none" stroke={i === index % 5 ? accent : faintLine} strokeWidth="1" />
          </g>
        ))}
        <path d="M90 70 H330 M112 88 H308 M132 106 H286" stroke={faintLine} strokeWidth="1" />
      </svg>
    );
  }

  if (visual === 'rural') {
    return (
      <svg className="absolute inset-0 h-full w-full opacity-90" viewBox="0 0 420 220" aria-hidden="true">
        <path d="M66 172 H356" stroke={softLine} />
        {[78, 112, 146, 180, 214, 248, 282, 316].map((x, i) => (
          <path key={x} d={`M${x} 172 C${x + 8} 140, ${x + 10} 110, ${x + 24} 82`} fill="none" stroke={i % 3 === index % 3 ? accent : faintLine} strokeWidth="1" />
        ))}
        <path d="M94 134 C128 106, 162 106, 196 134 S264 162, 330 92" fill="none" stroke={paperLine} strokeWidth="1" />
        <circle cx="196" cy="134" r="4" fill="none" stroke={accent} />
      </svg>
    );
  }

  if (visual === 'inequality' || visual === 'poverty') {
    const curve = visual === 'poverty' ? 'M62 168 C122 166, 168 152, 210 130 S300 78, 358 58' : 'M62 172 C144 170, 226 152, 358 52';
    return (
      <svg className="absolute inset-0 h-full w-full opacity-90" viewBox="0 0 420 220" aria-hidden="true">
        <path d="M62 172 H360 M62 172 V52" stroke={softLine} />
        <path d="M62 172 L360 52" stroke={faintLine} strokeDasharray="4 7" />
        <path d={curve} fill="none" stroke={accent} strokeWidth="1.6" />
        {[98, 134, 170, 206, 242, 278, 314].map((x, i) => (
          <line key={x} x1={x} y1="172" x2={x} y2={154 - i * (visual === 'poverty' ? 9 : 14)} stroke={i > 4 ? accent : faintLine} />
        ))}
        <path d="M82 70 H176 M82 88 H154" stroke={paperLine} />
      </svg>
    );
  }

  if (visual === 'capital' || visual === 'macro' || visual === 'finance') {
    return (
      <svg className="absolute inset-0 h-full w-full opacity-90" viewBox="0 0 420 220" aria-hidden="true">
        <path d="M58 160 C108 128, 138 132, 178 104 S258 62, 358 88" fill="none" stroke={accent} strokeWidth="1.5" />
        <path d="M62 176 H362 M76 58 V176" stroke={softLine} />
        {[108, 146, 184, 222, 260, 298, 336].map((x, i) => (
          <rect key={x} x={x} y={142 - ((i + index) % 4) * 18} width="12" height={34 + ((i + index) % 4) * 18} fill="none" stroke={i % 2 ? faintLine : paperLine} />
        ))}
        <path d="M88 84 C154 42, 222 178, 338 112" fill="none" stroke={visual === 'finance' ? accent : faintLine} strokeDasharray={visual === 'finance' ? '2 6' : '6 8'} />
      </svg>
    );
  }

  if (visual === 'justice' || visual === 'class') {
    return (
      <svg className="absolute inset-0 h-full w-full opacity-90" viewBox="0 0 420 220" aria-hidden="true">
        <path d="M210 54 V164 M142 82 H278 M168 164 H252" stroke={accent} strokeWidth="1.2" />
        <path d="M142 82 L104 148 H180 Z M278 82 L240 148 H316 Z" fill="none" stroke={softLine} />
        <path d="M104 148 C126 160, 158 160, 180 148 M240 148 C262 136, 294 136, 316 148" stroke={visual === 'justice' ? accent : faintLine} fill="none" />
        {visual === 'class'
          ? [72, 102, 132, 162, 286, 316, 346].map((x, i) => <circle key={x} cx={x} cy={70 + (i % 3) * 42} r="4" fill="none" stroke={i % 2 ? accent : faintLine} />)
          : null}
      </svg>
    );
  }

  if (visual === 'mind') {
    return (
      <svg className="absolute inset-0 h-full w-full opacity-90" viewBox="0 0 420 220" aria-hidden="true">
        <path d="M84 106 C112 48, 186 54, 204 106 C228 54, 306 48, 336 106 C318 168, 238 168, 204 116 C174 168, 102 168, 84 106 Z" fill="none" stroke={softLine} />
        <path d="M92 104 C154 96, 196 126, 252 106 S318 82, 354 112" fill="none" stroke={accent} strokeWidth="1.4" />
        <path d="M112 78 H166 M126 132 H176 M238 78 H296 M246 136 H318" stroke={faintLine} />
        <circle cx="204" cy="112" r="5" fill="none" stroke={accent} />
      </svg>
    );
  }

  if (visual === 'game') {
    return (
      <svg className="absolute inset-0 h-full w-full opacity-90" viewBox="0 0 420 220" aria-hidden="true">
        <rect x="96" y="54" width="220" height="128" rx="4" fill="none" stroke={softLine} />
        <path d="M96 118 H316 M206 54 V182" stroke={faintLine} />
        <path d="M124 82 L176 102 M238 84 L286 104 M124 150 L176 132 M238 150 L286 132" stroke={accent} />
        <circle cx="96" cy="54" r="5" fill="none" stroke={accent} />
        <circle cx="316" cy="182" r="5" fill="none" stroke={paperLine} />
      </svg>
    );
  }

  if (visual === 'gene') {
    return (
      <svg className="absolute inset-0 h-full w-full opacity-90" viewBox="0 0 420 220" aria-hidden="true">
        <path d="M112 40 C248 72, 172 150, 306 182 M306 40 C172 72, 248 150, 112 182" fill="none" stroke={accent} strokeWidth="1.3" />
        {[62, 86, 110, 134, 158].map((y, i) => (
          <line key={y} x1={132 + (i % 2) * 18} y1={y} x2={286 - (i % 2) * 18} y2={y + 4} stroke={i % 2 ? softLine : faintLine} />
        ))}
      </svg>
    );
  }

  if (visual === 'human') {
    return (
      <svg className="absolute inset-0 h-full w-full opacity-90" viewBox="0 0 420 220" aria-hidden="true">
        <path d="M72 158 C120 84, 186 134, 228 78 S316 44, 358 96" fill="none" stroke={accent} strokeWidth="1.3" />
        <path d="M94 170 C138 150, 168 154, 206 128 S268 86, 330 112" fill="none" stroke={softLine} />
        {[94, 142, 190, 238, 286, 334].map((x, i) => <circle key={x} cx={x} cy={156 - (i % 3) * 32} r="4" fill="none" stroke={i % 2 ? accent : faintLine} />)}
        <path d="M68 180 H360" stroke={faintLine} />
      </svg>
    );
  }

  if (visual === 'geopolitics' || visual === 'cycle') {
    return (
      <svg className="absolute inset-0 h-full w-full opacity-90" viewBox="0 0 420 220" aria-hidden="true">
        <circle cx="210" cy="112" r="58" fill="none" stroke={softLine} />
        <circle cx="210" cy="112" r="92" fill="none" stroke={faintLine} />
        <path d="M118 112 H302 M210 20 V204" stroke={faintLine} />
        <path d="M138 78 C174 52, 232 52, 286 82 M136 148 C184 178, 244 174, 292 140" stroke={accent} fill="none" />
        {visual === 'cycle' ? <path d="M288 80 L300 82 L292 92 M132 146 L120 144 L128 134" stroke={accent} fill="none" /> : <path d="M156 112 L210 72 L264 112 L210 152 Z" fill="none" stroke={paperLine} />}
      </svg>
    );
  }

  if (visual === 'crisis') {
    return (
      <svg className="absolute inset-0 h-full w-full opacity-90" viewBox="0 0 420 220" aria-hidden="true">
        <path d="M58 82 H360 M58 142 H360" stroke={faintLine} />
        <path d="M72 162 L122 104 L168 126 L210 72 L260 154 L314 88 L356 122" fill="none" stroke={accent} strokeWidth="1.6" />
        <path d="M112 58 C142 82, 142 112, 112 136 M288 58 C258 82, 258 112, 288 136" stroke={softLine} fill="none" />
        <circle cx="210" cy="72" r="5" fill="none" stroke={accent} />
      </svg>
    );
  }

  if (visual === 'system' || visual === 'technology') {
    const nodes = [
      [92, 72],
      [190, 54],
      [300, 82],
      [128, 154],
      [240, 160],
      [336, 140]
    ];
    return (
      <svg className="absolute inset-0 h-full w-full opacity-90" viewBox="0 0 420 220" aria-hidden="true">
        <path d="M92 72 C140 36, 238 32, 300 82 S308 170, 240 160 S144 196, 128 154 S52 112, 92 72" fill="none" stroke={accent} strokeWidth="1" strokeDasharray={visual === 'system' ? '3 7' : '1 6'} />
        {nodes.map(([x, y], i) => (
          <g key={`${x}-${y}`}>
            {i > 0 ? <line x1={x} y1={y} x2={nodes[i - 1][0]} y2={nodes[i - 1][1]} stroke={faintLine} /> : null}
            <rect x={x - 10} y={y - 10} width="20" height="20" rx={visual === 'technology' ? 3 : 10} fill="none" stroke={i % 2 ? accent : softLine} />
          </g>
        ))}
      </svg>
    );
  }

  if (visual === 'design' || visual === 'wisdom') {
    return (
      <svg className="absolute inset-0 h-full w-full opacity-90" viewBox="0 0 420 220" aria-hidden="true">
        <rect x="82" y="54" width="250" height="124" rx="6" fill="none" stroke={softLine} />
        <path d="M114 146 L176 84 L222 132 L282 72" fill="none" stroke={accent} strokeWidth="1.3" />
        <path d="M110 78 H310 M110 106 H168 M246 106 H310 M110 134 H154 M272 134 H310" stroke={faintLine} />
        {visual === 'wisdom' ? <circle cx="282" cy="72" r="18" fill="none" stroke={paperLine} /> : <path d="M188 74 L264 74 L302 140 L150 140 Z" fill="none" stroke={paperLine} />}
      </svg>
    );
  }

  return (
    <svg className="absolute inset-0 h-full w-full opacity-90" viewBox="0 0 420 220" aria-hidden="true">
      <path d="M72 164 L142 108 L210 132 L282 72 L350 96" fill="none" stroke={accent} strokeWidth="1.4" />
      <rect x="74" y="54" width="260" height="118" rx="4" fill="none" stroke={softLine} />
    </svg>
  );
}

function BookDialog({ book, onClose }: { book: Book; onClose: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center bg-black/76 px-4 py-6 backdrop-blur-xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.article
        className="grid max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-lg border border-white/12 bg-[#080808] shadow-[0_30px_120px_rgba(0,0,0,0.65)] lg:grid-cols-[0.85fr_1.15fr]"
        initial={{ opacity: 0, y: 22, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ duration: 0.22 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="min-h-[320px]">
          <BookCover book={book} index={2} />
        </div>
        <div className="overflow-y-auto p-6 md:p-8">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#ffd27a]/72">Book detail</p>
              <h2 className="text-4xl font-semibold leading-tight text-white md:text-5xl">{book.title}</h2>
              <p className="mt-4 font-serif text-xl italic text-white/48">{book.author}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/60 transition hover:text-white"
              aria-label="关闭书籍详情"
            >
              <X size={18} />
            </button>
          </div>

          <div className="space-y-6">
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/34">内容介绍</h3>
              <p className="text-base leading-8 text-white/68">{book.summary}</p>
            </section>
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/34">为什么值得读</h3>
              <p className="text-base leading-8 text-white/68">{book.why}</p>
            </section>
            <section>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-white/34">核心关键词</h3>
              <div className="flex flex-wrap gap-2">
                {book.keyIdeas.map((idea) => (
                  <span key={idea} className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-sm text-white/62">
                    {idea}
                  </span>
                ))}
              </div>
            </section>
            <section className="rounded-lg border border-[#ffd27a]/18 bg-[#ffd27a]/8 p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#ffd27a]/78">阅读问题</h3>
              <p className="text-sm leading-7 text-white/68">{book.readingPrompt}</p>
            </section>
          </div>
        </div>
      </motion.article>
    </motion.div>
  );
}
