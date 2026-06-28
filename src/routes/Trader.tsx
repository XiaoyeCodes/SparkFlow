import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  BookOpenText,
  Brain,
  ChartNoAxesCombined,
  Clock3,
  Landmark,
  Layers3,
  LineChart,
  Scale,
  ShieldCheck,
  Target,
  TrendingUp,
  X
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DcaRhythmFlow } from '../components/DcaRhythmFlow';
import { ModuleFrame } from '../components/ModuleFrame';

const articleToc = [
  'r > g：为什么劳动收入需要转化为资本所有权',
  '资本的平均利率：国债、综合资本与权益资产',
  '行为价差：为什么市场赚钱，投资者不赚钱',
  '定投机制：用纪律替代择时幻觉',
  '全天候策略：动态计算、买卖与再平衡规则'
];

const ALL_WEATHER_URL = '/allweather/index.html';

function AllWeatherWorkbench() {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const cleanupRef = useRef<null | (() => void)>(null);
  const [frameHeight, setFrameHeight] = useState(2400);

  const syncFrameHeight = useCallback(() => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (!doc) return;

    const nextHeight = Math.max(
      1800,
      doc.documentElement.scrollHeight,
      doc.body?.scrollHeight || 0
    );
    setFrameHeight(nextHeight + 24);
  }, []);

  const handleLoad = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    syncFrameHeight();

    const refresh = () => window.requestAnimationFrame(syncFrameHeight);
    window.addEventListener('resize', refresh);
    const timers = [250, 800, 1600, 3200].map((delay) => window.setTimeout(refresh, delay));

    cleanupRef.current = () => {
      window.removeEventListener('resize', refresh);
      timers.forEach(window.clearTimeout);
    };
  }, [syncFrameHeight]);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  return (
    <motion.section
      className="overflow-hidden rounded-lg border border-white/10 bg-black shadow-[0_30px_120px_rgba(0,0,0,0.52)]"
      initial={{ opacity: 0, y: 18, scale: 0.992 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.62, delay: 0.06, ease: [0.19, 1, 0.22, 1] }}
    >
      <iframe
        ref={frameRef}
        title="AllWeather.Fix ETF 定投工作台"
        src={ALL_WEATHER_URL}
        onLoad={handleLoad}
        className="block w-full border-0 bg-black"
        style={{ height: frameHeight }}
      />
    </motion.section>
  );
}

