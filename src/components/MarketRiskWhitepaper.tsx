import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  BookOpenText,
  ExternalLink,
  Gauge,
  Scale,
  ShieldCheck,
  Target,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const SOURCE_ARTICLE_URL = 'https://www.huxiu.com/article/4879815.html?f=rss';

const riskToc = [
  '方向正确，为什么仍会归零',
  '近百年反复出现的失败结构',
  '回撤、杠杆与毁灭概率',
  '凯利公式真正约束的是什么',
  '把风险纪律写成制度',
  '最后站着的人',
];

const caseRows = [
  {
    name: 'LTCM · 1998',
    structure: '价差收敛交易、模型依赖与高杠杆叠加',
    breakPoint: '市场相关性改变，流动性消失，损失速度超过降仓速度',
    status: '官方资料可核验',
  },
  {
    name: 'Amaranth · 2006',
    structure: '天然气价差上形成高度集中的方向性风险',
    breakPoint: '不利波动与集中头寸共同放大净值和流动性压力',
    status: '监管资料可核验',
  },
  {
    name: 'Archegos · 2021',
    structure: '总收益互换隐藏了跨交易对手的集中敞口',
    breakPoint: '集中持仓下跌触发追加保证金与连锁平仓',
    status: 'SEC 资料可核验',
  },
  {
    name: 'Melvin Capital · 2021',
    structure: '拥挤空头遭遇极端逼空，损失与赎回压力叠加',
    breakPoint: '仓位拥挤后，价格与流动性同时朝不利方向变化',
    status: '公开报道口径',
  },
  {
    name: 'SA 基金叙事 · 2026',
    structure: '虎嗅文章描述的 AI 基建集中持仓与杠杆事件',
    breakPoint: '文章用它说明方向判断与生存结构是两件事',
    status: '事件细节待独立核验',
  },
];

const recoveryRows = [
  { drawdown: 10, recovery: 11.1 },
  { drawdown: 20, recovery: 25 },
  { drawdown: 30, recovery: 42.9 },
  { drawdown: 50, recovery: 100 },
  { drawdown: 75, recovery: 300 },
];

