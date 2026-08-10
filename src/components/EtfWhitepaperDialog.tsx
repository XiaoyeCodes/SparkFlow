import { motion } from 'framer-motion';
import { useEffect } from 'react';
import {
  ArrowUpRight,
  BookOpenText,
  Brain,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Landmark,
  Layers3,
  Scale,
  ShieldCheck,
  Target,
  TrendingUp,
  X
} from 'lucide-react';

export const whitepaperToc = [
  'r > g：把劳动收入转化为资本所有权',
  '主动与被动：为什么平均值很难被长期战胜',
  '幸存者偏差：极少数超级赢家贡献大多数上涨',
  '牛顶买、熊底卖：信息与人性如何合谋',
  '闪电时刻：长期收益集中在少数关键交易日',
  '复利的时间优势：巴菲特的长期记录',
  '定投操作系统：低成本、分散、自动化与再平衡',
  '全天候策略：把原则落成可执行规则'
] as const;

const sources = [
  {
    name: 'S&P Dow Jones Indices · SPIVA U.S. Year-End 2025',
    note: '主动基金相对基准的长期胜率、存续率与费用后回报',
    href: 'https://www.spglobal.com/spdji/en/documents/spiva/spiva-us-year-end-2025.pdf'
  },
  {
    name: 'Morningstar · Mind the Gap 2025',
    note: '投资者实际获得的资金加权收益与基金总回报之间的行为差距',
    href: 'https://marketing.morningstar.com/content/cs-assets/v3/assets/blt9415ea4cc4157833/blt2c5c4d9171638c42/689b424311f3880edc4b4813/US_Mind_the_Gap_2025.pdf'
  },
  {
    name: 'Hendrik Bessembinder · Do Stocks Outperform Treasury Bills?',
    note: '个股回报的极端偏斜与少数超级赢家',
    href: 'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2900447'
  },
  {
    name: 'Barber & Odean · Trading Is Hazardous to Your Wealth',
    note: '个人投资者换手率、交易成本与净收益',
    href: 'https://faculty.haas.berkeley.edu/odean/papers/returns/returns.html'
  },
  {
    name: 'Barber & Odean · All That Glitters',
    note: '新闻、极端涨跌和异常成交量如何驱动散户注意力买入',
    href: 'https://faculty.haas.berkeley.edu/odean/papers/current%20versions/allthatglitters_rfs_2008.pdf'
  },
  {
    name: 'J.P. Morgan Asset Management · Navigating Market Volatility',
    note: '最佳交易日与最差交易日聚集，以及离场择时的代价',
    href: 'https://am.jpmorgan.com/us/en/asset-management/institutional/insights/retirement-insights/navigating-market-volatility-retirement-guide/'
  },
  {
    name: 'Berkshire Hathaway · 2025 Shareholder Letter',
    note: '伯克希尔 1965—2025 的官方长期复利记录',
    href: 'https://www.berkshirehathaway.com/letters/2025ltr.pdf'
  },
  {
    name: 'Vanguard Research · Cost averaging',
    note: '持续现金流定投与“已有大笔现金分批入场”的关键区别',
    href: 'https://corporate.vanguard.com/content/dam/corp/research/pdf/cost_averaging_invest_now_or_temporarily_hold_your_cash.pdf'
  },
  {
    name: 'Investor.gov · Dollar-cost averaging',
    note: '定期定额的定义、买入份额与价格之间的关系',
    href: 'https://www.investor.gov/introduction-investing/investing-basics/glossary/dollar-cost-averaging'
  },
  {
    name: 'Investor.gov · Index Funds',
    note: '指数基金的费用、跟踪误差、灵活性与产品风险基础',
    href: 'https://www.investor.gov/introduction-investing/investing-basics/investment-products/mutual-funds-and-exchange-traded-4'
  }
] as const;