export function Trader() {
  const [isWhitepaperOpen, setWhitepaperOpen] = useState(false);

  useEffect(() => {
    if (!isWhitepaperOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setWhitepaperOpen(false);
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isWhitepaperOpen]);

  const revealRhythm = () => {
    document.getElementById('dca-rhythm')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <ModuleFrame title="" kicker="">
      <div className="space-y-5">
        <motion.section
          id="dca-rhythm"
          className="scroll-mt-24"
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.78, ease: [0.19, 1, 0.22, 1] }}
        >
          <DcaRhythmFlow />
        </motion.section>

        <AllWeatherWorkbench />

        <section className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
          <motion.article
            className="relative min-h-[620px] overflow-hidden rounded-lg border border-white/10 bg-[#090908] p-6 md:p-9"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="pointer-events-none absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(244,238,225,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(244,238,225,0.07)_1px,transparent_1px)] [background-size:38px_38px]" />
            <div className="relative flex min-h-[548px] flex-col justify-between">
              <div>
                <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-[#b9ffdc]/22 bg-[#b9ffdc]/8 px-3 py-1 text-xs font-semibold text-[#b9ffdc]">
                  <BookOpenText size={14} />
                  Whitepaper / ETF dollar-cost averaging
                </div>
                <h2 className="max-w-3xl font-serif text-[clamp(2.5rem,5.8vw,6.4rem)] leading-[0.96] text-white/92">
                  把劳动收入，系统性转化为资本所有权。
                </h2>
                <p className="mt-8 max-w-2xl text-base leading-8 text-white/58">
                  这不是一篇鼓吹短期收益的投资说明，而是一套给普通人看的经济学解释：为什么资本回报长期高于工资增长，为什么多数投资者拿不到市场平均收益，以及为什么宽基 ETF 定投是一种朴素但有效的反人性机制。
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <button
                  type="button"
                  onClick={() => setWhitepaperOpen(true)}
                  className="inline-flex items-center justify-between gap-4 rounded-lg border border-[#b9ffdc]/28 bg-[#b9ffdc]/10 px-5 py-4 text-left font-semibold text-white transition hover:border-[#b9ffdc]/50 hover:bg-[#b9ffdc]/14"
                >
                  <span className="inline-flex items-center gap-3">
                    <BookOpenText size={18} />
                    阅读完整文章
                  </span>
                  <ArrowRight size={18} />
                </button>
                <button
                  type="button"
                  onClick={revealRhythm}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.045] px-5 py-4 text-sm font-semibold text-white/68 transition hover:border-white/22 hover:text-white"
                >
                  <ChartNoAxesCombined size={16} />
                  定投节奏流线
                </button>
              </div>
            </div>
          </motion.article>

          <motion.aside
            className="rounded-lg border border-white/10 bg-[#0d0e0c] p-5 md:p-6"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05 }}
          >
            <div className="mb-6 flex items-center justify-between gap-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/34">Core diagrams</p>
              <LineChart className="text-[#b9ffdc]" size={18} />
            </div>
            <RgSpreadChart />
            <div className="mt-5 grid gap-3">
              {articleToc.map((item, index) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setWhitepaperOpen(true)}
                  className="group flex items-center justify-between gap-4 rounded-lg border border-white/10 bg-black/22 px-4 py-3 text-left text-sm text-white/58 transition hover:border-[#b9ffdc]/28 hover:text-white"
                >
                  <span>
                    <span className="mr-3 font-mono text-xs text-[#b9ffdc]/58">{String(index + 1).padStart(2, '0')}</span>
                    {item}
                  </span>
                  <ArrowRight className="shrink-0 transition group-hover:translate-x-1" size={14} />
                </button>
              ))}
            </div>
          </motion.aside>
        </section>
      </div>

      {typeof document !== 'undefined'
        ? createPortal(
            <AnimatePresence>
              {isWhitepaperOpen ? <WhitepaperDialog onClose={() => setWhitepaperOpen(false)} /> : null}
            </AnimatePresence>,
            document.body
          )
        : null}
    </ModuleFrame>
  );
}

