import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { Bot, BrainCircuit, MessageSquareText, Paperclip, SendHorizontal, WandSparkles } from 'lucide-react';
import { BorderGlow } from '../components/BorderGlow';
import { PageTransition } from '../components/PageTransition';
import { Strands } from '../components/Strands';

const assistantCards: Array<[string, string, LucideIcon]> = [
  ['对话中枢', '把临时想法、问题和任务先收进一个清晰的工作流。', MessageSquareText],
  ['知识接线', '后续可以连接 Obsidian，把笔记、主题和双链变成可检索上下文。', BrainCircuit],
  ['行动编排', '把新闻、星图情报和项目计划整理成下一步可执行动作。', WandSparkles]
];

export function Assistant() {
  return (
    <PageTransition>
      <section className="relative min-h-[calc(100vh-var(--nav-height))] overflow-hidden bg-black text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(138,215,255,0.16),transparent_26%),linear-gradient(180deg,rgba(0,0,0,0.08),rgba(0,0,0,0.9)_82%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#8ad7ff]/48 to-transparent" />

        <div className="relative z-10 mx-auto flex min-h-[calc(100vh-var(--nav-height))] w-full max-w-7xl flex-col px-5 pb-10 pt-8 md:px-8">
          <motion.div
            className="mx-auto h-[230px] w-full max-w-[680px] md:h-[300px]"
            initial={{ opacity: 0, y: 20, filter: 'blur(12px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.72, ease: [0.19, 1, 0.22, 1] }}
          >
            <Strands
              colors={['#F97316', '#7C3AED', '#06B6D4']}
              count={3}
              speed={0.5}
              amplitude={1}
              waviness={1.7}
              thickness={0.7}
              glow={2.6}
              taper={3}
              spread={1}
              intensity={0.6}
              saturation={1.5}
              opacity={1}
              scale={1.5}
              glass={false}
              refraction={1}
              dispersion={1}
              glassSize={1}
            />
          </motion.div>

          <motion.div
            className="mx-auto -mt-4 max-w-3xl text-center md:-mt-8"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.58, delay: 0.1, ease: [0.19, 1, 0.22, 1] }}
          >
            <p className="mb-5 inline-flex items-center gap-2 border-l border-[#8ad7ff]/45 pl-3 text-xs font-semibold uppercase tracking-[0.22em] text-[#8ad7ff]/72">
              <Bot size={15} strokeWidth={1.7} />
              AI Assistant
            </p>
            <h1 className="text-balance text-5xl font-semibold leading-[0.92] text-white md:text-7xl">AI助手</h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-8 text-white/62 md:text-lg">
              一个专门承接对话、检索、整理和行动编排的助手栏。先把问题说清楚，再把上下文接进来。
            </p>
          </motion.div>

          <motion.div
            className="mx-auto mt-8 grid w-full max-w-5xl gap-3 md:grid-cols-3"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.52, delay: 0.18, ease: [0.19, 1, 0.22, 1] }}
          >
            {assistantCards.map(([title, body, Icon]) => (
              <article key={title} className="rounded-lg border border-white/10 bg-white/[0.045] p-5 backdrop-blur-2xl">
                <Icon className="text-[#8ad7ff]" size={19} strokeWidth={1.7} />
                <h2 className="mt-5 text-lg font-semibold text-white">{title}</h2>
                <p className="mt-3 text-sm leading-6 text-white/54">{body}</p>
              </article>
            ))}
          </motion.div>

          <motion.div
            className="mx-auto mt-5 w-full max-w-3xl"
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.52, delay: 0.24, ease: [0.19, 1, 0.22, 1] }}
          >
            <BorderGlow
              animated
              edgeSensitivity={1}
              glowColor="40 80 80"
              backgroundColor="rgba(18, 15, 23, 0.82)"
              borderRadius={28}
              glowRadius={40}
              glowIntensity={2.1}
              coneSpread={25}
              fillOpacity={0.42}
              colors={['#c084fc', '#f472b6', '#38bdf8']}
              className="assistant-input-glow"
            >
              <form className="flex min-h-[76px] items-center gap-3 px-4 py-3 md:px-5">
                <button
                  type="button"
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.045] text-white/54 transition hover:border-white/22 hover:text-white"
                  aria-label="添加上下文"
                >
                  <Paperclip size={17} strokeWidth={1.8} />
                </button>
                <input
                  className="h-11 min-w-0 flex-1 bg-transparent text-sm font-medium text-white outline-none placeholder:text-white/36"
                  placeholder="把问题、链接或一段想法交给 AI 助手..."
                  aria-label="AI助手输入"
                />
                <button
                  type="submit"
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-black transition hover:scale-[1.03] hover:bg-[#e9f7ff]"
                  aria-label="发送"
                >
                  <SendHorizontal size={18} strokeWidth={1.9} />
                </button>
              </form>
            </BorderGlow>
          </motion.div>

          <div className="pointer-events-none mt-auto pt-6 text-center font-mono text-[10px] uppercase leading-6 tracking-[0.18em] text-white/28">
            Context intake online / local-first assistant bay
          </div>
        </div>
      </section>
    </PageTransition>
  );
}