export function EtfWhitepaperDialog({ onClose, onOpenOriginal }: { onClose: () => void; onOpenOriginal: () => void }) {
  useEffect(() => {
    const sectionId = window.location.hash.slice(1);
    if (!sectionId) return;

    const frame = window.requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ block: 'start' });
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <motion.div
      className="fixed inset-0 z-50 bg-black/78 px-3 py-4 backdrop-blur-xl md:px-6 md:py-7"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.article
        className="mx-auto grid h-full max-w-7xl overflow-hidden rounded-lg border border-white/12 bg-[#f4eee1] text-[#171715] shadow-[0_30px_120px_rgba(0,0,0,0.6)] lg:grid-cols-[290px_1fr]"
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.985 }}
        transition={{ duration: 0.24 }}
        onClick={(event) => event.stopPropagation()}
      >
        <aside className="hidden border-r border-black/10 bg-[#ebe3d3] p-5 lg:block">
          <div className="sticky top-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-black/38">Whitepaper · 2026 edition</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight">股票 ETF<br />定投白皮书</h2>
            <p className="mt-4 text-xs leading-5 text-black/45">证据、行为与一套可以坚持十年的投资系统。</p>
            <nav className="mt-7 space-y-1.5" aria-label="白皮书目录">
              {whitepaperToc.map((item, index) => (
                <a key={item} href={`#wp-${index + 1}`} className="block rounded-md px-3 py-2 text-[13px] leading-5 text-black/56 transition hover:bg-black/5 hover:text-black">
                  <span className="mr-2 font-mono text-[11px] text-black/34">{String(index + 1).padStart(2, '0')}</span>
                  {item}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        <div className="overflow-y-auto scroll-smooth">
          <header className="sticky top-0 z-20 flex items-center justify-between border-b border-black/10 bg-[#f4eee1]/90 px-5 py-4 backdrop-blur-xl md:px-8">
            <div className="flex items-center gap-3">
              <BookOpenText size={18} />
              <span className="text-sm font-semibold">股票 ETF 定投白皮书</span>
              <span className="hidden rounded-full border border-black/10 px-2 py-0.5 font-mono text-[10px] text-black/45 sm:inline">EVIDENCE-BASED</span>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onOpenOriginal} className="rounded-full border border-black/10 px-3 py-2 text-xs font-semibold text-black/58 transition hover:border-black/25 hover:bg-black/5 hover:text-black">
                返回原版正文
              </button>
              <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full border border-black/10 text-black/62 transition hover:bg-black/5 hover:text-black" aria-label="关闭白皮书">
                <X size={18} />
              </button>
            </div>
          </header>

          <main className="px-5 py-8 md:px-10 md:py-12">
            <section className="mx-auto max-w-4xl">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-black/44">Research note / Personal finance</p>
              <h1 className="mt-5 max-w-3xl font-serif text-[clamp(2.7rem,6vw,6.6rem)] leading-[0.94]">长期持有的收益来源与行为难题</h1>
              <p className="mt-7 max-w-3xl text-xl leading-9 text-black/66">
                长期投资的核心任务，是在噪音、诱惑和恐惧中持续拥有一篮子会创造利润的企业。投资者最终获得的回报，取决于持有时间、投资成本、资产分散程度和行为纪律。
              </p>
              <div className="mt-9 grid gap-px overflow-hidden rounded-lg border border-black/10 bg-black/10 sm:grid-cols-2 lg:grid-cols-4">
                <Stat value="79%" label="2025 年美国大型主动基金跑输标普 500" source="SPIVA 2025" />
                <Stat value="1.2%/年" label="投资者实际收益与基金总回报的十年差距" source="Morningstar 2025" />
                <Stat value="4 / 7" label="美国普通股终身回报低于一个月期国库券" source="Bessembinder" />
                <Stat value="Top 4%" label="贡献了美国股市自 1926 年以来的全部净财富" source="Bessembinder" />
              </div>
              <div className="mt-6 rounded-lg border border-black/10 bg-black/[0.035] p-4 text-sm leading-7 text-black/58">
                <strong className="text-black/75">阅读口径：</strong>本文只用于投资教育，不构成个性化投资建议。历史收益用于理解市场规律；ETF 仍有波动、回撤、费用、跟踪误差、汇率和流动性风险。所有百分比均注明样本与来源，便于读者理解其适用范围。
              </div>
            </section>

            <ArticleSection id="wp-1" eyebrow="Part 01 · Ownership" title="r > g：先让劳动收入进入资本回报系统">
              <p>
                普通人的第一桶本金几乎都来自劳动，但工资是线性的：它依赖时间、岗位和组织分配。资本回报则来自企业利润、股息、利息和再投资，会在足够长的时间里形成复利。<strong>定投的首要作用，是把每月一部分劳动收入持续转换为企业所有权。</strong>
              </p>
              <Figure title="资本回报与经济增长的长期剪刀差" caption="概念示意：r 与 g 会随国家、时代和估值变化；图表用于解释长期资本积累机制。">
                <RgSpreadChart />
              </Figure>
              <p>
                现金承担应急和短期支出，股票承担长期增长，债券承担稳定与流动性。资产配置需要先划清时间边界：三年内确定要用的钱不应依赖股票兑现；真正十年以上不用的资金，更适合承受权益市场的完整周期。
              </p>
              <ActionRule icon={<Landmark size={18} />} title="先后顺序">
                先建立应急金、处理高息负债，再把长期闲钱自动转入低成本、广泛分散的资产，并让投资计划与日常现金管理彼此独立。
              </ActionRule>
            </ArticleSection>

            <ArticleSection id="wp-2" eyebrow="Part 02 · Active vs Passive" title="大多数主动基金，为什么长期很难跑赢指数">
              <p>
                指数获得的是市场平均回报，主动基金则要在平均回报之上，先覆盖研究、交易、管理费和税务摩擦，再持续选对股票与时点。对单个优秀经理而言，超额收益可能存在；对一个完整行业而言，<strong>费用前是总和博弈，费用后则必然有人落后。</strong>
              </p>
              <Figure title="时间越长，持续超越基准越难" caption="2025 年美国大型主动基金一年数据，以及全球型主动基金相对 S&P World 的 10 年、15 年数据。不同类别不可直接横向比较，但共同显示长期持续超额的稀缺性。">
                <ActivePassiveBars />
              </Figure>
              <p>
                SPIVA 2025 显示，<strong>79%</strong> 的美国大型主动基金在当年跑输标普 500；全球型主动基金在 10 年和 15 年区间跑输 S&amp;P World 的比例分别达到 <strong>93.41%</strong> 与 <strong>95.63%</strong>。主动管理要取得长期超额收益，需要同时满足经理选择有效、基金持续存续、风格稳定、费用合理，以及投资者能够度过阶段性落后等条件。
              </p>
              <SourceLink href={sources[0].href}>查看 SPIVA U.S. Year-End 2025 原始报告</SourceLink>
              <EvidenceBrief conclusion="Barber 与 Odean 的经典券商账户样本显示，家庭平均年换手率约 80%，相当于组合约 15 个月被完整换手一次；交易最频繁的 20% 家庭净年化约为 10.0%。" mechanism="高换手率叠加交易成本、追逐热点和择时误差，会持续压低投资者实际获得的净收益。" action="通过自动定投、年度再平衡和明确的卖出条件减少无计划换仓，让持有期限服务于长期目标。" />
            </ArticleSection>

            <ArticleSection id="wp-3" eyebrow="Part 03 · Positive Skew" title="极少数超级赢家决定指数长期回报">
              <p>
                美国个股的长期回报呈现明显的正偏分布。Bessembinder 对 1926 年以来美国普通股的研究显示，<strong>4/7 的股票终身买入持有回报低于一个月期国库券，表现最好的约 4% 公司解释了整个美国股市的全部净财富创造。</strong>退市数据同时包含并购、私有化、换板和破产，终身回报因此更适合用来衡量个股为投资者创造财富的能力。
              </p>
              <Figure title="个股回报呈正偏分布，极少数超级赢家拉长右尾" caption="Bessembinder 研究口径：Top 4% 贡献全部净财富，其余公司合计创造的财富约等于短期国库券。">
                <WinnerConcentrationChart />
              </Figure>
              <p>
                宽基指数通过市值加权、定期调整和成分更替，让优秀公司随着市值增长自然提高权重，同时逐步降低弱势公司的影响。长期持有宽基指数，可以提高组合捕获超级赢家的概率，并保留决定市场长期回报的右尾收益。
              </p>
              <ActionRule icon={<Layers3 size={18} />} title="分散提高捕获超级赢家的概率">
                分散是在承认“超级赢家事前极难识别”后，让自己仍有机会持有它。若做个股，核心仓仍可用宽基兜底，并给单一公司设置上限。
              </ActionRule>
              <SourceLink href={sources[2].href}>阅读 Bessembinder 原始论文与摘要</SourceLink>
            </ArticleSection>

            <ArticleSection id="wp-4" eyebrow="Part 04 · Behavior" title="为什么散户总在牛市顶部入场、熊市底部离场">
              <p>
                因为信息和人性都带着同一个延迟：价格先上涨，赚钱故事才会变多；新闻越密集，风险看起来越小；亲友的盈利变成社会证明，踏空比亏损更难忍受。等一个普通人终于“确认趋势”，上涨往往已经被价格充分反映。
              </p>
              <Figure title="一轮典型的追涨杀跌循环" caption="行为机制综合自注意力驱动买入、收益追逐、损失厌恶与处置效应研究。它是因果框架，不代表每位投资者都会经历全部步骤。">
                <BehaviorCycle />
              </Figure>
              <p>
                下跌时，机制反向运转：新闻集中报道风险，账户亏损变成高频刺激，人会把最近的跌幅外推到未来。为了立刻停止痛苦，卖出提供了一种“我重新掌控局面”的错觉。于是，<strong>牛市用确定感把人吸进来，熊市用确定感把人赶出去。</strong>
              </p>
              <p>
                Morningstar 2025 的十年统计中，基金与 ETF 的资金加权投资者收益约为 <strong>7.0%/年</strong>，而基金总回报约为 <strong>8.2%/年</strong>，行为差距为每年 1.2 个百分点——相当于基金年化总回报的大约 15% 被资金进出时点吞掉。
              </p>
              <ActionRule icon={<Brain size={18} />} title="让规则在情绪之前写好">
                自动扣款；关闭非必要价格提醒；把“何时卖出”限定为目标到期、现金需求、资产配置偏离或投资逻辑失效，让交易决定与新闻标题和单日涨跌相互隔离。
              </ActionRule>
              <SourceLink href={sources[1].href}>查看 Morningstar Mind the Gap 2025</SourceLink>
            </ArticleSection>

            <ArticleSection id="wp-5" eyebrow="Part 05 · Time in the market" title="闪电劈下来时，你必须在场">
              <p>
                市场长期收益高度集中在少数关键交易日，最好的日子又经常紧挨着最坏的日子。<strong>投资者需要同时经历下跌与修复，才能完整获得长期市场回报。</strong>这种时间聚集特征显著提高了离场择时和重新入场的难度。
              </p>
              <Figure title="离场择时最危险的地方：最佳日与最差日彼此相邻" caption="J.P. Morgan 2026 波动指南指出：过去 20 年若错过 10 个最佳交易日，组合终值会接近减半。该数据用于展示历史上收益集中的时间特征。">
                <LightningDays />
              </Figure>
              <p>
                市场最恐慌时，资产价格已经包含很低的预期，现实只要略好于预期，价格就可能在几天内快速修复。等宏观数据、媒体叙事和情绪重新转好，最陡峭的一段反弹通常已经结束。长期纪律的价值，在于让组合持续覆盖这些决定性时刻。
              </p>
              <blockquote className="rounded-lg border-l-4 border-black bg-black/[0.045] px-5 py-4 font-serif text-2xl leading-10 text-black/75">
                减少频繁进出；当天空最黑、闪电真正劈下来时，仍然留在场内。
              </blockquote>
              <SourceLink href={sources[5].href}>查看 J.P. Morgan 市场波动与最佳交易日说明</SourceLink>
            </ArticleSection>

            <ArticleSection id="wp-6" eyebrow="Part 06 · Compounding" title="复利的时间优势：巴菲特的长期记录">
              <p>
                公开的阶段性净资产估算显示，巴菲特绝大部分个人财富在 50 岁以后形成，体现了大额本金在复利后半程产生的陡峭增长。伯克希尔官方记录显示：1965—2025 年每股市值的复合年增长率为 <strong>19.7%</strong>，同期含股息的标普 500 为 <strong>10.5%</strong>；对应累计增幅约为 <strong>6,099,294%</strong> 与 <strong>46,061%</strong>。
              </p>
              <Figure title="复利的力量不在第一年，而在后半程" caption="纯数学示意：1 元按年化 10% 复利，不含税费与波动。现实回报不会如此平滑。">
                <CompoundingCurve />
              </Figure>
              <EvidenceBrief conclusion="公开净资产估算用于观察个人财富积累路径；伯克希尔股东信中的长期业绩表用于衡量公司每股市值的实际复利记录。" mechanism="随着本金扩大，相同回报率带来的绝对财富增量会逐年增加，因此复利成果天然集中在持有周期后半程。" action="尽早开始、持续追加、控制费用并防止永久性亏损，为复利保留足够长的运行时间。" />
              <p>
                复利最反直觉的地方，是前十年看起来“没什么发生”，后十年却可能贡献大部分终值。频繁换策略会不断重置持有信心；高费用、杠杆爆仓和永久性亏损则会直接打断复利。因此，长期投资首先是一场<strong>不出局的游戏</strong>。
              </p>
              <SourceLink href={sources[6].href}>查看 Berkshire Hathaway 2025 年股东信官方业绩表</SourceLink>
            </ArticleSection>

            <ArticleSection id="wp-7" eyebrow="Part 07 · Operating system" title="好评如潮的投资知识，最后都指向同一套朴素系统">
              <p>
                从 Bogle 的低成本指数理念、Malkiel 的随机漫步，到 Bernstein 的资产配置和 Housel 的行为金融，经典投资书最终反复强调的是同一件事：<strong>控制可控项，放弃不可控项。</strong>未来收益不可控，费用、分散、储蓄率、持有纪律与再平衡却可以控制。
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ['选“指数”，再选 ETF', '先确认追踪范围、编制规则和前十大权重，再结合名称与历史涨幅理解产品。'],
                  ['总成本优先', '比较费率、跟踪差异、买卖价差、税费与换汇成本，不只看管理费。'],
                  ['宽基做核心', '主题、行业与单一国家可作卫星仓；多只高度重叠 ETF 不等于更分散。'],
                  ['自动化现金流', '工资到账后固定日期扣款，减少每月重新做决定的机会。'],
                  ['新增资金先再平衡', '优先把新钱补给低配资产，只有偏离过大时才考虑卖出。'],
                  ['用风险预算定股债比', '比例取决于期限、现金流与最大可承受回撤，不取决于本周观点。'],
                  ['长期定投远离杠杆', '杠杆、反向与复杂衍生 ETF 通常不适合作为长期核心定投工具。'],
                  ['一年只改一次规则', '市场波动时执行既定规则；家庭目标变化时，才修改规则本身。']
                ].map(([title, body], index) => (
                  <div key={title} className="rounded-lg border border-black/10 bg-black/[0.028] p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-black/80"><CheckCircle2 size={16} />{String(index + 1).padStart(2, '0')} · {title}</div>
                    <p className="mt-2 text-sm leading-6 text-black/55">{body}</p>
                  </div>
                ))}
              </div>
              <Figure title="定投管理行为风险，一次投入提高资金在场时间" caption="Vanguard 对 MSCI World 1976—2022 滚动样本的研究：已有大笔现金时，立即投入在约 68% 的区间胜过三个月分批；分批投入在约 69% 的区间胜过一直持有现金。">
                <DcaDecisionMap />
              </Figure>
              <p>
                必须区分两种“定投”：<strong>工资到账后的持续投入</strong>，本质是把未来现金流尽快入市；<strong>手里已有一大笔可投资现金却长期分批</strong>，本质是延迟承担风险。后者通常牺牲期望收益来换取心理舒适。如果一次投入会让你在首次下跌时恐慌卖出，短期分批仍可能是更好的行为方案。
              </p>
              <SourceLink href={sources[7].href}>阅读 Vanguard 关于一次投入与分批投入的研究</SourceLink>
            </ArticleSection>

            <ArticleSection id="wp-8" eyebrow="Part 08 · Policy" title="全天候策略：把原则写成每月都能执行的规则">
              <p>
                这套工具把组合拆成四个角色：宽基权益承担企业利润增长，科技指数提供创新弹性，长期国债承担经济收缩与利率下行时的缓冲，黄金承担通胀、货币信用和极端不确定性对冲。组合以跨周期生存和持续留在市场为目标。
              </p>
              <Figure title="从工资现金流到长期组合的执行闭环" caption="示意比例用于展示组合机制；实际权重应根据投资期限、收入稳定性、币种、税务与最大可承受回撤调整。">
                <PolicyLoop />
              </Figure>
              <div className="grid gap-3 md:grid-cols-3">
                <RuleCard icon={<Clock3 size={18} />} title="每月" body="记录持仓与新增现金；自动补足低配资产；不因新闻改计划。" />
                <RuleCard icon={<Scale size={18} />} title="每季度" body="检查最大偏离、费用、现金流和风险承受力；优先用新钱再平衡。" />
                <RuleCard icon={<ShieldCheck size={18} />} title="每年" body="复核家庭目标与目标比例；需要时再做完整再平衡，不追逐去年冠军。" />
              </div>
              <p>
                日常模式建议“只买不卖”，把新增现金优先补到低于目标权重最多的资产。只有当最大偏离超过预设阈值，或家庭目标、期限和现金流发生变化时，才启动全面再平衡。<strong>月度负责执行，季度负责检查，年度负责校准。</strong>
              </p>
            </ArticleSection>

            <section className="mx-auto mt-14 max-w-4xl border-t border-black/10 pt-10">
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-black/45"><BookOpenText size={16} />研究来源与延伸阅读</div>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {sources.map((source, index) => (
                  <a key={source.name} href={source.href} target="_blank" rel="noreferrer" className="group rounded-lg border border-black/10 bg-black/[0.025] p-4 transition hover:border-black/25 hover:bg-black/[0.045]">
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-mono text-xs text-black/35">{String(index + 1).padStart(2, '0')}</span>
                      <ExternalLink className="shrink-0 text-black/30 transition group-hover:text-black/65" size={14} />
                    </div>
                    <p className="mt-2 text-sm font-semibold leading-5 text-black/75">{source.name}</p>
                    <p className="mt-1 text-xs leading-5 text-black/48">{source.note}</p>
                  </a>
                ))}
              </div>
            </section>

            <section className="mx-auto mt-12 max-w-4xl rounded-lg bg-[#171715] p-6 text-[#f4eee1] md:p-8">
              <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#b9ffdc]"><Target size={17} />最后的投资备忘录</div>
              <p className="font-serif text-2xl leading-10 text-white/88 md:text-3xl md:leading-[1.45]">
                不预测每一次风暴，不追逐每一个热点。用低成本买下一篮子生产性资产，用现金流持续积累份额，用再平衡管理风险，然后把最稀缺的优势——时间——留给复利。
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
    <section id={id} className="mx-auto mt-14 max-w-4xl scroll-mt-24 border-t border-black/10 pt-11">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-black/38">{eyebrow}</p>
      <h2 className="mt-3 max-w-3xl text-4xl font-semibold leading-tight md:text-5xl">{title}</h2>
      <div className="prose-like mt-7 space-y-5 text-base leading-8 text-black/68">{children}</div>
    </section>
  );
}