function WhitepaperDialog({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 bg-black/78 px-3 py-4 backdrop-blur-xl md:px-6 md:py-7"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.article
        className="mx-auto grid h-full max-w-6xl overflow-hidden rounded-lg border border-white/12 bg-[#f4eee1] text-[#171715] shadow-[0_30px_120px_rgba(0,0,0,0.6)] lg:grid-cols-[260px_1fr]"
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.985 }}
        transition={{ duration: 0.24 }}
        onClick={(event) => event.stopPropagation()}
      >
        <aside className="hidden border-r border-black/10 bg-[#ebe3d3] p-5 lg:block">
          <div className="sticky top-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-black/38">Whitepaper</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight">ETF 定投经济学说明书</h2>
            <div className="mt-8 space-y-3">
              {articleToc.map((item, index) => (
                <a key={item} href={`#wp-${index + 1}`} className="block rounded-md px-3 py-2 text-sm leading-5 text-black/56 transition hover:bg-black/5 hover:text-black">
                  <span className="mr-2 font-mono text-xs text-black/34">{String(index + 1).padStart(2, '0')}</span>
                  {item}
                </a>
              ))}
            </div>
          </div>
        </aside>

        <div className="overflow-y-auto">
          <header className="sticky top-0 z-20 flex items-center justify-between border-b border-black/10 bg-[#f4eee1]/88 px-5 py-4 backdrop-blur-xl md:px-8">
            <div className="flex items-center gap-3">
              <BookOpenText size={18} />
              <span className="text-sm font-semibold">股票 ETF 定投白皮书</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-10 w-10 place-items-center rounded-full border border-black/10 text-black/62 transition hover:bg-black/5 hover:text-black"
              aria-label="关闭白皮书"
            >
              <X size={18} />
            </button>
          </header>

          <main className="px-5 py-8 md:px-10 md:py-12">
            <section className="mx-auto max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-black/44">Research note / Personal finance</p>
              <h1 className="mt-5 font-serif text-[clamp(2.6rem,6vw,6rem)] leading-[0.96]">
                为什么普通人需要 ETF 定投
              </h1>
              <p className="mt-7 text-xl leading-9 text-black/66">
                这份白皮书试图讲清楚一个朴素问题：如果资本回报长期高于工资增长，而大多数投资者又因为行为错误拿不到市场平均收益，那么普通人应当怎样用最低复杂度、最低行动频率，把劳动成果逐步接入资本回报系统。
              </p>
              <div className="mt-8 rounded-lg border border-black/10 bg-black/[0.035] p-4 text-sm leading-7 text-black/58">
                本文只用于投资教育和方法论说明，不构成任何个性化投资建议。ETF 仍然有波动、回撤、汇率、估值和流动性风险。
              </div>
            </section>

            <ArticleSection id="wp-1" eyebrow="Part 01" title="r > g：资本回报为什么会持续压过劳动增长">
              <p>
                皮凯蒂在《21世纪资本论》中提出的核心公式是 <strong>r &gt; g</strong>。这里的 <strong>r</strong> 是资本回报率，包括利润、股息、利息、租金和资产增值；<strong>g</strong> 是经济增长率，长期看也接近社会总工资和劳动收入的增长速度。
              </p>
              <p>
                在长期历史中，资本回报率常见区间大约在 <strong>4% 到 5%</strong>，而经济增长率常见区间约为 <strong>1.5% 到 2%</strong>。这意味着资本所有者不只是“有钱”，而是处在一个更快的复利系统里。工资增长靠个人时间和组织分配，资本增长则来自企业利润、生产率提升、资产重估和现金流再投资。
              </p>
              <Figure title="资本回报与经济增长的长期剪刀差" caption="示意图：根据文中假设，和平时期 r 通常高于 g。1914-1970 年代因为战争、萧条、税制和人口红利，曾出现罕见反转。">
                <RgSpreadChart />
              </Figure>
              <p>
                这并不意味着劳动不重要。恰恰相反，普通人的第一桶本金通常只能来自劳动。但如果劳动成果长期只停留在现金和消费层面，它会不断面对通胀、资产价格上涨和工资增速放缓。ETF 定投的意义，就是把一部分劳动收入制度化地转化为资本所有权。
              </p>
            </ArticleSection>

            <ArticleSection id="wp-2" eyebrow="Part 02" title="资本的平均利率：从国债到权益资产">
              <p>
                资本不是单一资产。国债、房产、企业股权、土地和金融资产的风险不同，长期回报也不同。可以把它们理解成一条风险和收益逐渐上升的阶梯。
              </p>
              <Figure title="不同资产的长期真实回报区间" caption="示意数据来自用户提供文本：国债约 1%-2%，综合资本约 4%-5%，权益资产约 6.5%-7%。真实回报指扣除通胀后的购买力增长。">
                <AssetReturnBars />
              </Figure>
              <p>
                国债更像资本的“保底利率”，长期真实回报大约只能勉强跑赢通胀；综合资本代表土地、房产、工业资本和金融资产的平均回报；而股票权益资产则代表企业所有权，长期回报更高，但波动也更大。
              </p>
              <p>
                对普通人而言，宽基 ETF 的价值在于：它把“买入企业所有权”这件事做得足够低门槛、足够分散、足够透明。你不需要判断哪家公司一定会赢，而是通过指数机制持有一篮子公司，让市场不断筛选胜出者。
              </p>
            </ArticleSection>

            <ArticleSection id="wp-3" eyebrow="Part 03" title="行为价差：市场赚钱，投资者为什么不赚钱">
              <p>
                如果标普 500 长期名义回报接近 10%，为什么很多普通投资者实际年化只有 4% 到 5%？答案不是智商，而是行为。金融学里常把这种差距称为 <strong>Behavior Gap</strong>，也就是市场收益和投资者实际收益之间的差额。
              </p>
              <Figure title="行为价差：市场收益与投资者收益" caption="示意图：DALBAR 研究长期讨论平均投资者收益落后于市场指数，差距主要来自申赎时点、恐慌离场、追涨买入和频繁交易。">
                <BehaviorGapChart />
              </Figure>
              <p>
                人类天然厌恶亏损。亏损 10% 带来的痛苦，往往远大于盈利 10% 带来的快乐。因此投资者常在牛市高点加仓，在熊市低点离场，把本来只是账面波动的亏损变成真实亏损。
              </p>
              <p>
                更麻烦的是，市场的上涨并不均匀。少数关键交易日贡献了大量长期收益，而这些最强反弹往往紧跟在最恐慌的下跌之后。你以为自己是在躲风险，实际上可能刚好错过最重要的修复日。
              </p>
              <Figure title="错过最佳上涨日的代价" caption="1999-2019 年示意：持续持有标普 500 年化约 6.06%；错过最佳 10 天降至约 2.44%；错过最佳 20 天接近 0.08%。">
                <BestDaysChart />
              </Figure>
            </ArticleSection>

            <ArticleSection id="wp-4" eyebrow="Part 04" title="定投机制：用制度对抗人性">
              <p>
                定投不是预测系统，而是纪律系统。它并不承诺买在最低点，也不保证短期盈利。它真正解决的是普通投资者最难解决的问题：买入时点焦虑、情绪化操作、过度交易和长期缺席。
              </p>
              <p>
                定期定额的核心，是让现金流按照固定节奏进入市场。当价格高时，同样的钱买到更少份额；当价格低时，同样的钱买到更多份额。长期看，它降低了对单一买入点的依赖，也减少了“等一个完美时机”的拖延。
              </p>
              <Figure title="定投不是买最低，而是降低时点依赖" caption="示意图：每月固定金额买入，份额会随价格波动自然变化。纪律的价值在于持续在场。">
                <DcaDiagram />
              </Figure>
              <p>
                更重要的是，定投把投资动作从“我要不要现在买”变成“规则到了就执行”。这看似无聊，却恰恰是普通人跨越行为价差的关键。
              </p>
            </ArticleSection>

            <ArticleSection id="wp-5" eyebrow="Part 05" title="全天候策略：用动态计算器把定投变成可执行规则">
              <p>
                我的全天候策略不是押注某一个市场方向，而是把组合拆成四个角色：标普 500 承担美国大盘利润池，纳指基金承担科技创新弹性，长期国债承担利率下行和风险收缩时的防守，黄金资产承担通胀、货币信用和极端不确定性的对冲。它的核心目标不是每一年都跑第一，而是在不同宏观环境里都保留继续留在牌桌上的能力。
              </p>
              <Figure title="全天候策略的动态计算闭环" caption="工具会读取当前持仓市值、新增现金、目标比例和再平衡模式，输出每类资产应买入、卖出或持有的金额。">
                <AllWeatherPolicyMap />
              </Figure>
              <h3>为什么这样设计</h3>
              <p>
                标准稳健型配置采用 45% 标普 500、25% 纳指、20% 长期国债、10% 黄金。前 70% 是权益进攻端，用来承接长期资本回报、企业利润增长和科技创新；后 30% 是防守与对冲端，用来降低单一权益市场深度回撤对心态和现金流的破坏。这个比例的含义是：长期收益主要交给优秀企业，组合稳定性则交给债券与黄金。
              </p>
              <p>
                系统还保留了三种可切换风格：保守型更偏国债与黄金，适合现金流不稳、风险承受力较低或临近大额支出的人；稳健型是默认全天候，兼顾增长与回撤控制；激进型提高纳指权重，适合更年轻、现金流更强、能承受高波动的人。自定义模式则允许你手动调参，系统会把比例归一化后再参与计算。
              </p>
              <h3>如何操作：先录入，再让系统计算</h3>
              <p>
                每次执行前，只需要录入四类资产的当前市值和本月新增定投现金，然后选择投资风格与再平衡模式。工具会先计算当前组合与目标比例之间的偏离，再给出每个资产的目标市值和交易指令。这样做的价值在于：买什么、买多少、是否需要卖出，都由组合规则决定，而不是由当天新闻、涨跌幅或情绪决定。
              </p>
              <h3>如何买入：默认使用智能补仓</h3>
              <p>
                日常定投建议默认使用“智能补仓，只买不卖”。这个模式会把新增现金分成小步长，优先买入低于目标比例最多的资产。价格下跌、权重被动降低的资产会自然获得更多买入金额；价格上涨、权重已经偏高的资产会少买或不买。它相当于把“低位多买、高位少买”写进算法里，同时避免频繁卖出带来的税费、滑点和心理负担。
              </p>
              <h3>如何卖出与再平衡</h3>
              <p>
                卖出不应该是日常动作，而应该是风险校准动作。只有当某类资产明显超配、组合最大偏离超过约 6%，或季度/半年度复盘确认风险已经偏离目标时，再切换到“全面再平衡，允许卖出”。全面再平衡会用“当前持仓 + 新增现金”的总资产重新计算目标市值，高于目标的资产卖出，低于目标的资产买入，让组合回到设定比例附近。
              </p>
              <h3>推荐执行节奏</h3>
              <p>
                更适合普通人的节奏是：每月录入一次持仓与新增现金，执行智能补仓；每季度检查最大偏离、回撤和目标比例是否仍匹配自己的收入稳定性；每半年到一年做一次完整再平衡评估。若最大偏离超过 6%-8%、单一资产因暴涨暴跌显著改变组合风险，或个人现金流、负债、家庭计划发生变化，可以提前复盘。原则上，月度负责买入，季度负责检查，年度负责校准。
              </p>
              <p>
                这套动态计算功能的真正意义，是把投资从“预测市场”改造成“维护系统”。系统告诉你当月最应该补哪里、当前偏离有多大、是否值得强制再平衡；你要做的不是每天猜涨跌，而是持续输入真实持仓，按规则把现金流导入组合，让时间、分散和再平衡一起工作。
              </p>
            </ArticleSection>

            <section className="mx-auto mt-12 max-w-3xl rounded-lg border border-black/10 bg-black/[0.035] p-5">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Target size={17} />
                最后一句话
              </div>
              <p className="text-lg leading-8 text-black/68">
                普通人唯一能做的，不是战胜市场的每一次波动，而是尽早让自己的第一批劳动成果进入资本回报系统，并用宽基、定投、长期持有和少操作，尽可能少地犯人性错误。
              </p>
            </section>
          </main>
        </div>
      </motion.article>
    </motion.div>
  );
}

