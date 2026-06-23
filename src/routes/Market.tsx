import { useRef } from 'react';
import { motion } from 'framer-motion';
import { Activity, ArrowUpRight, BrainCircuit, FileText, Quote, Sparkles, Target, Waves } from 'lucide-react';
import { HeatmapPretextFlow } from '../components/HeatmapPretextFlow';
import { PageTransition } from '../components/PageTransition';
import { TradingViewHeatmap } from '../components/TradingViewHeatmap';

const marketNews = [
  {
    source: 'Bloomberg',
    time: '3 min',
    title: 'Semiconductor breadth improves as AI capex names regain leadership.',
    impact: 'AI / Chips',
    read: '算力链仍在吸收资金，若扩散到软件与电力设备，风险偏好可继续上移。'
  },
  {
    source: 'Reuters',
    time: '11 min',
    title: 'Healthcare drifts lower before policy headlines and trial readouts.',
    impact: 'Healthcare',
    read: '防御板块没有形成有效避险，短线更像行业内部事件驱动。'
  },
  {
    source: 'WSJ',
    time: '22 min',
    title: 'Treasury yields hold range while megacap growth absorbs fresh inflows.',
    impact: 'Rates',
    read: '利率尚未破坏成长股估值叙事，但需要盯住长端收益率。'
  }
];

const aiBullets = [
  ['AI 主力延续', 'NVDA 与软件链路仍是资金主线', '做多'],
  ['医疗短线承压', 'PFE 与防御板块波动扩大', '回避'],
  ['能源不弱', 'XOM/CVX 维持高位但缺少扩散', '观察'],
  ['等待宏观确认', 'PCE 与收益率决定风格切换', '关注']
];

const researchCards = [
  ['Core Thesis', '市场不是全面风险偏好，而是 AI 算力与少数高质量现金流资产在集中定价。'],
  ['Evidence', '热力图显示科技权重仍然贡献主要宽度，医疗与部分消费板块拖累指数内部质量。'],
  ['Action', '优先观察半导体、软件、电力设备的联动；回避单点事件驱动的弱势防御股。']
];

const investorPrinciples = [
  {
    name: 'Warren Buffett',
    label: '估值与耐心',
    quote: '别人贪婪时恐惧，别人恐惧时贪婪。',
    lesson: '市场热度越高，越要回到企业质量、现金流和安全边际；恐慌时不要被价格波动夺走判断。'
  },
  {
    name: 'Charlie Munger',
    label: '反向思考',
    quote: '反过来想，总是反过来想。',
    lesson: '先问什么会毁掉这笔交易：高估值、坏资产、杠杆、流动性、情绪化加仓。'
  },
  {
    name: 'Ray Dalio',
    label: '原则与复盘',
    quote: '痛苦加反思等于进步。',
    lesson: '亏损不是结论，而是反馈；每一次回撤都要沉淀成可执行的规则。'
  },
  {
    name: 'George Soros',
    label: '盈亏比',
    quote: '关键不是对错，而是对时赚多少，错时亏多少。',
    lesson: '不要为了证明自己正确而持仓；市场确认你错时，先控制下行。'
  },
  {
    name: 'Stanley Druckenmiller',
    label: '开放与纠错',
    quote: '保持开放，发现错了就迅速改变想法。',
    lesson: '不要把观点当身份；热力图和价格一旦证明原假设失效，就先收缩风险，再重新评估。'
  }
];