function Figure({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <figure className="my-8 overflow-hidden rounded-lg border border-black/10 bg-[#ebe3d3]">
      <div className="border-b border-black/10 px-4 py-3"><figcaption className="text-sm font-semibold">{title}</figcaption></div>
      <div className="p-4">{children}</div>
      <p className="border-t border-black/10 px-4 py-3 text-xs leading-5 text-black/48">{caption}</p>
    </figure>
  );
}

function Stat({ value, label, source }: { value: string; label: string; source: string }) {
  return (
    <div className="bg-[#ebe3d3] p-4">
      <p className="font-mono text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-2 text-xs leading-5 text-black/58">{label}</p>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-black/32">{source}</p>
    </div>
  );
}

function EvidenceBrief({ conclusion, mechanism, action }: { conclusion: string; mechanism: string; action: string }) {
  return (
    <div className="my-7 overflow-hidden rounded-lg border border-black/12 bg-[#171715] text-[#f4eee1]">
      <div className="grid gap-px bg-white/10 md:grid-cols-3">
        <div className="bg-[#171715] p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#b9ffdc]">研究结论</p><p className="mt-2 text-sm leading-6 text-white/75">{conclusion}</p></div>
        <div className="bg-[#171715] p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#ffbe77]">机制解释</p><p className="mt-2 text-sm leading-6 text-white/75">{mechanism}</p></div>
        <div className="bg-[#171715] p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">投资启示</p><p className="mt-2 text-sm leading-6 text-white/75">{action}</p></div>
      </div>
    </div>
  );
}