export function MarketRiskWhitepaperLauncher() {
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
        className="group inline-flex h-10 shrink-0 items-center gap-3 border border-[#d6b566]/35 bg-[#d6b566]/10 px-4 text-xs font-semibold text-[#ead59d] transition hover:border-[#d6b566]/60 hover:bg-[#d6b566]/15"
      >
        <BookOpenText size={15} />
        资本生存白皮书
        <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
      </button>

      {typeof document !== 'undefined'
        ? createPortal(
            <AnimatePresence>
              {open ? <RiskWhitepaperDialog onClose={() => setOpen(false)} /> : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </>
  );
}

function RiskWhitepaperDialog({ onClose }: { onClose: () => void }) {
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
        aria-labelledby="risk-whitepaper-title"
        className="mx-auto grid h-full max-w-6xl overflow-hidden rounded-lg border border-white/12 bg-[#f4eee1] text-[#171715] shadow-[0_30px_120px_rgba(0,0,0,0.62)] lg:grid-cols-[260px_1fr]"
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.985 }}
        transition={{ duration: 0.24 }}
        onClick={(event) => event.stopPropagation()}
      >
        <aside className="hidden border-r border-black/10 bg-[#ebe3d3] p-5 lg:block">
          <div className="sticky top-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-black/38">Whitepaper</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight">资本生存与杠杆风险</h2>
            <p className="mt-3 text-xs leading-5 text-black/45">从天才交易员的共同失败结构，反推普通投资者的风险纪律。</p>
            <nav className="mt-8 space-y-2" aria-label="白皮书目录">
              {riskToc.map((item, index) => (
                <a
                  key={item}
                  href={`#risk-wp-${index + 1}`}
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
              <ShieldCheck size={18} />
              <span className="text-sm font-semibold">资本生存白皮书</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-10 w-10 place-items-center rounded-full border border-black/10 text-black/62 transition hover:bg-black/5 hover:text-black"
              aria-label="关闭白皮书"
              title="关闭白皮书"
            >
              <X size={18} />
            </button>
          </header>

          <main className="px-5 py-8 md:px-10 md:py-12">
            <section className="mx-auto max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-black/44">Risk note / Capital survival</p>
              <h1 id="risk-whitepaper-title" className="mt-5 font-serif text-[clamp(2.6rem,6vw,5.8rem)] leading-[0.96]">
                华尔街如何杀死天才
              </h1>
              <p className="mt-7 text-xl leading-9 text-black/66">
                判断方向只是投资的一半，另一半是确保自己有足够的资本和时间，等到判断兑现。这份白皮书不研究怎样成为最聪明的人，只研究怎样避免在正确到来之前先被市场淘汰。
              </p>
              <div className="mt-8 border border-black/10 bg-black/[0.035] p-4 text-sm leading-7 text-black/58">
                本文依据虎嗅文章《华尔街是如何杀死天才的》的核心观点重新组织，并结合公开监管资料补充风险框架。它只用于投资教育，不构成个性化建议。原文中的部分当期事件尚缺少独立的一手监管文件，本文会明确标注，不把报道叙事当作已核验事实。
              </div>
              <a
                href={SOURCE_ARTICLE_URL}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-black/62 underline decoration-black/25 underline-offset-4 transition hover:text-black"
              >
                阅读虎嗅原文 <ExternalLink size={14} />
              </a>
            </section>

            <RiskSection id="risk-wp-1" eyebrow="Part 01" title="方向正确，为什么仍会归零">
              <p>
                市场不会因为一个观点最终正确，就保证持有这个观点的人赚钱。收益取决于方向、仓位、杠杆、路径和时间五个变量。只要其中一个变量失控，正确的长期判断也可能变成短期破产。
              </p>
              <p>
                杠杆最危险的地方，不只是放大亏损，而是出售等待的权利。没有杠杆时，投资者可以承受波动、等待基本面兑现；有了追加保证金约束，市场只要在正确方向到来前先走一段反向路径，仓位就可能被强制清除。
              </p>
              <RiskFigure title="天才交易最常见的毁灭链" caption="核心不是某一次预测错误，而是成功之后逐渐失去容错空间。">
                <FailureChain />
              </RiskFigure>
              <p>
                因此，交易计划首先要回答的不是“能赚多少”，而是“最坏情况下会发生什么”。只有当最坏路径不会摧毁本金、现金流与执行能力时，成功收益才有计算意义。
              </p>
            </RiskSection>

            <RiskSection id="risk-wp-2" eyebrow="Part 02" title="近百年反复出现的失败结构">
              <p>
                文章把不同时代的明星交易者放在一起，指出工具虽然从电话、期货变成总收益互换和算法，失败结构却高度相似：连续成功建立声望，声望带来更多资本，更多资本推动更集中、更高杠杆的仓位，最终由一次异常波动触发流动性危机。
              </p>
              <RiskFigure title="案例核验矩阵" caption="“可核验”指存在监管机构或央行公开资料；它不代表所有报道细节均已被确认。">
                <CaseMatrix />
              </RiskFigure>
              <div className="border-l-2 border-[#a27d35] bg-[#a27d35]/[0.06] px-4 py-3 text-sm leading-7 text-black/62">
                <strong>核验边界：</strong>虎嗅原文对 2026 年 SA 基金事件的描述承担了当代叙事角色，但本项目未找到足以独立确认爆仓、接盘规模与因果链条的一手监管文件。因此这里只保留它提出的问题，不把事件细节写成事实结论。
              </div>
            </RiskSection>

            <RiskSection id="risk-wp-3" eyebrow="Part 03" title="回撤、杠杆与毁灭概率">
              <p>
                亏损和修复不是对称关系。账户亏损 50% 后，需要上涨 100% 才能回到原点；亏损 75% 后，需要上涨 300%。越接近资本耗尽，修复难度增长得越快，而投资者可以犯错的次数越来越少。
              </p>
              <RiskFigure title="回撤越深，回本所需涨幅越陡" caption="修复涨幅 = 1 ÷（1 - 回撤比例）- 1。未计交易费用、税费和融资成本。">
                <DrawdownRecovery />
              </RiskFigure>
              <p>
                在极简模型中，4 倍总杠杆意味着标的组合反向波动约 25% 就可能耗尽本金。真实市场还存在跳空、相关性上升、保证金提高、融资方提前降额度和无法成交等摩擦，所以实际安全边界通常更窄。
              </p>
            </RiskSection>

            <RiskSection id="risk-wp-4" eyebrow="Part 04" title="凯利公式真正约束的是什么">
              <p>
                凯利公式追求的是长期资本对数增长最大化，而不是单次收益最大化。在只有胜负两种结果、概率和赔率可信的简化模型中，最优下注比例可以写作：
              </p>
              <div className="my-7 border-y border-black/12 bg-[#ebe3d3] px-5 py-6 text-center">
                <p className="font-mono text-3xl font-semibold">f* = (bp - q) / b</p>
                <p className="mt-3 text-xs leading-5 text-black/48">p 为胜率，q = 1 - p，b 为净赔率，f* 为理论最优资金比例。</p>
              </div>
              <p>
                公式最大的价值是提醒投资者：有优势不等于可以无限下注。即使胜率是 60% 对 40%，仓位超过优势所能支撑的边界，长期增长率也会下降，极端路径甚至会让资本永久退出。
              </p>
              <p>
                现实投资的胜率、赔率与相关性都只能估计，且会随市场改变。输入稍有偏差，满凯利仓位就可能显得过于激进。因此实务中常使用半凯利或更低比例，并额外受到最大回撤、流动性和个人现金流约束。凯利不是加杠杆许可证，而是仓位上限的警报器。
              </p>
            </RiskSection>

            <RiskSection id="risk-wp-5" eyebrow="Part 05" title="把风险纪律写成制度">
              <p>
                风控不能依赖临场勇气。真正有效的风险系统，应当在下单前就写清楚损失预算、仓位边界、流动性要求和退出条件，并让任何一个单点失败都无法摧毁整个账户。
              </p>
              <div className="my-8 grid gap-px overflow-hidden border border-black/10 bg-black/10 sm:grid-cols-2">
                <PolicyItem icon={<Target size={17} />} title="先定损失预算" text="单笔允许损失 = 可投资资本 × 预设风险比例。先有损失上限，再反推仓位。" />
                <PolicyItem icon={<Scale size={17} />} title="限制集中度" text="把同一主题、同一因子和高相关资产合并看待，避免表面分散、实质单押。" />
                <PolicyItem icon={<Gauge size={17} />} title="压力测试杠杆" text="同时测试跳空、波动率上升、相关性趋近 1、保证金提高和融资撤回。" />
                <PolicyItem icon={<ShieldCheck size={17} />} title="保留生存现金" text="现金不是拖累，而是避免被迫卖出、承担意外支出和等待机会的选择权。" />
              </div>
              <h3>交易前的十个问题</h3>
              <ol className="grid gap-3 pt-2 sm:grid-cols-2">
                {[
                  '最坏情景下会亏多少钱？',
                  '仓位是否依赖借款或追加保证金？',
                  '一次跳空会不会越过退出价格？',
                  '和现有持仓是否高度相关？',
                  '成交量能否支持有序退出？',
                  '优势来自数据，还是来自自信？',
                  '连续三次错误后还能否执行？',
                  '何种证据出现时承认判断失效？',
                  '如果融资被撤回，仓位会怎样？',
                  '这笔交易失败后，是否还有下一次？',
                ].map((item, index) => (
                  <li key={item} className="flex gap-3 border-b border-black/10 pb-3 text-sm leading-6">
                    <span className="font-mono text-xs text-black/34">{String(index + 1).padStart(2, '0')}</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </RiskSection>

            <RiskSection id="risk-wp-6" eyebrow="Part 06" title="最后站着的人">
              <p>
                长期赢家未必每次都看得最准，但他们会控制任何一次错误造成的伤害。他们愿意错过一段行情，也不让一次仓位失控夺走未来所有机会。资本市场真正奖励的，不只是洞察力，而是洞察、仓位、流动性与时间共同组成的生存能力。
              </p>
              <div className="mt-8 border border-black/10 bg-[#171715] p-6 text-[#f4eee1]">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#d6b566]">
                  <TriangleAlert size={17} /> 永久提醒
                </div>
                <p className="mt-4 text-xl leading-9 text-white/82">
                  先算失败的后果，再算成功的收益。投资的终点不是证明自己比市场聪明，而是在漫长周期和意外冲击之后，仍然拥有本金、判断力和下一次选择。
                </p>
              </div>

              <div className="mt-10 border-t border-black/10 pt-7">
                <h3>资料与核验</h3>
                <div className="mt-4 space-y-3 text-sm leading-6">
                  <SourceLink href={SOURCE_ARTICLE_URL} label="虎嗅：《华尔街是如何杀死天才的》" />
                  <SourceLink href="https://www.federalreserve.gov/boarddocs/testimony/1998/19981001.htm" label="美联储：LTCM 私营部门重组证词（1998）" />
                  <SourceLink href="https://www.cftc.gov/PressRoom/PressReleases/5692-09" label="CFTC：Amaranth 天然气期货执法资料" />
                  <SourceLink href="https://www.sec.gov/newsroom/press-releases/2022-70" label="SEC：Archegos 及相关人员指控资料" />
                  <SourceLink href="https://doi.org/10.1002/j.1538-7305.1956.tb03809.x" label="J. L. Kelly Jr.：A New Interpretation of Information Rate（1956）" />
                </div>
              </div>
            </RiskSection>
          </main>
        </div>
      </motion.article>
    </motion.div>
  );
}

function RiskSection({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mx-auto mt-12 max-w-3xl scroll-mt-24 border-t border-black/10 pt-10">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-black/38">{eyebrow}</p>
      <h2 className="mt-3 text-4xl font-semibold leading-tight md:text-5xl">{title}</h2>
      <div className="mt-7 space-y-5 text-base leading-8 text-black/68">{children}</div>
    </section>
  );
}

function RiskFigure({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <figure className="my-8 overflow-hidden rounded-lg border border-black/10 bg-[#ebe3d3]">
      <figcaption className="border-b border-black/10 px-4 py-3 text-sm font-semibold">{title}</figcaption>
      <div className="p-4">{children}</div>
      <p className="border-t border-black/10 px-4 py-3 text-xs leading-5 text-black/48">{caption}</p>
    </figure>
  );
}

function FailureChain() {
  const steps = [
    ['01', '连续成功', '能力与运气开始混淆'],
    ['02', '过度自信', '相信这一次不会不同'],
    ['03', '集中与杠杆', '容错空间被主动压缩'],
    ['04', '异常波动', '保证金与流动性收紧'],
    ['05', '强制平仓', '方向尚未兑现，本金先退出'],
  ];
  return (
    <div className="grid gap-2 md:grid-cols-5">
      {steps.map(([index, title, text]) => (
        <div key={index} className="min-h-32 border border-black/10 bg-[#f4eee1] p-3">
          <span className="font-mono text-xs text-black/32">{index}</span>
          <p className="mt-4 text-sm font-semibold">{title}</p>
          <p className="mt-2 text-xs leading-5 text-black/48">{text}</p>
        </div>
      ))}
    </div>
  );
}

function CaseMatrix() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-black/15 text-black/48">
            <th className="px-3 py-3 font-semibold">案例</th>
            <th className="px-3 py-3 font-semibold">风险结构</th>
            <th className="px-3 py-3 font-semibold">断裂点</th>
            <th className="px-3 py-3 font-semibold">核验状态</th>
          </tr>
        </thead>
        <tbody>
          {caseRows.map((item) => (
            <tr key={item.name} className="border-b border-black/10 align-top">
              <td className="px-3 py-3 font-semibold">{item.name}</td>
              <td className="px-3 py-3 leading-5 text-black/58">{item.structure}</td>
              <td className="px-3 py-3 leading-5 text-black/58">{item.breakPoint}</td>
              <td className="px-3 py-3 text-black/48">{item.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DrawdownRecovery() {
  return (
    <div className="space-y-3 py-2">
      {recoveryRows.map((item) => (
        <div key={item.drawdown} className="grid grid-cols-[72px_1fr_66px] items-center gap-3 text-xs">
          <span className="font-mono text-black/54">-{item.drawdown}%</span>
          <div className="h-4 bg-black/8">
            <div className="h-full bg-[#a27d35]" style={{ width: `${Math.max(4, Math.min(100, item.recovery / 3))}%` }} />
          </div>
          <span className="text-right font-mono font-semibold">+{item.recovery}%</span>
        </div>
      ))}
    </div>
  );
}

function PolicyItem({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="bg-[#f4eee1] p-4">
      <div className="flex items-center gap-2 font-semibold">{icon}{title}</div>
      <p className="mt-2 text-sm leading-6 text-black/55">{text}</p>
    </div>
  );
}

function SourceLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="flex items-start justify-between gap-4 border-b border-black/10 pb-3 text-black/58 transition hover:text-black">
      <span>{label}</span>
      <ExternalLink size={14} className="mt-1 shrink-0" />
    </a>
  );
}
