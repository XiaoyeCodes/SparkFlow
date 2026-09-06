import { useState } from 'react';
import type { Position, Snapshot } from '../../lib/ibkr/types';
import { formatDecimal } from '../../lib/ibkr/store';

export function AccountTables({ snapshot, select }: { snapshot: Snapshot; select: (position: Position) => void }) {
  const [tab, setTab] = useState('持仓');
  const [page, setPage] = useState(0);
  const total = tab === '持仓' ? snapshot.positions.length : tab === '挂单' ? snapshot.orders.length : tab === '成交' ? (snapshot.executions?.length ?? 0) : 0;
  const activePage = Math.min(page, Math.max(0, Math.ceil(total / 25) - 1));
  const start = activePage * 25;
  const empty = tab === '持仓' && snapshot.state === 'empty' ? '账户暂无持仓'
    : snapshot.state === 'loading' ? `正在同步${tab}` : snapshot.state === 'stale' ? `保留的${tab}数据已过期`
    : snapshot.state === 'permission-required' ? `缺少${tab}读取权限` : snapshot.state === 'error' ? `${tab}同步失败`
    : `尚无已同步的${tab}记录`;
  return <section className="ibkr-account-tables">
    <div className="ibkr-tabs" role="tablist" aria-label="账户明细">{['持仓', '挂单', '成交', '历史'].map(item => <button role="tab" key={item} aria-selected={tab === item} onClick={() => { setTab(item); setPage(0); }}>{item}</button>)}</div>
    <div className="ibkr-table-scroll">
      {tab === '持仓' && <table><thead><tr>{['标的', '数量', '成本', '市值', '币种'].map(text => <th key={text}>{text}</th>)}</tr></thead><tbody>{snapshot.positions.slice(start, start + 25).map(row => <tr key={row.conId}><td><button onClick={() => select(row)}>{row.symbol}<small>#{row.conId}</small></button></td><td>{formatDecimal(row.quantity)}</td><td>{formatDecimal(row.averageCost)}</td><td>{formatDecimal(row.marketValue)}</td><td>{row.currency}</td></tr>)}</tbody></table>}
      {tab === '挂单' && <table><thead><tr><th>标的 / 订单</th><th>提交</th><th>执行</th><th>已成交 / 剩余</th></tr></thead><tbody>{snapshot.orders.slice(start, start + 25).map(row => <tr key={row.clientIntentId}><td>{row.symbol || row.clientIntentId}<small>{row.managed ? '本系统' : '外部订单 · 只读'}</small>{row.orderId != null && <small>order {row.orderId} · client {row.clientId} · perm {row.permId}</small>}</td><td>{row.submission}</td><td>{row.execution}<small>{row.brokerStatus}</small></td><td>{formatDecimal(row.filled)} / {formatDecimal(row.remaining)}</td></tr>)}</tbody></table>}
      {tab === '成交' && <><small style={{ padding: '6px 14px' }}>券商返回的可查询时段；不是完整历史账本。</small><table><thead><tr><th>标的 / 成交编号</th><th>方向 / 数量</th><th>成交价</th><th>手续费</th></tr></thead><tbody>{(snapshot.executions || []).slice(start, start + 25).map(row => <tr key={row.execId}><td>{row.symbol}<small>{row.execId}</small><small>{row.executedAt ? new Date(row.executedAt).toLocaleString('zh-CN', { hour12: false }) : '成交时间未提供'}</small></td><td>{row.side} {formatDecimal(row.quantity)}</td><td>{formatDecimal(row.price)} {row.currency}</td><td>{row.commission === null ? '手续费待回报' : `${formatDecimal(row.commission)} ${row.commissionCurrency}`}</td></tr>)}</tbody></table></>}
      {tab === '历史' ? <p className="ibkr-empty">完整历史账本尚未接入</p> : !total && <p className="ibkr-empty">{empty}</p>}
    </div>
    {total > 25 && <div className="ibkr-pagination"><button disabled={activePage === 0} onClick={() => setPage(activePage - 1)}>上一页</button><span>{activePage + 1} / {Math.ceil(total / 25)}</span><button disabled={(activePage + 1) * 25 >= total} onClick={() => setPage(activePage + 1)}>下一页</button></div>}
  </section>;
}