function ActionRule({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="my-6 flex gap-4 rounded-lg border border-black/10 bg-black/[0.035] p-4">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black text-[#b9ffdc]">{icon}</div>
      <div><p className="text-sm font-semibold text-black/80">{title}</p><p className="mt-1 text-sm leading-6 text-black/58">{children}</p></div>
    </div>
  );
}

function SourceLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-black/12 px-3 py-1.5 text-xs font-semibold text-black/58 transition hover:border-black/30 hover:text-black">
      {children}<ExternalLink size={12} />
    </a>
  );
}

function RuleCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return <div className="rounded-lg border border-black/10 bg-black/[0.028] p-4"><div className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</div><p className="mt-3 text-sm leading-6 text-black/55">{body}</p></div>;
}

function RgSpreadChart() {
  return (
    <svg className="h-[260px] w-full" viewBox="0 0 720 260" role="img" aria-label="资本回报和经济增长示意图">
      <rect width="720" height="260" rx="8" fill="#0d0e0c" />
      {[60, 105, 150, 195].map((y) => <line key={y} x1="56" x2="670" y1={y} y2={y} stroke="rgba(244,238,225,0.12)" />)}
      <path d="M70 78 C170 74,250 86,342 80 S520 70,650 76" fill="none" stroke="#b9ffdc" strokeWidth="3" />
      <path d="M70 168 C168 160,236 184,326 146 S520 152,650 158" fill="none" stroke="#d9fae9" strokeWidth="3" opacity=".82" />
      <text x="72" y="42" fill="#f4eee1" fontSize="14" fontWeight="700">劳动提供本金，资本提供复利</text>
      <text x="565" y="70" fill="#b9ffdc" fontSize="13" fontWeight="700">资本回报 r</text>
      <text x="565" y="176" fill="#d9fae9" fontSize="13" fontWeight="700">经济增长 g</text>
      <text x="72" y="224" fill="rgba(244,238,225,.5)" fontSize="12">尽早拥有生产性资产，让劳动本金进入长期复利系统。</text>
    </svg>
  );
}

