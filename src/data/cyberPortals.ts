export type CyberPortalIcon =
  | 'globe'
  | 'radar'
  | 'weather'
  | 'market'
  | 'brief'
  | 'trends'
  | 'flight'
  | 'ship'
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
    id: 'trending-intelligence',
    index: '01',
    title: '热点情报',
    englishTitle: 'TRENDING INTELLIGENCE',
    description: '全网热点、AI 动态与每日全球市场晨报',
    accent: '#35f2ff',
    accentRgb: '53, 242, 255',
    portals: [
      {
        id: 'tophub',
        title: '全网热榜雷达',
        englishTitle: 'TRENDING RADAR',
        description: '聚合多个中文平台热榜，快速判断公众议题与传播热度。',
        url: 'https://newsnow.busiyi.world/c/hottest',
        domain: 'newsnow.busiyi.world',
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
      },
      {
        id: 'day1-global',
        title: 'Day1 全球晨报',
        englishTitle: 'DAILY MARKET BRIEF',
        description: '快速浏览美股、加密市场与当天关键投资情报。',
        url: 'https://brief.day1global.xyz/',
        domain: 'brief.day1global.xyz',
        icon: 'brief',
        variant: 'pulse'
      }
    ]
  },
  {
    id: 'finance-markets',
    index: '02',
    title: '财经与市场',
    englishTitle: 'FINANCE & MARKETS',
    description: '财经报道、市场热力与跨资产长期趋势',
    accent: '#eaff4f',
    accentRgb: '234, 255, 79',
    portals: [
      {
        id: 'wsj-chinese',
        title: '华尔街日报 · 中文网',
        englishTitle: 'THE WALL STREET JOURNAL',
        description: '阅读全球商业、经济、金融与国际事件的中文报道。',
        url: 'https://cn.wsj.com/',
        domain: 'cn.wsj.com',
        icon: 'brief',
        variant: 'grid'
      },
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
    id: 'valuation-sentiment',
    index: '03',
    title: '估值与情绪',
    englishTitle: 'VALUATION & SENTIMENT',
    description: '美股历史估值、市场情绪与综合估值模型',
    accent: '#ff8f70',
    accentRgb: '255, 143, 112',
    portals: [
      {
        id: 'multpl-market-data',
        title: 'Multpl · 美股估值',
        englishTitle: 'US MARKET VALUATION',
        description: '查阅标普 500 市盈率、席勒市盈率、股息率与美债利率历史。',
        url: 'https://www.multpl.com/',
        domain: 'multpl.com',
        icon: 'valuation',
        variant: 'orbit'
      },
      {
        id: 'cnn-fear-greed',
        title: 'CNN 恐惧与贪婪',
        englishTitle: 'FEAR & GREED INDEX',
        description: '通过市场动量、波动率、避险需求等指标观察投资者情绪。',
        url: 'https://edition.cnn.com/markets/fear-and-greed',
        domain: 'edition.cnn.com',
        icon: 'temperature',
        variant: 'pulse'
      },
      {
        id: 'current-market-valuation',
        title: '美国市场估值模型',
        englishTitle: 'CURRENT MARKET VALUATION',
        description: '汇总估值、衰退和市场情绪模型，观察美股所处历史区间。',
        url: 'https://currentmarketvaluation.com/',
        domain: 'currentmarketvaluation.com',
        icon: 'trends',
        variant: 'grid'
      }
    ]
  },
  {
    id: 'investment-data',
    index: '04',
    title: '投资与数据',
    englishTitle: 'INVESTMENT & DATA',
    description: '投资者专栏、市场温度与官方宏观数据',
    accent: '#ffb454',
    accentRgb: '255, 180, 84',
    portals: [
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
        id: 'national-statistics',
        title: '国家统计局 · 数据',
        englishTitle: 'CHINA OFFICIAL STATISTICS',
        description: '查询官方统计数据、经济运行发布、统计年鉴与指标解读。',
        url: 'https://www.stats.gov.cn/sj/',
        domain: 'stats.gov.cn',
        icon: 'statistics',
        variant: 'pulse'
      }
    ]
  },
  {
    id: 'geopolitical-awareness',
    index: '05',
    title: '地缘态势',
    englishTitle: 'GEOPOLITICAL AWARENESS',
    description: '全球冲突事件、军事动态与开放来源情报',
    accent: '#ff3bbd',
    accentRgb: '255, 59, 189',
    portals: [
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
        id: 'iran-liveuamap',
        title: '伊朗局势地图',
        englishTitle: 'IRAN SITUATION MAP',
        description: '追踪伊朗及周边地区的冲突事件、军事动态与开放来源情报。',
        url: 'https://iran.liveuamap.com/',
        domain: 'iran.liveuamap.com',
        icon: 'radar',
        variant: 'orbit'
      }
    ]
  },
  {
    id: 'global-tracking',
    index: '06',
    title: '全球追踪',
    englishTitle: 'GLOBAL TRACKING',
    description: '卫星气象、航空交通与全球海运动态',
    accent: '#a99aff',
    accentRgb: '169, 154, 255',
    portals: [
      {
        id: 'zoom-earth',
        title: '全球卫星气象',
        englishTitle: 'SATELLITE WEATHER',
        description: '查看实时卫星云图、降雨雷达、风场与极端天气轨迹。',
        url: 'https://zoom.earth/',
        domain: 'zoom.earth',
        icon: 'weather',
        variant: 'orbit'
      },
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
        id: 'marine-traffic',
        title: '全球船舶雷达',
        englishTitle: 'LIVE MARINE TRAFFIC',
        description: '查看全球船舶位置、航线、港口流量与海运活动。',
        url: 'https://www.marinetraffic.com/',
        domain: 'marinetraffic.com',
        icon: 'ship',
        variant: 'grid'
      }
    ]
  },
  {
    id: 'earth-space',
    index: '07',
    title: '地球与太空',
    englishTitle: 'EARTH & SPACE',
    description: '探索数字地球、太空视角与实时太阳系模型',
    accent: '#6fd9ff',
    accentRgb: '111, 217, 255',
    portals: [
      {
        id: 'google-earth',
        title: 'Google Earth',
        englishTitle: 'EXPLORE THE EARTH',
        description: '通过卫星影像、三维地形和街景探索全球各地。',
        url: 'https://earth.google.com/web/',
        domain: 'earth.google.com',
        icon: 'globe',
        variant: 'grid'
      },
      {
        id: 'sen-earth-live',
        title: 'Sen · 地球直播',
        englishTitle: 'EARTH LIVE FROM SPACE',
        description: '从太空视角观看实时地球影像与轨道直播内容。',
        url: 'https://www.sen.com/',
        domain: 'sen.com',
        icon: 'weather',
        variant: 'pulse'
      },
      {
        id: 'solar-system-scope',
        title: '太阳系实时模型',
        englishTitle: 'SOLAR SYSTEM SCOPE',
        description: '交互探索太阳系、夜空和天体的实时位置与运行轨迹。',
        url: 'https://www.solarsystemscope.com/',
        domain: 'solarsystemscope.com',
        icon: 'trends',
        variant: 'orbit'
      }
    ]
  }
];
