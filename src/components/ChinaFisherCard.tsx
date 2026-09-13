import { useEffect, useState } from 'react';
import { Orbit, RefreshCw } from 'lucide-react';
import type { FisherMode, FisherSnapshot } from '../lib/chinaFisherTypes';
import './ChinaFisherCard.css';
import { peekPublicData, publicDataFetch } from '../lib/publicDataClient';

const percent = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;

export function ChinaFisherCard() {
  const [mode, setMode] = useState<FisherMode>(() => {
    try { return localStorage.getItem('china-fisher-mode') === 'loan' ? 'loan' : 'deposit'; } catch { return 'deposit'; }
  });
  const [data, setData] = useState<FisherSnapshot | null>(() => peekPublicData<FisherSnapshot>(`/api/china-fisher?mode=${mode}`) ?? null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    const load = async () => {
      if (disposed || inFlight || document.hidden) return;
      clearTimeout(timer);
      inFlight = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 25_000);
      setBusy(true);
      let next = Date.now() + 60_000;
      try {
        const response = await publicDataFetch(`/api/china-fisher?mode=${mode}`, { signal: controller.signal, cache: revision ? 'reload' : 'no-store' });
        if (!response.ok) throw new Error('暂无法连接');
        const result: FisherSnapshot = await response.json();
        if (result.mode !== mode || !['current', 'pending', 'unavailable'].includes(result.status) || !Number.isFinite(Date.parse(result.validUntil))
          || !Number.isFinite(Date.parse(result.nextCheckAt)) || (result.status === 'current' && (!Number.isFinite(result.realRate) || !result.nominal || !result.inflation))) throw new Error('数据不完整');
        if (!disposed) { setData(result); setFailed(false); }
        next = Date.parse(result.nextCheckAt);
      } catch {
        if (!disposed) setFailed(true);
      } finally {
        clearTimeout(timeout);
        inFlight = false;
        if (!disposed) {
          setBusy(false);
          setNow(Date.now());
          timer = setTimeout(load, Math.max(1_000, Math.min(60_000, next - Date.now())));
        }
      }
    };
    const wake = () => { setNow(Date.now()); if (!document.hidden) void load(); };
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    void load();
    return () => {
      disposed = true;
      controller?.abort();
      clearTimeout(timer);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
    };
  }, [revision, mode]);

  const chooseMode = (value: FisherMode) => {
    if (value === mode) return;
    setMode(value);
    setData(null);
    setBusy(true);
    setFailed(false);
    try { localStorage.setItem('china-fisher-mode', value); } catch { /* Preference storage is optional. */ }
  };
  const deposit = mode === 'deposit';
  const current = !failed && data?.mode === mode && data.status === 'current' && now < Date.parse(data.validUntil);
  const status = current ? '最新发布' : busy ? '核实中' : '待更新';
  return <section className="china-fisher-card" aria-label="费雪方程式实际利率" data-status={current ? 'current' : 'pending'}>
    <header className="china-fisher-heading"><Orbit size={15} /><h2>费雪方程式</h2><span className="china-fisher-status" role="status" title={failed ? '连接中断，正在自动重试' : current ? '官方数据已核实' : data?.message || '正在核实官方数据'}><i />{status}</span>
      <button type="button" aria-label="核实费雪方程式数据" title="核实官方数据" disabled={busy} onClick={() => setRevision(value => value + 1)}><RefreshCw size={12} className={busy ? 'is-spinning' : ''} /></button>
    </header>
    <div className="china-fisher-switch" role="group" aria-label="实际利率口径">
      <button type="button" aria-pressed={deposit} onClick={() => chooseMode('deposit')}>存款购买力</button>
      <button type="button" aria-pressed={!deposit} onClick={() => chooseMode('loan')}>贷款成本</button>
    </div>
    <div className="china-fisher-result"><div><span>{deposit ? '实际存款收益' : '实际贷款成本'} · 近似估算</span><strong data-testid="fisher-result">{current ? percent(data.realRate!) : '—'}</strong></div><span className="china-fisher-symbol" aria-hidden="true">r ≈ i − π</span></div>
    <div className="china-fisher-equation" aria-label="实际利率约等于名义利率减通胀率">
      <div><span>{deposit ? '存款挂牌利率' : '贷款参考利率'} <small>{deposit ? '中行 · 1 年整存整取' : '1 年期 LPR'}</small></span><b>{current ? percent(data.nominal!.value) : '—'}</b><small>{current ? `${data.nominal!.publishedAt} 公布` : '等待官方核实'}</small></div>
      <span className="china-fisher-minus" aria-hidden="true">−</span>
      <div><span>通胀率 <small>CPI 同比</small></span><b>{current ? percent(data.inflation!.value) : '—'}</b><small>{current ? `${data.inflation!.period} 数据` : '等待官方核实'}</small></div>
    </div>
    <p className="china-fisher-note">{deposit ? '中行一年期整存整取挂牌利率 − 全国 CPI 同比。仅作存款购买力参考，实际办理利率以银行为准。' : '1 年期 LPR − 全国 CPI 同比。实际贷款按 LPR 加减点定价，非个人贷款报价。'}</p>
  </section>;
}
