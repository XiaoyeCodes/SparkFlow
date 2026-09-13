import { useEffect, useMemo, useState } from 'react';
import base from '../data/chinaRegionalEconomy.json';
import seed from '../data/chinaRegionalVerified.json';
import sources from '../data/chinaRegionalSources.json';
import { mergeRegionalObservations, type ChinaRegionalEconomy, type RegionalSnapshot } from './chinaRegionalEconomy';

export function useChinaRegionalEconomy(scope: string) {
  const [snapshot, setSnapshot] = useState(seed as unknown as RegionalSnapshot);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let stopped = false;
    let busy = false;
    let controller: AbortController | undefined;
    const sync = async () => {
      if (busy || document.hidden || stopped) return;
      busy = true;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 15_000);
      try {
        const sourceScope = sources.some(source => source.scope === scope) ? scope : '';
        const response = await fetch(`/api/china-regional-economy${sourceScope ? `?scope=${encodeURIComponent(sourceScope)}` : ''}`, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('数据同步失败');
        const next = await response.json() as RegionalSnapshot;
        if (!Array.isArray(next.observations) || !next.scopes) throw new Error('数据格式错误');
        if (!stopped) { setSnapshot(next); setOffline(false); }
      } catch { if (!stopped) setOffline(true); }
      finally { clearTimeout(timeout); busy = false; }
    };
    void sync();
    const timer = window.setInterval(() => { void sync(); }, 60_000);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    window.addEventListener('online', sync);
    return () => {
      stopped = true; controller?.abort(); clearInterval(timer);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
      window.removeEventListener('online', sync);
    };
  }, [scope]);
  const records = useMemo(() => mergeRegionalObservations(base.records as Record<string, ChinaRegionalEconomy>, snapshot.observations), [snapshot.observations]);
  return { records, snapshot, offline };
}
