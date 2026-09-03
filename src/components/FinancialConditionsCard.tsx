import { useId } from 'react';
import { ExternalLink } from 'lucide-react';
import type { FinancialConditionMetric, FinancialConditionPoint, FinancialConditionsSnapshot } from '../lib/financialConditionsTypes';

function signed(value: number, digits: number) {
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(digits)}`;
}

function dateLabel(value?: string) {
  return value ? value.slice(0, 10).replace(/-/g, '/') : '待更新';
}

function ConditionsTrend({ history }: { history: FinancialConditionPoint[] }) {
  const id = useId();
  if (history.length < 2) return <div className="macro-conditions-empty">趋势数据待更新</div>;
  const values = history.map(point => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 0.01);
  const start = Date.parse(history[0].time);
  const end = Date.parse(history[history.length - 1].time);
  const points = history.map(point => ({
    x: 3 + (Date.parse(point.time) - start) / Math.max(end - start, 1) * 314,
    y: 7 + (max - point.value + (span - (max - min)) / 2) / span * 34,
  }));
  const line = points.map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
  const last = points[points.length - 1];
  return <svg viewBox="0 0 320 48" preserveAspectRatio="none" role="img" aria-label={`NFCI 最近 ${history.length} 周趋势，上升代表收紧`}>
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop stopColor="currentColor" stopOpacity=".2" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
    <line x1="3" y1="24" x2="317" y2="24" className="macro-conditions-gridline" />
    <polygon points={`3,48 ${line} 317,48`} fill={`url(#${id})`} />
    <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    <circle cx={last.x} cy={last.y} r="2.5" fill="currentColor" />
  </svg>;
}

function SourceDate({ metric, label }: { metric: FinancialConditionMetric | null; label: string }) {
  return <span>{label} {dateLabel(metric?.observedAt)}{metric?.stale && <em> · 缓存</em>}</span>;
}

export function FinancialConditionsCard({ conditions, failed = false }: { conditions: FinancialConditionsSnapshot | null; failed?: boolean }) {
  const nfci = conditions?.nfci ?? null;
  const spread = conditions?.creditSpread ?? null;
  const change = nfci?.changeWeek ?? null;
  const tone = change === null || change === 0 ? 'neutral' : change > 0 ? 'tightening' : 'easing';
  const trend = change === null ? '周变化待更新' : change > 0 ? '条件收紧' : change < 0 ? '条件放松' : '条件持平';
  const spreadChange = spread?.changeWeek === null || !spread ? null : Number((spread.changeWeek * 100).toFixed(1));
  const spreadTone = spreadChange === null || spreadChange === 0 ? 'neutral' : spreadChange > 0 ? 'tightening' : 'easing';
  const unavailable = (conditions !== null || failed) && !nfci;
  return <section className="macro-terminal-section macro-conditions-section">
    <p className="macro-section-title">金融条件与信用利差</p>
    <div className={`macro-conditions-card ${tone}`}>
      <div className="macro-conditions-head">
        <a href="https://fred.stlouisfed.org/series/NFCI" target="_blank" rel="noreferrer" title="芝加哥联储 NFCI，周度指数；负值比历史均值宽松，正值比历史均值收紧。">
          <small>金融条件指数 · NFCI <ExternalLink size={9} /></small>
          <strong title={nfci ? nfci.value.toFixed(3) : undefined}>{nfci ? signed(nfci.value, 2) : unavailable ? '暂无数据' : '待更新'}</strong>
        </a>
        <span className="macro-conditions-change">
          <b>{trend}</b>
          <small>{change !== null ? `较上周 ${signed(change, Math.abs(change) < 0.01 ? 3 : 2)}` : '较上周 —'}</small>
        </span>
      </div>
      <div className="macro-conditions-context"><span>{nfci ? nfci.value < 0 ? '低于历史均值 · 偏宽松' : nfci.value > 0 ? '高于历史均值 · 偏紧' : '处于历史均值' : '等待官方数据'}</span><span>近26周 · 周度</span></div>
      <div className="macro-conditions-chart"><ConditionsTrend history={nfci?.history ?? []} /></div>
      <div className={`macro-conditions-credit ${spreadTone}`}>
        <a href="https://fred.stlouisfed.org/series/BAMLH0A0HYM2" target="_blank" rel="noreferrer" title="ICE BofA 美国高收益债期权调整利差（OAS），来源 FRED。单位 bp，1bp = 0.01 个百分点；走阔代表信用风险溢价上升。">
          <span>信用利差 <small>HY OAS <ExternalLink size={9} /></small></span>
          <strong>{spread ? `${(spread.value * 100).toFixed(0)}` : '—'}<small> bp</small></strong>
        </a>
        <span title={spread?.comparisonAt ? `对比 ${dateLabel(spread.comparisonAt)}；最新 ${dateLabel(spread.observedAt)}` : undefined}>
          {spreadChange !== null ? `较上周 ${signed(spreadChange, Number.isInteger(spreadChange) ? 0 : 1)}bp · ${spreadChange > 0 ? '走阔' : spreadChange < 0 ? '收窄' : '持平'}` : '周变化待更新'}
        </span>
      </div>
      <footer><SourceDate metric={nfci} label="NFCI" /><SourceDate metric={spread} label="OAS" /></footer>
      {failed && <div className="macro-conditions-notice" role="status">更新失败{nfci || spread ? ' · 保留上次数据' : ' · 稍后自动重试'}</div>}
    </div>
  </section>;
}
