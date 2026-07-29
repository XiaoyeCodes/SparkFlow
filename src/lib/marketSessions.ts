export type MarketSessionMarket = 'china' | 'hongkong' | 'us' | 'crypto';

export type MarketSessionTone = 'live' | 'auction' | 'extended' | 'paused' | 'closed' | 'halted';

export type MarketSessionStatus = {
  state: 'preopen' | 'auction' | 'trading' | 'break' | 'after-hours' | 'overnight' | 'holiday' | 'closed' | 'halted' | 'always-open';
  label: string;
  detail: string;
  localTime: string;
  location: string;
  nextLabel: string;
  tone: MarketSessionTone;
  sourceUrl: string;
};

const MARKET_TIME_ZONES: Record<MarketSessionMarket, string> = {
  china: 'Asia/Shanghai',
  hongkong: 'Asia/Hong_Kong',
  us: 'America/New_York',
  crypto: 'UTC',
};

const MARKET_LOCATIONS: Record<MarketSessionMarket, string> = {
  china: '上海时间',
  hongkong: '香港时间',
  us: '纽约时间',
  crypto: '协调世界时',
};

const MARKET_SOURCES: Record<MarketSessionMarket, string> = {
  china: 'https://www.sse.com.cn/lawandrules/sselawsrules2025/fund/trading/c/c_20260424_10817739.shtml',
  hongkong: 'https://www.hkex.com.hk/Services/Trading-hours-and-Severe-Weather-Arrangements/Trading-Hours/Securities-Market?sc_lang=zh-HK',
  us: 'https://www.nasdaq.com/market-activity/stock-market-holiday-schedule',
  crypto: 'https://help.coinbase.com/en/trading-and-funding/trading-hours-market-closures',
};

const HOLIDAYS: Partial<Record<MarketSessionMarket, Record<string, string>>> = {
  china: {
    '2026-01-01': '元旦',
    '2026-01-02': '元旦',
    '2026-01-03': '元旦',
    '2026-02-15': '春节',
    '2026-02-16': '春节',
    '2026-02-17': '春节',
    '2026-02-18': '春节',
    '2026-02-19': '春节',
    '2026-02-20': '春节',
    '2026-02-21': '春节',
    '2026-02-22': '春节',
    '2026-02-23': '春节',
    '2026-04-04': '清明节',
    '2026-04-05': '清明节',
    '2026-04-06': '清明节',
    '2026-05-01': '劳动节',
    '2026-05-02': '劳动节',
    '2026-05-03': '劳动节',
    '2026-05-04': '劳动节',
    '2026-05-05': '劳动节',
    '2026-06-19': '端午节',
    '2026-06-20': '端午节',
    '2026-06-21': '端午节',
    '2026-09-25': '中秋节',
    '2026-09-26': '中秋节',
    '2026-09-27': '中秋节',
    '2026-10-01': '国庆节',
    '2026-10-02': '国庆节',
    '2026-10-03': '国庆节',
    '2026-10-04': '国庆节',
    '2026-10-05': '国庆节',
    '2026-10-06': '国庆节',
    '2026-10-07': '国庆节',
  },
  hongkong: {
    '2026-01-01': '元旦',
    '2026-02-17': '农历新年',
    '2026-02-18': '农历新年',
    '2026-02-19': '农历新年',
    '2026-04-03': '耶稣受难节',
    '2026-04-06': '清明节翌日',
    '2026-04-07': '复活节翌日',
    '2026-05-01': '劳动节',
    '2026-05-25': '佛诞翌日',
    '2026-06-19': '端午节',
    '2026-07-01': '香港特别行政区成立纪念日',
    '2026-10-01': '国庆日',
    '2026-10-19': '重阳节翌日',
    '2026-12-25': '圣诞节',
  },
  us: {
    '2026-01-01': '元旦',
    '2026-01-19': '马丁·路德·金纪念日',
    '2026-02-16': '总统日',
    '2026-04-03': '耶稣受难节',
    '2026-05-25': '阵亡将士纪念日',
    '2026-06-19': '六月节',
    '2026-07-03': '独立日补休',
    '2026-09-07': '劳动节',
    '2026-11-26': '感恩节',
    '2026-12-25': '圣诞节',
  },
};

