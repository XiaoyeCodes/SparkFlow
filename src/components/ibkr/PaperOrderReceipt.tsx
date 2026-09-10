import { useEffect, useRef } from 'react';
import { AlertTriangle, Check, CircleCheck, Clock3, ReceiptText, RefreshCw, X } from 'lucide-react';
import { paperReceiptStatus, type PaperReceipt } from '../../lib/ibkr/paperReceipt';
import './PaperOrderReceipt.css';

const money = (value: string | null | undefined) => value != null && value !== '' && Number.isFinite(Number(value))
  ? Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '待回报';

export function PaperOrderReceipt({ receipt, refreshing, onRefresh, onClose, onViewOrders }: {
  receipt: PaperReceipt; refreshing: boolean; onRefresh: () => void; onClose: () => void; onViewOrders: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const status = paperReceiptStatus(receipt.row, receipt.pending);
  const warning = ['warning', 'error'].includes(status.kind);
  const Icon = warning ? AlertTriangle : ['filled', 'accepted', 'sent'].includes(status.kind) ? CircleCheck : Clock3;
  const orderId = receipt.row?.orderId ?? receipt.row?.brokerOrderId;
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <div className="awb-overlay pt-modal-backdrop"><section ref={dialog} tabIndex={-1}
    className={`pt-receipt is-${status.kind}`} role="dialog" aria-modal="true" aria-label="模拟订单回执"
    onKeyDown={event => {
      if (event.key === 'Escape' && !receipt.pending) { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []);
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
      }
    }}>
    <header className="pt-receipt-top"><span><ReceiptText size={17}/>模拟订单回执</span><button aria-label="关闭订单回执" disabled={receipt.pending} onClick={onClose}><X size={20}/></button></header>
    <div className="pt-receipt-result" role="status" aria-live="polite"><span className="pt-receipt-icon"><Icon size={30}/></span><span className="pt-receipt-badge">{status.label}</span><h2>{status.title}</h2><p>{status.detail}</p></div>
    <div className="pt-receipt-instrument"><div><span className="pt-paper-tag">IBKR 模拟账户 · {receipt.account}</span><h3><span className={receipt.side === 'BUY' ? 'pt-up' : 'pt-down'}>{receipt.side === 'BUY' ? '买入' : '卖出'}</span> {receipt.symbol}</h3></div><strong>{receipt.quantity}<small>股</small></strong></div>
    <dl className="pt-receipt-details">
      <div><dt>订单编号</dt><dd>{orderId != null ? `#${orderId}` : '等待券商编号'}</dd></div>
      <div><dt>订单类型</dt><dd>{receipt.orderType === 'MKT' ? '市价单' : '限价单'} · 当日有效</dd></div>
      <div><dt>委托价格</dt><dd>{receipt.orderType === 'MKT' ? '按市场价格成交' : `${money(receipt.limitPrice)} ${receipt.currency}`}</dd></div>
      <div><dt>已成交数量</dt><dd>{receipt.row?.filledQuantity != null ? `${receipt.row.filledQuantity} / ${receipt.quantity} 股` : '待回报'}</dd></div>
      <div><dt>成交均价</dt><dd>{money(receipt.row?.averageFillPrice)}{receipt.row?.averageFillPrice != null && ` ${receipt.currency}`}</dd></div>
      <div><dt>本地更新时间</dt><dd>{new Date(receipt.updatedAt).toLocaleString('zh-CN', { hour12: false })}</dd></div>
    </dl>
    {(receipt.error || receipt.row?.lastError) && <p className="pt-receipt-error" role="status"><AlertTriangle size={16}/><span>{receipt.error || receipt.row?.lastError}</span></p>}
    <p className="pt-receipt-followup">{receipt.pending ? '请等待发送结果。' : '状态随券商回报自动更新，关闭后仍可在订单列表查看回执。'}</p>
    <footer className="pt-receipt-actions"><button disabled={receipt.pending || refreshing} onClick={onRefresh}><RefreshCw size={15} className={refreshing ? 'pt-spin' : ''}/>{refreshing ? '正在刷新…' : '刷新回执'}</button><button className="primary" disabled={receipt.pending} onClick={onViewOrders}><Check size={16}/>查看订单记录</button></footer>
  </section></div>;
}
