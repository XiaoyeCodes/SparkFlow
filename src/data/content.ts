import type { LucideIcon } from 'lucide-react';
import { BookOpenText, Bot, Boxes, ChartNoAxesCombined, Newspaper, Orbit, PenLine, Radar } from 'lucide-react';

export type Gateway = {
  title: string;
  path: string;
  eyebrow: string;
  Icon: LucideIcon;
  tone: 'blue' | 'green' | 'white' | 'silver' | 'warm';
};

export const gateways: Gateway[] = [
  { title: '今日新闻', path: '/signals', eyebrow: '08:30 LIVE', Icon: Newspaper, tone: 'blue' },
  { title: 'AI助手', path: '/assistant', eyebrow: 'ASSISTANT', Icon: Bot, tone: 'white' },
  { title: '星图情报', path: '/starmap', eyebrow: 'INTEL MAP', Icon: Radar, tone: 'blue' },
  { title: '星河航道', path: '/galaxy', eyebrow: 'GALAXY', Icon: Orbit, tone: 'silver' },
  { title: '股票ETF定投软件', path: '/trader', eyebrow: 'ETF CORE', Icon: ChartNoAxesCombined, tone: 'green' },
  { title: '推荐书籍', path: '/stack', eyebrow: 'READING', Icon: BookOpenText, tone: 'warm' },
  { title: '个人项目集', path: '/artifacts', eyebrow: 'SHIPPED', Icon: Boxes, tone: 'silver' },
  { title: '成长建议栏', path: '/logs', eyebrow: 'GROWTH', Icon: PenLine, tone: 'white' }
];

export const textFlowCorpus = [
  '夜色里有低亮度的新闻字符慢慢下沉，像一条安静的电流。',
  '市场在开盘前调整呼吸，净值曲线把风险和耐心同时折成线。',
  '写作是一种把噪声清洗成秩序的方式。',
  'SparkFlow keeps signals sparse, deliberate, and alive.',
  '从新闻到投资，从阅读到项目，每一条流都应该先经过判断，再进入行动。',
  'The interface disappears. The thinking remains visible.',
  'LUMENARY 把灵感、事实、资产与作品放进同一个冷静的流场。'
].join('   ');

export const signals = [
  ['08:30:12', 'AI infrastructure demand keeps cloud capex elevated across large platforms.'],
  ['08:37:44', 'Asia session liquidity stays thin while semiconductor names lead futures.'],
  ['08:51:09', 'Policy desks watch long-end yields after the latest inflation print.'],
  ['09:02:31', 'Energy complex softens as supply headlines outrun realized demand.'],
  ['09:20:58', 'ETF flows remain concentrated in broad-market and dividend strategies.']
];

export type BookVisual =
  | 'inequality'
  | 'capital'
  | 'justice'
  | 'history'
  | 'china'
  | 'rural'
  | 'game'
  | 'mind'
  | 'gene'
  | 'human'
  | 'poverty'
  | 'class'
  | 'macro'
  | 'crisis'
  | 'geopolitics'
  | 'cycle'
  | 'system'
  | 'wisdom'
  | 'finance'
  | 'design'
  | 'technology';

export type Book = {
  title: string;
  author: string;
  coverUrl?: string;
  visual: BookVisual;
  note: string;
  summary: string;
  why: string;
  keyIdeas: string[];
  readingPrompt: string;
};

export type BookCategory = {
  id: string;
  title: string;
  subtitle: string;
  books: Book[];
};

