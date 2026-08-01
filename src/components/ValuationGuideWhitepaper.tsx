import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  BookOpenText,
  Check,
  CircleAlert,
  Scale,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const guideToc = [
  '先记住一句话',
  '三条线分别是什么',
  '为什么蓝线与虚线同步',
  '5年与长期冲突怎么办',
  '五步读图法',
  '新手决策速查',
];

const lineDefinitions = [
  {
    color: '#d48419',
    name: '橙线 · 指数价格',
    meaning: '市场真实成交形成的指数点位，回答“市场现在走到了哪里”。',
    use: '与黄虚线比较，判断当前价格对应的PB相对所选历史区间偏高还是偏低。',
  },
  {
    color: '#3d648b',
    name: '蓝线 · 净资产代理',
    meaning: '由“指数价格 ÷ PB”反推的账面价值基础，用来观察指数背后的净资产代理怎样变化。',
    use: '它不是企业真实净资产总额，也不是目标价。上证指数显示1x PB原始代理；标注“同起点”的指数只适合比较增长速度。',
  },
  {
    color: '#a88435',
    name: '黄虚线 · 历史PB中枢',
    meaning: '净资产代理 × 所选区间PB中位数，回答“如果估值回到这段历史的中间水平，价格大约在哪里”。',
    use: '它是相对估值参照，不是内在价值，也不保证价格一定回归。',
  },
];

