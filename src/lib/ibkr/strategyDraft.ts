import type { StrategyDefinition } from './backtestClient';

export type StrategyDraftInput = {
  strategyId: string; version: string; name: string; conId: string; barInterval: '1D' | '1h';
  fastWindow: string; slowWindow: string; targetQuantity: string; maxPositionQuantity: string;
  commissionPerOrder: string; commissionPerShare: string; slippageBps: string; versionNotes: string;
};

type DraftResult = { ok: true; errors: []; definition: StrategyDefinition } | { ok: false; errors: string[]; definition?: never };
const decimal = /^(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?$/;
const positiveWhole = /^[1-9][0-9]{0,17}$/;

export function buildStrategyDraft(input: StrategyDraftInput): DraftResult {
  const errors: string[] = [];
  const fast = Number(input.fastWindow); const slow = Number(input.slowWindow); const conId = Number(input.conId);
  if (!input.strategyId.startsWith('user:') || input.strategyId.length > 128) errors.push('用户策略 ID 必须以 user: 开头');
  else if (!/^\d+\.\d+\.\d+$/.test(input.version)) errors.push('版本必须使用 x.y.z');
  else if (!input.name.trim()) errors.push('策略名称不能为空');
  else if (!Number.isInteger(conId) || conId <= 0) errors.push('合约 conId 必须是正整数');
  else if (!Number.isInteger(fast) || fast < 1 || fast > 100 || !Number.isInteger(slow) || slow < 2 || slow > 500 || fast >= slow) errors.push('快速窗口必须小于慢速窗口');
  else if (!positiveWhole.test(input.targetQuantity)) errors.push('目标数量必须是正整股');
  else if (!positiveWhole.test(input.maxPositionQuantity) || BigInt(input.targetQuantity) > BigInt(input.maxPositionQuantity)) errors.push('最大持仓必须覆盖目标数量');
  else if (![input.commissionPerOrder, input.commissionPerShare, input.slippageBps].every(value => decimal.test(value)) || Number(input.slippageBps) > 1000) errors.push('成本参数必须是支持范围内的非负十进制数');
  else if (!input.versionNotes.trim()) errors.push('版本说明不能为空');
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], definition: {
    strategyId: input.strategyId, version: input.version, origin: 'user', name: input.name.trim(), universe: [conId], barInterval: input.barInterval,
    entryRule: `收盘价快速 SMA(${fast}) 高于慢速 SMA(${slow}) 后，下一根 bar 开盘调整到目标仓位。`,
    exitRule: `收盘价快速 SMA(${fast}) 小于或等于慢速 SMA(${slow}) 后，下一根 bar 开盘调整到零仓位。`,
    parameters: { fastWindow: String(fast), slowWindow: String(slow), targetQuantity: input.targetQuantity },
    signal: { kind: 'sma_cross', priceField: 'close', fastWindow: fast, slowWindow: slow,
      entryWhen: 'FAST_ABOVE_SLOW', exitWhen: 'FAST_AT_OR_BELOW_SLOW' },
    positionSizing: { kind: 'fixed_quantity', targetQuantity: input.targetQuantity },
    costs: { commissionPerOrder: input.commissionPerOrder, commissionPerShare: input.commissionPerShare, slippageBps: input.slippageBps },
    risk: { allowShort: false, maxPositionQuantity: input.maxPositionQuantity }, versionNotes: input.versionNotes.trim(),
  } };
}
