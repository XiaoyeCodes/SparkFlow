import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Check, ChevronDown, CircleStop, Clock3, Minus, Plus, RefreshCw, Search, ShieldCheck, ShoppingCart, SlidersHorizontal, Wallet, X } from 'lucide-react';
import type { PaperContract, PaperSearchCandidate, PaperOrderPreview, PaperOrderRecord, PaperQuote, PaperRiskLimits, PaperStatus, WorkbenchState } from '../../lib/ibkr/workbenchTypes';
import './PaperTradingWorkspace.css';
import { HoldingLogo } from './HoldingLogo';
import { TicketPriceChart } from './TicketPriceChart';

const api = '/api/ibkr-workbench/paper/';
async function paperRequest<T>(endpoint: string, value?: unknown): Promise<T> {
  const response = await fetch(api + endpoint, value === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '模拟盘订单服务暂不可用');
  return data;
}
const errors: Record<string, string> = {
  PAPER_GATEWAY_READONLY: 'Gateway 的 API 仍为只读，请取消“只读 API”后重新连接模拟账户。',
  PAPER_ACCOUNT_UNAVAILABLE: '模拟账户已断开，请到连接设置中点击智能连接。',
  PAPER_BRIDGE_UPDATE_REQUIRED: '新版行情接口尚未加载，请重启 SparkFlow 本地桥接服务后重新连接模拟账户。',
  PAPER_EXECUTION_DISABLED: '本次模拟交易已停止或授权到期，请重新连接后设置交易范围。',
  PAPER_POLICY_ALREADY_CONFIGURED: '本次交易范围已固定，重新连接后可设置新的范围。',
  PAPER_POLICY_EXPIRY: '本次交易有效期需在 8 小时以内。',
  PREVIEW_EXPIRED: '预览已过期，请重新预览后再确认。',
  PREVIEW_BODY_CHANGED: '订单已修改，请重新预览。',
  STALE_QUOTE: '券商实时行情不够新，请刷新行情后重试。',
  QUOTE_NOT_REALTIME: '下单校验需要 IBKR 实时行情，请检查行情权限。',
  QUOTE_UNAVAILABLE: '当前没有可用于订单校验的 IBKR 实时行情。',
  MISSING_QUOTE_AND_RISK_PROFILE: '尚未取得完整的实时成交行情与账户数据。请确认处于常规交易时段并已开通 API 行情权限。',
  ACCOUNT_STALE: '账户数据已过期，请刷新账户。',
  RECONCILIATION_REQUIRED: '订单状态尚待券商确认，请先刷新订单，避免重复下单。',
  OUTSIDE_RTH: '当前不在美股常规交易时段。本页面的订单只在常规时段、取得实时行情后提交。',
  DAILY_PNL_UNAVAILABLE: 'Gateway 尚未返回今日盈亏，暂不能完成订单校验。',
  MISSING_ACCOUNT_DATA: 'Gateway 尚未返回完整的美元现金与账户数据。',
  ORDER_NOTIONAL_LIMIT: '订单金额超过单笔上限，请调整数量或交易设置。',
  SYMBOL_WEIGHT_LIMIT: '下单后该股票占比将超过设置的上限。',
  TOTAL_EXPOSURE_LIMIT: '下单后持仓金额将超过账户上限。',
  INSUFFICIENT_CASH: '可用的已结算现金不足。',
  EXTERNAL_ORDER_RISK_UNKNOWN: '账户中有待核对的外部订单，请先在 Gateway 中确认其状态。',
};
const message = (e: unknown) => { const raw = e instanceof Error ? e.message : '订单服务暂不可用'; return errors[raw] ?? raw; };
const money = (v: string | number | null | undefined) => v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
const executionNames: Record<string, string> = { NONE: '待回报', PENDING: '待回报', OPEN: '已报单', SUBMITTED: '已报单', PARTIAL: '部分成交', PARTIALLY_FILLED: '部分成交', FILLED: '已成交', CANCELLED: '已撤单', REJECTED: '已拒绝', UNKNOWN: '待核对', CANCEL_PENDING: '撤单中', INACTIVE: '未激活' };
const submissionNames: Record<string, string> = { PERSISTED: '未提交', RECONCILING: '核对中', DENIED: '校验未通过', NOT_SUBMITTED: '未提交', PENDING: '提交中', CLAIMED: '提交中', SUBMITTING: '提交中', SUBMITTED: '已提交', ACKNOWLEDGED: '券商已接收', UNKNOWN: '待核对', REJECTED: '已拒绝' };
const limitFields = [
  ['maxOrderNotional', '单笔最大名义金额', 'USD'], ['maxTotalExposure', '账户最大总敞口', 'USD'],
  ['maxSymbolWeight', '单一标的最大权重', '%'], ['maxDailyLoss', '当日最大亏损', 'USD'],
  ['maxDailyOrders', '每日最大订单数', '笔'], ['maxOrdersPerMinute', '每分钟最大订单数', '笔'],
  ['maxPriceDeviation', '限价偏离行情上限', '%'], ['feeReserve', '手续费预留', 'USD'],
  ['maxQuoteAgeSeconds', '行情最大年龄', '秒'], ['maxAccountAgeSeconds', '账户快照最大年龄', '秒'],
] as const;

