import type { AccountSnapshot, Holding } from './workbenchTypes';

const numeric = (value: string | number | null | undefined) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const exportedHolding = (holding: Holding) => ({
  symbol: holding.symbol,
  name: holding.name ?? null,
  asset_type: holding.assetType ?? null,
  instrument_type: holding.instrumentType ?? null,
  exchange: holding.exchange ?? null,
  currency: holding.currency,
  quantity: numeric(holding.quantity),
  average_cost: numeric(holding.averageCost),
  market_value: numeric(holding.marketValue),
  unrealized_pnl: numeric(holding.unrealizedPnl),
  daily_pnl: numeric(holding.dailyPnl),
  sector: holding.sector ?? null,
  industry: holding.industry ?? null,
});

export function buildHoldingsAiExport(snapshot: AccountSnapshot, exportedAt = new Date().toISOString()) {
  return {
    format: 'sparkflow-ai-holdings-v1',
    exported_at: exportedAt,
    snapshot_as_of: snapshot.asOf,
    source: snapshot.source === 'ibkr' ? 'IBKR broker snapshot' : 'fixture/test snapshot',
    holding_count: snapshot.positions.length,
    prompt: [
      '请基于 holdings 数组分析这份投资组合。',
      '先检查缺失字段并说明数据时点；所有金额、成本和盈亏均为券商账面快照。',
      '按 currency 分组计算与比较；没有可靠汇率时，不要把不同币种直接相加。',
      '分析持仓集中度、行业暴露、成本与未实现盈亏、主要风险，以及值得继续核实的问题。',
      '把回答分为“可确认事实”“分析判断”“待核实信息”和“可考虑的行动”，不要虚构实时行情、基本面或新闻。',
      '若需要外部资料，请注明来源和日期；结论应说明依据、反对证据与失效条件。',
    ].join('\n'),
    field_notes: {
      average_cost: '券商平均成本，单位为该持仓 currency',
      market_value: '券商账面市值，单位为该持仓 currency',
      unrealized_pnl: '券商未实现盈亏，单位为该持仓 currency',
      daily_pnl: '券商当日盈亏；null 表示未提供，不等于 0',
      null: '字段未取得，不应按 0 处理',
    },
    holdings: snapshot.positions.map(exportedHolding),
  };
}

export function downloadHoldingsAiJson(snapshot: AccountSnapshot) {
  const payload = buildHoldingsAiExport(snapshot);
  const date = (snapshot.asOf ?? payload.exported_at).slice(0, 10);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `SparkFlow-持仓-AI分析-${date}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