const HALF_DAYS: Partial<Record<MarketSessionMarket, Set<string>>> = {
  hongkong: new Set(['2026-02-16', '2026-12-24', '2026-12-31']),
  us: new Set(['2026-11-27', '2026-12-24']),
};

type ZonedParts = {
  date: string;
  minutes: number;
  time: string;
  weekday: number;
};

function getZonedParts(now: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return {
    date,
    minutes: hour * 60 + minute,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    weekday,
  };
}

function shiftDate(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days, 12));
  return next.toISOString().slice(0, 10);
}

function isTradingDay(market: Exclude<MarketSessionMarket, 'crypto'>, date: string) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !HOLIDAYS[market]?.[date];
}

function nextTradingDate(market: Exclude<MarketSessionMarket, 'crypto'>, date: string) {
  let candidate = shiftDate(date, 1);
  for (let index = 0; index < 14; index += 1) {
    if (isTradingDay(market, candidate)) return candidate;
    candidate = shiftDate(candidate, 1);
  }
  return candidate;
}

function datePrefix(targetDate: string, currentDate: string) {
  if (targetDate === currentDate) return '今日';
  if (targetDate === shiftDate(currentDate, 1)) return '明日';
  return `${targetDate.slice(5, 7)}/${targetDate.slice(8, 10)}`;
}

function nextOpenLabel(
  market: Exclude<MarketSessionMarket, 'crypto'>,
  date: string,
  time: string,
  phase: string,
) {
  const targetDate = isTradingDay(market, date) ? date : nextTradingDate(market, date);
  return `${datePrefix(targetDate, date)} ${time} ${phase}`;
}

function closedStatus(
  market: Exclude<MarketSessionMarket, 'crypto'>,
  parts: ZonedParts,
  holidayName?: string,
): MarketSessionStatus {
  const nextDate = nextTradingDate(market, parts.date);
  const openTime = market === 'china' ? '09:15' : market === 'hongkong' ? '09:00' : '04:00';
  const openLabel = market === 'china' ? '集合竞价' : market === 'hongkong' ? '开市前时段' : '盘前交易';
  return {
    state: holidayName ? 'holiday' : 'closed',
    label: holidayName ? '节假日休市' : '周末休市',
    detail: holidayName || '非交易日',
    localTime: parts.time,
    location: MARKET_LOCATIONS[market],
    nextLabel: `${datePrefix(nextDate, parts.date)} ${openTime} ${openLabel}`,
    tone: 'closed',
    sourceUrl: MARKET_SOURCES[market],
  };
}

