import { useEffect, useState } from 'react';
import type { Snapshot } from '../../lib/ibkr/types';
import { formatDecimal } from '../../lib/ibkr/store';

export type MarketInstrument = { conId: number; symbol: string; currency: string; exchange?: string; name?: string };
type QuoteView = { accountKey: string; mode: string; sessionRevision: number; conId: number; state: string;
  last: string | null; bid: string | null; ask: string | null; close: string | null;
  observedAt: string | null; brokerAsOf: string | null; source: string; testData: boolean; detail: string | null };
const stateNames: Record<string,string> = { realtime:'实时流',delayed:'延迟',frozen:'冻结','delayed-frozen':'延迟冻结',stale:'已过期',missing:'等待报价','permission-required':'行情权限不足',disconnected:'已断线' };
const query = (snapshot: Snapshot) => new URLSearchParams({mode:snapshot.mode,accountKey:snapshot.accountKey});

export function MarketSearch({snapshot,search,select}:{snapshot:Snapshot;search:string;select:(value:MarketInstrument)=>void}) {
  const [rows,setRows]=useState<MarketInstrument[]>([]);
  const [notice,setNotice]=useState('');
  useEffect(()=>{
    const controller=new AbortController();setRows([]);setNotice('');
    const timer=setTimeout(async()=>{
      if (!/^[A-Za-z][A-Za-z0-9. -]{0,15}$/.test(search.trim())) return;
      setNotice('正在查询 IBKR 合约…');
      try {
        const params=query(snapshot);params.set('symbol',search.trim());
        const response=await fetch(`/api/ibkr-terminal/market/contracts?${params}`,{signal:controller.signal});
        const value=await response.json();
        if (!response.ok || value.accountKey!==snapshot.accountKey || value.mode!==snapshot.mode || value.sessionRevision!==snapshot.sessionRevision
          || !Array.isArray(value.contracts) || value.contracts.some((r:MarketInstrument)=>!Number.isSafeInteger(r.conId)||r.conId<=0||typeof r.symbol!=='string'||r.currency!=='USD')) throw new Error('合约查询不可用，请核对账户连接和代码。');
        if (!controller.signal.aborted) {setRows(value.contracts);setNotice(value.contracts.length?'':'没有匹配的股票 / ETF 合约。');}
      } catch(error) {if (!controller.signal.aborted) setNotice(error instanceof Error?error.message:'合约查询失败。');}
    },400);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[snapshot.accountKey,snapshot.mode,snapshot.sessionRevision,search]);
  return <div><h2>IBKR 合约 · 独立行情查询</h2>{notice&&<p role="status">{notice}</p>}{rows.map(row=><button key={row.conId} onClick={()=>select(row)}>{row.symbol} · {row.exchange} · 查看行情</button>)}</div>;
}

export function MarketQuote({snapshot,instrument}:{snapshot:Snapshot;instrument:MarketInstrument}) {
  const [quote,setQuote]=useState<QuoteView|null>(null);
  const [feed,setFeed]=useState('3');
  const [notice,setNotice]=useState('');
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    setQuote(null);setNotice('');
    const poll=async()=>{
      try {
        const params=query(snapshot);params.set('conId',String(instrument.conId));params.set('feed',feed);
        const response=await fetch(`/api/ibkr-terminal/market/quote?${params}`,{signal:controller.signal});
        const value=await response.json() as QuoteView;
        if (!response.ok || value.accountKey!==snapshot.accountKey || value.mode!==snapshot.mode || value.sessionRevision!==snapshot.sessionRevision
          || value.conId!==instrument.conId || value.testData!==snapshot.testData || !stateNames[value.state]
          || [value.last,value.bid,value.ask,value.close].some(v=>v!==null&&(typeof v!=='string'||!/^\d+(\.\d+)?$/.test(v)))) throw new Error('行情读取不可用，请重新查询并选择合约。');
        if (!controller.signal.aborted) {setQuote(value);setNotice('');}
      } catch(error) {if (!controller.signal.aborted) {setQuote(null);setNotice(error instanceof Error?error.message:'行情读取失败。');}}
      finally {if (!controller.signal.aborted) timer=setTimeout(poll,3000);}
    };
    void poll();return ()=>{controller.abort();clearTimeout(timer);};
  },[snapshot.mode,snapshot.accountKey,snapshot.sessionRevision,instrument.conId,feed]);
  return <div className="ibkr-market-quote" data-testid="market-quote">
    {quote?.detail==='IBKR_10197' && <p role="status">IBKR 行情会话冲突：请退出其他实盘行情会话，保留当前模拟盘 Gateway 后重新查询。</p>}
    <label>行情类型<select value={feed} onChange={e=>setFeed(e.target.value)}><option value="3">实时优先 / 可用时延迟</option><option value="1">实时</option><option value="2">冻结</option><option value="4">延迟冻结</option></select></label>
    <span>{quote?stateNames[quote.state]:'等待行情'}</span><b>最新 {formatDecimal(quote?.last)}</b><span>买 {formatDecimal(quote?.bid)} / 卖 {formatDecimal(quote?.ask)}</span><span>前收 {formatDecimal(quote?.close)}</span>
    <small>{notice || (quote?`${quote.testData?'工程数据 · ':''}${quote.source} · ${quote.brokerAsOf?`成交时间 ${new Date(quote.brokerAsOf).toLocaleString()}`:'成交时间未提供'} · 接收 ${quote.observedAt?new Date(quote.observedAt).toLocaleTimeString():'等待'}${quote.detail?` · ${quote.detail}`:''}`:'只读查询，不授权交易。')}</small>
  </div>;
}
