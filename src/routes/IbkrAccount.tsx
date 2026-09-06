import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { TerminalHeader, type WorkspaceTab } from '../components/ibkr/TerminalHeader';
import { AccountSidebar } from '../components/ibkr/AccountSidebar';
import { TradingWorkspace } from '../components/ibkr/TradingWorkspace';
import { AccountAiPanel } from '../components/ibkr/AccountAiPanel';
import { IntelligencePanel } from '../components/ibkr/IntelligencePanel';
import { emptySnapshot } from '../lib/ibkr/store';
import { startAccountSync } from '../lib/ibkr/stream';
import type { Position, Snapshot } from '../lib/ibkr/types';
import './IbkrAccount.css';
import type { MarketInstrument } from '../components/ibkr/MarketWatch';

export function IbkrAccount() {
  const [mode, setMode] = useState<'paper' | 'live'>('paper');
  const [snapshot, setSnapshot] = useState<Snapshot>(() => emptySnapshot('paper'));
  const [reload, setReload] = useState(0);
  const [tab, setTab] = useState<WorkspaceTab>('持仓');
  const [selected, setSelected] = useState<Position | null>(null);
  const [search, setSearch] = useState('');
  const [instrument, setInstrument] = useState<MarketInstrument | null>(null);
  const [left, setLeft] = useState(() => window.innerWidth >= 1280);
  const [right, setRight] = useState(() => window.innerWidth >= 1440);
  const [height, setHeight] = useState(() => window.innerWidth < 600 ? 240 : 320);
  const [expanded, setExpanded] = useState(false);
  const revision = useRef(0);
  const stopSync = useRef<(() => void) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ y: number; height: number } | null>(null);

  useEffect(() => {
    const id = ++revision.current;
    const stop = startAccountSync(mode, next => { if (id === revision.current) setSnapshot(next); });
    stopSync.current = stop;
    return () => { ++revision.current; stop(); };
  }, [mode, reload]);

  const switchMode = (next: 'paper' | 'live') => {
    if (next === mode) return;
    ++revision.current;
    stopSync.current?.();
    setSnapshot(emptySnapshot(next));
    setSelected(null);
    setInstrument(null);
    setSearch('');
    setMode(next);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); inputRef.current?.focus(); }
      if (event.key === 'Escape') { setSearch(''); if (window.innerWidth < 1280) { setLeft(false); setRight(false); } }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const resize = (value: number) => setHeight(Math.round(Math.min(Math.max(160, window.innerHeight - 250), Math.max(160, value))));
  const choose = (position: Position) => { setInstrument(null); setSelected(position); setSearch(''); if (window.innerWidth < 1280) setLeft(false); };
  const currentPosition = snapshot.positions.find(position => position.conId === selected?.conId) ?? null;

  return <div className="ibkr-terminal" data-testid="ibkr-terminal" data-mode={mode} data-left={left} data-right={right} style={{ '--ibkr-bottom-height': expanded ? '65%' : `${height}px` } as CSSProperties}>
    <TerminalHeader snapshot={snapshot} mode={mode} onMode={switchMode} tab={tab} onTab={setTab} search={search} onSearch={setSearch} inputRef={inputRef} left={left} right={right} toggleLeft={() => { setLeft(!left); if (window.innerWidth < 1280) setRight(false); }} toggleRight={() => { setRight(!right); if (window.innerWidth < 1280) setLeft(false); }} refresh={() => setReload(value => value + 1)} />
    <div className="ibkr-statusline" role="status"><span>{mode === 'live' ? '实盘只读 · 交易未授权' : '模拟盘 · 账户查看与人工订单分别授权'}</span>{snapshot.testData ? <b>工程测试数据 · 非真实券商账户</b> : <span>{snapshot.detail}</span>}{snapshot.state === 'stale' && <b>数据已过期</b>}</div>
    <div className="ibkr-main-grid">
      {left && <AccountSidebar snapshot={snapshot} selected={selected?.conId ?? null} select={choose} />}
      <TradingWorkspace key={`workspace-${mode}`} snapshot={snapshot} position={currentPosition} select={choose} tab={tab} search={search} instrument={instrument} selectInstrument={value => { setInstrument(value); setSearch(''); setTab('持仓'); }} />
      {right && <AccountAiPanel key={`ai-${mode}`} snapshot={snapshot} />}
    </div>
    <div className="ibkr-resize" role="separator" tabIndex={0} aria-label="调整资讯区域高度" aria-orientation="horizontal" aria-valuemin={160} aria-valuemax={Math.max(160, window.innerHeight - 250)} aria-valuenow={height}
      onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { event.preventDefault(); setExpanded(false); resize(event.key === 'Home' ? 160 : event.key === 'End' ? window.innerHeight - 250 : height + (event.key === 'ArrowUp' ? 20 : -20)); } }}
      onPointerDown={event => { setExpanded(false); drag.current = { y: event.clientY, height }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (drag.current) resize(drag.current.height + drag.current.y - event.clientY); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}><span /></div>
    <IntelligencePanel key={`intelligence-${mode}`} positions={snapshot.positions} position={currentPosition} expanded={expanded} toggleExpanded={() => setExpanded(!expanded)} />
  </div>;
}
