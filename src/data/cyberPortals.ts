export type CyberPortalIcon =
  | 'globe'
  | 'radar'
  | 'weather'
  | 'market'
  | 'brief'
  | 'trends'
  | 'flight'
  | 'hot'
  | 'temperature'
  | 'valuation'
  | 'statistics'
  | 'column'
  | 'ai';

export type CyberPortalVariant = 'grid' | 'orbit' | 'pulse';

export type CyberPortal = {
  id: string;
  title: string;
  englishTitle: string;
  description: string;
  url: string;
  domain: string;
  icon: CyberPortalIcon;
  variant: CyberPortalVariant;
};

export type CyberPortalGroup = {
  id: string;
  index: string;
  title: string;
  englishTitle: string;
  description: string;
  accent: string;
  accentRgb: string;
  portals: CyberPortal[];
};

export const cyberPortalGroups: CyberPortalGroup[] = [
  {
    id: 'global-awareness',
    index: '01',
    title: '全球态势',
    englishTitle: 'GLOBAL AWARENESS',
    description: '地缘冲突、基础设施与自然环境的全球视角',
    accent: '#ff3bbd',
    accentRgb: '255, 59, 189',
    portals: [
      {
        id: 'global-situation-monitor',
        title: '全球态势监控',
        englishTitle: 'SITUATION MONITOR',
        description: '聚合冲突、制裁、军事基地、航道、天气与基础设施信号。',
        url: 'https://monitor.goodthoughts.in/?lat=20.0000&lon=0.0000&zoom=1.00&view=global&timeRange=7d&layers=conflicts%2Cbases%2Chotspots%2Cnuclear%2Csanctions%2Cweather%2Ceconomic%2Cwaterways%2Coutages%2Cmilitary%2Cnatural%2CiranAttacks',
        domain: 'monitor.goodthoughts.in',
        icon: 'globe',
        variant: 'grid'
      },
      {
        id: 'crucix-terminal',
        title: 'CRUCIX 情报终端',
        englishTitle: 'INTELLIGENCE TERMINAL',
        description: '以交互式世界地图追踪开放来源事件与全球风险信号。',
        url: 'https://www.crucix.live/',
        domain: 'crucix.live',
        icon: 'radar',
        variant: 'pulse'
      },
      {
        id: 'zoom-earth',
        title: '全球卫星气象',
        englishTitle: 'SATELLITE WEATHER',
        description: '查看实时卫星云图、降雨雷达、风场与极端天气轨迹。',
        url: 'https://zoom.earth/',
        domain: 'zoom.earth',
        icon: 'weather',
        variant: 'orbit'
      }
    ]
  },
  {
    id: 'valuation-observation',
    index: '02',
    title: '估值观察',
    englishTitle: 'VALUATION OBSERVATORY',
    description: '全市场温度、指数估值与美股历史估值数据',
    accent: '#ffb454',
    accentRgb: '255, 180, 84',
    portals: [
      {
        id: 'youzhiyouxing-market',
        title: '有知有行 · 市场温度',
        englishTitle: 'MARKET TEMPERATURE',
        description: '观察全市场历史温度、不同温带的回测表现与股市回报来源。',
        url: 'https://youzhiyouxing.cn/data/market',
        domain: 'youzhiyouxing.cn',
        icon: 'temperature',
        variant: 'pulse'
      },
      {
        id: 'qieman-index-valuation',
        title: '且慢 · 指数估值',
        englishTitle: 'INDEX VALUATION',
        description: '查看指数估值数据，为指数基金研究与长期投资提供参考。',
        url: 'https://qieman.com/idx-eval',
        domain: 'qieman.com',
        icon: 'valuation',
        variant: 'grid'
      },
      {
        id: 'multpl-market-data',
        title: 'Multpl · 美股估值',
        englishTitle: 'US VALUATION HISTORY',
        description: '查阅标普 500 市盈率、席勒市盈率、股息率与美债利率历史。',
        url: 'https://www.multpl.com/',
        domain: 'multpl.com',
        icon: 'trends',
        variant: 'orbit'
      }
    ]
  },
  {
    id: 'market-research',
    index: '03',
    title: '宏观与市场',
    englishTitle: 'MACRO & MARKETS',
    description: '官方经济统计、市场热度与跨资产长期趋势',
    accent: '#eaff4f',
    accentRgb: '234, 255, 79',
    portals: [
      {
        id: 'nasdaq-100-heatmap',
        title: '纳指 100 热力图',
        englishTitle: 'NASDAQ 100 HEATMAP',
        description: '按市值与涨跌幅观察纳斯达克 100 成分股的实时市场温度。',
        url: 'https://www.tradingview.com/heatmap/stock/#%7B%22dataSource%22%3A%22NASDAQ100%22%2C%22blockColor%22%3A%22change%22%2C%22blockSize%22%3A%22market_cap_basic%22%2C%22grouping%22%3A%22no_group%22%7D',
        domain: 'tradingview.com',
        icon: 'market',
        variant: 'grid'
      },
      {
        id: 'national-statistics',
        title: '国家统计局 · 数据',
        englishTitle: 'CHINA OFFICIAL STATISTICS',
        description: '查询官方统计数据、经济运行发布、统计年鉴与指标解读。',
        url: 'https://www.stats.gov.cn/sj/',
        domain: 'stats.gov.cn',
        icon: 'statistics',
        variant: 'pulse'
      },
      {
        id: 'longterm-trends',
        title: '长期趋势图谱',
        englishTitle: 'LONG-TERM TRENDS',
        description: '用跨资产历史图表研究股票、债券、黄金与宏观周期。',
        url: 'https://www.longtermtrends.com/',
        domain: 'longtermtrends.com',
        icon: 'trends',
        variant: 'orbit'
      }
    ]
  },
  {
    id: 'financial-reading',
    index: '04',
    title: '财经阅读',
    englishTitle: 'FINANCIAL READING',
    description: '每日投资简报、投资者专栏与全球财经报道',
    accent: '#a99aff',
    accentRgb: '169, 154, 255',
    portals: [
      {
        id: 'day1-global',
        title: 'Day1 全球晨报',
        englishTitle: 'DAILY MARKET BRIEF',
        description: '快速浏览美股、加密市场与当天关键投资情报。',
        url: 'https://brief.day1global.xyz/',
        domain: 'brief.day1global.xyz',
        icon: 'brief',
        variant: 'pulse'
      },
      {
        id: 'xueqiu-bank-screw-column',
        title: '银行螺丝钉 · 雪球专栏',
        englishTitle: 'INVESTOR COLUMN',
        description: '阅读银行螺丝钉在雪球发布的专栏文章与投资观点。',
        url: 'https://xueqiu.com/3079173340/column',
        domain: 'xueqiu.com',
        icon: 'column',
        variant: 'orbit'
      },
      {
        id: 'wsj-chinese',
        title: '华尔街日报 · 中文网',
        englishTitle: 'THE WALL STREET JOURNAL',
        description: '阅读全球商业、经济、金融与国际事件的中文报道。',
        url: 'https://cn.wsj.com/',
        domain: 'cn.wsj.com',
        icon: 'brief',
        variant: 'grid'
      }
    ]
  },
  {
    id: 'live-intelligence',
    index: '05',
    title: '实时情报',
    englishTitle: 'LIVE INTELLIGENCE',
    description: '交通活动、公共议题与 AI 产业的实时脉冲',
    accent: '#35f2ff',
    accentRgb: '53, 242, 255',
    portals: [
      {
        id: 'flightradar24',
        title: '全球航班雷达',
        englishTitle: 'LIVE FLIGHT RADAR',
        description: '追踪全球民航位置、航线、速度、高度与机场运行状态。',
        url: 'https://www.flightradar24.com/31.09,121.00/9',
        domain: 'flightradar24.com',
        icon: 'flight',
        variant: 'orbit'
      },
      {
        id: 'tophub',
        title: '全网热榜雷达',
        englishTitle: 'TRENDING RADAR',
        description: '聚合多个中文平台热榜，快速判断公众议题与传播热度。',
        url: 'https://tophub.today/',
        domain: 'tophub.today',
        icon: 'hot',
        variant: 'pulse'
      },
      {
        id: 'aihot',
        title: 'AI 热点情报',
        englishTitle: 'AI SIGNAL FEED',
        description: '追踪 AI 领域热点事件、热度变化与多来源时间线。',
        url: 'https://aihot.news/?page=1',
        domain: 'aihot.news',
        icon: 'ai',
        variant: 'grid'
      }
    ]
  }
];
