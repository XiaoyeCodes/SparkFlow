import { motion } from 'framer-motion';
import {
  ArrowRight,
  Brain,
  BriefcaseBusiness,
  HeartPulse,
  Map,
  Orbit,
  Sigma,
  Sparkles,
  Target
} from 'lucide-react';
import { ModuleFrame } from '../components/ModuleFrame';

const growthPillars = [
  {
    title: '健康的生活方式',
    caption: '身体是长期主义的基础设施',
    body: '稳定睡眠、规律饮食、持续运动、整洁环境和可恢复的情绪系统，决定一个人能不能长期输出。健康不是效率工具，而是所有目标的前提。',
    Icon: HeartPulse
  },
  {
    title: '清醒的思维方式',
    caption: '用事实、模型和反馈校准判断',
    body: '先区分事实、情绪、解释和行动，再选择方法。成熟的思考不是永远正确，而是能在证据变化时更新自己。',
    Icon: Brain
  },
  {
    title: '职业成长路径',
    caption: '持续积累可迁移能力',
    body: '职业规划不是追逐头衔，而是沉淀技能、作品、信誉和行业理解。越能创造稳定价值，越不容易被单一岗位锁住。',
    Icon: BriefcaseBusiness
  },
  {
    title: '人生规划意识',
    caption: '把有限精力投向长期值得的事',
    body: '人生规划不是把未来写死，而是定期校准方向：我重视什么，愿意为什么付出代价，又该从哪些噪音里撤出来。',
    Icon: Map
  }
];

const thinkingCards = [
  {
    title: '第一性原理',
    tag: '拆到底层',
    core: '把复杂问题拆到不能再拆的基本事实，再从基本事实重新推导方案。',
    logic: '不要只在既有经验里找答案。先问这个问题最确定的事实是什么，哪些只是习惯、权威或路径依赖。',
    use: '遇到职业选择、产品设计、学习路线时，先重建问题，而不是复制别人的解法。'
  },
  {
    title: '批判性思维',
    tag: '审查判断',
    core: '对信息、论证和自己的直觉保持检验意识。',
    logic: '一个观点是否成立，取决于证据、推理链和边界条件，而不是表达者的身份或情绪强度。',
    use: '看到结论时追问：证据是什么，反例是什么，是否存在偷换概念或样本偏差。'
  },
  {
    title: '马克思主义哲学',
    tag: '关系与实践',
    core: '用联系、发展、矛盾和实践的眼光理解现实。',
    logic: '事物不是孤立静止的，很多变化来自结构关系、利益关系和主要矛盾的转化。',
    use: '分析社会、行业和个人处境时，既看现象，也看背后的生产关系、资源分配和历史阶段。'
  },
  {
    title: '奥卡姆剃刀',
    tag: '减少假设',
    core: '在能解释现象的方案里，优先选择假设更少、更简洁的解释。',
    logic: '复杂解释常常引入额外误差。简洁不是粗糙，而是减少不必要的变量。',
    use: '做判断时先排除过度脑补：是不是有一个更简单、更直接的原因。'
  },
  {
    title: '可证伪性',
    tag: '允许被推翻',
    core: '一个有价值的判断，应该能说明什么情况出现时它就是错的。',
    logic: '无法被检验的观点很难迭代。能被证伪，才意味着它能进入反馈循环。',
    use: '制定计划前写下失败信号，例如什么数据出现就说明方向需要调整。'
  },
  {
    title: '二元论',
    tag: '识别对立',
    core: '先识别问题中的核心对立面，再警惕把世界简化成非黑即白。',
    logic: '二分能帮助快速定位冲突，但现实经常存在连续谱、灰度和多变量耦合。',
    use: '用它发现张力，例如自由与秩序、效率与韧性；再用系统思维避免僵化对立。'
  },
  {
    title: '系统思维',
    tag: '看见结构',
    core: '关注要素之间的关系、反馈回路、延迟效应和整体涌现。',
    logic: '很多问题不是单点原因造成的，而是系统结构持续生产同一种结果。',
    use: '优化生活和职业时，不只改一个动作，而是重设环境、激励、流程和反馈。'
  },
  {
    title: '公理性知识与归纳性知识',
    tag: '区分确定性',
    core: '分清哪些知识来自定义和推演，哪些来自经验观察和概率归纳。',
    logic: '公理性知识追求逻辑必然，归纳性知识依赖样本和条件。混淆二者会导致过度自信。',
    use: '学习时标注知识类型：这是数学式推演，还是基于历史样本的经验规律。'
  },
  {
    title: '推论阶梯',
    tag: '拆开脑补',
    core: '人会从观察到的事实快速跳到解释、判断和行动。',
    logic: '我们以为自己在回应事实，其实常常在回应自己筛选后的事实和自动生成的故事。',
    use: '冲突或焦虑时倒推：我看到了什么，我选择忽略了什么，我加了什么解释。'
  },
  {
    title: '概率思维与期望值思维',
    tag: '长期决策',
    core: '不要只问会不会赢，要问概率、收益、损失和重复次数。',
    logic: '单次结果有噪声，长期结果由期望值主导。好决策可能短期失败，坏决策也可能偶然成功。',
    use: '评估选择时写下胜率、上行空间、下行损失和可重复性。'
  },
  {
    title: '凯利公式',
    tag: '控制下注',
    core: '在有优势时合理配置资源，避免因为过度下注而出局。',
    logic: '增长不仅取决于方向正确，也取决于仓位和风险控制。优势越不确定，下注越要保守。',
    use: '用于投资、创业和时间分配：看好也不要梭哈，先保证自己还能继续参与游戏。'
  },
  {
    title: '逆向思维',
    tag: '从失败倒推',
    core: '与其只问如何成功，不如先问怎样一定会失败。',
    logic: '失败路径通常更清楚。避开明显错误，往往比追求完美策略更有效。',
    use: '做计划前列出毁掉它的因素：睡眠崩坏、现金流断裂、能力错配、信息闭塞。'
  },
  {
    title: '演化思维',
    tag: '适应环境',
    core: '把个人、组织和观念看成在环境选择中不断变异、筛选和保留的结果。',
    logic: '不是最强者生存，而是最能适应变化者生存。优势也可能在环境改变后变成负担。',
    use: '保持小步试错，让能力和作品接受真实反馈，再保留有效变体。'
  },
  {
    title: '贝叶斯思维',
    tag: '更新信念',
    core: '先有先验判断，再根据新证据不断更新概率。',
    logic: '理性不是没有立场，而是愿意根据证据强度调整置信度。',
    use: '遇到新信息时问：这条证据应该让我把原判断上调多少，还是下调多少。'
  },
  {
    title: '费曼学习法',
    tag: '讲清楚',
    core: '如果不能用简单语言讲明白，就说明理解还不够深。',
    logic: '表达会暴露知识缺口。把概念讲给外行听，是检验理解质量的高效方法。',
    use: '学完一个模型后，用自己的话写一张卡片：定义、例子、反例和使用场景。'
  }
];

