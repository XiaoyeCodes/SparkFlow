import { useState } from 'react';
import type { AccountSnapshot, PortfolioPerformance } from '../../lib/ibkr/workbenchTypes';
import { chartMoney, chartPercent, holdingsAllocation, holdingsReturnSeries, returnGeometry, type AllocationSlice, type HoldingsRange } from '../../lib/ibkr/holdingsAnalytics';
import './HoldingsAnalytics.css';

function Donut({ slices, label, center, caption, print }: { slices: AllocationSlice[]; label: string; center: string; caption: string; print: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  let offset = 0;
  const selected = active === null ? null : slices[active];
  return <div className="ha-donut-layout"><svg viewBox="0 0 200 200" role="img" aria-label={label} className="ha-donut">
    <circle cx="100" cy="100" r="76" fill="none" stroke={print ? '#e1e9ef' : '#1c332c'} strokeWidth="24" />
    {total > 0 && slices.map((slice, index) => { const fraction = slice.value / total; const start = offset; offset += fraction; return <circle key={index} cx="100" cy="100" r="76" fill="none" stroke={slice.color} strokeWidth={active === index ? 29 : 24} pathLength="100" strokeDasharray={`${fraction * 100} ${100 - fraction * 100}`} strokeDashoffset={-start * 100} transform="rotate(-90 100 100)" opacity={active === null || active === index ? 1 : 0.4} onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)}><title>{slice.label} · {chartMoney(slice.value)} · {(fraction * 100).toFixed(1)}%</title></circle>; })}
    <text x="100" y="97" textAnchor="middle" fill={print ? '#17334c' : '#e7f2ed'} fontSize="21" fontWeight="600" fontFamily="Arial, Microsoft YaHei, sans-serif">{selected ? `${(selected.value / total * 100).toFixed(1)}%` : center}</text>
    <text x="100" y="120" textAnchor="middle" fill={print ? '#607789' : '#94ad9f'} fontSize="11" fontFamily="Arial, Microsoft YaHei, sans-serif">{selected?.label || caption}</text>
  </svg><div className="ha-legend">{slices.length ? slices.map((slice, index) => <button key={index} type="button" onFocus={() => setActive(index)} onBlur={() => setActive(null)} onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)} className={active === index ? 'active' : ''} title={`${slice.label} · ${chartMoney(slice.value)}`}><i style={{ background: slice.color }}/><span>{slice.label}</span><b>{(slice.value / total * 100).toFixed(1)}%</b></button>) : <span className="ha-empty-label">暂无可绘制数据</span>}</div></div>;
}

