import type { InfiniteMenuItem } from '../components/InfiniteMenu';

function makeCover(title: string, subtitle: string, accent: string, pattern: 'grid' | 'radar' | 'weather' | 'flight' | 'ship' | 'orbit' | 'news' | 'ai') {
  const encoded = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 900">
      <defs>
        <radialGradient id="g" cx="50%" cy="38%" r="62%">
          <stop offset="0%" stop-color="${accent}" stop-opacity="0.82"/>
          <stop offset="42%" stop-color="${accent}" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="#020304" stop-opacity="1"/>
        </radialGradient>
        <linearGradient id="line" x1="0" x2="1">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0"/>
          <stop offset="50%" stop-color="#ffffff" stop-opacity="0.62"/>
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="900" height="900" fill="#030406"/>
      <rect width="900" height="900" fill="url(#g)"/>
      ${pattern === 'grid' ? '<g opacity="0.45">' + Array.from({ length: 10 }, (_, i) => `<path d="M${90 + i * 80} 110V790M110 ${90 + i * 80}H790" stroke="${accent}" stroke-width="2"/>`).join('') + '</g>' : ''}
      ${pattern === 'radar' ? '<g fill="none" stroke="' + accent + '" stroke-width="3" opacity="0.55"><circle cx="450" cy="450" r="92"/><circle cx="450" cy="450" r="184"/><circle cx="450" cy="450" r="276"/><path d="M450 450 690 310"/></g>' : ''}
      ${pattern === 'weather' ? '<g fill="none" stroke="' + accent + '" stroke-width="12" opacity="0.58"><path d="M230 520c42-86 122-128 240-126 98 2 168-42 210-132"/><path d="M180 610c112-62 218-82 318-60 82 18 154 10 222-24"/></g>' : ''}
      ${pattern === 'flight' ? '<g fill="none" stroke="' + accent + '" stroke-width="5" opacity="0.62"><path d="M160 610C310 338 520 240 750 168"/><path d="M272 548l-72-34M580 278l-34-80"/></g>' : ''}
      ${pattern === 'ship' ? '<g fill="none" stroke="' + accent + '" stroke-width="6" opacity="0.55"><path d="M170 590c122 38 232 38 330 0s180-38 246 0"/><path d="M250 472h360l-74 92H316z"/></g>' : ''}
      ${pattern === 'orbit' ? '<g fill="none" stroke="' + accent + '" stroke-width="4" opacity="0.58"><ellipse cx="450" cy="450" rx="308" ry="126" transform="rotate(-18 450 450)"/><ellipse cx="450" cy="450" rx="236" ry="88" transform="rotate(34 450 450)"/><circle cx="450" cy="450" r="52" fill="' + accent + '" fill-opacity="0.28"/></g>' : ''}
      ${pattern === 'news' ? '<g fill="' + accent + '" opacity="0.58">' + Array.from({ length: 7 }, (_, i) => `<rect x="210" y="${260 + i * 54}" width="${420 + (i % 2) * 110}" height="14" rx="7"/>`).join('') + '</g>' : ''}
      ${pattern === 'ai' ? '<g fill="none" stroke="' + accent + '" stroke-width="4" opacity="0.62"><path d="M286 450c0-92 72-164 164-164s164 72 164 164-72 164-164 164-164-72-164-164z"/><path d="M344 450h212M450 344v212M372 372l156 156M528 372 372 528"/></g>' : ''}
      <path d="M120 700H780" stroke="url(#line)" stroke-width="2"/>
      <text x="120" y="728" fill="#f8fbff" font-family="Inter,Arial,sans-serif" font-size="58" font-weight="800">${title}</text>
      <text x="120" y="782" fill="#c9d7e6" font-family="JetBrains Mono,Consolas,monospace" font-size="24" letter-spacing="5">${subtitle}</text>
    </svg>
  `);
  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

export const realtimeWindows: InfiniteMenuItem[] = [
  {
    title: '股票窗口',
    description: 'TradingView NASDAQ 100 热力图，按市值和涨跌幅观察市场温度。',
    link: 'https://www.tradingview.com/heatmap/stock/#%7B%22dataSource%22%3A%22NASDAQ100%22%2C%22blockColor%22%3A%22change%22%2C%22blockSize%22%3A%22market_cap_basic%22%2C%22grouping%22%3A%22no_group%22%7D',
    image: makeCover('STOCK', 'NASDAQ HEATMAP', '#22c55e', 'grid')
  },
  {
    title: '实时地缘政治',
    description: 'Liveuamap 伊朗区域态势，适合快速查看地缘冲突事件流。',
    link: 'https://iran.liveuamap.com/',
    image: makeCover('GEO', 'LIVEUAMAP', '#ef4444', 'radar')
  },
  {
    title: '实时卫星天气',
    description: 'Zoom Earth 卫星云图和天气系统，观察全球尺度的实时气象。',
    link: 'https://zoom.earth/',
    image: makeCover('WEATHER', 'SATELLITE', '#38bdf8', 'weather')
  },
  {
    title: '实时飞机数据',
    description: 'Flightradar24 全球航班轨迹，用来查看空中交通和航线活动。',
    link: 'https://www.flightradar24.com/',
    image: makeCover('FLIGHT', 'RADAR 24', '#facc15', 'flight')
  },
  {
    title: '船舶数据',
    description: 'MarineTraffic 船舶位置与港口流量，补齐海运侧实时信号。',
    link: 'https://www.marinetraffic.com/',
    image: makeCover('MARINE', 'TRAFFIC', '#2dd4bf', 'ship')
  },
  {
    title: '太阳系地图',
    description: 'NASA Eyes 太阳系视图，用空间尺度校准视野，很浪漫也很硬核。',
    link: 'https://eyes.nasa.gov/apps/solar-system/#/earth',
    image: makeCover('SOLAR', 'NASA EYES', '#a78bfa', 'orbit')
  },
  {
    title: '今日新闻',
    description: '今日热榜入口，用最短时间扫过中文互联网高热议题。',
    link: 'https://tophub.today/',
    image: makeCover('NEWS', 'TOPHUB', '#f97316', 'news')
  },
  {
    title: 'AI 新闻',
    description: 'AI Hot 新闻聚合，集中查看 AI 产品、模型和产业动态。',
    link: 'https://aihot.virxact.com/?page=1',
    image: makeCover('AI NEWS', 'VIRXACT', '#8ad7ff', 'ai')
  }
];
