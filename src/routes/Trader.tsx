import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  BookOpenText,
  Brain,
  ChartNoAxesCombined,
  Clock3,
  ExternalLink,
  Flame,
  Landmark,
  Layers3,
  LineChart,
  Quote,
  Scale,
  ShieldCheck,
  Target,
  TrendingUp,
  X
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HeatmapPretextFlow } from '../components/HeatmapPretextFlow';
import { ModuleFrame } from '../components/ModuleFrame';
import { TradingViewHeatmap } from '../components/TradingViewHeatmap';

const articleToc = [
  'r > g：为什么劳动收入需要转化为资本所有权',
  '资本的平均利率：国债、综合资本与权益资产',
  '行为价差：为什么市场赚钱，投资者不赚钱',
  '定投机制：用纪律替代择时幻觉',
  '标的选择：沪深300、标普500、纳指100'
];

const targetFunds = [
  ['沪深300 ETF', '510300', '中国核心资产', '承接人民币资产与中国大型上市公司的长期 beta。'],
  ['标普500 ETF', 'S&P 500', '美国宽基核心', '覆盖美国大型公司利润池，是全球最重要的权益基准之一。'],
  ['纳指100 ETF', '513100 / Nasdaq-100', '创新增长暴露', '集中在大型非金融科技与成长型公司，弹性更高、波动也更高。']
];

const whitepaperInvestorAdvice = [
  {
    name: '巴菲特',
    role: '安全边际与长期耐心',
    quote: '别人贪婪时恐惧，别人恐惧时贪婪。',
    advice: '定投者不需要预测最低点，但必须在市场恐慌时保留继续买入的能力。下跌不是自动卖出的理由，而是检验资产质量、现金流和估值是否仍然成立的时刻。'
  },
  {
    name: '芒格',
    role: '反向思考',
    quote: '反过来想，总是反过来想。',
    advice: '先列出会毁掉复利的动作：高杠杆、频繁交易、追热门赛道、无法承受回撤、把短期价格波动当成长期判断。避免大错，比追求每次都买对更重要。'
  },
  {
    name: '达里欧',
    role: '原则化系统',
    quote: '痛苦加反思等于进步。',
    advice: '回撤不可避免，真正有价值的是把痛苦转化成规则：仓位上限、定投频率、再平衡阈值、止损条件和复盘记录。没有规则的反思，很容易变成下一次情绪交易。'
  },
  {
    name: '索罗斯',
    role: '盈亏比与纠错',
    quote: '关键不是对错，而是对时赚多少，错时亏多少。',
    advice: 'ETF 定投不是为了证明某个观点永远正确，而是让单次判断错误不会摧毁长期计划。宽基、分散和持续现金流，都是为了控制错误的代价。'
  },
  {
    name: '德鲁肯米勒',
    role: '开放心态与风险控制',
    quote: '保持开放，发现错了就迅速改变想法。',
    advice: '普通投资者最容易把观点当身份。更稳的方式是把宽基指数作为底仓，只在长期逻辑清晰、风险预算允许时提高少数高置信资产的比例；一旦事实变化，先收缩风险，再重新评估。'
  }
];