function chinaStatus(parts: ZonedParts): MarketSessionStatus {
  const base = {
    localTime: parts.time,
    location: MARKET_LOCATIONS.china,
    sourceUrl: MARKET_SOURCES.china,
  };
  const holiday = HOLIDAYS.china?.[parts.date];
  if (!isTradingDay('china', parts.date)) return closedStatus('china', parts, holiday);
  if (parts.minutes < 9 * 60 + 15) {
    return { ...base, state: 'preopen', label: '未开盘', detail: '等待开盘集合竞价', nextLabel: nextOpenLabel('china', parts.date, '09:15', '集合竞价'), tone: 'closed' };
  }
  if (parts.minutes < 9 * 60 + 25) {
    return { ...base, state: 'auction', label: '集合竞价', detail: '开盘集合竞价', nextLabel: '今日 09:25 竞价结束', tone: 'auction' };
  }
  if (parts.minutes < 9 * 60 + 30) {
    return { ...base, state: 'preopen', label: '等待开盘', detail: '集合竞价撮合完成', nextLabel: '今日 09:30 连续竞价', tone: 'auction' };
  }
  if (parts.minutes < 11 * 60 + 30) {
    return { ...base, state: 'trading', label: '交易中', detail: '上午连续竞价', nextLabel: '今日 11:30 午间休市', tone: 'live' };
  }
  if (parts.minutes < 13 * 60) {
    return { ...base, state: 'break', label: '午间休市', detail: '上午盘已收市', nextLabel: '今日 13:00 下午开盘', tone: 'paused' };
  }
  if (parts.minutes < 14 * 60 + 57) {
    return { ...base, state: 'trading', label: '交易中', detail: '下午连续竞价', nextLabel: '今日 14:57 收盘集合竞价', tone: 'live' };
  }
  if (parts.minutes < 15 * 60) {
    return { ...base, state: 'auction', label: '集合竞价', detail: '收盘集合竞价', nextLabel: '今日 15:00 收盘', tone: 'auction' };
  }
  const nextDate = nextTradingDate('china', parts.date);
  return {
    ...base,
    state: 'after-hours',
    label: '盘后',
    detail: parts.minutes < 15 * 60 + 30 ? '部分品种固定价格交易' : '当日交易已结束',
    nextLabel: `${datePrefix(nextDate, parts.date)} 09:15 集合竞价`,
    tone: 'extended',
  };
}

function hongKongStatus(parts: ZonedParts): MarketSessionStatus {
  const base = {
    localTime: parts.time,
    location: MARKET_LOCATIONS.hongkong,
    sourceUrl: MARKET_SOURCES.hongkong,
  };
  const holiday = HOLIDAYS.hongkong?.[parts.date];
  if (!isTradingDay('hongkong', parts.date)) return closedStatus('hongkong', parts, holiday);
  const halfDay = HALF_DAYS.hongkong?.has(parts.date) || false;
  if (parts.minutes < 9 * 60) {
    return { ...base, state: 'preopen', label: '未开盘', detail: '等待开市前时段', nextLabel: '今日 09:00 开市前时段', tone: 'closed' };
  }
  if (parts.minutes < 9 * 60 + 30) {
    return { ...base, state: 'auction', label: '集合竞价', detail: '开市前时段', nextLabel: '今日 09:30 持续交易', tone: 'auction' };
  }
  if (parts.minutes < 12 * 60) {
    return { ...base, state: 'trading', label: '交易中', detail: '早市持续交易', nextLabel: halfDay ? '今日 12:00 收市竞价' : '今日 12:00 午间休市', tone: 'live' };
  }
  if (halfDay && parts.minutes < 12 * 60 + 10) {
    return { ...base, state: 'auction', label: '集合竞价', detail: '半日市收市竞价', nextLabel: '随机于 12:08–12:10 收市', tone: 'auction' };
  }
  if (halfDay) {
    const nextDate = nextTradingDate('hongkong', parts.date);
    return { ...base, state: 'after-hours', label: '盘后', detail: '半日市已收市', nextLabel: `${datePrefix(nextDate, parts.date)} 09:00 开市前时段`, tone: 'extended' };
  }
  if (parts.minutes < 13 * 60) {
    return { ...base, state: 'break', label: '午间休市', detail: '证券市场午休', nextLabel: '今日 13:00 下午开盘', tone: 'paused' };
  }
  if (parts.minutes < 16 * 60) {
    return { ...base, state: 'trading', label: '交易中', detail: '午市持续交易', nextLabel: '今日 16:00 收市竞价', tone: 'live' };
  }
  if (parts.minutes < 16 * 60 + 10) {
    return { ...base, state: 'auction', label: '集合竞价', detail: '收市竞价时段', nextLabel: '随机于 16:08–16:10 收市', tone: 'auction' };
  }
  const nextDate = nextTradingDate('hongkong', parts.date);
  return { ...base, state: 'after-hours', label: '盘后', detail: '当日证券交易已结束', nextLabel: `${datePrefix(nextDate, parts.date)} 09:00 开市前时段`, tone: 'extended' };
}

