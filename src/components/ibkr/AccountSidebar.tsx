import { formatDecimal } from '../../lib/ibkr/store';
import type { Position, Snapshot } from '../../lib/ibkr/types';
import { SnapshotProvenance } from './SnapshotProvenance';

export function AccountSidebar({ snapshot, selected, select }: { snapshot: Snapshot; selected: number | null; select: (position: Position) => void }) {
  const emptyDetail = snapshot.state === 'loading' ? '正在同步账户持仓'
    : snapshot.state === 'empty' ? '账户暂无持仓'
    : snapshot.state === 'stale' ? '保留数据已过期，等待重新对账'
    : snapshot.state === 'permission-required' ? '账户读取权限不足'
    : snapshot.state === 'error' ? '账户同步失败，请检查本地服务' : '等待账户持仓同步';
  return <aside className="ibkr-sidebar" data-testid="account-sidebar" aria-label="账户概览与持仓">
    <section className="ibkr-card"><h2>账户概览 <span>READ ONLY</span></h2><div className="ibkr-netvalue">{formatDecimal(snapshot.metrics.netLiquidation)}</div><small>{snapshot.baseCurrency || '计价币种待同步'}</small>
      <dl className="ibkr-metrics"><div><dt>可用购买力</dt><dd>{formatDecimal(snapshot.metrics.buyingPower)}</dd></div><div><dt>维持保证金</dt><dd>{formatDecimal(snapshot.metrics.maintenanceMargin)}</dd></div></dl>
      <div className="ibkr-margin"><span className="ibkr-empty-ring">—</span><div>保证金使用率<small>数据不足</small></div></div>
      {snapshot.cash.map(row => <div className="ibkr-cash" key={row.currency}><span>现金 · {row.currency}</span><b>{formatDecimal(row.amount)}</b></div>)}
    </section>
    <section className="ibkr-card ibkr-position-list"><h2>持仓 <span>{snapshot.positions.length} 个标的</span></h2>
      {snapshot.positions.length ? snapshot.positions.map(position => <button key={position.conId} aria-pressed={selected === position.conId} onClick={() => select(position)}><div><b>{position.symbol}</b><small>{formatDecimal(position.quantity)} 股 · {position.currency}</small></div><div><b>{formatDecimal(position.marketValue)}</b><small>市值</small></div></button>) : <p className="ibkr-empty">{emptyDetail}<small>账户绑定完成后显示真实数据</small></p>}
    </section>
    <section className="ibkr-card ibkr-advice"><h2>AI 今日建议</h2><p>尚未授权分享账户数据</p><small>选择模型与分享范围后，按需生成分析。</small></section>
    <SnapshotProvenance snapshot={snapshot} />
  </aside>;
}