function ArticleSection({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mx-auto mt-12 max-w-3xl scroll-mt-24 border-t border-black/10 pt-10">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-black/38">{eyebrow}</p>
      <h2 className="mt-3 text-4xl font-semibold leading-tight md:text-5xl">{title}</h2>
      <div className="prose-like mt-7 space-y-5 text-base leading-8 text-black/68">{children}</div>
    </section>
  );
}

function Figure({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <figure className="my-8 overflow-hidden rounded-lg border border-black/10 bg-[#ebe3d3]">
      <div className="border-b border-black/10 px-4 py-3">
        <figcaption className="text-sm font-semibold">{title}</figcaption>
      </div>
      <div className="p-4">{children}</div>
      <p className="border-t border-black/10 px-4 py-3 text-xs leading-5 text-black/48">{caption}</p>
    </figure>
  );
}

function RgSpreadChart() {
  return (
    <svg className="h-[260px] w-full" viewBox="0 0 720 260" aria-label="r greater than g chart">
      <rect width="720" height="260" rx="8" fill="#0d0e0c" />
      {[60, 105, 150, 195].map((y) => (
        <line key={y} x1="56" x2="670" y1={y} y2={y} stroke="rgba(244,238,225,0.12)" />
      ))}
      <path d="M70 78 C170 74, 250 86, 342 80 S520 70, 650 76" fill="none" stroke="#b9ffdc" strokeWidth="3" />
      <path d="M70 168 C168 160, 236 184, 326 146 S520 152, 650 158" fill="none" stroke="#d9fae9" strokeWidth="3" opacity="0.82" />
      <path d="M252 154 C292 116, 340 96, 396 96 C448 98, 490 120, 520 150" fill="none" stroke="#7fd8b3" strokeWidth="2" strokeDasharray="6 8" opacity="0.72" />
      <text x="72" y="42" fill="#f4eee1" fontSize="14" fontWeight="700">长期真实回报率示意</text>
      <text x="565" y="70" fill="#b9ffdc" fontSize="13" fontWeight="700">r: 4%-5%</text>
      <text x="565" y="176" fill="#d9fae9" fontSize="13" fontWeight="700">g: 1.5%-2%</text>
      <text x="278" y="216" fill="rgba(244,238,225,0.55)" fontSize="12">1914-1970 附近曾出现罕见反转</text>
    </svg>
  );
}