export const bookCategories: BookCategory[] = [
  {
    id: 'economics-inequality',
    title: '经济学与不平等',
    subtitle: '理解资本、贫困、分配与宏微观经济机制。',
    books: [
      {
        title: '经济学原理：微观经济学分册',
        author: 'N. Gregory Mankiw',
        coverUrl: 'https://covers.openlibrary.org/b/isbn/9787301312971-L.jpg',
        visual: 'macro',
        note: '用供需、激励、市场结构和福利分析搭建经济学入门骨架。',
        summary: '这本书适合作为经济学底层词典。它把消费者、企业、市场、价格和政策干预放在同一套分析框架里，让你先理解个体决策如何通过市场形成整体结果。',
        why: '它能补足很多社会经济类阅读的基础概念，否则看贫困、不平等和资本论时容易只接收结论，缺少推理工具。',
        keyIdeas: ['机会成本', '边际分析', '供给与需求', '市场失灵'],
        readingPrompt: '读每一章时都问：这个概念如何解释我身边真实发生的一次交易或选择？'
      },
      {
        title: '经济学原理：宏观经济学分册',
        author: 'N. Gregory Mankiw',
        coverUrl: 'https://covers.openlibrary.org/b/id/5063349-L.jpg',
        visual: 'macro',
        note: '理解 GDP、通胀、失业、货币、财政政策和经济周期。',
        summary: '宏观分册关注整体经济的运行方式：增长从哪里来，货币如何影响价格，政策为什么会有滞后和副作用。它适合和金融、国家账本、产业周期类书一起读。',
        why: '很多公共讨论都绕不开宏观变量。读懂它，可以更清楚地区分短期刺激、长期增长和结构性矛盾。',
        keyIdeas: ['经济增长', '通货膨胀', '货币政策', '财政政策'],
        readingPrompt: '把每个宏观指标都对应到一个普通人的收入、就业、资产价格或消费决策上。'
      },
      {
        title: '贫穷的本质',
        author: '阿比吉特·班纳吉 / 埃斯特·迪弗洛',
        coverUrl: 'https://covers.openlibrary.org/b/id/6765497-L.jpg',
        visual: 'poverty',
        note: '用实验经济学拆解贫穷如何被选择、制度、信息和环境共同塑造。',
        summary: '作者反对用抽象道德判断解释贫穷，而是走进教育、医疗、信贷和家庭决策的细节。贫困不是单一原因造成的，而是一连串小摩擦累积出的困境。',
        why: '它会让你更谨慎地理解“努力”“选择”和“机会”，也能训练你用证据检验政策直觉。',
        keyIdeas: ['随机对照实验', '贫困陷阱', '信息约束', '小额干预'],
        readingPrompt: '读完后试着解释：为什么一个看似理性的建议，对穷人未必可执行？'
      },
      {
        title: '21世纪资本论',
        author: '托马斯·皮凯蒂',
        coverUrl: 'https://covers.openlibrary.org/b/id/10103429-L.jpg',
        visual: 'capital',
        note: '用长期数据看资本收益、劳动收入和财富分配之间的结构性张力。',
        summary: '这本书把不平等放进几个世纪的数据里观察，核心问题是资本收益率长期高于经济增长率时，财富会如何集中。',
        why: '它提供了理解现代社会阶层固化、资产价格和税制争论的一个重要入口。',
        keyIdeas: ['r > g', '财富集中', '继承资本', '累进税'],
        readingPrompt: '不要只记公式，重点看资产收益和劳动收入为什么会产生不同速度。'
      },
      {
        title: '世界不平等报告',
        author: 'World Inequality Lab',
        visual: 'inequality',
        note: '用全球数据比较收入、财富和碳排放分配的不平等结构。',
        summary: '报告型读物的价值在于把国家、阶层和时间维度放在一起比较。它让不平等从感受变成可追踪的指标。',
        why: '适合补充《21世纪资本论》的全球视角，帮助你理解不同国家的分配结构并不相同。',
        keyIdeas: ['收入分布', '财富分布', '全球比较', '碳不平等'],
        readingPrompt: '看图表时先问：这个差距来自收入、资产、税制，还是历史积累？'
      },
      {
        title: '不平等的代价',
        author: '约瑟夫·斯蒂格利茨',
        coverUrl: 'https://covers.openlibrary.org/b/id/9328023-L.jpg',
        visual: 'inequality',
        note: '理解不平等如何通过政治、金融和制度设计自我强化。',
        summary: '斯蒂格利茨把不平等视为制度问题，而不只是市场自然结果。他关注垄断、寻租、金融化和政治影响如何放大分配差距。',
        why: '它能把抽象的不平等讨论拉回制度设计：规则是谁制定的，又服务于谁。',
        keyIdeas: ['寻租', '市场权力', '制度扭曲', '民主质量'],
        readingPrompt: '读的时候区分：哪些不平等来自能力差异，哪些来自规则偏置？'
      }
    ]
  },
  {
    id: 'justice-society',
    title: '社会学、阶层与正义',
    subtitle: '理解家庭、乡土、阶级经验和全球正义问题。',
    books: [
      {
        title: '乡土中国',
        author: '费孝通',
        coverUrl: 'https://covers.openlibrary.org/b/id/15230847-L.jpg',
        visual: 'rural',
        note: '从差序格局、礼治秩序和乡土社会理解中国基层结构。',
        summary: '这本小书解释了很多中国社会的人情、关系、面子和秩序逻辑。它不是怀旧，而是在观察一种社会结构如何塑造人的行为。',
        why: '读懂它，很多看似个人性格的问题，会变成社会结构和关系网络的问题。',
        keyIdeas: ['差序格局', '礼治秩序', '熟人社会', '长老统治'],
        readingPrompt: '把书里的概念对照自己的家庭、村镇、职场关系，看看哪些仍在运作。'
      },
      {
        title: '我依稀记得',
        author: 'Didier Eribon',
        coverUrl: 'https://covers.openlibrary.org/b/id/7569903-L.jpg',
        visual: 'class',
        note: '从个人回忆进入阶级、身份、羞耻感和政治转向。',
        summary: '《Retour à Reims》不是普通回忆录，而是通过回到故乡这件事，重新审视阶级出身如何塑造人的语言、选择、羞耻和政治立场。',
        why: '它适合用来理解“个人奋斗”背后那些不容易被说出口的阶层经验。',
        keyIdeas: ['阶级再生产', '身份认同', '羞耻感', '政治转向'],
        readingPrompt: '读的时候问：哪些我以为是个人选择的东西，其实来自出身结构？'
      },
      {
        title: '全球正义报告',
        author: '全球正义研究相关报告',
        visual: 'justice',
        note: '从全球制度、资源分配和人类发展角度观察正义问题。',
        summary: '报告型文本适合作为问题地图：不同国家和群体在发展机会、资源、权利和风险承担上的差异，如何构成全球尺度的不公。',
        why: '它能把正义问题从道德口号推进到指标、制度和行动方案。',
        keyIdeas: ['全球分配', '发展机会', '制度责任', '公共品'],
        readingPrompt: '读报告时重点看指标定义：它把“正义”具体量化成了什么？'
      }
    ]
  },
  {
    id: 'history-china',
    title: '历史与中国叙事',
    subtitle: '从制度、人物、财政和时代转折理解中国历史。',
    books: [
      {
        title: '万历十五年',
        author: '黄仁宇',
        coverUrl: 'https://covers.openlibrary.org/b/isbn/9787108009821-L.jpg',
        visual: 'history',
        note: '用一个年份切开明代制度、财政、官僚与人物命运。',
        summary: '黄仁宇写的不是热闹的历史事件，而是一个庞大制度如何在日常运转中暴露疲态。万历皇帝、张居正、海瑞等人物都像制度压力下的剖面。',
        why: '它训练你从制度细节看历史，而不是只看英雄、宫斗和战争。',
        keyIdeas: ['大历史观', '财政制度', '官僚体系', '道德与技术'],
        readingPrompt: '读人物时不要急着评价好坏，先看他们被什么制度约束。'
      },
      {
        title: '明朝那些事',
        author: '当年明月',
        visual: 'history',
        note: '以通俗叙事进入明代政治、战争、人物和王朝兴衰。',
        summary: '它的优势是可读性强，能把明代长时段历史串成连续故事。适合作为进入明史的第一层地图。',
        why: '先建立时间线和人物关系，再读更专业的制度史，会轻松很多。',
        keyIdeas: ['王朝兴衰', '人物群像', '政治斗争', '历史叙事'],
        readingPrompt: '把它当作地图，而不是最终解释；读完再追问背后的制度原因。'
      },
      {
        title: '置身事内',
        author: '兰小欢',
        visual: 'china',
        note: '从地方政府、土地财政和城市化机制理解中国经济运行的真实肌理。',
        summary: '这本书把中国经济放进地方政府行为和财政激励中理解，解释了城市化、债务、招商、土地和产业政策之间的连接。',
        why: '它能把宏观新闻和身边城市变化连起来，是理解中国现实的一本高性价比入口。',
        keyIdeas: ['地方政府', '土地财政', '城市化', '产业政策'],
        readingPrompt: '观察你所在城市：哪些变化能用书里的地方政府激励解释？'
      },
      {
        title: '八次危机',
        author: '温铁军',
        visual: 'crisis',
        note: '从多次经济波动中理解国家如何吸收危机、转移成本和重建秩序。',
        summary: '这本书提供了一个从国家能力、农村、工业化和外部冲击看中国经济周期的角度。',
        why: '它适合和《置身事内》互相参照：一个看地方财政，一个看长期危机吸收机制。',
        keyIdeas: ['危机转嫁', '国家能力', '三农问题', '工业化'],
        readingPrompt: '读每次危机时问：成本最终由谁承担，又通过什么机制被吸收？'
      }
    ]
  },
  {
    id: 'cognition-decision',
    title: '认知、博弈与决策',
    subtitle: '训练判断、策略、偏误识别和长期理性。',
    books: [
      {
        title: '思考，快与慢',
        author: 'Daniel Kahneman',
        coverUrl: 'https://covers.openlibrary.org/b/id/13290711-L.jpg',
        visual: 'mind',
        note: '理解系统一与系统二，以及人类判断中稳定存在的认知偏误。',
        summary: '卡尼曼把直觉和理性拆成两个系统，展示人在风险、概率、损失和判断中如何反复犯错。',
        why: '它是训练自我校准的基础读物，让你对“我觉得”保持距离。',
        keyIdeas: ['系统一', '系统二', '损失厌恶', '锚定效应'],
        readingPrompt: '每读一个偏误，就找一个自己最近犯过的真实例子。'
      },
      {
        title: '纳什博弈论与经济学',
        author: '相关博弈论读本',
        coverUrl: 'https://covers.openlibrary.org/b/id/3979917-L.jpg',
        visual: 'game',
        note: '从策略互动、均衡和激励兼容理解人与组织的选择。',
        summary: '博弈论关心的不是单个人如何最优，而是多个参与者互相预判时，结果如何形成。',
        why: '它能解释谈判、竞争、合作、价格战和制度设计中的许多反直觉结果。',
        keyIdeas: ['纳什均衡', '囚徒困境', '策略互动', '激励兼容'],
        readingPrompt: '遇到冲突时画出参与者、收益和可选策略，再判断均衡在哪里。'
      },
      {
        title: '穷查理宝典',
        author: '查理·芒格',
        coverUrl: 'https://covers.openlibrary.org/b/id/8337563-L.jpg',
        visual: 'wisdom',
        note: '建立跨学科多元思维模型，训练长期理性和机会成本意识。',
        summary: '芒格强调用多个学科的模型共同看世界，避免单一工具带来的盲区。',
        why: '它适合做长期复读书，每次读都能和新的经验连接起来。',
        keyIdeas: ['多元思维模型', '逆向思维', '机会成本', '能力圈'],
        readingPrompt: '读完一章就写下：这个模型能解释我哪一个错误判断？'
      },
      {
        title: '纳瓦尔宝典',
        author: 'Eric Jorgenson / Naval Ravikant',
        visual: 'wisdom',
        note: '从财富、判断、杠杆、幸福和长期主义理解个人成长的底层策略。',
        summary: '《纳瓦尔宝典》整理了 Naval Ravikant 关于财富创造、个人判断、长期复利和幸福的公开表达。它不是传统商业书，而是一组高度压缩的人生操作原则：用专长、责任、杠杆和长期关系创造复利。',
        why: '它适合作为个人成长和财富观的桥梁读物，能帮助你区分赚钱、致富、自由和幸福这几个常被混在一起的概念。',
        keyIdeas: ['专长', '杠杆', '长期主义', '判断力'],
        readingPrompt: '读的时候问：我现在积累的是可复利的专长，还是只能出售时间的技能？'
      }
    ]
  },
  {
    id: 'evolution-civilization',
    title: '演化、人类与文明',
    subtitle: '从基因、地理和文明叙事理解人类社会的深层路径。',
    books: [
      {
        title: '自私的基因',
        author: 'Richard Dawkins',
        coverUrl: 'https://covers.openlibrary.org/b/id/133936-L.jpg',
        visual: 'gene',
        note: '从基因视角理解演化、利他、竞争和复制策略。',
        summary: '这本书把演化的视角从个体转向基因，解释很多行为为何能在自然选择中保留下来。',
        why: '它会改变你理解人性、合作和竞争的底层视角。',
        keyIdeas: ['基因选择', '复制子', '亲缘选择', '演化稳定策略'],
        readingPrompt: '读的时候警惕误解：自私的是基因模型，不等于人必须自私。'
      },
      {
        title: '人类简史',
        author: 'Yuval Noah Harari',
        coverUrl: 'https://covers.openlibrary.org/b/id/8634250-L.jpg',
        visual: 'human',
        note: '用大历史方式理解认知革命、农业革命、帝国、资本与科技。',
        summary: '这本书用很强的叙事能力把人类历史压缩成几次重大跃迁，尤其强调共同想象如何组织大规模合作。',
        why: '它适合建立大图景，但也要带着批判意识读，区分叙事力量和学术确定性。',
        keyIdeas: ['认知革命', '虚构秩序', '农业革命', '大规模合作'],
        readingPrompt: '读每个宏大判断时都问：它的证据是什么，哪些地方可能过度概括？'
      },
      {
        title: '枪炮、病菌与钢铁',
        author: 'Jared Diamond',
        coverUrl: 'https://covers.openlibrary.org/b/id/7884018-L.jpg',
        visual: 'human',
        note: '从地理、生态和技术扩散解释文明分化，反思单一英雄史观。',
        summary: '戴蒙德把文明差异放在大陆轴线、作物、动物、疾病和技术扩散这些环境因素里解释。',
        why: '它能帮你从结构条件看历史差异，而不是简单归因于民族性格。',
        keyIdeas: ['地理决定因素', '驯化', '疾病免疫', '技术扩散'],
        readingPrompt: '读完后比较它和《人类简史》：一个偏环境结构，一个偏叙事组织。'
      }
    ]
  },
  {
    id: 'politics-world',
    title: '政治经济与国际秩序',
    subtitle: '理解国家竞争、金融危机、周期与战略秩序。',
    books: [
      {
        title: '大国政治的悲剧',
        author: 'John Mearsheimer',
        coverUrl: 'https://covers.openlibrary.org/b/id/246652-L.jpg',
        visual: 'geopolitics',
        note: '从进攻性现实主义理解大国竞争、安全困境与国际秩序的不稳定。',
        summary: '米尔斯海默的核心是：在无政府国际体系中，大国会追求安全和权力，冲突不是偶然偏差，而是结构性结果。',
        why: '它能提供一种冷峻的国际政治框架，也需要和其他理论互相校正。',
        keyIdeas: ['现实主义', '安全困境', '权力最大化', '大国竞争'],
        readingPrompt: '读的时候问：这个理论解释力强在哪里，又忽略了哪些合作机制？'
      },
      {
        title: '论中国',
        author: 'Henry Kissinger',
        coverUrl: 'https://covers.openlibrary.org/b/id/7911685-L.jpg',
        visual: 'geopolitics',
        note: '从战略文化和外交史角度理解中国的秩序观与长期博弈。',
        summary: '基辛格用外交家的视角解读中国历史中的秩序、边界、谈判和战略耐心。',
        why: '它适合补充国际关系中的中国视角，尤其是长期战略和文明叙事。',
        keyIdeas: ['战略文化', '外交史', '秩序观', '长期博弈'],
        readingPrompt: '把它和《大国政治的悲剧》对读：一个看体系压力，一个看历史文化。'
      },
      {
        title: '大周期',
        author: 'Ray Dalio',
        visual: 'cycle',
        note: '用债务、货币、地缘和内部秩序理解国家兴衰与时代周期。',
        summary: '达利欧把帝国兴衰拆成债务周期、内部冲突、外部竞争、储备货币和生产力等变量。',
        why: '它适合作为观察宏观变化的周期框架，但不要把周期当成机械预言。',
        keyIdeas: ['长期债务周期', '储备货币', '内部秩序', '帝国兴衰'],
        readingPrompt: '把每个周期变量对应到当下新闻，判断它是早期信号还是噪声。'
      },
      {
        title: '大空头',
        author: 'Michael Lewis',
        coverUrl: 'https://covers.openlibrary.org/b/id/6386926-L.jpg',
        visual: 'finance',
        note: '通过次贷危机理解金融杠杆、结构性风险和市场共识的脆弱性。',
        summary: '这本书用人物故事讲清楚复杂金融产品如何把风险包装、转移并放大。',
        why: '它提醒你：市场共识可能只是集体盲点，复杂产品也可能隐藏简单危险。',
        keyIdeas: ['次贷危机', 'CDO', '杠杆', '反共识交易'],
        readingPrompt: '读故事时标注：每个人的激励是什么，为什么风险会被忽视？'
      }
    ]
  },
  {
    id: 'systems-technology',
    title: '系统、组织与技术延伸',
    subtitle: '理解复杂系统、学习型组织、数据系统和设计模式。',
    books: [
      {
        title: '第五项修炼',
        author: 'Peter Senge',
        coverUrl: 'https://covers.openlibrary.org/b/id/5306808-L.jpg',
        visual: 'system',
        note: '用系统思考、心智模式和学习型组织理解复杂系统中的反馈回路。',
        summary: '圣吉把组织问题放进系统反馈中理解，强调很多管理困境来自延迟、局部最优和心智模式。',
        why: '它适合和你的系统思维卡片互相呼应，把抽象模型落到组织实践。',
        keyIdeas: ['系统思考', '心智模式', '共同愿景', '学习型组织'],
        readingPrompt: '选一个反复出现的问题，画出增强回路和调节回路。'
      },
      {
        title: 'Designing Data-Intensive Applications',
        author: 'Martin Kleppmann',
        coverUrl: 'https://covers.openlibrary.org/b/id/8434671-L.jpg',
        visual: 'technology',
        note: '理解现代数据系统的可靠性、扩展性与一致性。',
        summary: '这本书把数据库、流处理、分布式系统和一致性问题讲成一套工程判断框架。',
        why: '如果你做软件或 AI 工具，它能提升你对系统边界和可靠性的判断。',
        keyIdeas: ['可靠性', '可扩展性', '一致性', '数据流'],
        readingPrompt: '读每个技术概念时问：它牺牲了什么，换来了什么？'
      },
      {
        title: 'A Pattern Language',
        author: 'Christopher Alexander',
        coverUrl: 'https://covers.openlibrary.org/b/id/120825-L.jpg',
        visual: 'design',
        note: '用模式语言观察空间、设计和人的真实使用方式。',
        summary: '亚历山大关注的不是风格，而是人如何在空间里生活。模式是一种可复用但不僵化的设计知识。',
        why: '它对做产品、页面和生活空间都有启发：好设计应该从真实行为长出来。',
        keyIdeas: ['模式语言', '空间秩序', '人的尺度', '生成式设计'],
        readingPrompt: '找一个你喜欢的空间，试着提炼它背后的模式。'
      },
      {
        title: 'The Beginning of Infinity',
        author: 'David Deutsch',
        coverUrl: 'https://covers.openlibrary.org/b/id/8622269-L.jpg',
        visual: 'wisdom',
        note: '用解释、知识增长和可纠错性理解人类进步。',
        summary: 'Deutsch 把进步理解为好解释不断被提出、批判和改进的过程。',
        why: '它适合作为认知和科学精神的高阶延伸，提醒你知识不是记忆，而是可改进的解释。',
        keyIdeas: ['好解释', '可纠错性', '知识增长', '无限进步'],
        readingPrompt: '遇到一个解释时问：它是否难以变化，同时能解释更多事实？'
      },
      {
        title: '原则',
        author: 'Ray Dalio',
        visual: 'system',
        note: '把个人经验沉淀成可复用原则，用透明、反馈和决策流程管理人生与组织。',
        summary: '《原则》是达里欧把自己在生活和桥水基金管理中的经验提炼成决策系统的书。它强调现实主义、极度透明、可信度加权决策和从错误中构建流程。',
        why: '它能帮助你把“我觉得”变成“我依据什么原则判断”，适合用于个人复盘、团队协作和长期目标管理。',
        keyIdeas: ['原则化决策', '极度透明', '可信度加权', '复盘系统'],
        readingPrompt: '读完后试着写下自己的三条原则：遇到冲突、选择和失败时，你打算如何行动？'
      }
    ]
  }
];

export const books: Book[] = bookCategories.flatMap((category) => category.books);

export const projects = [
  ['Signal Desk', '实时新闻过滤与行动队列'],
  ['Flow Trader', 'ETF定投与净值边界排版'],
  ['Reading Stack', '书籍、摘录与复读系统'],
  ['Artifact Wall', '作品集与发布记录']
];

export const logEntries = [
  '真正的个人主页不是简历，也不是社交名片。它更像一个安静的控制台：只让必要的信号浮上来。',
  '设计里最难的克制，是知道哪些东西明明能做，却不该在第一屏做。',
  '当文本、行情和作品都变成流，界面的任务就是把流速调到适合判断。'
];