export function Trader() {
  const heatmapPanelRef = useRef<HTMLDivElement | null>(null);
  const [heatmapMode, setHeatmapMode] = useState<'stocks' | 'etfs'>('stocks');
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

  const revealHeatmap = () => {
    document.getElementById('market-heatmap')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <ModuleFrame title="股票 ETF 定投软件" kicker="ETF Research">
      <div className="space-y-5">
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
                    阅读完整白皮书
                  </span>
                  <ArrowRight size={18} />
                </button>
                <button
                  type="button"
                  onClick={revealHeatmap}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.045] px-5 py-4 text-sm font-semibold text-white/68 transition hover:border-white/22 hover:text-white"
                >
                  <Flame size={16} />
                  市场热力图
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

        <section className="rounded-lg border border-white/10 bg-[#090a09] p-6">
          <div className="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/34">Selected indexes</p>
              <h2 className="mt-2 text-3xl font-semibold text-white md:text-4xl">三个标的，各自承担不同角色</h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-white/48">白皮书里会解释为什么不是追热门个股，而是用宽基指数承接长期经济增长、创新红利与区域分散。</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {targetFunds.map(([name, ticker, role, body], index) => (
              <article key={name} className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8ad7ff]/72">{ticker}</p>
                <h3 className="mt-3 text-2xl font-semibold text-white">{name}</h3>
                <p className="mt-1 text-sm text-white/38">{role}</p>
                <p className="mt-5 text-sm leading-7 text-white/54">{body}</p>
                <div className="mt-5 h-px bg-white/10" />
                <p className="mt-4 font-mono text-xs text-white/32">0{index + 1} / portfolio role</p>
              </article>
            ))}
          </div>
        </section>

        <motion.section
          id="market-heatmap"
          className="relative min-h-[660px] scroll-mt-24 overflow-hidden rounded-lg border border-white/10 bg-[#050506]"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.72, delay: 0.12, ease: [0.19, 1, 0.22, 1] }}
        >
          <HeatmapPretextFlow obstacleRef={heatmapPanelRef} />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(138,215,255,0.12),transparent_38%),linear-gradient(to_bottom,rgba(0,0,0,0.18),rgba(0,0,0,0.74))]" />

          <div className="relative z-10 flex items-center justify-between gap-4 px-5 pt-5 md:px-7 md:pt-7">
            <div>
              <p className="text-[11px] font-semibold uppercase text-[#b9ffdc]/72">TradingView Heatmap</p>
              <h2 className="mt-1 text-2xl font-semibold leading-none text-white md:text-4xl">Market heat field</h2>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-full border border-white/10 bg-black/35 p-1 backdrop-blur-xl">
                {(['stocks', 'etfs'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setHeatmapMode(mode)}
                    className={[
                      'rounded-full px-3 py-1.5 text-xs font-semibold transition',
                      heatmapMode === mode ? 'bg-white text-black' : 'text-white/52 hover:text-white'
                    ].join(' ')}
                  >
                    {mode === 'stocks' ? 'Stocks' : 'ETFs'}
                  </button>
                ))}
              </div>
              <a
                href={heatmapMode === 'stocks' ? 'https://www.tradingview.com/heatmap/stock/' : 'https://www.tradingview.com/heatmap/etf/'}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/30 text-white/60 transition hover:border-white/24 hover:text-white"
                aria-label="Open TradingView"
              >
                <ExternalLink size={16} strokeWidth={1.8} />
              </a>
            </div>
          </div>

          <div className="relative z-10 mx-auto mt-8 w-[min(1040px,88vw)] px-4 pb-8 md:mt-10 md:px-0">
            <div
              ref={heatmapPanelRef}
              className="heatmap-ambient-panel relative h-[390px] overflow-hidden rounded-lg border border-white/[0.06] bg-black/25 shadow-[0_0_92px_rgba(138,215,255,0.10)] md:h-[430px]"
            >
              <div className="absolute inset-0 opacity-68 brightness-[0.7] contrast-[1.08] saturate-[0.76] [mask-image:radial-gradient(ellipse_at_center,black_52%,rgba(0,0,0,0.72)_74%,transparent_100%)]">
                <TradingViewHeatmap mode={heatmapMode} />
              </div>
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_42%,rgba(0,0,0,0.34)_72%,rgba(0,0,0,0.78)_100%),linear-gradient(to_bottom,rgba(0,0,0,0.2),transparent_28%,rgba(0,0,0,0.32))]" />
            </div>
            <div className="mt-5 grid gap-3 text-sm text-white/54 md:grid-cols-3">
              <p>热力图只作为宏观背景信号，不直接决定定投动作。</p>
              <p>颜色提示市场宽度，真正的动作仍由现金流、定投周期和再平衡规则触发。</p>
              <p>点击右上角外链可以进入 TradingView 原站做完整交互。</p>
            </div>
          </div>
        </motion.section>
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
              <InvestorAdvicePanel />
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

            <ArticleSection id="wp-5" eyebrow="Part 05" title="为什么选择沪深300、标普500、纳指100">
              <p>
                ETF 标的选择不应该基于“最近谁涨得猛”，而应该基于资产角色。一个适合长期定投的标的，最好满足几个条件：指数规则透明、成分足够分散、长期有经济基础、费率可控、流动性较好。
              </p>
              <Figure title="三个标的在组合里的角色" caption="示意图：沪深300提供中国权益暴露，标普500提供美国宽基核心，纳指100提供科技与创新增长暴露。">
                <TargetMatrix />
              </Figure>
              <h3>标普 500：美国大盘宽基核心</h3>
              <p>
                标普 500 是美国最重要的大盘股票指数之一，通常被视为美国大型上市公司整体表现的代表。它采用自由流通市值加权，持有的是美国各行业头部企业的组合。它的意义不是某一家企业，而是一整套美国企业利润池。
              </p>
              <h3>纳指 100：科技与创新增长暴露</h3>
              <p>
                纳指 100 覆盖纳斯达克上市的 100 家大型非金融公司，科技、互联网、半导体、软件和创新型公司权重更高。它的长期弹性可能更强，但波动、估值敏感度和回撤也通常更大。
              </p>
              <h3>沪深 300：人民币资产与中国核心公司</h3>
              <p>
                沪深 300 代表 A 股中规模大、流动性较好的核心上市公司。它更适合作为中国权益资产底仓，用来承接中国经济、产业政策和人民币资产的长期变化。
              </p>
              <p>
                三者合在一起，并不是为了“押中最强指数”，而是为了让组合同时拥有中国资产、美国宽基和全球科技创新的不同风险来源。定投的任务，是让这些资产在长期现金流里逐步积累，而不是每天判断谁明天会涨。
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