export function Market() {
  const heatmapRef = useRef<HTMLDivElement | null>(null);

  return (
    <PageTransition>
      <section className="min-h-screen bg-black px-4 pb-10 pt-[calc(var(--nav-height)+24px)] text-white md:px-8">
        <div className="mx-auto w-full max-w-7xl">
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[#8ad7ff]/62">Equity Research Desk</p>
              <h1 className="text-5xl font-semibold leading-[0.94] md:text-7xl">MarketLens</h1>
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-full border border-white/10 bg-white/[0.045] p-1 backdrop-blur-2xl">
              {[
                ['S&P 500', '+0.42%'],
                ['Nasdaq', '+0.68%'],
                ['VIX', '17.4']
              ].map(([label, value]) => (
                <div key={label} className="rounded-full px-3 py-2 text-center">
                  <p className="text-[10px] uppercase text-white/36">{label}</p>
                  <p className="mt-0.5 text-xs font-semibold text-white">{value}</p>
                </div>
              ))}
            </div>
          </div>

          <motion.div
            className="relative overflow-hidden rounded-lg border border-white/10 bg-[#050506] shadow-[0_0_110px_rgba(138,215,255,0.08)]"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: [0.19, 1, 0.22, 1] }}
          >
            <HeatmapPretextFlow obstacleRef={heatmapRef} />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_25%_15%,rgba(138,215,255,0.13),transparent_30%),radial-gradient(circle_at_78%_36%,rgba(255,82,82,0.09),transparent_30%),linear-gradient(to_bottom,rgba(0,0,0,0.10),rgba(0,0,0,0.58))]" />

            <div className="relative z-10 grid gap-4 p-4 lg:grid-cols-[1.55fr_0.75fr] lg:p-5">
              <div ref={heatmapRef} className="glass-market-panel h-[594px] overflow-hidden rounded-lg border border-white/10 bg-black/44">
                <MarketPanelHeader />
                <div className="relative h-[520px] max-h-[520px] overflow-hidden bg-black">
                  <div className="absolute inset-0 opacity-100 brightness-[1.02] contrast-[1.06] saturate-[1.1] [mask-image:radial-gradient(ellipse_at_center,black_74%,rgba(0,0,0,0.88)_90%,transparent_100%)]">
                    <TradingViewHeatmap mode="stocks" />
                  </div>
                  <FluidHeatOverlay />
                </div>
              </div>

              <aside className="flex min-h-[600px] flex-col gap-4">
                <AIAnalystCard />
                <ActionQueue />
                <NewsTape compact />
              </aside>
            </div>

            <ResearchDesk />
          </motion.div>
        </div>
      </section>
    </PageTransition>
  );
}

function MarketPanelHeader() {
  return (
    <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.055] px-5 py-4 backdrop-blur-2xl">
      <div className="flex items-center gap-3">
        <span className="h-2.5 w-2.5 rounded-full bg-[#8ad7ff] shadow-[0_0_22px_rgba(138,215,255,0.8)]" />
        <div>
          <p className="text-sm font-semibold">标普500 市场热力图</p>
          <p className="mt-1 text-xs text-white/42">TradingView live market breadth</p>
        </div>
      </div>
      <a
        href="https://www.tradingview.com/heatmap/stock/"
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white/58 transition hover:text-white"
        aria-label="Open TradingView heatmap"
      >
        <ArrowUpRight size={16} strokeWidth={1.8} />
      </a>
    </div>
  );
}

function AIAnalystCard() {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.06] p-5 backdrop-blur-2xl">
      <div className="flex items-center gap-3">
        <div className="grid h-12 w-12 place-items-center rounded-full border border-[#8ad7ff]/50 bg-[#8ad7ff]/10">
          <BrainCircuit className="text-[#8ad7ff]" size={23} strokeWidth={1.7} />
        </div>
        <div>
          <h2 className="text-xl font-semibold">AI 智能分析师</h2>
          <p className="text-xs text-white/42">多模型融合 + 专业量化视角</p>
        </div>
      </div>
      <div className="mt-5 rounded-lg border border-[#8ad7ff]/18 bg-[#8ad7ff]/8 p-4 text-sm leading-6 text-white/72">
        今日市场偏多，科技与能源领跑。半导体板块受 AI 算力需求持续催化，短线关注 NVDA、AMD 与电力设备链路。
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Metric label="Confidence" value="78%" />
        <Metric label="Risk Mode" value="MID" />
      </div>
    </div>
  );
}

