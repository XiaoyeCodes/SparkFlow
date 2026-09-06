import { useEffect, useMemo, useState } from 'react';
import type { NewsFeed } from '../../lib/newsTypes';
import type { Position, Snapshot } from '../../lib/ibkr/types';
import { fetchNewsEvidence, safeNewsUrl } from '../../lib/ibkr/newsEvidence';
import { PriceChart } from './PriceChart';
import { AccountTables } from './AccountTables';
import type { WorkspaceTab } from './TerminalHeader';
import { OrderTicket } from './OrderTicket';
import { StrategyWorkspace } from './StrategyWorkspace';
import { AuthorizationMatrix } from './AuthorizationMatrix';
import { PaperOrderTicket } from './PaperOrderTicket';
import { MarketSearch, type MarketInstrument } from './MarketWatch';

export function TradingWorkspace({ snapshot, position, select, tab, search, instrument, selectInstrument }: { snapshot: Snapshot; position: Position | null; select: (position: Position) => void; tab: WorkspaceTab; search: string; instrument: MarketInstrument | null; selectInstrument: (value: MarketInstrument) => void }) {
  const results = snapshot.positions.filter(row => row.symbol.toLowerCase().includes(search.toLowerCase()) || String(row.conId) === search);
  return <div className="ibkr-workspace" data-testid="account-workspace">
    {search && <section className="ibkr-search-results" aria-label="搜索结果"><h2>金融合约 · 当前账户</h2>{results.length ? results.map(row => <button key={row.conId} onClick={() => select(row)}>{row.symbol} · {row.currency} · conId {row.conId}</button>) : <p>没有匹配的已同步合约</p>}<MarketSearch snapshot={snapshot} search={search} select={selectInstrument} /><h2>新闻 · 有来源证据</h2><NewsSearchResults search={search} /></section>}
    {tab === '持仓' ? <><PriceChart snapshot={snapshot} position={instrument ?? position} watch={Boolean(instrument)} quote={snapshot.quotes.find(row => row.conId === position?.conId)} /><AccountTables snapshot={snapshot} select={select} /></> : <section className="ibkr-workspace-page"><span className="ibkr-eyebrow">{tab === '订单' ? 'ORDER MANAGEMENT' : tab === '分析' ? 'STRATEGY & RESEARCH' : 'ACCOUNT SETTINGS'}</span><h1>{tab === '订单' ? '订单工作区' : tab === '分析' ? '策略与历史回测' : '账户与权限'}</h1>
      {tab === '订单' ? <>{snapshot.mode === 'paper' && !snapshot.testData ? <PaperOrderTicket snapshot={snapshot} position={position} /> : <OrderTicket snapshot={snapshot} position={position} />}<AccountTables snapshot={snapshot} select={select} /></> : tab === '分析' ? <StrategyWorkspace snapshot={snapshot} /> : <><AuthorizationMatrix snapshot={snapshot} /><p>请在官方 Gateway / TWS 登录。账户绑定在本地服务中完成，无需提供登录密码。</p></>}
    </section>}
  </div>;
}

function NewsSearchResults({ search }: { search: string }) {
  const [feed, setFeed] = useState<NewsFeed | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetchNewsEvidence(controller.signal).then(setFeed).catch(reason => {
      if (reason?.name !== 'AbortError') setError(reason instanceof Error ? reason.message : '新闻源不可用');
    });
    return () => controller.abort();
  }, []);
  const matches = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (feed?.items ?? []).filter(item => `${item.title} ${item.summary ?? ''} ${item.source}`.toLocaleLowerCase().includes(needle)).slice(0, 10);
  }, [feed, search]);
  if (error) return <p>{error}</p>;
  if (!feed) return <p>正在读取新闻证据…</p>;
  if (!matches.length) return <p>没有匹配且带来源的新闻</p>;
  return <div className="ibkr-search-news">{matches.map(item => {
    const href = safeNewsUrl(item.url);
    const body = <><b>{item.title}</b><small>{item.source} · {item.publishedAt || '发布时间待核验'}</small></>;
    return href ? <a key={item.id} href={href} target="_blank" rel="noreferrer">{body}</a> : <div key={item.id}>{body}</div>;
  })}</div>;
}