export function HoldingsAnalytics({ snapshot, performance, range = 90, onRange, print = false }: { snapshot: AccountSnapshot; performance?: PortfolioPerformance; range?: HoldingsRange; onRange?: (range: HoldingsRange) => void; print?: boolean }) {
  const allocation = holdingsAllocation(snapshot);
  const returns = holdingsReturnSeries(performance, range);
  const geometry = returnGeometry(returns.points);
  const [hover, setHover] = useState<number | null>(null);
  const point = hover === null ? null : geometry.coordinates[hover];
  const value = point ? point.value : returns.value;
  const ink = print ? '#61798b' : '#89a496';
  const grid = print ? '#dce5ec' : '#20392e';
  return <section className={`holdings-analytics${print ? ' ha-print' : ''}`} aria-label="持仓图表总览">
    <article className="ha-card" aria-label="持仓分布"><header><div><span className="ha-kicker">ALLOCATION</span><h2>持仓分布</h2></div><span className="ha-badge">{snapshot.positions.length} 项持仓</span></header>
      <Donut slices={allocation.slices} label="各持仓市值占持仓总市值的比例" center={chartMoney(allocation.excluded && !allocation.slices.length ? null : allocation.gross)} caption={`${allocation.excluded ? '已知市值' : allocation.short ? '绝对敞口' : '持仓市值'} · ${allocation.currency}`} print={print}/>
      <footer>{allocation.excluded ? `仅展示可用的 ${allocation.currency} 市值；${allocation.excluded} 项未计入。` : allocation.short ? '按市值绝对值展示多空敞口，空头单独标识。' : '占比以持仓总市值计算，不含现金。'}</footer>
    </article>
    <article className="ha-card" aria-label="资产构成"><header><div><span className="ha-kicker">ACCOUNT VALUE</span><h2>资产构成</h2></div><span className="ha-badge">{allocation.currency}</span></header>
      <div className="ha-total"><span>总资产 · 账户净值</span><strong>{chartMoney(allocation.total)}<small>{allocation.currency}</small></strong></div>
      <Donut slices={allocation.assets} label="账户持仓、现金与其他净资产构成" center={allocation.total && allocation.cash !== null ? `${(allocation.cash / allocation.total * 100).toFixed(1)}%` : '—'} caption="现金占净值" print={print}/>
      <div className="ha-balances"><div><span>持仓市值</span><b>{chartMoney(allocation.invested)}</b></div><div><span>现金余额</span><b>{chartMoney(allocation.cash)}</b></div></div><footer>{allocation.assetNote}</footer>
    </article>
    <article className="ha-card ha-performance" aria-label="账户盈亏曲线"><header><div><span className="ha-kicker">PERFORMANCE</span><h2>账户盈亏曲线</h2></div>{!print && <div className="ha-ranges" aria-label="收益曲线日期范围">{([30, 90, 0] as const).map(days => <button key={days} type="button" aria-pressed={range === days} onClick={() => { setHover(null); onRange?.(days); }}>{days === 0 ? '全部' : `${days}天`}</button>)}</div>}</header>
      <div className="ha-return"><strong className={value !== null && value < 0 ? 'ha-down' : 'ha-up'}>{chartPercent(value)}</strong><span>{point ? point.date : returns.method === 'MWR' ? '原始累计收益率 · MWR' : returns.method === 'TWR' ? '区间收益率 · TWR' : '收益率 · 待同步'}</span></div>
      {returns.count >= 2 ? <svg className="ha-line" viewBox="0 0 400 194" role="img" aria-label={`账户收益率曲线 ${returns.start} 至 ${returns.end}`} onMouseLeave={() => setHover(null)} onMouseMove={event => { const bounds = event.currentTarget.getBoundingClientRect(); const x = (event.clientX - bounds.left) / bounds.width * 400; const nearest = geometry.coordinates.reduce((best, p, index, list) => Math.abs(p.x - x) < Math.abs(list[best].x - x) ? index : best, 0); setHover(nearest); }}>
        {geometry.ticks.map((tick, index) => <g key={index}><line x1="49" x2="380" y1={tick.y} y2={tick.y} stroke={grid}/><text x="43" y={tick.y + 4} textAnchor="end" fill={ink} fontSize="10" fontFamily="Arial">{(tick.value * 100).toFixed(1)}%</text></g>)}
        <line x1="49" x2="380" y1={geometry.zero} y2={geometry.zero} stroke={ink} strokeDasharray="3 5" opacity="0.6"/>
        <path d={geometry.path} fill="none" stroke={print ? '#168665' : '#68d9b6'} strokeWidth="2.3" strokeLinejoin="round"/>
        {point?.y != null && <g><line x1={point.x} x2={point.x} y1="18" y2="164" stroke={ink} strokeDasharray="3 4"/><circle cx={point.x} cy={point.y} r="4" fill="#68d9b6"/></g>}
        <text x="49" y="189" fill={ink} fontSize="10" fontFamily="Arial">{returns.start}</text><text x="380" y="189" textAnchor="end" fill={ink} fontSize="10" fontFamily="Arial">{returns.end}</text>
      </svg> : <div className="ha-no-history">收益历史不足两个有效日期<br/><small>同步到有效记录后自动展示</small></div>}
      <footer><span>{returns.note}</span><span>{performance?.source || 'IBKR'} · {returns.count} 个有效日期{print ? ` · ${range ? `最近 ${range} 天` : '全部历史'}` : ''}</span></footer>
    </article>
  </section>;
}
