import type { PaperOrderRecord } from './workbenchTypes';

const orderErrorMessages: Record<string, string> = {
  IBKR_201: 'IBKR 已拒绝这笔订单。201 是通用拒单代码，请在 IB Gateway 或 TWS 的订单日志中查看券商给出的具体原因。夜盘常见原因包括标的不支持夜盘、限价偏离参考价，以及交易权限或风控限制。',
  IBKR_399: 'IBKR 返回了一条通用订单提示（399）。当前订单已获券商受理，399 本身不代表拒单；委托会继续等待成交。具体提示内容可在 IB Gateway 或 TWS 的订单日志中查看。',
  PAPER_OPERATION_FAILED: '本地订单处理发生异常，系统未取得券商订单号。请先刷新订单记录确认状态；若记录中仍没有该订单，可重新预览后发送。',
};

export function paperOrderErrorMessage(code: string | null | undefined) {
  return code ? orderErrorMessages[code] ?? code : '';
}

export function paperFilledQuantity(row: PaperOrderRecord | null | undefined) {
  if (!row) return null;
  const durable = Number(row.filledQuantity ?? 0);
  const broker = Number(row.brokerFilled ?? Number.NaN);
  return Number.isFinite(broker) && broker > durable ? row.brokerFilled! : row.filledQuantity ?? '0';
}

export function paperOrderNeedsStatusCheck(row: PaperOrderRecord) {
  const stableOpen = ['OPEN', 'SUBMITTED'].includes(row.execution)
    && row.submission === 'ACKNOWLEDGED'
    && row.brokerFilled != null
    && row.brokerRemaining != null;
  return Boolean(row.reconciliationRequired && !stableOpen);
}

export function paperReceiptStatus(row: PaperOrderRecord | null, pending = false) {
  if (pending) return { kind: 'pending', title: '正在发送订单', label: '发送中', detail: '正在发送这笔模拟订单，回执会自动更新。' };
  const initialBrokerRejection = row?.lastError === 'IBKR_201' && ['UNKNOWN', 'SUBMITTING'].includes(row.submission)
    && ['NONE', 'PENDING', 'UNKNOWN', 'INACTIVE'].includes(row.execution);
  if (row && (initialBrokerRejection || ['REJECTED', 'INACTIVE'].includes(row.execution) || ['DENIED', 'REJECTED'].includes(row.submission) || row.dispatchState === 'DENIED'))
    return { kind: 'error', title: '订单未获受理', label: '已拒绝', detail: 'IBKR 未受理这笔订单。请核对下方原因；订单不会自动重复发送。' };
  if (!row || row.submission === 'UNKNOWN' || row.execution === 'UNKNOWN' || row.submission === 'RECONCILING')
    return { kind: 'warning', title: '发送结果待核对', label: '待核对', detail: '系统正在自动同步和核对订单。尚不能确认最终结果，请勿重复发送。' };
  if (row.execution === 'FILLED') return { kind: 'filled', title: '交易成功', label: '已全部成交', detail: row.reconciliationRequired ? 'IBKR 已确认全部成交，资金、费用与持仓正在自动核对。' : 'IBKR 已回报这笔模拟订单全部成交。成交详情如下。' };
  if (row.execution === 'CANCELLED') return { kind: 'neutral', title: '订单已撤销', label: '已撤单', detail: 'IBKR 已确认撤单；撤单前的成交仍会保留在下方。' };
  if (row.execution === 'CANCEL_PENDING' || ['PERSISTED', 'SUBMITTING', 'REQUESTED', 'UNKNOWN'].includes(row.cancelState ?? ''))
    return { kind: 'pending', title: '正在等待撤单结果', label: '撤单中', detail: '撤单尚未最终确认，订单仍可能继续成交。' };
  if (['PARTIAL', 'PARTIALLY_FILLED'].includes(row.execution))
    return { kind: 'partial', title: '订单部分成交', label: '部分成交', detail: 'IBKR 已回报部分成交，其余数量仍在等待后续回报。' };
  if (['OPEN', 'SUBMITTED'].includes(row.execution) && row.submission === 'ACKNOWLEDGED'
    && row.brokerFilled != null && row.brokerRemaining != null)
    return { kind: 'accepted', title: '订单发送成功', label: '券商已受理', detail: 'IBKR 当前仍将这笔委托报告为有效挂单；成交情况会继续主动同步。' };
  if (row.reconciliationRequired) return { kind: 'warning', title: '订单状态待核对', label: '待核对', detail: '正在自动核对券商记录，请等待最新回报。' };
  if (row.submission === 'ACKNOWLEDGED' || ['OPEN', 'SUBMITTED'].includes(row.execution))
    return { kind: 'accepted', title: '订单发送成功', label: '券商已受理', detail: 'IBKR 已受理委托，成交情况会随券商回报自动更新。' };
  if (row.dispatchState === 'SENT') return { kind: 'sent', title: '订单发送成功', label: '等待券商确认', detail: '订单已交给 IBKR API，正在等待券商受理和成交回报。' };
  if (row.dispatchState === 'UNKNOWN') return { kind: 'warning', title: '发送结果待核对', label: '待核对', detail: '发送结果暂不确定，请核对订单记录，避免重复发送。' };
  return { kind: 'pending', title: '正在等待发送回报', label: '处理中', detail: '已有本地订单记录，尚未取得发送成功或券商受理的确认。' };
}

export type PaperReceipt = {
  accountKey: string; account: string; symbol: string; currency: string;
  side: 'BUY' | 'SELL'; quantity: string; limitPrice: string | null; orderType: 'LMT' | 'MKT';
  row: PaperOrderRecord | null; pending: boolean; updatedAt: string; error?: string;
};
