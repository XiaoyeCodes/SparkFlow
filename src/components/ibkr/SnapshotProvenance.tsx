import type { Snapshot } from '../../lib/ibkr/types';

const labels: Record<string, string> = { 'metrics.netLiquidation': '账户净值', 'metrics.unrealizedPnl': '未实现盈亏', 'metrics.buyingPower': '购买力', 'metrics.maintenanceMargin': '维持保证金', positions: '持仓', orders: '挂单', executions: '成交' };
const time = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未提供';

export function SnapshotProvenance({ snapshot }: { snapshot: Snapshot }) {
  return <details className="ibkr-card ibkr-provenance"><summary>数据来源与时间</summary>
    <small>快照生成：{time(snapshot.asOf)}<br />此时间不代表各项数据的更新时间。</small>
    {Object.entries(snapshot.provenance || {}).map(([field, stamp]) => <div key={field} style={{ marginTop: 12 }}><b>{labels[field] || field}</b><small>{snapshot.testData ? '工程样本 · ' : ''}{stamp.source}</small><small>收到数据：{time(stamp.observedAt)}</small>{stamp.requestCompletedAt && <small>请求完成：{time(stamp.requestCompletedAt)}</small>}<small>{stamp.brokerAsOf ? `券商原始时间：${time(stamp.brokerAsOf)}` : '券商原始时间未提供'}</small></div>)}
    {!snapshot.provenance && <small>尚无可追溯的数据来源记录。</small>}
  </details>;
}
