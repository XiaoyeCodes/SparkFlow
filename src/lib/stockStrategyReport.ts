import type { StrategyReport } from './stockStrategyTypes';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const first = (...values: unknown[]) => values.map(text).find(Boolean) || '';
const bullets = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean).map(item => `- ${item}`).join('\n') : text(value);
const labelled = (value: unknown, labels: Record<string, string>) => {
  const data = object(value);
  return Object.entries(labels).flatMap(([key, label]) => {
    const item = data[key];
    const content = typeof item === 'number' && Number.isFinite(item) ? String(item) : text(item);
    return content ? [`**${label}**：${content}`] : [];
  }).join('\n\n');
};

// DSA agent reports store evidence under dashboard; classic reports use flat fields.
// Normalize at read time so saved research remains intact and both formats display.
export function strategyReportDetails(report?: StrategyReport) {
  const details = report?.details;
  const raw = object(details?.raw_result);
  const dashboard = object(raw.dashboard);
  const data = object(dashboard.data_perspective);
  const intelligence = object(dashboard.intelligence);
  const battle = object(dashboard.battle_plan);
  const technical = [
    labelled(data.trend_status, { ma_alignment: '均线结构', trend_strength: '趋势强度', is_bullish: '多头结构' }),
    labelled(data.price_position, { current_price: '分析时价格', ma5: 'MA5', ma10: 'MA10', ma20: 'MA20', bias_ma5: 'MA5 乖离率', bias_status: '乖离状态', support_level: '支撑位', resistance_level: '阻力位' }),
    labelled(data.volume_analysis, { volume_ratio: '量比', volume_status: '成交量状态', turnover_rate: '换手率', volume_meaning: '量价解读' }),
    labelled(data.chip_structure, { chip_health: '筹码观察' }),
  ].filter(Boolean).join('\n\n');
  return {
    technical_analysis: first(details?.technical_analysis, raw.technical_analysis, raw.trend_analysis, technical),
    fundamental_analysis: first(details?.fundamental_analysis, raw.fundamental_analysis, intelligence.earnings_outlook),
    news_summary: first(details?.news_summary, raw.news_summary, intelligence.latest_news),
    empty_news_disclosure: text(details?.empty_news_disclosure),
    risk_warning: first(details?.risk_warning, raw.risk_warning, [bullets(intelligence.risk_alerts), labelled(battle.position_strategy, { risk_control: '风险控制' })].filter(Boolean).join('\n\n')),
  };
}