function AssetReturnBars() {
  const bars = [
    ['国债', 2, '#d9fae9'],
    ['综合资本', 5, '#b9ffdc'],
    ['权益资产', 7, '#7fd8b3']
  ] as const;

  return (
    <svg className="h-[260px] w-full" viewBox="0 0 720 260" aria-label="asset return bars">
      <rect width="720" height="260" rx="8" fill="#f4eee1" />
      <line x1="76" x2="650" y1="204" y2="204" stroke="rgba(0,0,0,0.22)" />
      {bars.map(([label, value, color], index) => {
        const height = value * 22;
        const x = 132 + index * 170;
        return (
          <g key={label}>
            <rect x={x} y={204 - height} width="76" height={height} rx="5" fill={color} opacity="0.82" />
            <text x={x + 38} y={232} textAnchor="middle" fill="#171715" fontSize="14" fontWeight="700">{label}</text>
            <text x={x + 38} y={190 - height} textAnchor="middle" fill="#171715" fontSize="16" fontWeight="800">{value}%</text>
          </g>
        );
      })}
      <text x="76" y="42" fill="#171715" fontSize="15" fontWeight="800">长期真实回报率区间中位示意</text>
    </svg>
  );
}

function BehaviorGapChart() {
  return (
    <svg className="h-[250px] w-full" viewBox="0 0 720 250" aria-label="behavior gap chart">
      <rect width="720" height="250" rx="8" fill="#f4eee1" />
      <path d="M80 178 C170 90, 260 132, 350 74 S540 94, 650 48" fill="none" stroke="#171715" strokeWidth="2.5" />
      <path d="M80 178 C172 150, 232 204, 320 156 S510 176, 650 128" fill="none" stroke="#7fd8b3" strokeWidth="2.5" opacity="0.82" />
      <path d="M514 92 V128" stroke="#7fd8b3" strokeWidth="2" strokeDasharray="4 6" opacity="0.76" />
      <text x="86" y="44" fill="#171715" fontSize="15" fontWeight="800">市场收益与投资者收益之间的行为价差</text>
      <text x="548" y="52" fill="#171715" fontSize="13" fontWeight="700">市场</text>
      <text x="548" y="142" fill="#2e986f" fontSize="13" fontWeight="700">普通投资者</text>
      <text x="524" y="114" fill="#2e986f" fontSize="12">Gap</text>
    </svg>
  );
}

