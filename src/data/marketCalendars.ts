export type MarketCalendarId =
  | 'china'
  | 'hongkong'
  | 'us'
  | 'japan'
  | 'korea'
  | 'india'
  | 'germany'
  | 'france'
  | 'uk';

export type MarketHalfDay = {
  name: string;
  closeMinute: number;
};

// Exchange-local dates. Weekends are handled separately by the session engine.
export const MARKET_HOLIDAYS_2026: Record<MarketCalendarId, Record<string, string>> = {
  china: {
    '2026-01-01': '元旦',
    '2026-01-02': '元旦休市',
    '2026-02-16': '春节',
    '2026-02-17': '春节',
    '2026-02-18': '春节',
    '2026-02-19': '春节',
    '2026-02-20': '春节',
    '2026-02-23': '春节休市',
    '2026-04-06': '清明节',
    '2026-05-01': '劳动节',
    '2026-05-04': '劳动节',
    '2026-05-05': '劳动节',
    '2026-06-19': '端午节',
    '2026-09-25': '中秋节',
    '2026-10-01': '国庆节',
    '2026-10-02': '国庆节',
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
  japan: {
    '2026-01-01': '元旦',
    '2026-01-02': '交易所休市日',
    '2026-01-12': '成人日',
    '2026-02-11': '建国纪念日',
    '2026-02-23': '天皇诞辰',
    '2026-03-20': '春分日',
    '2026-04-29': '昭和日',
    '2026-05-04': '绿之日',
    '2026-05-05': '儿童节',
    '2026-05-06': '宪法纪念日补休',
    '2026-07-20': '海之日',
    '2026-08-11': '山之日',
    '2026-09-21': '敬老日',
    '2026-09-22': '国民休息日',
    '2026-09-23': '秋分日',
    '2026-10-12': '体育日',
    '2026-11-03': '文化日',
    '2026-11-23': '勤劳感谢日',
    '2026-12-31': '交易所休市日',
  },
  korea: {
    '2026-01-01': '元旦',
    '2026-02-16': '春节',
    '2026-02-17': '春节',
    '2026-02-18': '春节',
    '2026-03-02': '三一节补休',
    '2026-05-01': '劳动节',
    '2026-05-05': '儿童节',
    '2026-05-25': '佛诞补休',
    '2026-06-03': '地方选举日',
    '2026-07-17': '制宪节',
    '2026-08-17': '光复节补休',
    '2026-09-24': '秋夕',
    '2026-09-25': '秋夕',
    '2026-10-05': '开天节补休',
    '2026-10-09': '韩文日',
    '2026-12-25': '圣诞节',
    '2026-12-31': 'KRX 年终休市',
  },
  india: {
    '2026-01-26': '共和国日',
    '2026-03-03': '洒红节',
    '2026-03-26': '罗摩诞辰',
    '2026-03-31': '筏驮摩那诞辰',
    '2026-04-03': '耶稣受难节',
    '2026-04-14': '安贝德卡诞辰',
    '2026-05-01': '马哈拉施特拉邦日',
    '2026-05-28': '宰牲节',
    '2026-06-26': '穆哈兰姆节',
    '2026-09-14': '象神节',
    '2026-10-02': '甘地诞辰',
    '2026-10-20': '十胜节',
    '2026-11-10': '排灯节',
    '2026-11-24': '古鲁那纳克诞辰',
    '2026-12-25': '圣诞节',
  },
  germany: {
    '2026-01-01': '元旦',
    '2026-04-03': '耶稣受难节',
    '2026-04-06': '复活节星期一',
    '2026-05-01': '劳动节',
    '2026-12-24': '平安夜休市',
    '2026-12-25': '圣诞节',
    '2026-12-31': '除夕休市',
  },
  france: {
    '2026-01-01': '元旦',
    '2026-04-03': '耶稣受难节',
    '2026-04-06': '复活节星期一',
    '2026-05-01': '劳动节',
    '2026-12-25': '圣诞节',
  },
  uk: {
    '2026-01-01': '元旦',
    '2026-04-03': '耶稣受难节',
    '2026-04-06': '复活节星期一',
    '2026-05-04': '五月银行假日',
    '2026-05-25': '春季银行假日',
    '2026-08-31': '夏季银行假日',
    '2026-12-25': '圣诞节',
    '2026-12-28': '节礼日补休',
  },
};

export const MARKET_HALF_DAYS_2026: Partial<Record<MarketCalendarId, Record<string, MarketHalfDay>>> = {
  hongkong: {
    '2026-02-16': { name: '农历新年前夕半日市', closeMinute: 12 * 60 + 10 },
    '2026-12-24': { name: '圣诞前夕半日市', closeMinute: 12 * 60 + 10 },
    '2026-12-31': { name: '除夕半日市', closeMinute: 12 * 60 + 10 },
  },
  us: {
    '2026-11-27': { name: '感恩节翌日提前收市', closeMinute: 13 * 60 },
    '2026-12-24': { name: '圣诞前夕提前收市', closeMinute: 13 * 60 },
  },
  france: {
    '2026-12-24': { name: '圣诞前夕半日市', closeMinute: 14 * 60 + 5 },
    '2026-12-31': { name: '除夕半日市', closeMinute: 14 * 60 + 5 },
  },
  uk: {
    '2026-12-24': { name: '圣诞前夕半日市', closeMinute: 12 * 60 + 30 },
    '2026-12-31': { name: '除夕半日市', closeMinute: 12 * 60 + 30 },
  },
};

export const MARKET_CALENDAR_SOURCE_URLS: Record<MarketCalendarId, string> = {
  china: 'https://www.sse.com.cn/disclosure/dealinstruc/closed/',
  hongkong: 'https://www.hkex.com.hk/-/media/HKEX-Market/Services/Circulars-and-Notices/Participant-and-Members-Circulars/SEHK/2025/ce_SEHK_CT_075_2025.pdf',
  us: 'https://www.nasdaqtrader.com/trader.aspx?id=Calendar',
  japan: 'https://www.jpx.co.jp/english/corporate/about-jpx/calendar/',
  korea: 'https://global.krx.co.kr/contents/GLB/06/0602/0602010201/GLB0602010201T1.jsp',
  india: 'https://www.nseindia.com/resources/exchange-communication-holidays',
  germany: 'https://www.xetra.com/xetra-en/trading/trading-calendar-and-trading-hours',
  france: 'https://live.euronext.com/en/resources/trading-hours-holidays',
  uk: 'https://www.londonstockexchange.com/equities-trading/business-days',
};

export function getMarketHolidayName(market: MarketCalendarId, date: string) {
  return MARKET_HOLIDAYS_2026[market]?.[date];
}

export function getMarketHolidayDates(market: MarketCalendarId) {
  return Object.keys(MARKET_HOLIDAYS_2026[market] || {});
}

export function getMarketHalfDay(market: MarketCalendarId, date: string) {
  return MARKET_HALF_DAYS_2026[market]?.[date];
}
