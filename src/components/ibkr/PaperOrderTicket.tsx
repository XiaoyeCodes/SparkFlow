import { useEffect, useRef, useState } from 'react';
import type { Position, Snapshot } from '../../lib/ibkr/types';
import { validOrderPreview, type OrderPreview } from '../../lib/ibkr/orderClient';

type Instrument = { conId: number; symbol: string; currency: string; exchange: string; name: string };
type ManagedOrder = { bodyHash: string; intent: { clientIntentId: string; accountKey: string; conId: number; side: string; quantity: string; limitPrice: string }; submission: string; execution: string; cancelState: string; orderId: number | null; permId: number | null; lastError: string | null };
type PaperState = { enabled: boolean; account: string | null; accountKey: string | null; policy: { expiresAt: string; conIds: number[] } | null; orders: ManagedOrder[]; connection: string; state: string; detail: string };
const fields = [
  ['maxOrderNotional', '单笔金额上限（USD）'], ['maxTotalExposure', '账户总敞口上限（USD）'],
  ['maxSymbolWeight', '单标的权重上限（0～1）'], ['maxDailyLoss', '日亏损停止线（USD）'],
  ['maxDailyOrders', '每日订单数上限'], ['maxOrdersPerMinute', '每分钟订单数上限'],
  ['maxPriceDeviation', '限价偏离报价上限（0～1）'], ['feeReserve', '每笔手续费预留（USD）'],
] as const;
const messages: Record<string, string> = {
  PAPER_EXECUTION_DISABLED: '请先确认本次模拟盘的风险范围。', RECONCILIATION_REQUIRED: '账户核对未完成，请检查 Gateway 的 IB API 模式与权限。',
  MISSING_QUOTE_AND_RISK_PROFILE: '尚未收到实时成交报价或当日盈亏，请等待数据并重新预览。',
  DAILY_PNL_UNAVAILABLE: 'IBKR 尚未返回当日盈亏，无法执行日亏损风控。', MISSING_ACCOUNT_DATA: '缺少已结算现金或净值等必要数据。',
  OUTSIDE_RTH: '当前不在该合约的常规交易时段。', STALE_QUOTE: '实时报价已过期，请重新预览。',
  STALE_ACCOUNT: '账户风险数据已过期，请重新预览。', PREVIEW_SOURCE_CHANGED: '报价或账户数据已变化，请重新预览。',
  EXTERNAL_ORDER_RISK_UNKNOWN: '账户仍有挂单，其剩余风险未完成核对。', ACCOUNT_INTEGRITY_HALT: '账户核对已暂停，需先处理券商返回的异常。',
  BROKER_READ_TIMEOUT: '券商数据读取超时；未发送新订单。', PAPER_POLICY_ALREADY_CONFIGURED: '本次连接已有风险范围；停止后需重新启动服务再设置。',
  PAPER_ACCOUNT_UNAVAILABLE: '指定模拟账户尚未连接。', QUOTE_UNAVAILABLE: '报价不是实时数据，已拒绝下单。',
  PAPER_OPERATION_FAILED: '操作结果未确认；请先核对本系统订单和 Gateway，不要另建相同订单。',
  CASH_MISMATCH: '券商现金与本系统成交及手续费未对齐，预占继续保留。', POSITION_MISMATCH: '券商持仓与本系统成交未对齐，预占继续保留。',
  COMMISSION_PENDING: '成交手续费尚未完整返回，暂不释放预占。', EVENT_BARRIER_CHANGED: '核对期间收到新的订单回报，请稍后重新核对。',
  UNRESOLVED_ORDER: '仍有未确认订单，先等待或核对券商回报，不重复下单。',
};
async function api<T>(action: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/ibkr-terminal/paper/${action}`, { method: body === undefined ? 'GET' : 'POST', signal,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) { const code = typeof value.detail === 'string' ? value.detail : 'INVALID_REQUEST'; throw new Error(`${messages[code] ?? '请求被拒绝或服务不可用。'}（${code}）`); }
  return value as T;
}

export function PaperOrderTicket({ snapshot, position }: { snapshot: Snapshot; position: Position | null }) {
  const [state, setState] = useState<PaperState | null>(null);
  const [symbol, setSymbol] = useState(position?.symbol ?? '');
  const [contracts, setContracts] = useState<Instrument[]>([]);
  const [selected, setSelected] = useState<Instrument | null>(null);
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [minutes, setMinutes] = useState('30');
  const [riskConsent, setRiskConsent] = useState(false);
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [preview, setPreview] = useState<OrderPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const polling = new AbortController(); controller.current?.abort();
    setPreview(null); setConfirmed(false); setState(null); setNotice(''); setBusy(false);
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const next = await api<PaperState>('status', undefined, polling.signal); if (!polling.signal.aborted && (!next.accountKey || next.accountKey === snapshot.accountKey)) setState(next); }
      catch (error) { if (!polling.signal.aborted) setNotice(error instanceof Error ? error.message : '本地账户服务未连接。'); }
      finally { if (!polling.signal.aborted) timer = setTimeout(poll, 3000); }
    };
    void poll(); return () => { polling.abort(); clearTimeout(timer); controller.current?.abort(); };
  }, [snapshot.accountKey, snapshot.sessionRevision]);
  const run = async (work: (signal: AbortSignal) => Promise<void>) => {
    controller.current?.abort(); const current = new AbortController(); controller.current = current;
    setBusy(true); setNotice('');
    try { await work(current.signal); }
    catch (error) { if (!current.signal.aborted) setNotice(error instanceof Error ? error.message : '操作失败。请先查看订单状态。'); }
    finally { if (!current.signal.aborted) setBusy(false); }
  };
  const invalidate = () => { setPreview(null); setConfirmed(false); };
  const lookup = () => run(async signal => {
    invalidate(); setSelected(null);
    const rows = await api<Instrument[]>(`contract?symbol=${encodeURIComponent(symbol.trim())}`, undefined, signal);
    if (signal.aborted) return; setContracts(rows); if (rows.length === 1) setSelected(rows[0]);
    if (!rows.length) setNotice('未找到匹配的美股 / ETF 合约。');
  });
  const configure = () => run(async signal => {
    if (!selected || !riskConsent) return;
    const policy = Object.fromEntries(fields.map(([key]) => [key, key === 'maxDailyOrders' || key === 'maxOrdersPerMinute' ? Number(limits[key]) : limits[key]]));
    const next = await api<PaperState>('configure', { accountKey: snapshot.accountKey, mode: 'paper', conIds: [selected.conId],
      expiresAt: new Date(Date.now() + Number(minutes) * 60000).toISOString(), explicit: true,
      limits: { ...policy, maxQuoteAgeSeconds: 10, maxAccountAgeSeconds: 30 } }, signal);
    if (!signal.aborted) { setState(next); setNotice('风险范围已记录。每笔订单仍须预览并确认；未发送订单。'); }
  });
  const createPreview = () => run(async signal => {
    if (!selected) return; invalidate();
    const next = await api<unknown>('preview', { accountKey: snapshot.accountKey, mode: 'paper', conId: selected.conId,
      side, quantity, limitPrice: price, orderType: 'LMT', tif: 'DAY' }, signal);
    if (!validOrderPreview(next) || next.accountKey !== snapshot.accountKey || next.mode !== 'paper' || next.conId !== selected.conId
      || next.quantity !== quantity || next.limitPrice !== price || next.side !== side) throw new Error('订单预览条款不匹配，已拒绝确认。');
    if (!signal.aborted) setPreview(next);
  });
  const send = () => run(async signal => {
    if (!preview || !confirmed) return;
    const row = await api<ManagedOrder>('confirm', { previewId: preview.previewId, bodyHash: preview.bodyHash, explicit: true }, signal);
    if (signal.aborted) return;
    if (row.intent.accountKey !== preview.accountKey || row.bodyHash !== preview.bodyHash) throw new Error('订单返回身份不匹配，请核对账本，勿重复下单。');
    invalidate(); setNotice(`订单已记录：${row.submission} / ${row.execution}。是否接受或成交以券商回报为准。`);
    const next = await api<PaperState>('status', undefined, signal); if (!signal.aborted) setState(next);
  });
  const ready = state?.enabled && state.connection === 'connected' && ['ready', 'empty'].includes(state.state);
  const valid = /^[1-9][0-9]*$/.test(quantity) && /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(price) && Number(price) > 0;
  const riskValid = fields.every(([key]) => /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(limits[key] ?? '')) && Number(minutes) > 0 && Number(minutes) <= 480;
  return <div className="ibkr-order-ticket ibkr-paper-ticket" data-testid="paper-order-ticket">
    <p><b>IBKR 模拟账户 {state?.account ?? '未连接'}</b> · 人工整股 / DAY 限价 / 常规交易时段</p>
    <p role="status">{state?.detail ?? snapshot.detail}</p>
    <fieldset disabled={busy || Boolean(preview)}><legend>选择交易合约</legend>
      <label>股票 / ETF 代码<input aria-label="股票 / ETF 代码" value={symbol} onChange={e => { setSymbol(e.target.value); setSelected(null); }} placeholder="输入你选择的代码" /></label>
      <button disabled={!symbol.trim()} onClick={() => void lookup()}>查询 IBKR 合约</button>
      {contracts.length > 1 && <label>匹配合约<select value={selected?.conId ?? ''} onChange={e => setSelected(contracts.find(c => c.conId === Number(e.target.value)) ?? null)}><option value="">请选择</option>{contracts.map(c => <option value={c.conId} key={c.conId}>{c.symbol} · {c.exchange} · #{c.conId}</option>)}</select></label>}
      {selected && <p>{selected.name} · {selected.symbol} · {selected.currency} · {selected.exchange} · conId {selected.conId}</p>}
    </fieldset>
    {!state?.policy ? <details><summary>设置本次模拟盘风险范围</summary><fieldset disabled={busy}><legend>限额由你决定；此设置不会发送订单</legend>
      {fields.map(([key, label]) => <label key={key}>{label}<input aria-label={label} inputMode="decimal" value={limits[key] ?? ''} onChange={e => setLimits({ ...limits, [key]: e.target.value })} /></label>)}
      <label>有效期（分钟）<input value={minutes} onChange={e => setMinutes(e.target.value)} /></label>
    </fieldset><label className="ibkr-confirm-check"><input type="checkbox" checked={riskConsent} onChange={e => setRiskConsent(e.target.checked)} />我确认以上范围仅用于当前模拟账户和所选合约，逐笔人工确认，不启用自动策略</label>
      <button disabled={!riskValid || !riskConsent || !selected || busy || state?.connection !== 'connected'} onClick={() => void configure()}>保存模拟盘风险范围</button>
    </details> : <p>本次合约范围：{state.policy.conIds.join(', ')} · 有效至 {new Date(state.policy.expiresAt).toLocaleString()} · {state.enabled ? '每笔仍须确认' : '新增订单已停止或授权到期'}</p>}
    <fieldset disabled={busy || Boolean(preview)}><legend>订单条款</legend>
      <label>方向<select value={side} onChange={e => { setSide(e.target.value as 'BUY' | 'SELL'); invalidate(); }}><option value="BUY">买入</option><option value="SELL">卖出现有持仓</option></select></label>
      <label>整股数量<input value={quantity} onChange={e => { setQuantity(e.target.value); invalidate(); }} inputMode="numeric" /></label>
      <label>限价（USD）<input value={price} onChange={e => { setPrice(e.target.value); invalidate(); }} inputMode="decimal" /></label>
      <button className="ibkr-primary" disabled={!ready || !selected || !valid} onClick={() => void createPreview()}>生成模拟盘订单预览</button>
    </fieldset>
    {preview && <section className="ibkr-order-preview"><b>发送前确认 · {state?.account}</b><p>{preview.side} {preview.quantity} {preview.symbol} @ {preview.limitPrice} {preview.currency} · DAY</p>
      <p>现金预占 {preview.reservedCash} · 敞口预占 {preview.reservedNotional} · 有效至 {new Date(preview.expiresAt).toLocaleTimeString()}</p>{preview.warnings.map(w => <p key={w}>{w}</p>)}
      <label className="ibkr-confirm-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />我确认将以上精确订单发送到 IBKR 模拟账户</label>
      <button disabled={busy} onClick={invalidate}>返回修改</button><button className="ibkr-primary" disabled={!confirmed || busy} onClick={() => void send()}>确认后发送至 IBKR 模拟盘</button>
    </section>}
    {notice && <p role="status">{notice}</p>}{busy && <p role="status">正在处理，请勿重复提交…</p>}
    <p className="ibkr-order-footnote">实盘写入关闭。超时后先核对下方订单状态与 Gateway，勿另建相同订单。行情、当日盈亏和完整账户风险缺失时拒绝发送。</p>
    {state?.policy && <button disabled={busy} onClick={() => void run(async signal => {
      const result = await api<{ detail: string; status: PaperState }>('reconcile', undefined, signal);
      if (!signal.aborted) { setState(result.status); invalidate(); setNotice(result.detail); }
    })}>核对成交、现金与持仓</button>}
    {!!state?.orders.length && <div><h3>本系统订单回报</h3>{state.orders.map(row => <div key={row.intent.clientIntentId} className="ibkr-order-preview">
      <p>#{row.intent.conId} · {row.intent.side} {row.intent.quantity} @ {row.intent.limitPrice} · {row.submission} / {row.execution}</p><small>order {row.orderId ?? '待回报'} · perm {row.permId ?? '待回报'} · {row.lastError ?? ''}</small>
      <button disabled={busy || !row.permId || row.cancelState !== 'NONE' || ['FILLED', 'CANCELLED', 'REJECTED'].includes(row.execution)} onClick={() => {
        if (window.confirm(`确认撤销模拟账户 ${state.account} 的订单 ${row.orderId}（${row.intent.side} ${row.intent.quantity} @ ${row.intent.limitPrice}）？撤单期间仍可能成交。`)) void run(async signal => {
          await api('cancel', { intentId: row.intent.clientIntentId, bodyHash: row.bodyHash, explicit: true }, signal); if (!signal.aborted) setNotice('撤单请求已记录，等待券商确认。');
        });
      }}>请求撤单</button></div>)}</div>}
    {state?.enabled && <button disabled={busy} onClick={() => void run(async signal => { await api('stop', {}, signal); if (!signal.aborted) { setState({ ...state, enabled: false }); invalidate(); setNotice('新增订单已停止；未撤单或平仓。'); } })}>停止新增订单</button>}
  </div>;
}