function ActionQueue() {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.055] p-5 backdrop-blur-2xl">
      <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase text-white/44">
        <Sparkles size={15} />
        AI action queue
      </div>
      <div className="space-y-3">
        {aiBullets.map(([title, body, tag], index) => (
          <motion.div
            key={title}
            className="flex items-start justify-between gap-4 border-t border-white/10 pt-3 first:border-t-0 first:pt-0"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.42, delay: index * 0.06 }}
          >
            <div>
              <p className="text-sm font-semibold text-white/84">{title}</p>
              <p className="mt-1 text-xs leading-5 text-white/48">{body}</p>
            </div>
            <span className="rounded-full bg-[#b9ffdc]/10 px-2 py-1 text-[11px] font-semibold text-[#b9ffdc]">{tag}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function ResearchDesk() {
  return (
    <div className="relative z-10 border-t border-white/10 p-4 lg:p-5">
      <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/40">
        <FileText size={15} strokeWidth={1.7} />
        Research desk
      </div>
      <div className="grid gap-4 lg:grid-cols-[0.95fr_1.15fr_0.9fr]">
        {researchCards.map(([title, body], index) => (
          <motion.article
            key={title}
            className="rounded-lg border border-white/10 bg-white/[0.045] p-5 backdrop-blur-2xl"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.48, delay: 0.1 + index * 0.06 }}
          >
            <div className="mb-5 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/30 text-[#8ad7ff]">
              {index === 0 ? <Target size={16} /> : index === 1 ? <Waves size={16} /> : <Activity size={16} />}
            </div>
            <h3 className="text-2xl font-semibold text-white">{title}</h3>
            <p className="mt-4 text-sm leading-7 text-white/60">{body}</p>
          </motion.article>
        ))}
      </div>
      <InvestorPrinciples />
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <NewsTape />
        <div className="rounded-lg border border-white/10 bg-white/[0.045] p-5 backdrop-blur-2xl">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-white/40">AI reasoning</p>
          <div className="space-y-4 text-sm leading-7 text-white/62">
            <p>1. 热力图先看宽度，不先看涨跌幅。科技上涨若只集中在少数巨头，仓位应更克制。</p>
            <p>2. 新闻只作为证据，不作为指令。真正的动作需要价格、量能、波动率共同确认。</p>
            <p>3. 当前更适合建立观察清单，而不是追逐高开后的单点动量。</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function InvestorPrinciples() {
  return (
    <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.04] p-5 backdrop-blur-2xl">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/38">Investor discipline</p>
          <h3 className="mt-2 text-2xl font-semibold text-white">大师原则：看盘时真正要记住的事</h3>
        </div>
        <Quote className="hidden text-[#ffd27a]/70 md:block" size={24} />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {investorPrinciples.map((item, index) => (
          <motion.article
            key={item.name}
            className="rounded-lg border border-white/10 bg-black/24 p-4"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.36, delay: index * 0.04 }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ffd27a]/72">{item.label}</p>
            <h4 className="mt-2 text-lg font-semibold text-white">{item.name}</h4>
            <p className="mt-4 font-serif text-base leading-6 text-white/74">“{item.quote}”</p>
            <p className="mt-4 text-xs leading-6 text-white/48">{item.lesson}</p>
          </motion.article>
        ))}
      </div>
    </div>
  );
}

function NewsTape({ compact = false }: { compact?: boolean }) {
  return (
    <div className="min-h-0 flex-1 rounded-lg border border-white/10 bg-white/[0.045] p-5 backdrop-blur-2xl">
      <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase text-white/44">
        <Activity size={15} />
        Market news + AI read
      </div>
      <div className={compact ? 'space-y-4' : 'grid gap-4 md:grid-cols-3 lg:grid-cols-1'}>
        {marketNews.map((item) => (
          <article key={item.title} className="border-t border-white/10 pt-4 first:border-t-0 first:pt-0 md:first:border-t md:first:pt-4 lg:first:border-t-0 lg:first:pt-0">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-white/38">
              <span>{item.source}</span>
              <span>{item.time}</span>
              <span className="ml-auto rounded-full bg-white/8 px-2 py-1 text-white/52">{item.impact}</span>
            </div>
            <h3 className="text-sm font-semibold leading-5 text-white/82">{item.title}</h3>
            {!compact ? <p className="mt-3 text-xs leading-6 text-white/50">{item.read}</p> : null}
          </article>
        ))}
      </div>
    </div>
  );
}

function FluidHeatOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute left-[8%] top-[12%] h-48 w-48 rounded-full bg-[#00d084]/7 blur-3xl" />
      <div className="absolute bottom-[18%] right-[12%] h-56 w-56 rounded-full bg-[#ff3b3b]/7 blur-3xl" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_64%,rgba(0,0,0,0.24)_88%,rgba(0,0,0,0.64)_100%)]" />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/28 p-3">
      <p className="text-[11px] uppercase text-white/36">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}
