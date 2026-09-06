import { useEffect, useRef, useState } from 'react';
import type { Position, Snapshot } from '../../lib/ibkr/types';
import { confirmOrder, OrderReviewError, previewOrder, type OrderPreview } from '../../lib/ibkr/orderClient';

const messages: Record<string, string> = {
  ORDER_REVIEW_DISABLED: '本地订单审查服务尚未配置。',
  MISSING_QUOTE_AND_RISK_PROFILE: '缺少可信报价或账户风险配置，无法生成预览。',
  PREVIEW_SOURCE_CHANGED: '账户或报价已变化，请重新预览。',
  PREVIEW_EXPIRED: '预览已过期，请重新预览。',
  STALE_QUOTE: '报价已过期，已拒绝预览。',
  STALE_ACCOUNT: '账户快照已过期，已拒绝预览。',
  ORDER_REVIEW_UNAVAILABLE: '本地订单审查服务不可用。',
};

export function OrderTicket({ snapshot, position }: { snapshot: Snapshot; position: Position | null }) {
  const contract = position ?? snapshot.positions[0] ?? null;
  const quote = snapshot.quotes.find(row => row.conId === contract?.conId);
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [preview, setPreview] = useState<OrderPreview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    request.current?.abort();
    setPreview(null); setAcknowledged(false); setStatus(''); setQuantity(''); setPrice(quote?.price ?? '');
    return () => request.current?.abort();
  }, [snapshot.mode, snapshot.accountKey, contract?.conId, quote?.price]);

  const blocked = snapshot.mode === 'live' ? '实盘写入保持关闭，当前不能创建实盘订单预览。'
    : snapshot.state === 'stale' ? '账户快照已过期，拒绝新增风险。'
    : snapshot.state === 'permission-required' ? '缺少账户或行情读取权限，拒绝新增风险。'
    : snapshot.state === 'error' ? '账户同步失败，拒绝新增风险。'
    : snapshot.state === 'loading' ? '正在同步并核对指定 paper 账户。'
    : snapshot.connection !== 'connected' || snapshot.state !== 'ready' ? '先连接并核对指定 paper 账户。'
    : !contract ? '当前账户没有可用于首期整股限价单的合约。'
    : quote?.state !== 'realtime' || !quote.price ? '需要该合约的实时可信报价。' : '';
  const valid = /^(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?$/.test(quantity)
    && Number(quantity) > 0 && /^(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?$/.test(price) && Number(price) > 0;

  const explain = (error: unknown) => {
    const code = error instanceof OrderReviewError ? error.code : error instanceof Error && error.name === 'AbortError' ? '' : 'ORDER_REVIEW_UNAVAILABLE';
    return code ? `${messages[code] ?? '风控拒绝此请求。'}（${code}）` : '';
  };
  const createPreview = async () => {
    if (!contract || blocked || !valid) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setStatus(''); setPreview(null); setAcknowledged(false);
    try {
      setPreview(await previewOrder({ accountKey: snapshot.accountKey, mode: 'paper', conId: contract.conId,
        side, quantity, orderType: 'LMT', limitPrice: price, tif: 'DAY' }, controller.signal));
    } catch (error) { setStatus(explain(error)); }
    finally { if (request.current === controller) setBusy(false); }
  };
  const confirm = async () => {
    if (!preview || !acknowledged) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setStatus('');
    try {
      await confirmOrder(preview, controller.signal);
      setPreview(null); setAcknowledged(false); setStatus('订单意图已在本地保存并预占风险额度；尚未提交至 IBKR。');
    } catch (error) { setStatus(explain(error)); setPreview(null); setAcknowledged(false); }
    finally { if (request.current === controller) setBusy(false); }
  };

  return <div className="ibkr-order-ticket" data-testid="order-ticket">
    <div className="ibkr-order-summary"><div><span>合约</span><strong>{contract ? `${contract.symbol} · conId ${contract.conId}` : '未选择'}</strong></div><div><span>报价</span><strong>{quote?.price ? `${quote.price} ${contract?.currency ?? ''}` : '缺失'}</strong></div><div><span>范围</span><strong>美股 / ETF · 整股 · DAY 限价</strong></div></div>
    <fieldset disabled={Boolean(blocked) || busy || Boolean(preview)}>
      <legend>人工订单草稿</legend>
      <label>方向<select aria-label="方向" value={side} onChange={event => setSide(event.target.value as 'BUY' | 'SELL')}><option value="BUY">买入</option><option value="SELL">卖出</option></select></label>
      <label>数量（股）<input aria-label="数量（股）" inputMode="decimal" value={quantity} onChange={event => setQuantity(event.target.value)} placeholder="输入整股数量" /></label>
      <label>限价（USD）<input aria-label="限价（USD）" inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} /></label>
      <button className="ibkr-primary" disabled={!valid || Boolean(blocked) || busy} onClick={() => void createPreview()}>{busy ? '正在核对…' : '生成风险预览'}</button>
    </fieldset>
    {blocked && <p className="ibkr-order-blocked" role="status">{blocked}</p>}
    {preview && <section className="ibkr-order-preview" aria-label="订单风险预览">
      <div className="ibkr-preview-title"><b>确认本地订单意图</b>{preview.testData && <strong>工程测试数据</strong>}</div>
      <dl><dt>订单</dt><dd>{preview.side === 'BUY' ? '买入' : '卖出'} {preview.quantity} {preview.symbol} @ {preview.limitPrice} {preview.currency}</dd><dt>现金预占</dt><dd>{preview.reservedCash} {preview.currency}</dd><dt>敞口预占</dt><dd>{preview.reservedNotional} {preview.currency}</dd><dt>快照</dt><dd>{preview.snapshotId}</dd><dt>有效至</dt><dd>{new Date(preview.expiresAt).toLocaleTimeString()}</dd></dl>
      {preview.warnings.map(row => <p key={row}>{row}</p>)}
      <label className="ibkr-confirm-check"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />我确认以上精确条款，仅保存本地意图</label>
      <div><button onClick={() => { setPreview(null); setAcknowledged(false); }}>返回修改</button><button className="ibkr-primary" disabled={!acknowledged || busy} onClick={() => void confirm()}>确认并本地保存</button></div>
    </section>}
    {status && <p className="ibkr-order-status" role="status">{status}</p>}
    <p className="ibkr-order-footnote">确认预览不等于券商交易授权。本页面不会绕过风控或向 IBKR 发送订单。</p>
  </div>;
}