function InvestorAdvicePanel() {
  return (
    <div className="my-8 overflow-hidden rounded-lg border border-black/10 bg-[#171715] text-[#f4eee1]">
      <div className="grid gap-6 border-b border-white/10 p-5 md:grid-cols-[0.78fr_1.22fr] md:p-6">
        <div>
          <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#ffd27a]/32 bg-[#ffd27a]/10 text-[#ffd27a]">
            <Quote size={18} />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#ffd27a]/72">Investor discipline</p>
          <h3 className="mt-3 text-3xl font-semibold leading-tight">投资大师给定投者的共同建议</h3>
        </div>
        <p className="self-end text-sm leading-7 text-white/58">
          这些名言背后的共同逻辑不是“崇拜大师”，而是把长期投资拆成几条可执行纪律：不要在恐慌中退出，不要在狂热中加杠杆，不要频繁证明自己正确，用规则承受波动，用分散限制错误代价。
        </p>
      </div>
      <div className="divide-y divide-white/10">
        {whitepaperInvestorAdvice.map((item) => (
          <article key={item.name} className="grid gap-4 p-5 md:grid-cols-[180px_1fr] md:p-6">
            <div>
              <p className="text-lg font-semibold">{item.name}</p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#ffd27a]/64">{item.role}</p>
            </div>
            <div>
              <p className="font-serif text-xl leading-8 text-white/86">“{item.quote}”</p>
              <p className="mt-3 text-sm leading-7 text-white/58">{item.advice}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
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
      <path d="M70 168 C168 160, 236 184, 326 146 S520 152, 650 158" fill="none" stroke="#8ad7ff" strokeWidth="3" />
      <path d="M252 154 C292 116, 340 96, 396 96 C448 98, 490 120, 520 150" fill="none" stroke="#ffd27a" strokeWidth="2" strokeDasharray="6 8" />
      <text x="72" y="42" fill="#f4eee1" fontSize="14" fontWeight="700">长期真实回报率示意</text>
      <text x="565" y="70" fill="#b9ffdc" fontSize="13" fontWeight="700">r: 4%-5%</text>
      <text x="565" y="176" fill="#8ad7ff" fontSize="13" fontWeight="700">g: 1.5%-2%</text>
      <text x="278" y="216" fill="rgba(244,238,225,0.55)" fontSize="12">1914-1970 附近曾出现罕见反转</text>
    </svg>
  );
}

function AssetReturnBars() {
  const bars = [
    ['国债', 2, '#8ad7ff'],
    ['综合资本', 5, '#b9ffdc'],
    ['权益资产', 7, '#ffd27a']
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
      <path d="M80 178 C172 150, 232 204, 320 156 S510 176, 650 128" fill="none" stroke="#d15b45" strokeWidth="2.5" />
      <path d="M514 92 V128" stroke="#d15b45" strokeWidth="2" strokeDasharray="4 6" />
      <text x="86" y="44" fill="#171715" fontSize="15" fontWeight="800">市场收益与投资者收益之间的行为价差</text>
      <text x="548" y="52" fill="#171715" fontSize="13" fontWeight="700">市场</text>
      <text x="548" y="142" fill="#d15b45" fontSize="13" fontWeight="700">普通投资者</text>
      <text x="524" y="114" fill="#d15b45" fontSize="12">Gap</text>
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
            <rect x={x} y={190 - height} width="86" height={height} rx="5" fill={index === 0 ? '#b9ffdc' : index === 1 ? '#ffd27a' : '#d15b45'} />
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
          <circle cx={x} cy={index % 2 ? 154 : 116} r={index % 2 ? 8 : 5} fill={index % 2 ? '#b9ffdc' : '#8ad7ff'} stroke="#171715" />
        </g>
      ))}
      <text x="70" y="40" fill="#171715" fontSize="15" fontWeight="800">固定金额买入，份额随价格自动变化</text>
      <text x="70" y="222" fill="rgba(0,0,0,0.55)" fontSize="12">价格低时买到更多份额，价格高时买到更少份额。</text>
    </svg>
  );
}

