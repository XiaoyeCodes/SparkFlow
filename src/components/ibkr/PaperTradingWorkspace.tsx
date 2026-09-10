import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, ArrowUpRight, BarChart3, Check, ChevronDown, CircleDollarSign, Clock3, History, Minus, Plus, RefreshCw, Scale, Search, ShieldCheck, ShoppingCart, SlidersHorizontal, Sunrise, TrendingDown, TrendingUp, Wallet, X } from 'lucide-react';
import type { PaperContract, PaperSearchCandidate, PaperOrderPreview, PaperOrderRecord, PaperQuote, PaperRiskLimits, PaperStatus, WorkbenchState } from '../../lib/ibkr/workbenchTypes';
import './PaperTradingWorkspace.css';
import { HoldingLogo } from './HoldingLogo';
import { TicketPriceChart } from './TicketPriceChart';
import { PaperOrderReceipt } from './PaperOrderReceipt';
import { paperReceiptStatus, type PaperReceipt } from '../../lib/ibkr/paperReceipt';

const api = '/api/ibkr-workbench/paper/';
async function paperRequest<T>(endpoint: string, value?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(api + endpoint, { signal, ...(value === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '模拟盘订单服务暂不可用');
  return data;
}
const errors: Record<string, string> = {
  PAPER_GATEWAY_READONLY: 'Gateway 的 API 仍为只读，请取消“只读 API”后重新连接模拟账户。',
  PAPER_ACCOUNT_UNAVAILABLE: '模拟账户已断开，请到连接设置中点击智能连接。',
  PAPER_BRIDGE_UPDATE_REQUIRED: '新版行情接口尚未加载，请重启 SparkFlow 本地桥接服务后重新连接模拟账户。',
  PAPER_EXECUTION_DISABLED: '模拟交易当前未启用或本次时段已结束，请重新预览订单。',
  PAPER_POLICY_ALREADY_CONFIGURED: '股票切换尚未完成，请重新预览订单。',
  PAPER_SESSION_CHANGED: 'Gateway 会话已更新，旧订单预览已失效，请重新预览。',
  CONTRACT_SCOPE: '股票切换尚未完成，请重新预览订单。',
  PAPER_POLICY_EXPIRY: '本次交易有效期需在 8 小时以内。',
  PREVIEW_EXPIRED: '预览已过期，请重新预览后再确认。',
  PREVIEW_BODY_CHANGED: '订单已修改，请重新预览。',
  STALE_QUOTE: '券商实时行情不够新，请刷新行情后重试。',
  QUOTE_NOT_REALTIME: '下单校验需要 IBKR 实时行情，请检查行情权限。',
  QUOTE_UNAVAILABLE: '当前没有可用于订单校验的 IBKR 实时行情。',
  PRICE_DEVIATION: '限价与 IBKR 当前参考价偏差过大，已刷新行情；请核对新价格后重新预览。',
  ORDER_FREQUENCY_LIMIT: '短时间内订单较多，请稍后再预览；订单尚未发送。',
  PAPER_REFERENCE_UNAVAILABLE: 'IBKR 暂未返回可用于估算资金的持仓估值或行情快照，请稍后重新预览。',
  IBKR_10189: 'IBKR 拒绝了该股票的逐笔行情请求：缺少 API 行情订阅权限（10189）。请在 IBKR 核对美股行情权限及模拟盘行情共享后重试。',
  IBKR_10089: 'IBKR 提示该股票的 API 行情需要额外订阅（10089），暂未发送订单。',
  IBKR_354: 'IBKR 未授权该股票的行情（354），请核对行情订阅及模拟盘共享设置。',
  IBKR_10197: 'IBKR 行情被另一登录会话占用（10197），请关闭冲突会话后重试。',
  MISSING_QUOTE_AND_RISK_PROFILE: '尚未取得完整的实时成交行情与账户数据。请确认处于常规交易时段并已开通 API 行情权限。',
  ACCOUNT_STALE: '账户数据已过期，请刷新账户。',
  RECONCILIATION_REQUIRED: '账户或订单对账尚未完成，请刷新订单核对状态后再预览。',
  ACCOUNT_PROOF_SCOPE: 'Gateway 会话已变化，请重新预览订单以使用当前连接。',
  ACCOUNT_INTEGRITY_HALT: '订单记录需要重新核对，请点击“刷新订单”。若仍无法恢复，请保留当前订单状态以便检查。',
  BRIDGE_RESTARTING: '正在更新本地桥接服务，请连接恢复后重新预览。',
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
const quoteFacts = [
  ['open', '今开', 'price', Sunrise], ['close', '昨收', 'price', History], ['high', '最高', 'price', TrendingUp], ['peDynamic', '市盈率（动）', 'ratio', Activity],
  ['low', '最低', 'price', TrendingDown], ['volume', '成交量', 'compact', BarChart3], ['amount', '成交额 · USD', 'compact', CircleDollarSign], ['peStatic', '市盈率（静）', 'ratio', Scale],
] as const;
const formatQuoteFact = (value: string | null | undefined, kind: typeof quoteFacts[number][2]) => {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '—';
  if (kind === 'price') return money(value);
  if (kind === 'ratio') return Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return Number(value).toLocaleString('zh-CN', { notation: 'compact', maximumFractionDigits: 2 });
};
const executionNames: Record<string, string> = { NONE: '待回报', PENDING: '待回报', OPEN: '已报单', SUBMITTED: '已报单', PARTIAL: '部分成交', PARTIALLY_FILLED: '部分成交', FILLED: '已成交', CANCELLED: '已撤单', REJECTED: '已拒绝', UNKNOWN: '待核对', CANCEL_PENDING: '撤单中', INACTIVE: '未激活' };
const submissionNames: Record<string, string> = { PERSISTED: '未提交', RECONCILING: '核对中', DENIED: '校验未通过', NOT_SUBMITTED: '未提交', PENDING: '提交中', CLAIMED: '提交中', SUBMITTING: '提交中', SUBMITTED: '已提交', ACKNOWLEDGED: '券商已接收', UNKNOWN: '待核对', REJECTED: '已拒绝' };
const taskMessages: Record<string, string> = {
  search: '正在搜索股票…', resolve: '正在核验股票合约…', status: '正在刷新交易状态…',
  transport: '正在连接模拟盘订单服务…', preview: '正在读取账户并预览订单…',
  confirm: '正在提交订单，等待券商回报…', cancel: '正在提交撤单请求…',
  reconcile: '正在核对订单、成交与账户数据…',
};
const completedMessages: Record<string, string> = {
  status: '交易状态已刷新。', transport: '模拟盘订单服务已连接。',
  reconcile: '订单与账户数据已核对，请查看下方订单状态。',
};
const limitFields = [
  ['maxOrderNotional', '单笔最大名义金额', 'USD'], ['maxTotalExposure', '账户最大总敞口', 'USD'],
  ['maxSymbolWeight', '单一标的最大权重', '%'], ['maxDailyLoss', '当日最大亏损', 'USD'],
  ['maxDailyOrders', '每日最大订单数', '笔'], ['maxOrdersPerMinute', '每分钟最大订单数', '笔'],
  ['maxPriceDeviation', '限价偏离行情上限', '%'], ['feeReserve', '手续费预留', 'USD'],
  ['maxQuoteAgeSeconds', '行情最大年龄', '秒'], ['maxAccountAgeSeconds', '账户快照最大年龄', '秒'],
] as const;

export function PaperTradingWorkspace({ state, openSettings }: { state: WorkbenchState; openSettings: () => void }) {
  const [status, setStatus] = useState<PaperStatus | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState('');
  const subscriptionError = [errors.IBKR_10089, errors.IBKR_10189, errors.IBKR_354].includes(error);
  const actionLock = useRef(false), quoteRevision = useRef(0);
  const statusRevision = useRef(0);
  const trackedOrder = useRef<{id:string;signature:string} | null>(null);
  const [symbol, setSymbol] = useState('AAPL'), [found, setFound] = useState<PaperContract[]>([]), [contracts, setContracts] = useState<PaperContract[]>([]);
  const [candidates, setCandidates] = useState<PaperSearchCandidate[]>([]);
  const searchRevision = useRef(0);
  const [quote, setQuote] = useState<PaperQuote | null>(null), [quoteError, setQuoteError] = useState(''), [quoteBusy, setQuoteBusy] = useState(false);
  const [order, setOrder] = useState({ conId: '', side: 'BUY' as 'BUY' | 'SELL', quantity: '10', limitPrice: '', orderType: 'LMT' as 'LMT'|'MKT' });
  const [preview, setPreview] = useState<PaperOrderPreview | null>(null), [cancelOrder, setCancelOrder] = useState<PaperOrderRecord | null>(null);
  const [receipt, setReceipt] = useState<PaperReceipt | null>(null), [receiptRefreshing, setReceiptRefreshing] = useState(false);
  const scope = `${state.source}:${state.gatewayMode}:${state.snapshot.accountKey}`, scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [tableTab, setTableTab] = useState<'orders' | 'holdings'>('orders'), [hours, setHours] = useState('1'), [now, setNow] = useState(Date.now());
  const [limits, setLimits] = useState<Record<keyof PaperRiskLimits, string>>(() => ({
    maxOrderNotional: '10000', maxTotalExposure: String(Math.max(1, Math.floor(Number(state.snapshot.metrics.netLiquidation || 100000) * .95))),
    maxSymbolWeight: '30', maxDailyLoss: '5000', maxDailyOrders: '20', maxOrdersPerMinute: '2',
    maxQuoteAgeSeconds: '5', maxAccountAgeSeconds: '20', maxPriceDeviation: '2', feeReserve: '5',
  }));
  const selected = contracts.find(row => String(row.conId) === order.conId);
  const paperSelected = state.source === 'gateway' && state.gatewayMode === 'paper';
  const online = status?.available && status.connection === 'connected';
  const snapshot = status?.snapshot?.accountKey === state.snapshot.accountKey && status.snapshot.mode === 'paper' ? status.snapshot : state.snapshot;
  const cash = snapshot.cash.find(row => row.currency === 'USD')?.amount;
  const position = snapshot.positions.find(row => row.conId === selected?.conId);
  const referencePrice = order.orderType === 'MKT' ? Number((order.side === 'BUY' ? quote?.ask : quote?.bid) ?? quote?.last ?? 0) : Number(order.limitPrice);
  const amount = Number(order.quantity) * referencePrice;
  const capacity = referencePrice > 0 && cash != null ? Math.max(0, Math.floor((Number(cash) - Number(limits.feeReserve)) / (referencePrice * (order.orderType === 'MKT' ? 1.05 : 1)))) : null;
  const load = useCallback(async () => {
    const revision = ++statusRevision.current;
    const value = await paperRequest<PaperStatus>('status', undefined, AbortSignal.timeout(15000));
    if (revision !== statusRevision.current || scope !== scopeRef.current || value.accountKey && value.accountKey !== state.snapshot.accountKey) return;
    setStatus(value);
    setReceipt(current => {
      if (!current || current.pending || current.accountKey !== value.accountKey || !current.row) return current;
      const row = value.orders.find(row => row.intent.clientIntentId === current.row!.intent.clientIntentId);
      return row ? { ...current, row, error: undefined, updatedAt: new Date().toISOString() } : current;
    });
  }, [scope, state.snapshot.accountKey]);
  useEffect(() => {
    ++statusRevision.current; trackedOrder.current = null; setReceipt(null); setPreview(null); setCancelOrder(null); setStatus(null); setError(''); setNotice('');
    return () => { ++statusRevision.current; };
  }, [scope]);
  useEffect(() => {
    if (!paperSelected) return;
    let disposed = false, polling=false, timer:ReturnType<typeof setTimeout>;
    const poll = async () => {
      if(disposed||polling)return;
      clearTimeout(timer);polling=true;
      try { if(!actionLock.current)await load(); } catch (e) { if(!disposed) { setError(message(e)); setReceipt(current => current ? { ...current, error: '状态刷新暂不可用，保留上次回执；不会重新发送订单。' } : current); } }
      finally { polling=false;if(!disposed)timer=setTimeout(()=>void poll(),document.hidden?10000:2000); }
    };
    const resume=()=>{if(!document.hidden)void poll();};
    void poll();document.addEventListener('visibilitychange',resume);window.addEventListener('focus',resume);
    return () => { disposed=true;++statusRevision.current;clearTimeout(timer);document.removeEventListener('visibilitychange',resume);window.removeEventListener('focus',resume); };
  }, [paperSelected,load]);
  useEffect(() => {
    const tracked=trackedOrder.current;
    const row=status?.orders.find(row=>row.intent.clientIntentId===tracked?.id);
    if(!row||!tracked)return;
    const signature=[row.submission,row.execution,row.filledQuantity,row.lastError].join('|');
    if(signature===tracked.signature)return;
    tracked.signature=signature;
    const label=contracts.find(stock=>stock.conId===row.intent.conId)?.symbol || String(row.intent.conId);
    if(row.execution==='FILLED')setNotice(`${label} 订单已成交 ${row.filledQuantity} 股，成交均价 ${money(row.averageFillPrice)} USD。`);
    else if(['PARTIAL','PARTIALLY_FILLED'].includes(row.execution))setNotice(`${label} 已部分成交 ${row.filledQuantity} 股，正在自动同步剩余订单。`);
    else if(row.execution==='CANCELLED')setNotice(`${label} 订单已撤销，已成交 ${row.filledQuantity || '0'} 股。`);
    else if(row.execution==='REJECTED') {setNotice('');setError(`${label} 订单已被券商拒绝。${row.lastError ? message(new Error(row.lastError)) : ''}`);}
  },[status,contracts]);
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
    try { const value = await paperRequest<PaperQuote>('market-quote', { conId:contract.conId,symbol:contract.symbol,currency:contract.currency,exchange:contract.exchange }); if (revision === quoteRevision.current) {setQuote(value);setQuoteError('');return value;} }
    catch (e) { if (revision === quoteRevision.current) {setQuoteError(message(e));setQuote(current=>current?{...current,state:'stale'}:null);} }
    finally { if (revision === quoteRevision.current) setQuoteBusy(false); }
    return null;
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
    actionLock.current = true; ++statusRevision.current; setBusy(name); setError(''); setNotice('');
    try { await run(); if (completedMessages[name]) setNotice(completedMessages[name]); } catch (e) {
      const code = e instanceof Error ? e.message : '';
      let detail = message(e);
      if (name === 'preview' && code === 'PRICE_DEVIATION' && selected && order.orderType === 'LMT') {
        const latest = await refreshQuote(selected);
        const replacement = order.side === 'BUY' ? latest?.ask : latest?.bid;
        if (replacement && latest?.state !== 'stale' && latest?.state !== 'missing') {
          setOrder(current => ({ ...current, limitPrice: replacement }));
          detail = `原限价与 IBKR 当前参考价偏差过大，已更新为${order.side === 'BUY' ? '卖一' : '买一'}价 ${money(replacement)} USD；请核对后重新预览。`;
        }
      }
      setError(detail);
      if (name === 'preview' || name === 'confirm') { setPreview(null); await load().catch(() => {}); }
    } finally { actionLock.current = false; setBusy(''); }
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
  const validOrder = !!selected && /^[1-9]\d*$/.test(order.quantity) && (order.orderType === 'MKT' || /^\d+(\.\d+)?$/.test(order.limitPrice) && Number(order.limitPrice) > 0) && Number.isFinite(amount);
  const makePreview = () => execute('preview', async () => {
    if (!selected) return;
    let current = await paperRequest<PaperStatus>('status');
    const selectedIsCurrent = !!current.policy?.conIds.includes(selected.conId);
    if (!current.enabled || !selectedIsCurrent) {
      const expiresAt = current.policy?.expiresAt && Date.parse(current.policy.expiresAt) > Date.now()
        ? current.policy.expiresAt
        : new Date(Date.now() + Number(hours) * 3600000).toISOString();
      const activeLimits = current.policy?.limits ?? parsedLimits;
      if (current.enabled) await paperRequest('stop', {});
      current = await paperRequest<PaperStatus>('configure', { conIds: [selected.conId], expiresAt, limits: activeLimits, explicit: true });
    }
    setStatus(current);
    setPreview(await paperRequest<PaperOrderPreview>('preview', { conId: selected.conId, side: order.side, quantity: order.quantity, ...(order.orderType === 'MKT' ? { orderType: 'MKT' } : { limitPrice: order.limitPrice }) }));
  });
  const confirm = () => execute('confirm', async () => {
    if (!preview || Date.parse(preview.expiresAt) <= Date.now()) return;
    const submitted = preview;
    const next: PaperReceipt = { ...submitted, orderType: submitted.orderType || order.orderType, account: status?.account || '模拟账户', row: null, pending: true, updatedAt: new Date().toISOString() };
    ++statusRevision.current; setPreview(null); setTableTab('orders'); setReceipt(next);
    try {
      const row = await paperRequest<PaperOrderRecord>('confirm', { previewId: submitted.previewId, bodyHash: submitted.bodyHash, explicit: true }, AbortSignal.timeout(20000));
      if (scope !== scopeRef.current) return;
      if (!row?.intent?.clientIntentId || row.intent.accountKey && row.intent.accountKey !== submitted.accountKey) throw new Error('未取得匹配的订单回执，请核对订单记录。');
      ++statusRevision.current;
      trackedOrder.current = { id: row.intent.clientIntentId, signature: '' };
      setReceipt({ ...next, row, pending: false, updatedAt: new Date().toISOString() });
      setNotice(paperReceiptStatus(row).detail);
      setStatus(current => current ? { ...current, orders: [...current.orders.filter(r => r.intent.clientIntentId !== row.intent.clientIntentId), row] } : current);
    } catch (e) {
      if (scope !== scopeRef.current) return;
      setReceipt({ ...next, pending: false, error: message(e), updatedAt: new Date().toISOString() });
    }
    await load().catch(() => { if (scope === scopeRef.current) setReceipt(current => current ? { ...current, error: '状态刷新暂不可用，保留上次回执；不会重新发送订单。' } : current); });
    if (selected && submitted.orderType === 'LMT') {
      const latest = await refreshQuote(selected);
      const replacement = submitted.side === 'BUY' ? latest?.ask : latest?.bid;
      if (scope === scopeRef.current && replacement && latest?.state !== 'stale' && latest?.state !== 'missing') {
        setOrder(current => ({ ...current, limitPrice: replacement }));
      }
    }
  });
  const refreshReceipt = async () => {
    if (receiptRefreshing) return;
    setReceiptRefreshing(true);
    try { await load(); }
    catch { if (scope === scopeRef.current) setReceipt(current => current ? { ...current, error: '状态刷新暂不可用，保留上次回执；不会重新发送订单。' } : current); }
    finally { setReceiptRefreshing(false); }
  };
  const viewReceipt = (row: PaperOrderRecord) => {
    const contract = contracts.find(contract => contract.conId === row.intent.conId);
    const holding = snapshot.positions.find(holding => holding.conId === row.intent.conId);
    setReceipt({ ...row.intent, accountKey: status?.accountKey || state.snapshot.accountKey, account: status?.account || '模拟账户',
      symbol: contract?.symbol || holding?.symbol || `合约 ${row.intent.conId}`, currency: contract?.currency || holding?.currency || 'USD',
      row, pending: false, updatedAt: new Date().toISOString() });
  };
  const cancel = () => execute('cancel', async () => {
    if (!cancelOrder) return;
    trackedOrder.current={id:cancelOrder.intent.clientIntentId,signature:''};
    await paperRequest('cancel', { intentId: cancelOrder.intent.clientIntentId, bodyHash: cancelOrder.bodyHash, explicit: true });
    setCancelOrder(null); setNotice('撤单请求已发送，等待券商确认。'); await load();
  });
  const step = (field: 'quantity' | 'limitPrice', direction: number) => {
    const increment = field === 'quantity' ? 1 : Number(quote?.minTick || '.01');
    const next = Math.max(field === 'quantity' ? 1 : increment, Number(order[field] || 0) + direction * increment);
    updateOrder({ [field]: field === 'quantity' ? String(Math.round(next)) : next.toFixed(2) });
  };
  const contractFor = (id: number) => contracts.find(r => r.conId === id) || snapshot.positions.find(r => r.conId === id);
  const nameFor = (id: number) => contractFor(id)?.symbol || '合约 ' + id;
  const logoFor = (id: number) => { const contract = contractFor(id); return contract ? <HoldingLogo holding={{ ...contract, assetType: 'STK' }}/> : null; };
  const quoteNames: Record<string, string> = { reference: '参考行情 · 实时性未确认', stale: '刷新失败 · 上次报价', realtime: '实时快照', delayed: '延迟行情', frozen: '冻结行情', 'delayed-frozen': '延迟冻结行情', missing: '暂无行情' };
  const change = quote?.last && quote.close ? (Number(quote.last) / Number(quote.close) - 1) * 100 : null;
  const previewSeconds = preview ? Math.max(0, Math.ceil((Date.parse(preview.expiresAt) - now) / 1000)) : 0;
  if (!paperSelected) return <section className="awb-panel awb-paper-blocked"><ShoppingCart/><h2>连接模拟账户，开始练习交易</h2><p>请在连接设置中选择 IB Gateway 模拟盘。</p><button className="primary" onClick={openSettings}>前往连接设置</button></section>;

  return <div className="awb-paper-workspace pt-workspace">
    <div className="pt-account-strip">
      <span className={'pt-connection ' + (online ? 'online' : '')}><i/>{online ? '模拟账户已连接' : status ? '模拟交易暂不可用' : '正在读取账户'}</span>
      <span>{status?.account || 'IB Gateway'} <b className="pt-paper-tag">模拟资金</b></span>
      <span>账户净值 <strong>{money(snapshot.metrics.netLiquidation)} <small>USD</small></strong></span>
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
        <div className="pt-quote-caption"><span>{quoteBusy ? '正在读取参考行情…' : (quote?.source || '参考行情') + ' · ' + (quote ? quoteNames[quote.state] || '参考行情' : '等待报价')}</span>{quote && <time>报价 {quote.asOf ? new Date(quote.asOf).toLocaleString('zh-CN', { hour12:false }) : '时间未提供'} · 获取 {new Date(quote.fetchedAt).toLocaleTimeString('zh-CN', { hour12:false })}</time>}</div>
        <div className="pt-market-facts pt-chart-facts">{quoteFacts.map(([field,label,kind,Icon])=>{const display=formatQuoteFact(quote?.[field],kind);return <article className="pt-market-fact" data-kind={kind} key={field} aria-label={`${label} ${display}`}><div><span aria-hidden="true"><Icon size={15}/></span><small>{label}</small></div><b>{display}</b></article>;})}</div>
        <TicketPriceChart contract={selected}/>
        <div className="pt-session"><Clock3 size={18}/><div><strong>{quote?.regularHours === true ? '美股常规交易时段' : quote?.regularHours === false ? '美股常规时段已休市' : '常规交易时间 09:30–16:00 美东'}</strong><p>{quote?.nextOpen ? '下次开市：' + new Date(quote.nextOpen).toLocaleString('zh-CN', { hour12: false }) + '（本地时间）' : '限价单 · 当日有效 · 常规交易时段'}</p></div></div>
        <div className="pt-position-summary"><div><Wallet size={17}/>当前股票持仓</div><strong>{position ? Number(position.quantity).toLocaleString('en-US', { maximumFractionDigits: 6 }) : '0'} <small>股</small></strong><span>平均成本 <b>{money(position?.averageCost)} USD</b></span></div>
        <p className="pt-source-note">报价每 5 秒、分时每 30 秒刷新，后台标签页暂停刷新。报价时间来自上游，不保证逐笔实时；市价单按 IBKR 实际成交价结算。{quote?.sourceUrl && <a href={quote.sourceUrl} target="_blank" rel="noreferrer"> 查看行情来源 ↗</a>}</p>
      </section>
      <section className={'awb-panel pt-ticket ' + (order.side === 'SELL' ? 'is-sell' : '')}>
        <div className="pt-section-title"><span><ShoppingCart size={17}/>交易下单</span><span className="pt-paper-tag">模拟盘</span></div>
        <div className="pt-depth"><div className="pt-depth-heading"><strong>三档买卖盘</strong><small>{quote?.source || '参考行情'} · 价格 USD · 数量为上游原始单位</small></div><div className="pt-depth-columns">{(['bids','asks'] as const).map(side => <div className={'pt-depth-side '+side} key={side}><div className="pt-depth-labels"><span>{side === 'bids' ? '买盘' : '卖盘'}</span><span>价格</span><span>挂单量</span></div>{[1,2,3].map(level => { const item = quote?.[side]?.find(row=>row.level===level); const price=item?.price??(level===1?quote?.[side==='bids'?'bid':'ask']:null); return <button key={level} aria-label={(side==='bids'?'买':'卖')+['一','二','三'][level-1]+'价'+(price?' '+price+' 填入限价':' 未提供')} disabled={!price||quote?.state==='stale'} onClick={()=>updateOrder({limitPrice:price!,orderType:'LMT'})}><span>{side==='bids'?'买':'卖'}{['一','二','三'][level-1]}</span><b>{price?money(price):'未提供'}</b><span>{item?.size?Number(item.size).toLocaleString('en-US'):'—'}</span></button>; })}</div>)}</div>{!quote?.bids?.some(row=>row.price)&&!quote?.asks?.some(row=>row.price)&&<p>上游暂未提供该美股的买卖档位，不用最新成交价推算挂单价格。</p>}</div>
        <div className="pt-side-switch" role="group" aria-label="买卖方向">{(['BUY', 'SELL'] as const).map(side => <button key={side} aria-pressed={order.side === side} className={order.side === side ? 'active' : ''} onClick={() => updateOrder({ side })}>{side === 'BUY' ? '买入' : '卖出'}</button>)}</div>
        <div className="pt-fixed-field"><span>订单类型</span><div className="pt-order-types" role="group" aria-label="订单类型">{(['LMT','MKT'] as const).map(type => <button key={type} disabled={type === 'MKT' && !status?.supportedOrderTypes?.includes('MKT')} title={type === 'MKT' && !status?.supportedOrderTypes?.includes('MKT') ? '重启本地桥接后即可使用市价单' : undefined} aria-pressed={order.orderType === type} onClick={() => updateOrder({ orderType:type })}>{type === 'LMT' ? '限价单' : '市价单'}</button>)}</div></div>
        <p className="pt-field-help">{order.orderType === 'MKT' ? '按市场可成交价格执行，不设成交价上限；资金按参考价加 5% 预留。' : order.side === 'BUY' ? '只以设定价格或更低价格买入。' : '只以设定价格或更高价格卖出已有持仓。'}</p>
        <div className="pt-order-entry-grid">{(['limitPrice', 'quantity'] as const).filter(field => field === 'quantity' || order.orderType === 'LMT').map(field => <label className="pt-field" key={field}><span>{field === 'quantity' ? '数量' : '限价'} <small>{field === 'quantity' ? '股 · 整股交易' : 'USD'}</small></span><div className="pt-stepper"><button type="button" aria-label={field === 'quantity' ? '减少股数' : '降低限价'} onClick={() => step(field, -1)}><Minus size={16}/></button><input aria-label={field === 'quantity' ? '数量（整股）' : '限价（USD）'} inputMode={field === 'quantity' ? 'numeric' : 'decimal'} placeholder="输入每股价格" value={order[field]} onChange={e => updateOrder({ [field]: e.target.value })}/><button type="button" aria-label={field === 'quantity' ? '增加股数' : '提高限价'} onClick={() => step(field, 1)}><Plus size={16}/></button></div></label>)}</div>
        <div className="pt-quantity-presets">{[10, 50, 100].map(value => <button key={value} onClick={() => updateOrder({ quantity: String(value) })}>{value} 股</button>)}<button disabled={order.side === 'BUY' ? !capacity : !position} onClick={() => updateOrder({ quantity: String(order.side === 'BUY' ? capacity : Math.floor(Number(position?.quantity || 0))) })}>{order.side === 'BUY' ? '现金可买' : '全部可卖'}</button></div>
        <div className="pt-order-meta"><div className="pt-fixed-field"><span>有效期</span><b>当日有效 <small>DAY</small></b></div><div className="pt-fixed-field"><span>交易时段</span><b>常规时段</b></div></div>
        <div className="pt-ticket-feedback" role="region" aria-label="交易提示">
          {(busy || quoteBusy) && <div className="pt-feedback-message is-pending" role="status"><RefreshCw size={16} className="pt-spin"/><span>{busy ? taskMessages[busy] || '正在处理…' : '正在刷新股票行情…'}</span></div>}
          {error && <div className="pt-feedback-message is-error" role="alert"><AlertTriangle size={16}/><span data-testid={subscriptionError ? 'paper-preview-status' : undefined}>{subscriptionError ? '预览未完成，订单尚未发送。' : error}</span><button aria-label="关闭错误" onClick={() => setError('')}><X size={15}/></button></div>}
          {notice && <div className="pt-feedback-message is-success" role="status"><Check size={16}/><span>{notice}</span><button aria-label="关闭交易提示" onClick={() => setNotice('')}><X size={15}/></button></div>}
          {status?.syncError && <div className="pt-feedback-message is-warning" role="status"><RefreshCw size={16}/><span>{['COMMISSION_PENDING','UNRESOLVED_ORDER','EVENT_BARRIER_CHANGED','STALE_ACCOUNT_PROOF','ORDER_QUANTITY_MISMATCH'].includes(status.syncError) ? '正在等待券商补全成交与费用回报，将自动继续核对。' : `账户同步暂未完成，正在自动重试。${errors[status.syncError] || status.syncError}`}</span></div>}
          {(quoteError || quote?.state === 'missing') && <div className="pt-feedback-message is-warning" role="status"><AlertTriangle size={16}/><span>{quoteError || '参考行情源暂未返回这只股票的报价，请稍后刷新。'}</span></div>}
          {online && !status?.supportedOrderTypes?.includes('MKT') && <div className="pt-feedback-message is-warning" role="status"><AlertTriangle size={16}/><span>市价单接口已更新，请点击智能连接更新本地桥接服务后使用。</span></div>}
        </div>
        <div className="pt-estimate"><span>预估订单金额</span><strong>{validOrder && referencePrice > 0 ? money(amount) : '—'} <small>USD</small></strong><p>{order.side === 'BUY' ? '按美元现金估算可买 ' + (capacity ?? '—') + ' 股；实际以已结算现金校验为准。' : '当前可卖持仓 ' + Math.floor(Number(position?.quantity || 0)) + ' 股。'}<br/>金额未含手续费，预留 {money(status?.policy?.limits?.feeReserve ?? limits.feeReserve)} USD。</p></div>
        <details className="pt-settings"><summary><SlidersHorizontal size={15}/>模拟交易设置<ChevronDown size={14}/></summary><p>单笔上限 {money(status?.policy?.limits?.maxOrderNotional ?? limits.maxOrderNotional)} USD · {status?.enabled ? '交易风控已开启，切换股票时自动沿用同一套参数' : '首次预览时开启模拟交易风控'}。</p>{!status?.enabled ? <div className="awb-paper-risk-grid">{limitFields.map(([key, label, unit]) => <label key={key}>{label}<span><input inputMode="decimal" value={limits[key]} onChange={e => setLimits(current => ({ ...current, [key]: e.target.value }))}/><i>{unit}</i></span></label>)}<label>本次交易时长<span><input inputMode="decimal" value={hours} onChange={e => setHours(e.target.value)}/><i>小时</i></span></label></div> : <p>当前已选 {selected?.symbol || '等待选择'}；选择其他股票后可直接预览。有效至 {status.policy && new Date(status.policy.expiresAt).toLocaleTimeString('zh-CN', { hour12: false })}。</p>}</details>
        <button className="primary pt-submit" disabled={!online || !validOrder || (!status?.enabled && !validLimits) || !!busy} onClick={() => void makePreview()}>{busy === 'preview' ? '正在校验订单…' : status?.enabled ? '预览' + (order.side === 'BUY' ? '买入' : '卖出') + '订单' : '开启模拟交易并预览'}<ArrowUpRight size={17}/></button>
        <p className="pt-submit-note">{status?.enabled ? '可自由切换已核验股票；预览后再次确认，才会发送订单。' : '启用模拟交易：' + (selected?.symbol || '所选股票') + ' · 单笔 ≤ ' + money(limits.maxOrderNotional) + ' USD · ' + hours + ' 小时。预览不会发送订单。'}</p>
      </section>
    </div>
    <section className="awb-panel pt-activity"><div className="pt-activity-header"><div role="tablist" aria-label="交易记录"><button role="tab" aria-selected={tableTab === 'orders'} onClick={() => setTableTab('orders')}>订单 <span>{status?.orders.length ?? 0}</span></button><button role="tab" aria-selected={tableTab === 'holdings'} onClick={() => setTableTab('holdings')}>持仓 <span>{snapshot.positions.length}</span></button></div><span className="pt-auto-sync"><RefreshCw size={14}/>{status?.connection === 'connected' ? '每 2 秒自动同步' : '等待连接，自动重试'}</span></div>
      <div className="awb-table-scroll">{tableTab === 'orders' ? <table><thead><tr><th>股票</th><th>方向</th><th>委托数量</th><th>限价 / USD</th><th>订单状态</th><th>成交数量</th><th>成交均价 / USD</th><th>操作</th></tr></thead><tbody>{status?.orders.map(row => <tr key={row.intent.clientIntentId}><td><div className="pt-stock-cell">{logoFor(row.intent.conId)}<div><b>{nameFor(row.intent.conId)}</b><small>{(row.orderId ?? row.brokerOrderId) ? '#' + (row.orderId ?? row.brokerOrderId) : '等待订单编号'}</small></div></div></td><td className={row.intent.side === 'BUY' ? 'pt-up' : 'pt-down'}>{row.intent.side === 'BUY' ? '买入' : '卖出'}</td><td>{row.intent.quantity} 股</td><td>{row.intent.orderType === 'MKT' ? '市价' : money(row.intent.limitPrice)}</td><td><span className={'pt-order-state ' + (row.execution === 'FILLED' ? 'filled' : '')}>{executionNames[row.execution] || submissionNames[row.submission] || '等待券商回报'}</span>{row.reconciliationRequired && <small>正在自动核对</small>}</td><td>{row.filledQuantity || '0'}</td><td>{money(row.averageFillPrice)}</td><td><div className="pt-order-actions"><button onClick={() => viewReceipt(row)}>查看回执</button><button disabled={!!busy || ['FILLED', 'CANCELLED', 'REJECTED'].includes(row.execution)} onClick={() => setCancelOrder(row)}>撤单</button></div></td></tr>)}</tbody></table> : <table><thead><tr><th>股票</th><th>持仓数量</th><th>平均成本</th><th>持仓市值</th><th>操作</th></tr></thead><tbody>{snapshot.positions.map(row => <tr key={row.conId}><td><div className="pt-stock-cell"><HoldingLogo holding={{ ...row, assetType: row.assetType || 'STK' }}/><div><b>{row.symbol}</b><small>{row.currency}</small></div></div></td><td>{row.quantity} 股</td><td>{money(row.averageCost)}</td><td>{money(row.marketValue)}</td><td><button onClick={() => { add({ conId: row.conId, symbol: row.symbol, currency: row.currency }); updateOrder({ side: 'SELL', quantity: String(Math.floor(Number(row.quantity))) }); }}>卖出</button></td></tr>)}</tbody></table>}
      {!(tableTab === 'orders' ? status?.orders.length : snapshot.positions.length) && <div className="pt-empty"><ShoppingCart size={24}/><div><b>{tableTab === 'orders' ? '还没有模拟订单' : '暂无持仓'}</b><p>{tableTab === 'orders' ? '在上方选股票、填写价格与数量，预览并确认后，订单会出现在这里。' : '成交并同步后，持仓会显示在这里。'}</p></div></div>}</div><p className="pt-source-note">此处记录 SparkFlow 提交的委托，成交状态以 IBKR 回报为准。模拟资金不影响实盘账户。</p></section>
    {preview && <div className="awb-overlay pt-modal-backdrop"><section className="pt-review" role="dialog" aria-modal="true" aria-label="确认模拟订单"><div className="pt-section-title"><span>确认模拟订单</span><button aria-label="关闭订单预览" disabled={!!busy} onClick={() => setPreview(null)}><X size={18}/></button></div><span className="pt-paper-tag">IBKR 模拟账户 · {status?.account}</span><h2>{preview.side === 'BUY' ? '买入' : '卖出'} {preview.symbol}</h2><div className="pt-review-total">{preview.quantity} <small>股</small></div><dl><dt>委托价格</dt><dd>{preview.orderType === 'MKT' ? '市价成交' : money(preview.limitPrice) + ' USD'}</dd><dt>订单类型</dt><dd>{preview.orderType === 'MKT' ? '市价单' : '限价单'} · 当日有效</dd><dt>交易时段</dt><dd>常规交易时段</dd><dt>{preview.orderType === 'MKT' ? '预估占用（含 5% 缓冲）' : '订单金额'}</dt><dd>{money(preview.reservedNotional)} USD</dd><dt>预留现金（含费用预留）</dt><dd>{money(preview.reservedCash)} USD</dd></dl>{preview.warnings.map(w => <p className="pt-muted-message" key={w}>{w}</p>)}<p className="pt-submit-note">{previewSeconds ? '请在 ' + previewSeconds + ' 秒内确认，发送时会再次校验。' : '预览已过期，请返回重新预览。'}</p><button className="primary pt-submit" disabled={!!busy || !previewSeconds} onClick={() => void confirm()}><Check size={17}/>{busy === 'confirm' ? '发送中…' : '确认发送模拟订单'}</button><button className="pt-back" disabled={!!busy} onClick={() => setPreview(null)}>返回修改</button></section></div>}
    {receipt && <PaperOrderReceipt receipt={receipt} refreshing={receiptRefreshing} onRefresh={() => void refreshReceipt()} onClose={() => setReceipt(null)} onViewOrders={() => { setReceipt(null); setTableTab('orders'); requestAnimationFrame(() => document.querySelector('.pt-activity')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }}/>}
    {cancelOrder && <div className="awb-overlay"><section className="awb-paper-confirm" role="dialog" aria-modal="true" aria-label="撤销模拟订单"><AlertTriangle/><h2>确认撤销模拟订单？</h2><p>{nameFor(cancelOrder.intent.conId)} · {cancelOrder.intent.side === 'BUY' ? '买入' : '卖出'} {cancelOrder.intent.quantity} 股 · 限价 {cancelOrder.intent.orderType === 'MKT' ? '市价' : money(cancelOrder.intent.limitPrice)} USD</p><div><button disabled={!!busy} onClick={() => setCancelOrder(null)}>返回</button><button className="primary" disabled={!!busy} onClick={() => void cancel()}>确认撤单</button></div></section></div>}
  </div>;
}
