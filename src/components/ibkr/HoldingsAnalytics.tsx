import { useState } from 'react';
import type { AccountSnapshot, PortfolioPerformance } from '../../lib/ibkr/workbenchTypes';
import { chartMoney, chartPercent, holdingsAllocation, holdingsReturnSeries, returnGeometry, type AllocationSlice, type HoldingsRange } from '../../lib/ibkr/holdingsAnalytics';
import './HoldingsAnalytics.css';

type AccountAmount = { label: string; value: number | null; note?: string };

function Donut({ slices, label, center, caption, print, amounts = false, details, innerSlices = [] }: { slices: AllocationSlice[]; label: string; center: string; caption: string; print: boolean; amounts?: boolean; details?: AccountAmount[]; innerSlices?: (AllocationSlice & { displayValue?: number })[] }) {
  const [active, setActive] = useState<number | null>(null);
  const [activeDetail, setActiveDetail] = useState<number | null>(null);
  const detail = activeDetail === null ? null : details?.[activeDetail];
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const [activeInner, setActiveInner] = useState<number | null>(null);
  const innerTotal = innerSlices.reduce((sum, slice) => sum + slice.value, 0);
  const innerSelected = activeInner === null ? null : innerSlices[activeInner];
  const doubleRing = innerTotal > 0;
  let innerOffset = 0;
  let offset = 0;
  const selected = active === null ? null : slices[active];
  return <div className={`ha-donut-layout${details ? ' ha-amount-donut' : ''}`}><svg viewBox="0 0 200 200" role="img" aria-label={label} className="ha-donut">
    <circle cx="100" cy="100" r={doubleRing ? 84 : 76} fill="none" stroke={print ? '#e1e9ef' : '#1c332c'} strokeWidth={doubleRing ? 17 : 24} />
    {total > 0 && slices.map((slice, index) => { const fraction = slice.value / total; const start = offset; offset += fraction; return <circle key={index} cx="100" cy="100" r={doubleRing ? 84 : 76} fill="none" stroke={slice.color} strokeWidth={doubleRing ? active === index ? 20 : 17 : active === index ? 29 : 24} pathLength="100" strokeDasharray={`${fraction * 100} ${100 - fraction * 100}`} strokeDashoffset={-start * 100} transform="rotate(-90 100 100)" opacity={active === null || active === index ? 1 : 0.4} onMouseEnter={() => { setActive(index); setActiveDetail(null); setActiveInner(null); }} onMouseLeave={() => setActive(null)}><title>{slice.label} · {chartMoney(slice.value)} · {(fraction * 100).toFixed(1)}%</title></circle>; })}
    {doubleRing && innerSlices.map((slice, index) => {
      const fraction = slice.value / innerTotal, start = innerOffset; innerOffset += fraction;
      return <circle className="ha-funding-segment" key={slice.label} cx="100" cy="100" r="63" fill="none" stroke={slice.color} strokeWidth={activeInner === index ? 17 : 14} pathLength="100" strokeDasharray={`${fraction * 100} ${100 - fraction * 100}`} strokeDashoffset={-start * 100} transform="rotate(-90 100 100)" onMouseEnter={() => { setActiveInner(index); setActiveDetail(null); setActive(null); }} onMouseLeave={() => setActiveInner(null)}><title>{slice.label} · {chartMoney(slice.displayValue ?? slice.value)} · {(fraction * 100).toFixed(1)}%</title></circle>;
    })}
    <text x="100" y="97" textAnchor="middle" fill={print ? '#17334c' : '#e7f2ed'} fontSize={doubleRing ? 17 : 21} fontWeight="600" fontFamily="Arial, Microsoft YaHei, sans-serif">{detail ? chartMoney(detail.value) : innerSelected ? chartMoney(innerSelected.displayValue ?? innerSelected.value) : selected ? amounts ? chartMoney(selected.value) : `${(selected.value / total * 100).toFixed(1)}%` : center}</text>
    <text x="100" y="120" textAnchor="middle" fill={print ? '#607789' : '#94ad9f'} fontSize="11" fontFamily="Arial, Microsoft YaHei, sans-serif">{detail?.label || innerSelected?.label || selected?.label || caption}</text>
  </svg><div className="ha-legend">{details ? details.map((item, index) => <button key={item.label} type="button" onFocus={() => setActiveDetail(index)} onBlur={() => setActiveDetail(null)} onMouseEnter={() => setActiveDetail(index)} onMouseLeave={() => setActiveDetail(null)} onClick={() => setActiveDetail(index)} className={activeDetail === index ? 'active' : ''} title={item.note || `${item.label} · ${chartMoney(item.value)}`}><span>{item.label}</span><b className={item.value !== null && item.value < 0 ? 'ha-down' : ''}>{chartMoney(item.value)}</b></button>) : slices.length ? slices.map((slice, index) => <button key={index} type="button" onFocus={() => setActive(index)} onBlur={() => setActive(null)} onMouseEnter={() => { setActive(index); setActiveDetail(null); setActiveInner(null); }} onMouseLeave={() => setActive(null)} className={active === index ? 'active' : ''} title={`${slice.label} · ${chartMoney(slice.value)}`}><i style={{ background: slice.color }}/><span>{slice.label}</span><b>{amounts ? chartMoney(slice.value) : `${(slice.value / total * 100).toFixed(1)}%`}</b></button>) : <span className="ha-empty-label">暂无可绘制数据</span>}</div></div>;
}