function usStatus(parts: ZonedParts, systemState: 'normal' | 'halted' | 'unknown'): MarketSessionStatus {
  const base = {
    localTime: parts.time,
    location: MARKET_LOCATIONS.us,
    sourceUrl: MARKET_SOURCES.us,
  };
  const holiday = HOLIDAYS.us?.[parts.date];
  const tomorrow = shiftDate(parts.date, 1);
  const sundayOvernight = parts.weekday === 0 && parts.minutes >= 20 * 60 && isTradingDay('us', tomorrow);
  if (sundayOvernight) {
    return { ...base, state: 'overnight', label: '夜盘', detail: '部分券商与标的可交易', nextLabel: '明日 04:00 盘前交易', tone: 'extended' };
  }
  if (!isTradingDay('us', parts.date)) return closedStatus('us', parts, holiday);

  const earlyClose = HALF_DAYS.us?.has(parts.date) || false;
  const closeMinute = earlyClose ? 13 * 60 : 16 * 60;
  if (parts.minutes < 4 * 60) {
    return { ...base, state: 'overnight', label: '夜盘', detail: '部分券商与标的可交易', nextLabel: '今日 04:00 盘前交易', tone: 'extended' };
  }
  if (parts.minutes < 9 * 60 + 30) {
    return { ...base, state: 'preopen', label: '盘前', detail: 'Nasdaq 盘前交易', nextLabel: '今日 09:30 常规开盘', tone: 'auction' };
  }
  if (parts.minutes < closeMinute) {
    if (systemState === 'halted') {
      return {
        ...base,
        state: 'halted',
        label: '熔断 / 停市',
        detail: 'Nasdaq 官方系统状态异常',
        nextLabel: '等待交易所恢复通知',
        tone: 'halted',
        sourceUrl: 'https://www.nasdaqtrader.com/Trader.aspx?id=MarketSystemStatusToday',
      };
    }
    return {
      ...base,
      state: 'trading',
      label: '交易中',
      detail: earlyClose ? '常规交易 · 今日提前收市' : '常规交易时段',
      nextLabel: earlyClose ? '今日 13:00 提前收市' : '今日 16:00 常规收市',
      tone: 'live',
    };
  }
  if (parts.minutes < 20 * 60) {
    return { ...base, state: 'after-hours', label: '盘后', detail: '延长时段交易', nextLabel: parts.minutes < 16 * 60 ? '今日 16:00 盘后交易' : '今日 20:00 夜盘', tone: 'extended' };
  }
  if (isTradingDay('us', tomorrow)) {
    return { ...base, state: 'overnight', label: '夜盘', detail: '部分券商与标的可交易', nextLabel: '明日 04:00 盘前交易', tone: 'extended' };
  }
  const nextDate = nextTradingDate('us', parts.date);
  return { ...base, state: 'closed', label: '已收市', detail: '周末或假日前无夜盘', nextLabel: `${datePrefix(nextDate, parts.date)} 04:00 盘前交易`, tone: 'closed' };
}

export function getMarketSessionStatus(
  market: MarketSessionMarket,
  now = new Date(),
  usSystemState: 'normal' | 'halted' | 'unknown' = 'unknown',
): MarketSessionStatus {
  const parts = getZonedParts(now, MARKET_TIME_ZONES[market]);
  if (market === 'china') return chinaStatus(parts);
  if (market === 'hongkong') return hongKongStatus(parts);
  if (market === 'us') return usStatus(parts, usSystemState);
  return {
    state: 'always-open',
    label: '全天交易',
    detail: '数字资产市场 24/7 运行',
    localTime: parts.time,
    location: MARKET_LOCATIONS.crypto,
    nextLabel: '持续交易 · 无固定收盘',
    tone: 'live',
    sourceUrl: MARKET_SOURCES.crypto,
  };
}