function TargetMatrix() {
  return (
    <svg className="h-[280px] w-full" viewBox="0 0 720 280" aria-label="target matrix">
      <rect width="720" height="280" rx="8" fill="#0d0e0c" />
      <line x1="110" x2="640" y1="210" y2="210" stroke="rgba(244,238,225,0.2)" />
      <line x1="110" x2="110" y1="54" y2="210" stroke="rgba(244,238,225,0.2)" />
      <text x="112" y="36" fill="#f4eee1" fontSize="14" fontWeight="800">组合角色：区域分散 × 增长弹性</text>
      <text x="498" y="238" fill="rgba(244,238,225,0.55)" fontSize="12">增长弹性</text>
      <text x="42" y="78" fill="rgba(244,238,225,0.55)" fontSize="12" transform="rotate(-90 42 78)">波动 / 风险</text>
      <circle cx="210" cy="152" r="34" fill="rgba(185,255,220,0.18)" stroke="#b9ffdc" />
      <text x="210" y="157" textAnchor="middle" fill="#f4eee1" fontSize="12" fontWeight="800">沪深300</text>
      <circle cx="360" cy="132" r="38" fill="rgba(138,215,255,0.18)" stroke="#8ad7ff" />
      <text x="360" y="137" textAnchor="middle" fill="#f4eee1" fontSize="12" fontWeight="800">标普500</text>
      <circle cx="520" cy="92" r="42" fill="rgba(255,210,122,0.18)" stroke="#ffd27a" />
      <text x="520" y="97" textAnchor="middle" fill="#f4eee1" fontSize="12" fontWeight="800">纳指100</text>
    </svg>
  );
}
