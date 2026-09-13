export type ChinaMacroNewsRankable = {
  title: string;
  importanceScore?: number;
  publishedAt?: string;
};

const CHINA_MACRO_HIGHLIGHT_TERMS = [
  '中央政治局', '中共中央', '国务院', '国常会', '中国人民银行', '国家统计局',
  '国家发展改革委', '财政部', '商务部', '中国证监会',
  '重大事故', '应急响应', '安全生产', '地震', '台风', '特大暴雨', '洪水', '洪涝',
  '降准', '降息', 'LPR', 'GDP', 'CPI', 'PPI', 'PMI', '社融', 'M1', 'M2',
  '工业增加值', '固定资产投资', '社会消费品零售', '失业率', '进出口', '人民币', '汇率',
  '资本市场', 'A股', '证监会', '房地产', '楼市', '就业', '消费', '教育', '医疗', '养老', '民生',
  '重大', '重点', '首次', '突破', '改革', '政策', '条例', '规划',
] as const;

export function getChinaMacroNewsHighlights(title: string, limit = 3): string[] {
  const normalizedTitle = title.toLocaleUpperCase('zh-CN');
  return CHINA_MACRO_HIGHLIGHT_TERMS
    .filter((term) => normalizedTitle.includes(term.toLocaleUpperCase('zh-CN')))
    .slice(0, Math.max(0, limit))
    .sort((left, right) => right.length - left.length);
}

export function rankChinaMacroNews<T extends ChinaMacroNewsRankable>(
  items: T[],
  limit = 6,
): Array<T & { highlights: string[] }> {
  return items.map((item, sourceIndex) => ({
    item: { ...item, highlights: getChinaMacroNewsHighlights(item.title) },
    sourceIndex,
    publishedTime: Number.isFinite(Date.parse(item.publishedAt || '')) ? Date.parse(item.publishedAt || '') : 0,
  })).sort((left, right) => (
    (right.item.importanceScore || 0) - (left.item.importanceScore || 0)
    || right.publishedTime - left.publishedTime
    || left.sourceIndex - right.sourceIndex
  )).slice(0, Math.max(0, limit)).map(({ item }) => item);
}
