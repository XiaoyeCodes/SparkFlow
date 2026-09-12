export type CyberPortalIcon =
  | 'globe'
  | 'radar'
  | 'weather'
  | 'market'
  | 'brief'
  | 'trends'
  | 'flight'
  | 'hot'
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
    id: 'market-research',
    index: '02',
    title: '市场研究',
    englishTitle: 'MARKET RESEARCH',
    description: '横截面热度、每日简报与长期资产趋势',
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
    id: 'live-intelligence',
    index: '03',
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
