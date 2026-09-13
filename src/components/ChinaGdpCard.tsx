import { useEffect, useId, useState } from 'react';
import { ArrowUpRight, ChartNoAxesColumnIncreasing } from 'lucide-react';
import type { ChinaGdpSnapshot } from '../lib/chinaGdpTypes';
import './ChinaGdpCard.css';

export function ChinaGdpCard() {
  const [data, setData] = useState<ChinaGdpSnapshot | null>(null);
  const [now, setNow] = useState(Date.now());
  const [active, setActive] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const gradient = useId().replace(/:/g, '');
  useEffect(() => {
    let disposed = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    const load = async () => {
      if (disposed || running || document.hidden) return;
      clearTimeout(timer);
      running = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 25_000);
      let next = Date.now() + 60_000;
      try {
        const response = await fetch('/api/china-gdp', {cache:'no-store', signal:controller.signal});
        if (!response.ok) throw new Error('GDP source unavailable');
        const result: ChinaGdpSnapshot = await response.json();
        if (!Array.isArray(result.years) || !Number.isFinite(Date.parse(result.validUntil)) || !Number.isFinite(Date.parse(result.nextCheckAt))) throw new Error('Invalid GDP response');
        if (result.status === 'current' && (result.years.length !== 5 || result.years.some(row => !Number.isFinite(row.value) || row.value <= 0 || !Number.isFinite(row.growth)))) throw new Error('Invalid GDP values');
        if (!disposed) { setData(result); setFailed(false); }
        next = Date.parse(result.nextCheckAt);
      } catch { if (!disposed) setFailed(true); }
      finally {
        clearTimeout(timeout);
        running = false;
        if (!disposed) { setNow(Date.now()); timer = setTimeout(load, Math.max(1_000, Math.min(60_000, next - Date.now()))); }
      }
    };
    const wake = () => {setNow(Date.now()); if (!document.hidden) void load();};
    const tick = setInterval(() => setNow(Date.now()), 10_000);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    void load();
    return () => {disposed = true; controller?.abort(); clearTimeout(timer); clearInterval(tick); document.removeEventListener('visibilitychange',wake); window.removeEventListener('focus',wake); window.removeEventListener('online',wake);};
  }, []);
  const ready = !failed && data?.status === 'current' && now < Date.parse(data.validUntil);
  const rows = ready ? data.years : [];
  const last = rows[rows.length - 1];
  const selected = active === null ? null : rows[active];
  const max = rows.length ? Math.ceil(Math.max(...rows.map(row => row.value)) / 20) * 20 : 160;
  return <section className="china-gdp-card" aria-label="中国 GDP 柱状图">
    <header><ChartNoAxesColumnIncreasing size={15} /><h2>中国 GDP</h2><span>近 5 年</span><a href={selected?.sourceUrl || last?.sourceUrl || 'https://www.stats.gov.cn/sj/tjgb/ndtjgb/qgndtjgb/'} target="_blank" rel="noreferrer" title="查看国家统计局原文" aria-label="查看 GDP 官方来源"><ArrowUpRight size={13} /></a></header>
    <div className="china-gdp-headline"><div><strong>{last ? last.value.toFixed(2) : '—'}</strong><span>万亿元</span></div><div><b>{last ? `${last.growth > 0 ? '+' : ''}${last.growth.toFixed(1)}%` : '—'}</b><small>{last ? `${last.year} 年实际增速` : '等待官方数据'}</small></div></div>
    {ready ? <div className="china-gdp-plot">
      <svg viewBox="0 0 320 150" aria-label="年度 GDP，单位万亿元" onMouseLeave={() => setActive(null)}>
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#67dab6" stopOpacity=".9" /><stop offset="100%" stopColor="#20745c" stopOpacity=".5" /></linearGradient></defs>
        {[0, .5, 1].map(fraction => <g key={fraction}><line x1="29" x2="316" y1={116 - fraction * 90} y2={116 - fraction * 90} stroke="#234037" strokeDasharray={fraction ? '2 4' : undefined} /><text x="23" y={120 - fraction * 90} textAnchor="end" className="china-gdp-axis">{(max * fraction).toFixed(0)}</text></g>)}
        {rows.map((row, index) => {
          const x = 41 + index * 56;
          const height = row.value / max * 90;
          return <g key={row.year} role="button" tabIndex={0} aria-label={`${row.year}年 GDP ${row.value.toFixed(2)}万亿元，实际增长${row.growth}%`} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} onClick={() => setActive(index)} onKeyDown={event => {if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); setActive(index);} if (event.key === 'Escape') setActive(null);}} className={index === active ? 'is-active' : ''}>
            <rect x={x - 4} y="10" width="47" height="138" fill="transparent" />
            <rect x={x} y={116 - height} width="34" height={height} rx="3" fill={index === rows.length - 1 ? '#69dcbc' : `url(#${gradient})`} className="china-gdp-bar" />
            <text x={x + 17} y={108 - height} textAnchor="middle" className="china-gdp-value">{row.value.toFixed(1)}</text>
            <text x={x + 17} y="137" textAnchor="middle" className="china-gdp-year">{row.year}</text>
          </g>;
        })}
      </svg>
      {selected && <div className="china-gdp-tooltip" role="status"><strong>{selected.year} 年 · 公报初步核算</strong><span>GDP <b>{selected.value.toFixed(2)} 万亿元</b></span><span>实际增速 <b>{selected.growth > 0 ? '+' : ''}{selected.growth.toFixed(1)}%</b></span></div>}
    </div> : <div className="china-gdp-empty" role="status">{failed || data?.status === 'unavailable' ? '官方数据暂不可用，正在自动重试' : data ? '正在核实最新年度公报' : '正在读取国家统计局数据…'}</div>}
    <p>现价总量 · 各年公报初步核算值<br />增速按不变价计算，历史值未统一追溯修订。</p>
  </section>;
}
