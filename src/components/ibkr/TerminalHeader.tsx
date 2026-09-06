import { Search, RefreshCw, PanelLeft, PanelRight, ArrowUpRight } from 'lucide-react';
import type { RefObject } from 'react';
import { Link } from 'react-router-dom';
import { formatDecimal } from '../../lib/ibkr/store';
import type { Snapshot } from '../../lib/ibkr/types';

export type WorkspaceTab = '持仓' | '订单' | '分析' | '设置';
export function TerminalHeader({ snapshot, mode, onMode, tab, onTab, search, onSearch, inputRef, left, right, toggleLeft, toggleRight, refresh }: {
  snapshot: Snapshot; mode: 'paper' | 'live'; onMode: (mode: 'paper' | 'live') => void; tab: WorkspaceTab; onTab: (tab: WorkspaceTab) => void;
  search: string; onSearch: (value: string) => void; inputRef: RefObject<HTMLInputElement>; left: boolean; right: boolean; toggleLeft: () => void; toggleRight: () => void; refresh: () => void;
}) {
  return <header className="ibkr-header" aria-label="交易终端顶栏">
    <Link className="ibkr-brand" to="/" aria-label="返回 SparkFlow"><span>SF</span><div><b>SparkFlow</b><small>IBKR TERMINAL <ArrowUpRight size={10} /></small></div></Link>
    <div className="ibkr-mode" aria-label="账户模式">{(['paper', 'live'] as const).map(item => <button key={item} aria-pressed={mode === item} onClick={() => onMode(item)}>{item === 'paper' ? '模拟 PAPER' : '实盘 LIVE'}</button>)}</div>
    <label className="ibkr-search"><Search size={14} /><input ref={inputRef} type="search" aria-label="搜索合约或新闻" placeholder="搜索合约 / 新闻" value={search} onChange={event => onSearch(event.target.value)} /><kbd>⌃ K</kbd></label>
    <nav className="ibkr-tabs" aria-label="终端导航">{(['持仓', '订单', '分析', '设置'] as const).map(item => <button key={item} aria-pressed={tab === item} onClick={() => onTab(item)}>{item}</button>)}</nav>
    <div className="ibkr-header-metric"><small>账户净值 {snapshot.baseCurrency}</small><strong>{formatDecimal(snapshot.metrics.netLiquidation)}</strong></div>
    <div className="ibkr-header-metric"><small>未实现盈亏</small><strong>{formatDecimal(snapshot.metrics.unrealizedPnl)}</strong></div>
    <span data-testid="connection-status" className="ibkr-connection"><i data-connected={snapshot.connection === 'connected'} />{snapshot.state === 'loading' ? '连接检查中' : snapshot.connection === 'connected' ? (snapshot.testData ? '测试数据' : 'IBKR 已连接') : '未连接'}</span>
    <div className="ibkr-layout-controls"><button aria-label={left ? '折叠账户栏' : '展开账户栏'} aria-expanded={left} onClick={toggleLeft}><PanelLeft size={16} /></button><button aria-label={right ? '折叠 AI 栏' : '展开 AI 栏'} aria-expanded={right} onClick={toggleRight}><PanelRight size={16} /></button><button aria-label="刷新账户" disabled={snapshot.state === 'loading'} onClick={refresh}><RefreshCw size={15} /></button></div>
  </header>;
}