function BestDaysChart() {
  const bars = [
    ['持续持有', 6.06],
    ['错过10天', 2.44],
    ['错过20天', 0.08]
  ] as const;

  return (
    <svg className="h-[250px] w-full" viewBox="0 0 720 250" aria-label="missing best days chart">
      <rect width="720" height="250" rx="8" fill="#0d0e0c" />
      <line x1="74" x2="650" y1="190" y2="190" stroke="rgba(244,238,225,0.2)" />
      {bars.map(([label, value], index) => {
        const height = Math.max(3, value * 22);
        const x = 124 + index * 180;
        return (
          <g key={label}>
            <rect x={x} y={190 - height} width="86" height={height} rx="5" fill={index === 0 ? '#b9ffdc' : index === 1 ? '#7fd8b3' : '#2e986f'} />
            <text x={x + 43} y={220} textAnchor="middle" fill="#f4eee1" fontSize="13" fontWeight="700">{label}</text>
            <text x={x + 43} y={176 - height} textAnchor="middle" fill="#f4eee1" fontSize="16" fontWeight="800">{value}%</text>
          </g>
        );
      })}
      <text x="74" y="42" fill="#f4eee1" fontSize="15" fontWeight="800">错过最佳上涨日的年化回报损耗</text>
    </svg>
  );
}