export function ValuationGuideWhitepaperLauncher() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="valuation-guide-launcher"
        className="group mt-3 inline-flex h-9 items-center gap-2 border border-[#d6b566]/30 bg-[#d6b566]/[0.07] px-3 text-[11px] font-semibold text-[#e6cd8e] transition hover:border-[#d6b566]/55 hover:bg-[#d6b566]/12"
      >
        <BookOpenText size={14} />
        估值图新手说明书
        <ArrowRight size={13} className="transition group-hover:translate-x-0.5" />
      </button>

      {typeof document !== 'undefined'
        ? createPortal(
            <AnimatePresence>
              {open ? <ValuationGuideDialog onClose={() => setOpen(false)} /> : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </>
  );
}

function ValuationGuideDialog({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-[80] bg-black/80 px-3 py-4 backdrop-blur-xl md:px-6 md:py-7"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.article
        role="dialog"
        aria-modal="true"
        aria-labelledby="valuation-guide-title"
        className="mx-auto grid h-full max-w-6xl overflow-hidden rounded-lg border border-white/12 bg-[#f4eee1] text-[#171715] shadow-[0_30px_120px_rgba(0,0,0,0.62)] lg:grid-cols-[260px_1fr]"
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.985 }}
        transition={{ duration: 0.24 }}
        onClick={(event) => event.stopPropagation()}
      >
        <aside className="hidden border-r border-black/10 bg-[#ebe3d3] p-5 lg:block">
          <div className="sticky top-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-black/38">Field Guide</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight">A股估值图新手说明书</h2>
            <p className="mt-3 text-xs leading-5 text-black/45">不用预测涨跌，先学会判断当前价格在历史估值中的位置。</p>
            <nav className="mt-8 space-y-2" aria-label="说明书目录">
              {guideToc.map((item, index) => (
                <a
                  key={item}
                  href={`#valuation-guide-${index + 1}`}
                  className="block rounded-md px-3 py-2 text-sm leading-5 text-black/56 transition hover:bg-black/5 hover:text-black"
                >
                  <span className="mr-2 font-mono text-xs text-black/34">{String(index + 1).padStart(2, '0')}</span>
                  {item}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        <div className="overflow-y-auto">
          <header className="sticky top-0 z-20 flex items-center justify-between border-b border-black/10 bg-[#f4eee1]/90 px-5 py-4 backdrop-blur-xl md:px-8">
            <div className="flex items-center gap-3">
              <BookOpenText size={18} />
              <span className="text-sm font-semibold">估值图新手说明书</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-10 w-10 place-items-center rounded-full border border-black/10 text-black/62 transition hover:bg-black/5 hover:text-black"
              aria-label="关闭说明书"
              title="关闭说明书"
            >
              <X size={18} />
            </button>
          </header>

          <main className="px-5 py-8 md:px-10 md:py-12">
            <section className="mx-auto max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-black/44">Valuation field guide / Beginner edition</p>
              <h1 id="valuation-guide-title" className="mt-5 font-serif text-[clamp(2.5rem,6vw,5.5rem)] leading-[0.98]">
                三条线，读懂市场贵不贵
              </h1>
              <p className="mt-7 text-xl leading-9 text-black/66">
                这张图不是预测明天涨跌的水晶球。它把指数价格、净资产代理和历史PB中枢放在一起，帮助你回答一个更朴素的问题：今天的估值，相对自己过去的一段历史，处在什么位置？
              </p>
              <div className="mt-8 border-l-2 border-[#a27d35] bg-[#a27d35]/[0.06] px-5 py-4 text-base leading-8 text-black/66">
                <strong>新手先记：</strong>主要看橙线与黄虚线的关系，再用PB历史分位确认。蓝线用于理解净资产基础，不用于单独判断买卖。
              </div>
            </section>

            <GuideSection id="valuation-guide-1" eyebrow="Part 01" title="先记住一句话">
              <div className="border border-black/10 bg-[#171715] p-6 text-[#f4eee1]">
                <p className="text-sm font-semibold text-[#d6b566]">最简读法</p>
                <p className="mt-3 text-2xl leading-10 text-white/88">
                  橙线在黄虚线上方，表示当前PB高于所选历史区间的中位数；橙线在黄虚线下方，则表示当前PB低于中位数。
                </p>
              </div>
              <p>
                这是“相对历史”的高低，不等于绝对高估或低估。行业结构、盈利质量、利率环境和指数编制都可能改变合理估值，所以它更适合指导定投节奏和仓位再平衡，不适合一次性押注顶部或底部。
              </p>
            </GuideSection>

            <GuideSection id="valuation-guide-2" eyebrow="Part 02" title="三条线分别是什么">
              <div className="grid gap-px overflow-hidden border border-black/10 bg-black/10">
                {lineDefinitions.map((item) => (
                  <div key={item.name} className="bg-[#f4eee1] p-5 md:grid md:grid-cols-[210px_1fr] md:gap-6">
                    <div className="flex items-center gap-3">
                      <span className="h-0.5 w-10" style={{ backgroundColor: item.color }} />
                      <strong>{item.name}</strong>
                    </div>
                    <div className="mt-3 space-y-2 text-sm leading-6 text-black/62 md:mt-0">
                      <p>{item.meaning}</p>
                      <p className="text-black/45">怎么看：{item.use}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-y border-black/10 bg-[#ebe3d3] px-5 py-6 text-center">
                <p className="font-mono text-lg font-semibold md:text-2xl">蓝线 = 指数价格 ÷ PB</p>
                <p className="mt-2 font-mono text-lg font-semibold md:text-2xl">黄虚线 = 蓝线 × 所选区间PB中位数</p>
              </div>
            </GuideSection>

            <GuideSection id="valuation-guide-3" eyebrow="Part 03" title="为什么蓝线与虚线同步">
              <p>
                因为黄虚线就是用蓝线乘以一个固定的PB中位数得到的。选定1年、3年、5年或全部后，这个区间的PB中位数是一个常数，所以蓝线涨跌多少，黄虚线也会按同样比例涨跌。
              </p>
              <div className="grid gap-px overflow-hidden border border-black/10 bg-black/10 sm:grid-cols-3">
                <Fact label="蓝线变化" value="净资产代理变化" />
                <Fact label="虚线与蓝线距离" value="历史PB中枢倍数" />
                <Fact label="橙线与虚线距离" value="当前PB偏离中枢" />
              </div>
              <p>
                因此两条线走势高度一致是公式设定，不是数据重复。真正用于估值判断的是橙线相对黄虚线的位置，以及右上角显示的当前PB、历史中位数和PB分位。
              </p>
            </GuideSection>

            <GuideSection id="valuation-guide-4" eyebrow="Part 04" title="5年与长期冲突怎么办">
              <p>
                切换年份不会改变今天的指数价格和当前PB，但会改变比较样本。近5年可能整体估值较低，当前PB就显得偏高；全部历史包含更早的高估阶段，当前PB在长周期里又可能偏低。
              </p>
              <div className="border border-black/10 bg-[#171715] p-6 text-[#f4eee1]">
                <p className="text-sm font-semibold text-[#d6b566]">双周期判断法</p>
                <div className="mt-4 grid gap-5 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-white/42">5年分位</p>
                    <p className="mt-1 text-lg font-semibold">判断当前周期是否拥挤</p>
                    <p className="mt-2 text-sm leading-6 text-white/58">主要决定现在要不要追涨、加快或放慢新增资金。</p>
                  </div>
                  <div className="border-t border-white/12 pt-5 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
                    <p className="text-xs text-white/42">全部历史分位</p>
                    <p className="mt-1 text-lg font-semibold">判断长期估值底座</p>
                    <p className="mt-2 text-sm leading-6 text-white/58">主要决定长期核心仓位是否仍值得保留，而不是决定明天买卖。</p>
                  </div>
                </div>
              </div>
              <div className="hidden overflow-x-auto border border-black/10 sm:block">
                <table className="w-full min-w-[620px] border-collapse text-left text-sm">
                  <thead className="bg-[#ebe3d3] text-black/62">
                    <tr>
                      <th className="px-4 py-3 font-semibold">区间</th>
                      <th className="px-4 py-3 font-semibold">主要回答</th>
                      <th className="px-4 py-3 font-semibold">适合用途</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/10">
                    <RangeRow period="1年" question="最近一年是否过热或过冷" use="观察短期情绪，不单独定仓位" />
                    <RangeRow period="3年" question="一轮中短周期中的位置" use="辅助调整新增资金节奏" />
                    <RangeRow period="5年" question="最近完整市场阶段中的位置" use="定投和再平衡的主要参考" />
                    <RangeRow period="全部" question="长期历史坐标在哪里" use="校准5年结论，避免只看近期" />
                  </tbody>
                </table>
              </div>
              <div className="divide-y divide-black/10 border border-black/10 sm:hidden">
                <MobileReferenceRow title="1年" summary="最近一年是否过热或过冷" action="观察短期情绪，不单独定仓位" />
                <MobileReferenceRow title="3年" summary="一轮中短周期中的位置" action="辅助调整新增资金节奏" />
                <MobileReferenceRow title="5年" summary="最近完整市场阶段中的位置" action="定投和再平衡的主要参考" />
                <MobileReferenceRow title="全部" summary="长期历史坐标在哪里" action="校准5年结论，避免只看近期" />
              </div>
              <h3 className="pt-2 text-2xl font-semibold text-black/82">把两个结论合成一句人话</h3>
              <div className="hidden overflow-x-auto border border-black/10 sm:block">
                <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                  <thead className="bg-[#ebe3d3] text-black/62">
                    <tr>
                      <th className="px-4 py-3 font-semibold">5年判断</th>
                      <th className="px-4 py-3 font-semibold">全部历史判断</th>
                      <th className="px-4 py-3 font-semibold">合并结论</th>
                      <th className="px-4 py-3 font-semibold">新手行动</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/10">
                    <DualCycleRow
                      recent="偏高"
                      longTerm="偏高"
                      conclusion="短期拥挤，长期也贵"
                      action="停止追高和额外加码；超出目标仓位时分批再平衡。"
                      tone="#a13f4a"
                    />
                    <DualCycleRow
                      recent="偏低"
                      longTerm="偏低"
                      conclusion="短期低迷，长期也便宜"
                      action="维持基础定投，可在风险承受范围内分批小幅增加。"
                      tone="#1b7f6b"
                    />
                    <DualCycleRow
                      recent="偏高"
                      longTerm="偏低"
                      conclusion="短期偏贵，但长期并不贵"
                      action="不追涨、不一次性抄底；保留核心仓位，维持基础定投，等待更好的加码位置。"
                      tone="#9a6b2f"
                    />
                    <DualCycleRow
                      recent="偏低"
                      longTerm="偏高"
                      conclusion="近期回落，但长期仍贵"
                      action="把它当回调而非深度低估；只做基础定投，不因短期下跌大幅加仓。"
                      tone="#8b6544"
                    />
                  </tbody>
                </table>
              </div>
              <div className="divide-y divide-black/10 border border-black/10 sm:hidden">
                <MobileCycleRow
                  recent="偏高"
                  longTerm="偏高"
                  conclusion="短期拥挤，长期也贵"
                  action="停止追高和额外加码；超出目标仓位时分批再平衡。"
                  tone="#a13f4a"
                />
                <MobileCycleRow
                  recent="偏低"
                  longTerm="偏低"
                  conclusion="短期低迷，长期也便宜"
                  action="维持基础定投，可在风险承受范围内分批小幅增加。"
                  tone="#1b7f6b"
                />
                <MobileCycleRow
                  recent="偏高"
                  longTerm="偏低"
                  conclusion="短期偏贵，但长期并不贵"
                  action="不追涨、不一次性抄底；保留核心仓位，维持基础定投，等待更好的加码位置。"
                  tone="#9a6b2f"
                />
                <MobileCycleRow
                  recent="偏低"
                  longTerm="偏高"
                  conclusion="近期回落，但长期仍贵"
                  action="把它当回调而非深度低估；只做基础定投，不因短期下跌大幅加仓。"
                  tone="#8b6544"
                />
              </div>

              <div className="border-l-2 border-[#a27d35] bg-[#a27d35]/[0.06] px-5 py-4 text-sm leading-7 text-black/66">
                <strong>最常见的冲突：5年偏高、全部历史偏低。</strong><br />
                这不是数据互相打架，而是在说：“相对最近几年已经不便宜，但放进更长历史仍没有贵到极端。”正确动作通常不是满仓追涨，也不是因为长期偏低就立刻重仓；而是保留长期核心仓位、维持基础定投，把额外资金留给回调。如果当前仓位已经高于自己的目标比例，则只对超出的部分分批再平衡。
              </div>

              <div className="grid gap-px overflow-hidden border border-black/10 bg-black/10 sm:grid-cols-3">
                <Fact label="两个周期同向" value="信号更清楚，可适度调整节奏" />
                <Fact label="两个周期冲突" value="信号降级，维持基础动作" />
                <Fact label="任一周期接近中性" value="视为没有强信号，不做大动作" />
              </div>

              <p>
                不要把5年分位和全部历史分位简单平均成一个数字。它们回答的是不同问题：5年看“现在拥不拥挤”，全部历史看“长期贵不贵”。先分别读懂，再合并成仓位节奏，信息才不会被平均值掩盖。
              </p>
            </GuideSection>

            <GuideSection id="valuation-guide-5" eyebrow="Part 05" title="五步读图法">
              <ol className="space-y-3">
                <GuideStep index="01" title="先选指数" text="你买沪深300，就看沪深300；不要用上证指数的估值替代自己的投资标的。" />
                <GuideStep index="02" title="先看5年，再看全部" text="5年决定近期节奏，全部历史负责检查结论是否过于依赖最近环境。" />
                <GuideStep index="03" title="比较橙线与黄虚线" text="先判断价格在历史PB中枢上方、附近还是下方。" />
                <GuideStep index="04" title="核对PB历史分位" text="线的位置看偏离方向，分位数看当前PB在历史样本中的排序。两者应当相互印证。" />
                <GuideStep index="05" title="最后才决定资金节奏" text="把结论转成小幅增加、维持、减少或再平衡，不把估值图变成一次性满仓与清仓按钮。" />
              </ol>
            </GuideSection>

            <GuideSection id="valuation-guide-6" eyebrow="Part 06" title="新手决策速查">
              <div className="overflow-x-auto border border-black/10">
                <table className="w-full min-w-[680px] border-collapse text-left text-sm">
                  <thead className="bg-[#171715] text-[#f4eee1]">
                    <tr>
                      <th className="px-4 py-3 font-semibold">PB历史分位</th>
                      <th className="px-4 py-3 font-semibold">估值状态</th>
                      <th className="px-4 py-3 font-semibold">定投参考</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/10">
                    <DecisionRow range="0% - 20%" state="明显偏低" action="可适当提高定投额，仍需分批" tone="#1b7f6b" />
                    <DecisionRow range="20% - 40%" state="略偏低" action="正常定投或小幅增加" tone="#3d8b76" />
                    <DecisionRow range="40% - 60%" state="中性" action="维持基础定投" tone="#8a6b28" />
                    <DecisionRow range="60% - 80%" state="略偏高" action="减少新增资金，检查目标仓位" tone="#a65f3d" />
                    <DecisionRow range="80% - 100%" state="明显偏高" action="暂停加码，按目标仓位再平衡" tone="#a13f4a" />
                  </tbody>
                </table>
              </div>

              <div className="mt-8 grid gap-px overflow-hidden border border-black/10 bg-black/10 sm:grid-cols-2">
                <Reminder icon={<Check size={17} />} title="可以用它做什么" text="判断相对估值、安排定投节奏、检查仓位是否偏离目标。" />
                <Reminder icon={<CircleAlert size={17} />} title="不能用它做什么" text="预测短期涨跌、确认绝对底部、把虚线当成必然到达的目标价。" />
              </div>

              <div className="mt-8 border border-black/10 bg-[#171715] p-6 text-[#f4eee1]">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#d6b566]">
                  <Scale size={17} /> 最后的纪律
                </div>
                <p className="mt-4 text-xl leading-9 text-white/82">
                  估值低，可能继续下跌；估值高，也可能继续上涨。好的决策不是猜中拐点，而是在不同估值区间里，用分批投入、目标仓位和再平衡控制自己犯错的代价。
                </p>
              </div>

              <p className="mt-8 text-xs leading-6 text-black/45">
                本说明书仅解释项目图表口径，不构成证券买卖建议。PB中枢与历史分位会随样本区间、指数成分和数据修订变化；使用前请结合现金流、持有期限和风险承受能力。
              </p>
            </GuideSection>
          </main>
        </div>
      </motion.article>
    </motion.div>
  );
}

function GuideSection({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mx-auto mt-12 max-w-3xl scroll-mt-24 border-t border-black/10 pt-10">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-black/38">{eyebrow}</p>
      <h2 className="mt-3 text-4xl font-semibold leading-tight md:text-5xl">{title}</h2>
      <div className="mt-7 space-y-5 text-base leading-8 text-black/68">{children}</div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#f4eee1] p-4">
      <p className="text-xs text-black/42">{label}</p>
      <p className="mt-2 text-sm font-semibold">{value}</p>
    </div>
  );
}

function RangeRow({ period, question, use }: { period: string; question: string; use: string }) {
  return (
    <tr>
      <td className="px-4 py-3 font-mono font-semibold">{period}</td>
      <td className="px-4 py-3 text-black/62">{question}</td>
      <td className="px-4 py-3 text-black/62">{use}</td>
    </tr>
  );
}

function MobileReferenceRow({ title, summary, action }: { title: string; summary: string; action: string }) {
  return (
    <div className="p-4">
      <p className="font-mono text-xs font-semibold text-black/42">{title}</p>
      <p className="mt-2 text-sm font-semibold text-black/76">{summary}</p>
      <p className="mt-1 text-sm leading-6 text-black/52">{action}</p>
    </div>
  );
}

function DualCycleRow({
  recent,
  longTerm,
  conclusion,
  action,
  tone,
}: {
  recent: string;
  longTerm: string;
  conclusion: string;
  action: string;
  tone: string;
}) {
  return (
    <tr>
      <td className="px-4 py-3 font-semibold" style={{ color: tone }}>{recent}</td>
      <td className="px-4 py-3 font-semibold" style={{ color: tone }}>{longTerm}</td>
      <td className="px-4 py-3 font-semibold text-black/76">{conclusion}</td>
      <td className="px-4 py-3 leading-6 text-black/58">{action}</td>
    </tr>
  );
}

function MobileCycleRow({
  recent,
  longTerm,
  conclusion,
  action,
  tone,
}: {
  recent: string;
  longTerm: string;
  conclusion: string;
  action: string;
  tone: string;
}) {
  return (
    <div className="p-4">
      <div className="flex items-center gap-2 font-mono text-xs font-semibold" style={{ color: tone }}>
        <span>5年 {recent}</span>
        <span className="text-black/22">/</span>
        <span>长期 {longTerm}</span>
      </div>
      <p className="mt-2 text-base font-semibold text-black/78">{conclusion}</p>
      <p className="mt-2 text-sm leading-6 text-black/56">{action}</p>
    </div>
  );
}

function GuideStep({ index, title, text }: { index: string; title: string; text: string }) {
  return (
    <li className="grid gap-2 border-b border-black/10 pb-4 sm:grid-cols-[52px_150px_1fr] sm:gap-4">
      <span className="font-mono text-xs text-black/34">{index}</span>
      <strong className="text-sm">{title}</strong>
      <span className="text-sm leading-6 text-black/62">{text}</span>
    </li>
  );
}

function DecisionRow({ range, state, action, tone }: { range: string; state: string; action: string; tone: string }) {
  return (
    <tr>
      <td className="px-4 py-3 font-mono">{range}</td>
      <td className="px-4 py-3 font-semibold" style={{ color: tone }}>{state}</td>
      <td className="px-4 py-3 text-black/62">{action}</td>
    </tr>
  );
}

function Reminder({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="bg-[#f4eee1] p-5">
      <div className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</div>
      <p className="mt-3 text-sm leading-6 text-black/58">{text}</p>
    </div>
  );
}