export function HoldingsAnalytics({ snapshot, performance, range = 90, onRange, print = false }: { snapshot: AccountSnapshot; performance?: PortfolioPerformance; range?: HoldingsRange; onRange?: (range: HoldingsRange) => void; print?: boolean }) {
  const allocation = holdingsAllocation(snapshot);
  const returns = holdingsReturnSeries(performance, range);
  const geometry = returnGeometry(returns.points);
  const [hover, setHover] = useState<number | null>(null);
  const point = hover === null ? null : geometry.coordinates[hover];
  const value = point ? point.value : returns.value;
  const navPoint = hover === null ? returns.points[returns.points.length - 1] : returns.points[hover];
  const navValue = navPoint?.nav ?? null;
  const baseNav = returns.points.find(row => row.nav !== null)?.nav ?? null;
  const performanceCurrency = performance?.currency || allocation.currency;
  const localNav = returns.kind === 'nav';
  const navChange = localNav && navValue !== null && baseNav !== null ? navValue - baseNav : null;
  const navChangeText = navChange === null ? '—' : `${navChange > 0 ? '+' : ''}${chartMoney(navChange)}`;
  const performanceTitle = localNav ? '账户净值轨迹' : '账户收益曲线';
  const ink = print ? '#61798b' : '#89a496';
  const grid = print ? '#dce5ec' : '#20392e';
  return <section className={`holdings-analytics${print ? ' ha-print' : ''}`} aria-label="持仓图表总览">
    <article className="ha-card" aria-label="持仓分布"><header><div><span className="ha-kicker">ALLOCATION</span><h2>持仓分布</h2></div><span className="ha-badge">{snapshot.positions.length} 项持仓</span></header>
      <Donut slices={allocation.slices} label="各持仓市值占持仓总市值的比例" center={chartMoney(allocation.excluded && !allocation.slices.length ? null : allocation.gross)} caption={`${allocation.excluded ? '已知市值' : allocation.short ? '绝对敞口' : '持仓市值'} · ${allocation.currency}`} print={print}/>
      <footer>{allocation.excluded ? `仅展示可用的 ${allocation.currency} 市值；${allocation.excluded} 项未计入。` : allocation.short ? '按市值绝对值展示多空敞口，空头单独标识。' : '占比以持仓总市值计算，不含现金。'}</footer>
    </article>
    <article className="ha-card" aria-label="资产构成"><header><div><span className="ha-kicker">ACCOUNT VALUE</span><h2>资产构成</h2></div><span className="ha-badge">{allocation.currency}</span></header>
      <div className="ha-total"><span>总资产 · 账户净值</span><strong>{chartMoney(allocation.total)}<small>{allocation.currency}</small></strong></div>
      <Donut slices={allocation.amountSlices} label="账户资产金额构成" innerSlices={allocation.fundingSlices.map(slice => ({ ...slice, label: slice.label === '自有净值' ? '总资产 · 账户净值' : slice.label === '融资负债' ? '融资欠额' : slice.label, displayValue: slice.label === '融资负债' ? -slice.value : slice.value, color: slice.label === '自有净值' ? '#70a8ed' : slice.color }))} center={chartMoney(allocation.total)} caption="总资产 · 账户净值" print={print} amounts details={[
        { label: '总持有价值', value: allocation.heldValue, note: '多头持仓市值加正现金余额，未扣融资欠款' },
        { label: '总资产 · 账户净值', value: allocation.total },
        { label: '持仓余额 · 市值', value: allocation.invested },
        { label: allocation.financingDebt ? '融资欠额' : '现金余额', value: allocation.cash, note: allocation.financingDebt ? '负现金即融资欠额，不重复列示或扣除' : '券商回报的现金余额' },
        { label: '可融资额度', value: allocation.financingAvailable, note: '计算值：有融资欠额时＝购买力；无融资欠额时＝购买力－账户净值' },
        { label: '购买力', value: allocation.buyingPower, note: '券商回报的购买力' },
        ...(allocation.residual !== null && Math.abs(allocation.residual) > 0.01 ? [{ label: '其他净额 · 待核对', value: allocation.residual }] : []),
      ]}/>
      <footer>{allocation.excluded || allocation.residual === null ? allocation.assetNote : allocation.fundingSlices.length ? '外环：持仓与正现金；内环：账户净值（蓝）与融资等负债（橙），负净值时展示正资产与净资产缺口。负现金已含融资欠款，不重复扣减。' : '圆环展示持仓与现金；总资产采用券商账户净值，其他净额单列。'}<br/>可融资额度为计算值：有欠额时等于购买力，无欠额时为购买力减账户净值。</footer>
    </article>
    <article className="ha-card ha-performance" aria-label={performanceTitle}><header><div><span className="ha-kicker">PERFORMANCE</span><h2>{performanceTitle}</h2></div>{!print && <div className="ha-ranges" aria-label={`${localNav ? '净值' : '收益'}曲线日期范围`}>{([30, 90, 0] as const).map(days => <button key={days} type="button" aria-pressed={range === days} onClick={() => { setHover(null); onRange?.(days); }}>{days === 0 ? '全部' : `${days}天`}</button>)}</div>}</header>
      <div className="ha-return"><div className="ha-return-values"><div className="ha-return-change">{localNav && <><span>{point ? '截至该日净值变动' : '区间净值变动金额'}</span><b className={navChange !== null && navChange < 0 ? 'ha-down' : 'ha-up'}>{navChangeText}<small>{performanceCurrency}</small></b></>}<strong className={value !== null && value < 0 ? 'ha-down' : 'ha-up'}>{chartPercent(value)}</strong></div><div className="ha-return-amount"><span>{point ? '当日账户净值' : '期末账户净值'}</span><b>{chartMoney(navValue)}<small>{performanceCurrency}</small></b></div></div><span>{point ? point.date : localNav ? '所选区间净值变动 · 含出入金' : returns.method === 'MWR' ? '原始累计收益率 · MWR' : returns.method === 'TWR' ? '区间收益率 · TWR' : '收益率 · 待同步'}</span></div>
      {returns.count >= 2 ? <svg className="ha-line" viewBox="0 0 400 194" role="img" aria-label={`账户${localNav ? '净值变动' : '收益率'}曲线 ${returns.start} 至 ${returns.end}`} onMouseLeave={() => setHover(null)} onMouseMove={event => { const bounds = event.currentTarget.getBoundingClientRect(); const x = (event.clientX - bounds.left) / bounds.width * 400; const nearest = geometry.coordinates.reduce((best, p, index, list) => Math.abs(p.x - x) < Math.abs(list[best].x - x) ? index : best, 0); setHover(nearest); }}>
        {geometry.ticks.map((tick, index) => <g key={index}><line x1="49" x2="380" y1={tick.y} y2={tick.y} stroke={grid}/><text x="43" y={tick.y + 4} textAnchor="end" fill={ink} fontSize="10" fontFamily="Arial">{(tick.value * 100).toFixed(1)}%</text></g>)}
        <line x1="49" x2="380" y1={geometry.zero} y2={geometry.zero} stroke={ink} strokeDasharray="3 5" opacity="0.6"/>
        <path d={geometry.path} fill="none" stroke={print ? '#168665' : '#68d9b6'} strokeWidth="2.3" strokeLinejoin="round"/>
        {point?.y != null && <g><line x1={point.x} x2={point.x} y1="18" y2="164" stroke={ink} strokeDasharray="3 4"/><circle cx={point.x} cy={point.y} r="4" fill="#68d9b6"/></g>}
        <text x="49" y="189" fill={ink} fontSize="10" fontFamily="Arial">{returns.start}</text><text x="380" y="189" textAnchor="end" fill={ink} fontSize="10" fontFamily="Arial">{returns.end}</text>
      </svg> : <div className="ha-no-history">{localNav ? '本地净值历史不足两个有效日期' : '收益历史不足两个有效日期'}<br/><small>{localNav ? '每次成功同步后按日积累' : '同步到有效记录后自动展示'}</small></div>}
      <footer><span>{returns.note}</span><span>{performance?.source || 'IBKR'} · {returns.count} 个有效日期{print ? ` · ${range ? `最近 ${range} 天` : '全部历史'}` : ''}</span></footer>
    </article>
  </section>;
}