export function PaperTradingWorkspace({ state, openSettings }: { state: WorkbenchState; openSettings: () => void }) {
  const [status, setStatus] = useState<PaperStatus | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState('');
  const actionLock = useRef(false), quoteRevision = useRef(0);
  const [symbol, setSymbol] = useState('AAPL'), [found, setFound] = useState<PaperContract[]>([]), [contracts, setContracts] = useState<PaperContract[]>([]);
  const [candidates, setCandidates] = useState<PaperSearchCandidate[]>([]);
  const searchRevision = useRef(0);
  const [quote, setQuote] = useState<PaperQuote | null>(null), [quoteError, setQuoteError] = useState(''), [quoteBusy, setQuoteBusy] = useState(false);
  const [order, setOrder] = useState({ conId: '', side: 'BUY' as 'BUY' | 'SELL', quantity: '10', limitPrice: '', orderType: 'LMT' as 'LMT'|'MKT' });
  const [preview, setPreview] = useState<PaperOrderPreview | null>(null), [cancelOrder, setCancelOrder] = useState<PaperOrderRecord | null>(null);
  const [tableTab, setTableTab] = useState<'orders' | 'holdings'>('orders'), [hours, setHours] = useState('1'), [now, setNow] = useState(Date.now());
  const [limits, setLimits] = useState<Record<keyof PaperRiskLimits, string>>(() => ({
    maxOrderNotional: '10000', maxTotalExposure: String(Math.max(1, Math.floor(Number(state.snapshot.metrics.netLiquidation || 100000) * .95))),
    maxSymbolWeight: '30', maxDailyLoss: '5000', maxDailyOrders: '20', maxOrdersPerMinute: '2',
    maxQuoteAgeSeconds: '5', maxAccountAgeSeconds: '20', maxPriceDeviation: '2', feeReserve: '5',
  }));
  const selected = contracts.find(row => String(row.conId) === order.conId);
  const paperSelected = state.source === 'gateway' && state.gatewayMode === 'paper';
  const online = status?.available && status.connection === 'connected';
  const cash = state.snapshot.cash.find(row => row.currency === 'USD')?.amount;
  const position = state.snapshot.positions.find(row => row.conId === selected?.conId);
  const referencePrice = order.orderType === 'MKT' ? Number((order.side === 'BUY' ? quote?.ask : quote?.bid) ?? quote?.last ?? 0) : Number(order.limitPrice);
  const amount = Number(order.quantity) * referencePrice;
  const capacity = referencePrice > 0 && cash != null ? Math.max(0, Math.floor((Number(cash) - Number(limits.feeReserve)) / (referencePrice * (order.orderType === 'MKT' ? 1.05 : 1)))) : null;
  const load = useCallback(async () => { setStatus(await paperRequest<PaperStatus>('status')); }, []);
  useEffect(() => {
    if (!paperSelected) return;
    let disposed = false;
    const poll = async () => { try { const value = await paperRequest<PaperStatus>('status'); if (!disposed) setStatus(value); } catch (e) { if (!disposed) setError(message(e)); } };
    void poll(); const timer = setInterval(() => void poll(), 4000);
    return () => { disposed = true; clearInterval(timer); };
  }, [paperSelected]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!status?.available) return;
    let disposed = false;
    const ids = status.policy?.conIds;
    void Promise.all((ids?.length ? ids.map(conId => ({ conId })) : [{ symbol: 'AAPL' }]).map(query => paperRequest<PaperContract[]>('contract', query)))
      .then(rows => { if (disposed) return; const list = rows.flat(); setContracts(list); if (list[0]) setOrder(current => ({ ...current, conId: current.conId || String(list[0].conId) })); })
      .catch(e => { if (!disposed) setQuoteError(message(e)); });
    return () => { disposed = true; };
  }, [status?.available]);
  const refreshQuote = useCallback(async (contract: PaperContract, quiet = false) => {
    const revision = ++quoteRevision.current; if (!quiet) setQuoteBusy(true);
    try { const value = await paperRequest<PaperQuote>('market-quote', { conId:contract.conId,symbol:contract.symbol,currency:contract.currency,exchange:contract.exchange }); if (revision === quoteRevision.current) {setQuote(value);setQuoteError('');} }
    catch (e) { if (revision === quoteRevision.current) {setQuoteError(message(e));setQuote(current=>current?{...current,state:'stale'}:null);} }
    finally { if (revision === quoteRevision.current) setQuoteBusy(false); }
  }, []);
  useEffect(() => {
    setPreview(null); setQuote(null); setQuoteBusy(false);
    if (!selected) return;
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    const poll = async (quiet = true) => {
      if (!document.hidden) await refreshQuote(selected,quiet);
      if (!disposed) timer = setTimeout(() => void poll(),5000);
    };
    void poll(false);
    return () => { disposed=true;clearTimeout(timer);++quoteRevision.current; };
  }, [selected?.conId,selected?.symbol,selected?.exchange, refreshQuote]);
  const execute = async (name: string, run: () => Promise<void>) => {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(name); setError(''); setNotice('');
    try { await run(); } catch (e) { setError(message(e)); } finally { actionLock.current = false; setBusy(''); }
  };
  const updateOrder = (patch: Partial<typeof order>) => { setPreview(null); setOrder(current => ({ ...current, ...patch })); };
  const add = (row: PaperContract) => {
    setContracts(current => current.some(item => item.conId === row.conId) ? current : [...current, row]);
    setFound([]); setCandidates([]); setSymbol(row.symbol); updateOrder({ conId: String(row.conId), limitPrice: '' });
  };
  const search = () => execute('search', async () => {
    const query = symbol.trim(), revision = ++searchRevision.current;
    setFound([]); setCandidates([]);
    if (/^[A-Za-z][A-Za-z0-9. -]{0,15}$/.test(query)) {
      const rows = await paperRequest<PaperContract[]>('contract', { symbol: query });
      if (revision !== searchRevision.current) return;
      if (rows.length) {setFound(rows);return;}
    }
    const rows = await paperRequest<PaperSearchCandidate[]>('search', { query });
    if (revision !== searchRevision.current) return;
    setCandidates(rows); if (!rows.length) setError('没有找到匹配的美股或 ETF，请缩短公司名或输入股票代码。');
  });
  const chooseCandidate = (candidate: PaperSearchCandidate) => execute('resolve',async()=>{
    const revision = searchRevision.current;
    const rows = await paperRequest<PaperContract[]>('contract',{symbol:candidate.brokerSymbol});
    if (revision !== searchRevision.current) return;
    const matches = rows.filter(row=>row.currency==='USD' && row.symbol.replace(/[ ._]/g,'.')===candidate.symbol &&
      (row.exchange===candidate.exchange || candidate.exchange==='NASDAQ'&&row.exchange==='ISLAND' || candidate.exchange==='AMEX'&&['ARCA','NYSEARCA'].includes(row.exchange || '')));
    if (matches.length===1) add({...matches[0],name:candidate.name+' · '+(matches[0].name || candidate.symbol)});
    else if (matches.length>1) {setCandidates([]);setFound(matches);}
    else setError('IBKR 未返回该股票的匹配合约，请检查 Gateway 连接或使用股票代码重试。');
  });
  const parsedLimits = useMemo(() => ({
    ...limits, maxSymbolWeight: String(Number(limits.maxSymbolWeight) / 100), maxPriceDeviation: String(Number(limits.maxPriceDeviation) / 100),
    maxDailyOrders: Number(limits.maxDailyOrders), maxOrdersPerMinute: Number(limits.maxOrdersPerMinute),
    maxQuoteAgeSeconds: Number(limits.maxQuoteAgeSeconds), maxAccountAgeSeconds: Number(limits.maxAccountAgeSeconds),
  }) as PaperRiskLimits, [limits]);
  const validLimits = Number(hours) > 0 && Number(hours) <= 8 && Object.values(limits).every(v => v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0);
  const authorized = !status?.enabled || !!selected && !!status.policy?.conIds.includes(selected.conId);
  const validOrder = !!selected && /^[1-9]\d*$/.test(order.quantity) && (order.orderType === 'MKT' || /^\d+(\.\d+)?$/.test(order.limitPrice) && Number(order.limitPrice) > 0) && Number.isFinite(amount);
  const makePreview = () => execute('preview', async () => {
    if (!selected) return;
    if (!status?.enabled) setStatus(await paperRequest<PaperStatus>('configure', { conIds: [selected.conId], expiresAt: new Date(Date.now() + Number(hours) * 3600000).toISOString(), limits: parsedLimits, explicit: true }));
    setPreview(await paperRequest<PaperOrderPreview>('preview', { conId: selected.conId, side: order.side, quantity: order.quantity, ...(order.orderType === 'MKT' ? { orderType: 'MKT' } : { limitPrice: order.limitPrice }) }));
  });
  const confirm = () => execute('confirm', async () => {
    if (!preview || Date.parse(preview.expiresAt) <= Date.now()) return;
    const row = await paperRequest<PaperOrderRecord>('confirm', { previewId: preview.previewId, bodyHash: preview.bodyHash, explicit: true });
    setPreview(null); setTableTab('orders');
    setNotice(row.execution === 'FILLED' ? '券商确认订单已成交，请查看下方成交数量。' : '订单已提交，正在等待券商回报。成交情况以下方订单状态为准。');
    setStatus(current => current ? { ...current, orders: [...current.orders.filter(r => r.intent.clientIntentId !== row.intent.clientIntentId), row] } : current);
    await load();
  });
  const cancel = () => execute('cancel', async () => {
    if (!cancelOrder) return;
    await paperRequest('cancel', { intentId: cancelOrder.intent.clientIntentId, bodyHash: cancelOrder.bodyHash, explicit: true });
    setCancelOrder(null); setNotice('撤单请求已发送，等待券商确认。'); await load();
  });
  const step = (field: 'quantity' | 'limitPrice', direction: number) => {
    const increment = field === 'quantity' ? 1 : Number(quote?.minTick || '.01');
    const next = Math.max(field === 'quantity' ? 1 : increment, Number(order[field] || 0) + direction * increment);
    updateOrder({ [field]: field === 'quantity' ? String(Math.round(next)) : next.toFixed(2) });
  };
  const contractFor = (id: number) => contracts.find(r => r.conId === id) || state.snapshot.positions.find(r => r.conId === id);
  const nameFor = (id: number) => contractFor(id)?.symbol || '合约 ' + id;
  const logoFor = (id: number) => { const contract = contractFor(id); return contract ? <HoldingLogo holding={{ ...contract, assetType: 'STK' }}/> : null; };
  const quoteNames: Record<string, string> = { reference: '参考行情 · 实时性未确认', stale: '刷新失败 · 上次报价', realtime: '实时快照', delayed: '延迟行情', frozen: '冻结行情', 'delayed-frozen': '延迟冻结行情', missing: '暂无行情' };
  const change = quote?.last && quote.close ? (Number(quote.last) / Number(quote.close) - 1) * 100 : null;
  const previewSeconds = preview ? Math.max(0, Math.ceil((Date.parse(preview.expiresAt) - now) / 1000)) : 0;
  if (!paperSelected) return <section className="awb-panel awb-paper-blocked"><ShoppingCart/><h2>连接模拟账户，开始练习交易</h2><p>请在连接设置中选择 IB Gateway 模拟盘。</p><button className="primary" onClick={openSettings}>前往连接设置</button></section>;

  return <div className="awb-paper-workspace pt-workspace">
    {error && <div className="awb-message error" role="alert"><span>{error}</span><button aria-label="关闭错误" onClick={() => setError('')}><X size={15}/></button></div>}
    {notice && <div className="pt-notice" role="status"><Check size={16}/>{notice}</div>}
    <div className="pt-account-strip">
      <span className={'pt-connection ' + (online ? 'online' : '')}><i/>{online ? '模拟账户已连接' : status ? '模拟交易暂不可用' : '正在读取账户'}</span>
      <span>{status?.account || 'IB Gateway'} <b className="pt-paper-tag">模拟资金</b></span>
      <span>账户净值 <strong>{money(state.snapshot.metrics.netLiquidation)} <small>USD</small></strong></span>
      <span>美元现金 <strong>{money(cash)} <small>USD</small></strong></span>
      <button onClick={() => void execute('status', load)} disabled={!!busy}><RefreshCw size={14}/>刷新状态</button>
    </div>
    {status && !status.available && <section className="awb-panel awb-paper-setup"><h2><ShieldCheck size={18}/>{status.connection === 'connected' ? '模拟盘当前仍是只读连接' : '请先连接模拟盘 Gateway'}</h2><p>打开 Gateway「配置 → API → 设置」，取消勾选“只读 API”，应用后重新连接模拟账户。</p><button className="primary" disabled={!!busy || status.connection !== 'connected'} onClick={() => void execute('transport', async () => { await paperRequest('transport', { explicit: true }); await load(); })}>我已取消只读，启用模拟盘订单连接</button> <button onClick={openSettings}>打开连接设置</button></section>}
    <div className="pt-trade-grid">
      <section className="awb-panel pt-market">
        <div className="pt-section-title"><span><Search size={17}/>股票与行情</span><small>美国股票 · ETF</small></div>
        <form className="awb-paper-search" onSubmit={e => { e.preventDefault(); void search(); }}><input aria-label="搜索模拟盘合约" value={symbol} onChange={e => {setSymbol(e.target.value);++searchRevision.current;setFound([]);setCandidates([]);}} placeholder="股票代码 / 中文公司名，如 AAPL、苹果、伯克希尔" maxLength={60} autoComplete="off"/><button type="submit" disabled={!symbol.trim() || !!busy || !online}><Search size={15}/>{busy === 'search' ? '查询中' : '搜索股票'}</button></form>
        {!!candidates.length && <div className="awb-paper-contract-results pt-search-results">{candidates.map(row=><button key={row.symbol} disabled={!!busy || !online} onClick={()=>void chooseCandidate(row)}><HoldingLogo holding={{symbol:row.symbol,currency:'USD',assetType:'STK',exchange:row.exchange}}/><b>{row.symbol}</b><span>{row.name} · {row.exchange} · {row.kind}</span><small>{busy==='resolve'?'核验中…':'选择'}</small></button>)}</div>}
        {!!found.length && <div className="awb-paper-contract-results">{found.map(row => <button key={row.conId} onClick={() => add(row)}><b>{row.symbol}</b><span>{row.name} · {row.exchange} · {row.currency}</span><small>选择</small></button>)}</div>}
        <div className="pt-stock-heading"><div className="pt-stock-mark">{selected ? <HoldingLogo holding={{ ...selected, assetType: 'STK' }}/> : '—'}</div><div><h2>{selected?.symbol || '选择一只股票'}<span>{selected?.exchange || 'SMART'}</span></h2><p>{selected?.name || '搜索股票代码，查看行情并填写订单'}</p></div><button className="pt-icon-button" aria-label="刷新股票行情" disabled={!selected || quoteBusy} onClick={() => selected && void refreshQuote(selected)}><RefreshCw size={17} className={quoteBusy ? 'pt-spin' : ''}/></button></div>
        <div className="pt-price"><strong>{money(quote?.last ?? quote?.close)}</strong><span>USD</span>{change !== null && <b className={change >= 0 ? 'pt-up' : 'pt-down'}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</b>}</div>
        <div className="pt-quote-caption"><span>{quoteBusy ? '正在读取东方财富行情…' : '东方财富 · ' + (quote ? quoteNames[quote.state] || '参考行情' : '等待报价')}</span>{quote && <time>报价 {quote.asOf ? new Date(quote.asOf).toLocaleString('zh-CN', { hour12:false }) : '时间未提供'} · 获取 {new Date(quote.fetchedAt).toLocaleTimeString('zh-CN', { hour12:false })}</time>}</div>
        {quoteError && <p className="pt-muted-message">{quoteError}</p>}
        {quote?.state === 'missing' && <p className="pt-muted-message">东方财富暂未返回这只股票的报价，请稍后刷新。</p>}
        <div className="pt-market-facts pt-chart-facts">{(['open','close','high','low','volume','amount'] as const).map((field,i)=><span key={field}>{['今开','昨收','最高','最低','成交量','成交额 · USD'][i]}<b>{quote?.[field] == null ? '—' : i<4 ? money(quote[field]) : Number(quote[field]).toLocaleString('zh-CN',{notation:'compact',maximumFractionDigits:2})}</b></span>)}</div>
        <TicketPriceChart contract={selected}/>
        <div className="pt-session"><Clock3 size={18}/><div><strong>{quote?.regularHours === true ? '美股常规交易时段' : quote?.regularHours === false ? '美股常规时段已休市' : '常规交易时间 09:30–16:00 美东'}</strong><p>{quote?.nextOpen ? '下次开市：' + new Date(quote.nextOpen).toLocaleString('zh-CN', { hour12: false }) + '（本地时间）' : '限价单 · 当日有效 · 常规交易时段'}</p></div></div>
        <div className="pt-position-summary"><div><Wallet size={17}/>当前股票持仓</div><strong>{position ? Number(position.quantity).toLocaleString('en-US', { maximumFractionDigits: 6 }) : '0'} <small>股</small></strong><span>平均成本 <b>{money(position?.averageCost)} USD</b></span></div>
        <p className="pt-source-note">报价每 5 秒、分时每 30 秒刷新，后台标签页暂停刷新。报价时间来自上游，不保证逐笔实时；市价单按 IBKR 实际成交价结算。{quote?.sourceUrl && <a href={quote.sourceUrl} target="_blank" rel="noreferrer"> 查看行情来源 ↗</a>}</p>
      </section>
      <section className={'awb-panel pt-ticket ' + (order.side === 'SELL' ? 'is-sell' : '')}>
        <div className="pt-section-title"><span><ShoppingCart size={17}/>交易下单</span><span className="pt-paper-tag">模拟盘</span></div>
        <div className="pt-depth"><div className="pt-depth-heading"><strong>三档买卖盘</strong><small>东方财富 · 价格 USD · 数量为上游原始单位</small></div><div className="pt-depth-columns">{(['bids','asks'] as const).map(side => <div className={'pt-depth-side '+side} key={side}><div className="pt-depth-labels"><span>{side === 'bids' ? '买盘' : '卖盘'}</span><span>价格</span><span>挂单量</span></div>{[1,2,3].map(level => { const item = quote?.[side]?.find(row => row.level === level); const price = item?.price ?? (level === 1 ? quote?.[side === 'bids' ? 'bid' : 'ask'] : null); return <button key={level} aria-label={(side === 'bids' ? '买' : '卖')+['一','二','三'][level-1]+'价'+(price ? ' '+price+' 填入限价' : ' 未提供')} disabled={!price || quote?.state==='stale'} onClick={()=>updateOrder({limitPrice:price!,orderType:'LMT'})}><span>{side === 'bids' ? '买' : '卖'}{['一','二','三'][level-1]}</span><b>{price ? money(price) : '未提供'}</b><span>{item?.size ? Number(item.size).toLocaleString('en-US') : '—'}</span></button>; })}</div>)}</div>{!quote?.bids?.some(row=>row.price) && !quote?.asks?.some(row=>row.price) && <p>上游暂未提供该美股的买卖档位，不用最新成交价推算挂单价格。</p>}</div>
        <div className="pt-side-switch" role="group" aria-label="买卖方向">{(['BUY', 'SELL'] as const).map(side => <button key={side} aria-pressed={order.side === side} className={order.side === side ? 'active' : ''} onClick={() => updateOrder({ side })}>{side === 'BUY' ? '买入' : '卖出'}</button>)}</div>
        <div className="pt-fixed-field"><span>订单类型</span><div className="pt-order-types" role="group" aria-label="订单类型">{(['LMT','MKT'] as const).map(type => <button key={type} disabled={type === 'MKT' && !status?.supportedOrderTypes?.includes('MKT')} title={type === 'MKT' && !status?.supportedOrderTypes?.includes('MKT') ? '重启本地桥接后即可使用市价单' : undefined} aria-pressed={order.orderType === type} onClick={() => updateOrder({ orderType:type })}>{type === 'LMT' ? '限价单' : '市价单'}</button>)}</div></div>
        {online && !status?.supportedOrderTypes?.includes('MKT') && <p className="pt-muted-message">市价单接口已更新，请重启本地桥接服务后使用。</p>}<p className="pt-field-help">{order.orderType === 'MKT' ? '按市场可成交价格执行，不设成交价上限；资金按参考价加 5% 预留。' : order.side === 'BUY' ? '只以设定价格或更低价格买入。' : '只以设定价格或更高价格卖出已有持仓。'}</p>
        {(['limitPrice', 'quantity'] as const).filter(field => field === 'quantity' || order.orderType === 'LMT').map(field => <label className="pt-field" key={field}><span>{field === 'quantity' ? '数量' : '限价'} <small>{field === 'quantity' ? '股 · 整股交易' : 'USD'}</small></span><div className="pt-stepper"><button type="button" aria-label={field === 'quantity' ? '减少股数' : '降低限价'} onClick={() => step(field, -1)}><Minus size={16}/></button><input aria-label={field === 'quantity' ? '数量（整股）' : '限价（USD）'} inputMode={field === 'quantity' ? 'numeric' : 'decimal'} placeholder="输入每股价格" value={order[field]} onChange={e => updateOrder({ [field]: e.target.value })}/><button type="button" aria-label={field === 'quantity' ? '增加股数' : '提高限价'} onClick={() => step(field, 1)}><Plus size={16}/></button></div></label>)}
        <div className="pt-quantity-presets">{[10, 50, 100].map(value => <button key={value} onClick={() => updateOrder({ quantity: String(value) })}>{value} 股</button>)}<button disabled={order.side === 'BUY' ? !capacity : !position} onClick={() => updateOrder({ quantity: String(order.side === 'BUY' ? capacity : Math.floor(Number(position?.quantity || 0))) })}>{order.side === 'BUY' ? '现金可买' : '全部可卖'}</button></div>
        <div className="pt-fixed-field"><span>有效期</span><b>当日有效 <small>DAY</small></b></div><div className="pt-fixed-field"><span>交易时段</span><b>常规时段</b></div>
        <div className="pt-estimate"><span>预估订单金额</span><strong>{validOrder && referencePrice > 0 ? money(amount) : '—'} <small>USD</small></strong><p>{order.side === 'BUY' ? '按美元现金估算可买 ' + (capacity ?? '—') + ' 股；实际以已结算现金校验为准。' : '当前可卖持仓 ' + Math.floor(Number(position?.quantity || 0)) + ' 股。'}<br/>金额未含手续费，预留 {money(status?.policy?.limits?.feeReserve ?? limits.feeReserve)} USD。</p></div>
        <details className="pt-settings"><summary><SlidersHorizontal size={15}/>模拟交易设置<ChevronDown size={14}/></summary><p>单笔上限 {money(status?.policy?.limits?.maxOrderNotional ?? limits.maxOrderNotional)} USD · {status?.enabled ? '本次范围已开启' : '首次预览时开启所选股票的交易范围'}。</p>{!status?.enabled ? <div className="awb-paper-risk-grid">{limitFields.map(([key, label, unit]) => <label key={key}>{label}<span><input inputMode="decimal" value={limits[key]} onChange={e => setLimits(current => ({ ...current, [key]: e.target.value }))}/><i>{unit}</i></span></label>)}<label>授权有效期<span><input inputMode="decimal" value={hours} onChange={e => setHours(e.target.value)}/><i>小时</i></span></label></div> : <p>授权股票：{status.policy?.conIds.map(nameFor).join('、')}。有效至 {status.policy && new Date(status.policy.expiresAt).toLocaleTimeString('zh-CN', { hour12: false })}。</p>}</details>
        {!authorized && <p className="pt-muted-message">这只股票不在本次交易范围中，请选择已授权股票。</p>}
        <button className="primary pt-submit" disabled={!online || !authorized || !validOrder || (!status?.enabled && !validLimits) || !!busy} onClick={() => void makePreview()}>{busy === 'preview' ? '正在校验订单…' : status?.enabled ? '预览' + (order.side === 'BUY' ? '买入' : '卖出') + '订单' : '开启模拟交易并预览'}<ArrowUpRight size={17}/></button>
        <p className="pt-submit-note">{status?.enabled ? '预览后再次确认，才会发送订单。' : '开启范围：' + (selected?.symbol || '所选股票') + ' · 单笔 ≤ ' + money(limits.maxOrderNotional) + ' USD · ' + hours + ' 小时。预览不会发送订单。'}</p>
      </section>
    </div>
    <section className="awb-panel pt-activity"><div className="pt-activity-header"><div role="tablist" aria-label="交易记录"><button role="tab" aria-selected={tableTab === 'orders'} onClick={() => setTableTab('orders')}>订单 <span>{status?.orders.length ?? 0}</span></button><button role="tab" aria-selected={tableTab === 'holdings'} onClick={() => setTableTab('holdings')}>持仓 <span>{state.snapshot.positions.length}</span></button></div><div><button disabled={!!busy || !status?.enabled} onClick={() => void execute('reconcile', async () => { await paperRequest('reconcile', {}); await load(); })}><RefreshCw size={14}/>刷新订单</button>{status?.enabled && <button disabled={!!busy} onClick={() => void execute('stop', async () => { await paperRequest('stop', {}); await load(); })}><CircleStop size={14}/>停止新增订单</button>}</div></div>
      <div className="awb-table-scroll">{tableTab === 'orders' ? <table><thead><tr><th>股票</th><th>方向</th><th>委托数量</th><th>限价 / USD</th><th>订单状态</th><th>成交数量</th><th>成交均价 / USD</th><th>操作</th></tr></thead><tbody>{status?.orders.map(row => <tr key={row.intent.clientIntentId}><td><div className="pt-stock-cell">{logoFor(row.intent.conId)}<div><b>{nameFor(row.intent.conId)}</b><small>{(row.orderId ?? row.brokerOrderId) ? '#' + (row.orderId ?? row.brokerOrderId) : '等待订单编号'}</small></div></div></td><td className={row.intent.side === 'BUY' ? 'pt-up' : 'pt-down'}>{row.intent.side === 'BUY' ? '买入' : '卖出'}</td><td>{row.intent.quantity} 股</td><td>{row.intent.orderType === 'MKT' ? '市价' : money(row.intent.limitPrice)}</td><td><span className={'pt-order-state ' + (row.execution === 'FILLED' ? 'filled' : '')}>{executionNames[row.execution] || submissionNames[row.submission] || '等待券商回报'}</span>{row.reconciliationRequired && <small>需刷新订单核对</small>}</td><td>{row.filledQuantity || '0'}</td><td>{money(row.averageFillPrice)}</td><td><button disabled={!!busy || ['FILLED', 'CANCELLED', 'REJECTED'].includes(row.execution)} onClick={() => setCancelOrder(row)}>撤单</button></td></tr>)}</tbody></table> : <table><thead><tr><th>股票</th><th>持仓数量</th><th>平均成本</th><th>持仓市值</th><th>操作</th></tr></thead><tbody>{state.snapshot.positions.map(row => <tr key={row.conId}><td><div className="pt-stock-cell"><HoldingLogo holding={{ ...row, assetType: row.assetType || 'STK' }}/><div><b>{row.symbol}</b><small>{row.currency}</small></div></div></td><td>{row.quantity} 股</td><td>{money(row.averageCost)}</td><td>{money(row.marketValue)}</td><td><button onClick={() => { add({ conId: row.conId, symbol: row.symbol, currency: row.currency }); updateOrder({ side: 'SELL', quantity: String(Math.floor(Number(row.quantity))) }); }}>卖出</button></td></tr>)}</tbody></table>}
      {!(tableTab === 'orders' ? status?.orders.length : state.snapshot.positions.length) && <div className="pt-empty"><ShoppingCart size={24}/><div><b>{tableTab === 'orders' ? '还没有模拟订单' : '暂无持仓'}</b><p>{tableTab === 'orders' ? '在上方选股票、填写价格与数量，预览并确认后，订单会出现在这里。' : '成交并同步后，持仓会显示在这里。'}</p></div></div>}</div><p className="pt-source-note">此处记录 SparkFlow 提交的委托，成交状态以 IBKR 回报为准。模拟资金不影响实盘账户。</p></section>
    {preview && <div className="awb-overlay pt-modal-backdrop"><section className="pt-review" role="dialog" aria-modal="true" aria-label="确认模拟订单"><div className="pt-section-title"><span>确认模拟订单</span><button aria-label="关闭订单预览" disabled={!!busy} onClick={() => setPreview(null)}><X size={18}/></button></div><span className="pt-paper-tag">IBKR 模拟账户 · {status?.account}</span><h2>{preview.side === 'BUY' ? '买入' : '卖出'} {preview.symbol}</h2><div className="pt-review-total">{preview.quantity} <small>股</small></div><dl><dt>委托价格</dt><dd>{preview.orderType === 'MKT' ? '市价成交' : money(preview.limitPrice) + ' USD'}</dd><dt>订单类型</dt><dd>{preview.orderType === 'MKT' ? '市价单' : '限价单'} · 当日有效</dd><dt>交易时段</dt><dd>常规交易时段</dd><dt>{preview.orderType === 'MKT' ? '预估占用（含 5% 缓冲）' : '订单金额'}</dt><dd>{money(preview.reservedNotional)} USD</dd><dt>预留现金（含费用预留）</dt><dd>{money(preview.reservedCash)} USD</dd></dl>{preview.warnings.map(w => <p className="pt-muted-message" key={w}>{w}</p>)}<p className="pt-submit-note">{previewSeconds ? '请在 ' + previewSeconds + ' 秒内确认，发送时会再次校验。' : '预览已过期，请返回重新预览。'}</p><button className="primary pt-submit" disabled={!!busy || !previewSeconds} onClick={() => void confirm()}><Check size={17}/>{busy === 'confirm' ? '发送中…' : '确认发送模拟订单'}</button><button className="pt-back" disabled={!!busy} onClick={() => setPreview(null)}>返回修改</button></section></div>}
    {cancelOrder && <div className="awb-overlay"><section className="awb-paper-confirm" role="dialog" aria-modal="true" aria-label="撤销模拟订单"><AlertTriangle/><h2>确认撤销模拟订单？</h2><p>{nameFor(cancelOrder.intent.conId)} · {cancelOrder.intent.side === 'BUY' ? '买入' : '卖出'} {cancelOrder.intent.quantity} 股 · 限价 {cancelOrder.intent.orderType === 'MKT' ? '市价' : money(cancelOrder.intent.limitPrice)} USD</p><div><button disabled={!!busy} onClick={() => setCancelOrder(null)}>返回</button><button className="primary" disabled={!!busy} onClick={() => void cancel()}>确认撤单</button></div></section></div>}
  </div>;
}
