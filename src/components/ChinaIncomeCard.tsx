import { useEffect, useState, type CSSProperties } from 'react';
import { ArrowUpRight, Users } from 'lucide-react';
import type { IncomeSnapshot } from '../lib/chinaIncomeTypes';
import './ChinaIncomeCard.css';

const number = (v: number) => v.toLocaleString('zh-CN');
const pct = (v: number) => `${v>0?'+':''}${v.toFixed(1)}%`;
const colors = ['#66d6b5','#68a7e5','#c4ab7a','#b09cda'];
export function ChinaIncomeCard() {
  const [snapshot,setSnapshot] = useState<IncomeSnapshot | null>(null);
  const [now,setNow] = useState(Date.now());
  const [offline,setOffline] = useState(false);
  useEffect(()=>{
    let disposed=false, running=false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    const load=async()=>{
      if(disposed || running || document.hidden) return;
      clearTimeout(timer); running=true; controller=new AbortController();
      const timeout=setTimeout(()=>controller?.abort(),40_000);
      let next=Date.now()+60_000;
      try {
        const r=await fetch('/api/china-income',{cache:'no-store',signal:controller.signal});
        if(!r.ok) throw new Error('Income unavailable');
        const data: IncomeSnapshot=await r.json();
        if(!['current','snapshot','unavailable'].includes(data.status) || !Number.isFinite(Date.parse(data.validUntil)) || !Number.isFinite(Date.parse(data.nextCheckAt))) throw new Error('Income format invalid');
        if(data.report && (data.report.groups.length!==3 || data.report.sources.length!==4)) throw new Error('Income incomplete');
        if(!disposed){setSnapshot(data);setOffline(false);}
        next=Date.parse(data.nextCheckAt);
      } catch {if(!disposed)setOffline(true);}
      finally {clearTimeout(timeout);running=false;if(!disposed){setNow(Date.now());timer=setTimeout(load,Math.max(1000,Math.min(60_000,next-Date.now())));}}
    };
    const wake=()=>{setNow(Date.now());if(!document.hidden)void load();};
    const tick=setInterval(()=>setNow(Date.now()),1000);
    document.addEventListener('visibilitychange',wake);window.addEventListener('focus',wake);window.addEventListener('online',wake);void load();
    return()=>{disposed=true;controller?.abort();clearTimeout(timer);clearInterval(tick);document.removeEventListener('visibilitychange',wake);window.removeEventListener('focus',wake);window.removeEventListener('online',wake);};
  },[]);
  const report = snapshot && now<Date.parse(snapshot.validUntil) ? snapshot.report : null;
  const values = report?.groups.flatMap(row=>[row.nominal,row.real]) || [0,7];
  const min=Math.min(0,...values), max=Math.max(1,Math.ceil(Math.max(...values)));
  const x=(v:number)=>133+(v-min)/(max-min)*130;
  return <section className="china-income-card" aria-label="居民收入变化">
    <header><Users size={14}/><h2>居民收入变化</h2><span>{report?.label || '居民可支配收入'}</span><a href={report?.sourceUrl || 'https://www.stats.gov.cn/sj/zxfb/'} target="_blank" rel="noreferrer" aria-label="查看居民收入官方来源"><ArrowUpRight size={13}/></a></header>
    {report ? <>
      <div className="china-income-summary">
        <div><span>全国人均可支配收入</span><strong>{number(report.groups[0].amount)}<small>元</small></strong><em>同比名义 {pct(report.groups[0].nominal)}</em></div>
        <div><span>全国中位数</span><strong>{number(report.median)}<small>元</small></strong><em>同比名义 {pct(report.medianGrowth)}</em></div>
      </div>
      <div className="china-income-median"><span>中位数 / 平均数</span><div><i style={{width:`${Math.min(100,report.medianRatio)}%`}}/></div><b>{report.medianRatio.toFixed(1)}%</b></div>
      <div className="china-income-chart-heading"><b>城乡收入与增速</b><span><i className="nominal"/>名义 <i className="real"/>实际</span></div>
      <svg className="china-income-chart" viewBox="0 0 320 94" role="img" aria-label="全国、城镇、农村收入同比增速对比；圆点为名义增速，方点为实际增速">
        {[min,(min+max)/2,max].map(v=><g key={v}><line x1={x(v)} x2={x(v)} y1="19" y2="91" stroke="#254035" strokeDasharray="2 3"/><text x={x(v)} y="11" textAnchor="middle" className="axis">{v.toFixed(1)}%</text></g>)}
        {report.groups.map((row,i)=>{const y=27+i*26;return <g key={row.label} tabIndex={0} aria-label={`${row.label}收入${row.amount}元，名义增长${row.nominal}%，实际增长${row.real}%`}>
          <title>{row.label}人均收入 {number(row.amount)} 元；名义 {pct(row.nominal)}，实际 {pct(row.real)}</title>
          <text x="0" y={y+3} className="label">{row.label}</text><text x="39" y={y+3} className="amount">{number(row.amount)}元</text>
          <line x1={x(row.real)} x2={x(row.nominal)} y1={y} y2={y} stroke="#628778" strokeWidth="2"/>
          <circle cx={x(row.nominal)} cy={y} r="3.5" fill="#68a7e5"/><rect x={x(row.real)-3} y={y-3} width="6" height="6" rx="1" fill="#66d6b5"/>
          <text x="273" y={y-2} className="nominal-label">{pct(row.nominal)}</text><text x="273" y={y+10} className="real-label">{pct(row.real)}</text>
        </g>;})}
      </svg>
      <div className="china-income-chart-heading"><b>收入来源</b><span>金额 · 名义增速 · 占比</span></div>
      <div className="china-income-stack" aria-label="收入来源占比">{report.sources.map((row,i)=><i key={row.label} style={{flex:row.share,background:colors[i]}} title={`${row.label} ${row.share}%`}/>)}</div>
      <div className="china-income-sources">{report.sources.map((row,i)=><div key={row.label} style={{'--income-color':colors[i]} as CSSProperties}><span><i/>{row.label}<small>{row.share.toFixed(1)}%</small></span><b>{number(row.amount)}<small>元</small><em>{pct(row.growth)}</em></b></div>)}</div>
      <p className="china-income-foot">本期累计，非月收入 · 实际增速已扣除价格因素<br/><span role="status">{snapshot?.status==='snapshot' || offline ? `官方快照 · ${report.publishedAt} 发布，在线核实暂不可用` : `国家统计局 · ${report.publishedAt} 发布`}</span></p>
    </> : <div className="china-income-empty" role="status">{snapshot || offline ? '新一期收入数据待核实，正在自动重试' : '正在读取国家统计局收入数据…'}</div>}
  </section>;
}