function DcaDiagram() {
  return (
    <svg className="h-[250px] w-full" viewBox="0 0 720 250" aria-label="DCA diagram">
      <rect width="720" height="250" rx="8" fill="#f4eee1" />
      <path d="M70 146 C126 84, 176 194, 246 124 S378 74, 450 144 S560 188, 650 92" fill="none" stroke="#171715" strokeWidth="2" />
      {[90, 170, 250, 330, 410, 490, 570, 650].map((x, index) => (
        <g key={x}>
          <line x1={x} y1="52" x2={x} y2="196" stroke="rgba(0,0,0,0.12)" />
          <circle cx={x} cy={index % 2 ? 154 : 116} r={index % 2 ? 8 : 5} fill={index % 2 ? '#b9ffdc' : '#d9fae9'} stroke="#171715" />
        </g>
      ))}
      <text x="70" y="40" fill="#171715" fontSize="15" fontWeight="800">固定金额买入，份额随价格自动变化</text>
      <text x="70" y="222" fill="rgba(0,0,0,0.55)" fontSize="12">价格低时买到更多份额，价格高时买到更少份额。</text>
    </svg>
  );
}

function AllWeatherPolicyMap() {
  const assets = [
    { name: '标普500', weight: '45%', role: '宽基利润池', x: 120, y: 82 },
    { name: '纳指基金', weight: '25%', role: '创新弹性', x: 300, y: 82 },
    { name: '长期国债', weight: '20%', role: '防守缓冲', x: 120, y: 178 },
    { name: '黄金资产', weight: '10%', role: '极端对冲', x: 300, y: 178 }
  ] as const;

  return (
    <svg className="h-[300px] w-full" viewBox="0 0 720 300" aria-label="all weather strategy calculation loop">
      <rect width="720" height="300" rx="8" fill="#0d0e0c" />
      <rect x="28" y="28" width="420" height="224" rx="14" fill="rgba(185,255,220,0.04)" stroke="rgba(185,255,220,0.18)" />
      {assets.map((asset) => (
        <g key={asset.name}>
          <rect x={asset.x} y={asset.y} width="142" height="62" rx="10" fill="rgba(217,250,233,0.06)" stroke="rgba(185,255,220,0.34)" />
          <text x={asset.x + 16} y={asset.y + 24} fill="#f4eee1" fontSize="14" fontWeight="800">{asset.name}</text>
          <text x={asset.x + 16} y={asset.y + 45} fill="#b9ffdc" fontSize="12" fontWeight="700">{asset.weight} / {asset.role}</text>
        </g>
      ))}
      <path d="M448 140 C486 140, 498 140, 526 140" fill="none" stroke="#b9ffdc" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M516 130 L532 140 L516 150" fill="none" stroke="#b9ffdc" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="536" y="58" width="146" height="164" rx="16" fill="rgba(185,255,220,0.08)" stroke="#b9ffdc" />
      <text x="609" y="88" textAnchor="middle" fill="#f4eee1" fontSize="14" fontWeight="800">动态计算器</text>
      <line x1="560" x2="658" y1="104" y2="104" stroke="rgba(244,238,225,0.16)" />
      <text x="560" y="130" fill="rgba(244,238,225,0.72)" fontSize="12">01 当前市值</text>
      <text x="560" y="154" fill="rgba(244,238,225,0.72)" fontSize="12">02 新增现金</text>
      <text x="560" y="178" fill="rgba(244,238,225,0.72)" fontSize="12">03 最大偏离</text>
      <text x="560" y="202" fill="#b9ffdc" fontSize="12" fontWeight="700">输出买入 / 卖出 / 持有</text>
      <path d="M104 252 C198 286, 356 286, 582 236" fill="none" stroke="rgba(185,255,220,0.52)" strokeWidth="2" strokeDasharray="7 9" />
      <text x="68" y="274" fill="rgba(244,238,225,0.58)" fontSize="12">每月智能补仓，季度检查偏离，半年到一年评估强制再平衡。</text>
    </svg>
  );
}