export function Logs() {
  return (
    <ModuleFrame title="成长建议栏" kicker="Growth Notes">
      <div className="space-y-10">
        <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
          <motion.div
            className="rounded-lg border border-white/10 bg-[#080908] p-6 md:p-8"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-[#8ad7ff]/24 bg-[#8ad7ff]/8 px-3 py-1 text-xs font-semibold text-[#8ad7ff]">
              <Sparkles size={14} />
              Personal operating system
            </div>
            <p className="max-w-3xl font-serif text-[clamp(2rem,5vw,4.7rem)] leading-[1.05] text-white/88">
              成长不是突然开悟，而是持续校准身体、判断、职业与人生方向。
            </p>
            <p className="mt-7 max-w-2xl text-sm leading-7 text-white/56 md:text-base">
              这个栏目记录一套可反复使用的成长框架：先把生活养稳，再把思维练清楚，随后用长期作品和复利能力建立职业位置，最后让人生选择服务于真正重要的目标。
            </p>
          </motion.div>

          <motion.div
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1"
            initial="hidden"
            animate="show"
            variants={{
              hidden: { opacity: 1 },
              show: { opacity: 1, transition: { staggerChildren: 0.06 } }
            }}
          >
            {growthPillars.map(({ title, caption, body, Icon }) => (
              <motion.article
                key={title}
                className="rounded-lg border border-white/10 bg-white/[0.045] p-5 transition hover:border-white/20"
                variants={{
                  hidden: { opacity: 0, y: 16 },
                  show: { opacity: 1, y: 0 }
                }}
              >
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold text-white">{title}</h2>
                    <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-white/36">{caption}</p>
                  </div>
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/30 text-[#b9ffdc]">
                    <Icon size={18} strokeWidth={1.8} />
                  </div>
                </div>
                <p className="text-sm leading-7 text-white/58">{body}</p>
              </motion.article>
            ))}
          </motion.div>
        </section>

        <section>
          <div className="mb-5 flex flex-col justify-between gap-3 border-b border-white/10 pb-5 md:flex-row md:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/36">Thinking toolkit</p>
              <h2 className="mt-2 text-3xl font-semibold text-white md:text-5xl">核心思维模型卡片</h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-white/48">
              每张卡片都不是概念收藏，而是一种判断动作：它应该帮助你拆问题、看结构、控风险、更新认知，并把学习转化成可行动的选择。
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {thinkingCards.map((card, index) => (
              <motion.article
                key={card.title}
                className="group flex min-h-[292px] flex-col rounded-lg border border-white/10 bg-[#0b0c0b] p-5 transition duration-300 hover:-translate-y-0.5 hover:border-[#8ad7ff]/36 hover:bg-[#101211]"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.42, delay: index * 0.025 }}
              >
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8ad7ff]/70">
                      {String(index + 1).padStart(2, '0')} · {card.tag}
                    </p>
                    <h3 className="text-2xl font-semibold leading-tight text-white">{card.title}</h3>
                  </div>
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-white/54 transition group-hover:text-[#8ad7ff]">
                    {index % 3 === 0 ? <Target size={16} /> : index % 3 === 1 ? <Sigma size={16} /> : <Orbit size={16} />}
                  </div>
                </div>

                <div className="space-y-4 text-sm leading-6">
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-white/32">核心观点</p>
                    <p className="text-white/78">{card.core}</p>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-white/32">底层逻辑</p>
                    <p className="text-white/55">{card.logic}</p>
                  </div>
                </div>

                <div className="mt-auto pt-5">
                  <div className="flex gap-2 rounded-md border border-white/10 bg-black/24 p-3 text-xs leading-5 text-white/52">
                    <ArrowRight className="mt-0.5 shrink-0 text-[#b9ffdc]" size={14} />
                    <span>{card.use}</span>
                  </div>
                </div>
              </motion.article>
            ))}
          </div>
        </section>
      </div>
    </ModuleFrame>
  );
}