function ActivePassiveBars() {
  const items = [
    { label: '美国大型主动基金', period: '2025 单年', value: 79 },
    { label: '全球型主动基金', period: '10 年', value: 93.41 },
    { label: '全球型主动基金', period: '15 年', value: 95.63 }
  ];
  return (
    <div className="rounded-lg bg-[#0d0e0c] p-5 text-[#f4eee1]">
      <div className="mb-6 flex items-end justify-between gap-4"><div><p className="text-xs uppercase tracking-[.16em] text-white/38">Underperformed benchmark</p><p className="mt-1 text-sm font-semibold">跑输对应基准的基金比例</p></div><TrendingUp size={20} className="text-[#b9ffdc]" /></div>
      <div className="space-y-5">
        {items.map((item) => <div key={`${item.label}-${item.period}`}><div className="mb-2 flex items-end justify-between gap-4 text-xs"><span>{item.label} · {item.period}</span><strong className="font-mono text-base text-[#b9ffdc]">{item.value}%</strong></div><div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#b9ffdc]" style={{ width: `${item.value}%` }} /></div></div>)}
      </div>
    </div>
  );
}

function WinnerConcentrationChart() {
  return (
    <div className="grid min-h-[250px] gap-px overflow-hidden rounded-lg bg-black/10 sm:grid-cols-[1.35fr_.65fr]">
      <div className="flex flex-col justify-between bg-[#0d0e0c] p-6 text-[#f4eee1]"><div><p className="font-mono text-5xl font-semibold text-[#b9ffdc]">4 / 7</p><p className="mt-3 max-w-sm text-sm leading-6 text-white/58">普通股的终身买入持有回报低于一个月期国库券</p></div><p className="mt-8 text-xs text-white/32">个股长期回报呈现高度正偏分布</p></div>
      <div className="flex flex-col justify-between bg-[#b9ffdc] p-6"><div><p className="font-mono text-5xl font-semibold">4%</p><p className="mt-3 text-sm leading-6 text-black/60">最强公司贡献全部净财富创造</p></div><ArrowUpRight size={34} className="self-end" /></div>
    </div>
  );
}

function BehaviorCycle() {
  const steps = [
    ['01', '价格上涨', '风险看起来变小'], ['02', '新闻增多', '注意力集中'], ['03', 'FOMO 买入', '高位确认趋势'], ['04', '价格下跌', '亏损高频刺激'], ['05', '恐慌卖出', '用行动停止痛苦'], ['06', '反弹缺席', '等待“更确定”']
  ];
  return <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{steps.map(([no, title, body], index) => <div key={no} className={`rounded-lg border p-4 ${index === 2 || index === 4 ? 'border-black bg-[#171715] text-[#f4eee1]' : 'border-black/10 bg-[#f4eee1]'}`}><p className={`font-mono text-xs ${index === 2 || index === 4 ? 'text-[#b9ffdc]' : 'text-black/35'}`}>{no}</p><p className="mt-5 text-base font-semibold">{title}</p><p className={`mt-1 text-xs ${index === 2 || index === 4 ? 'text-white/48' : 'text-black/45'}`}>{body}</p></div>)}</div>;
}

function LightningDays() {
  return (
    <div className="rounded-lg bg-[#0d0e0c] p-5 text-[#f4eee1]">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-white/10 p-4"><p className="font-mono text-3xl text-[#b9ffdc]">20 年</p><p className="mt-2 text-xs leading-5 text-white/48">研究观察窗口</p></div>
        <div className="rounded-lg border border-white/10 p-4"><p className="font-mono text-3xl text-[#b9ffdc]">10 天</p><p className="mt-2 text-xs leading-5 text-white/48">错过极少数最佳交易日</p></div>
        <div className="rounded-lg border border-[#b9ffdc]/35 bg-[#b9ffdc]/8 p-4"><p className="font-mono text-3xl text-[#b9ffdc]">≈ 减半</p><p className="mt-2 text-xs leading-5 text-white/48">组合终值损失</p></div>
      </div>
      <div className="mt-5 flex items-center gap-3 text-xs text-white/40"><span className="h-px flex-1 bg-gradient-to-r from-transparent via-white/20 to-transparent" />最佳与最差交易日往往彼此靠近<span className="h-px flex-1 bg-gradient-to-r from-transparent via-white/20 to-transparent" /></div>
    </div>
  );
}

function CompoundingCurve() {
  const values = [{ year: 0, value: 1 }, { year: 10, value: 2.59 }, { year: 20, value: 6.73 }, { year: 30, value: 17.45 }, { year: 40, value: 45.26 }];
  return <div className="rounded-lg bg-[#0d0e0c] p-5 text-[#f4eee1]"><div className="flex h-[220px] items-end gap-3">{values.map((item, index) => <div key={item.year} className="flex flex-1 flex-col items-center justify-end gap-2"><span className="font-mono text-xs text-[#b9ffdc]">{item.value.toFixed(item.value < 10 ? 2 : 1)}×</span><div className="w-full max-w-20 rounded-t bg-[#b9ffdc]" style={{ height: `${Math.max(8, (item.value / 45.26) * 150)}px`, opacity: .42 + index * .13 }} /><span className="text-[11px] text-white/42">{item.year} 年</span></div>)}</div><p className="mt-4 border-t border-white/10 pt-4 text-xs text-white/40">在同样 10% 的假设回报下，第 30—40 年增加的财富，远多于最初 20 年之和。</p></div>;
}

function DcaDecisionMap() {
  return (
    <div className="grid gap-px overflow-hidden rounded-lg bg-black/10 md:grid-cols-2">
      <div className="bg-[#0d0e0c] p-5 text-[#f4eee1]"><p className="text-xs uppercase tracking-[.16em] text-[#b9ffdc]">未来工资现金流</p><p className="mt-3 text-xl font-semibold">按月到账，立即定投</p><p className="mt-3 text-sm leading-6 text-white/48">不存在“本可更早投入”的现金拖延，自动化能显著降低行为摩擦。</p></div>
      <div className="bg-[#f4eee1] p-5"><p className="text-xs uppercase tracking-[.16em] text-black/38">已有大笔可投资现金</p><p className="mt-3 text-xl font-semibold">一次投入期望更高</p><p className="mt-3 text-sm leading-6 text-black/48">心理承受力较弱时，可预先设定一个短期、固定期限完成分批投入。</p></div>
    </div>
  );
}

function PolicyLoop() {
  const items = [['宽基权益', '长期利润池', '45%'], ['科技指数', '创新弹性', '25%'], ['长期国债', '防守缓冲', '20%'], ['黄金资产', '极端对冲', '10%']];
  return <div className="rounded-lg bg-[#0d0e0c] p-5 text-[#f4eee1]"><div className="grid gap-2 sm:grid-cols-2">{items.map(([name, role, weight]) => <div key={name} className="flex items-center justify-between rounded-lg border border-white/10 p-4"><div><p className="font-semibold">{name}</p><p className="mt-1 text-xs text-white/38">{role}</p></div><span className="font-mono text-xl text-[#b9ffdc]">{weight}</span></div>)}</div><div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-white/44"><span className="rounded-full border border-white/10 px-3 py-1">输入持仓</span><span>→</span><span className="rounded-full border border-white/10 px-3 py-1">加入现金</span><span>→</span><span className="rounded-full border border-[#b9ffdc]/30 px-3 py-1 text-[#b9ffdc]">补足低配</span><span>→</span><span className="rounded-full border border-white/10 px-3 py-1">年度校准</span></div></div>;
}
