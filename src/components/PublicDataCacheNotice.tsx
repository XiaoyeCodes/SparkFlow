import { useEffect, useState, useSyncExternalStore } from 'react';
import { getPublicDataNotices, publicDataVersion, subscribePublicData } from '../lib/publicDataClient';

export function PublicDataCacheNotice({ scope }: { scope: 'china' | 'global' | 'market' }) {
  useSyncExternalStore(subscribePublicData, publicDataVersion, publicDataVersion);
  const [, setTick] = useState(0);
  useEffect(() => { const timer = setInterval(() => setTick(value => value + 1), 10_000); return () => clearInterval(timer); }, []);
  const notices = getPublicDataNotices(scope);
  if (!notices.length) return null;
  const unavailable = notices.some(item => item.state === 'unavailable' || (item.expiresAt && Date.parse(item.expiresAt) <= Date.now()));
  const dates = notices.flatMap(item => item.storedAt ? [Date.parse(item.storedAt)] : []).filter(Number.isFinite);
  const timestamp = dates.length ? new Date(Math.min(...dates)).toLocaleString('zh-CN', { hour12: false }) : '';
  return <div role="status" className="fixed bottom-3 left-1/2 z-[60] max-w-[90vw] -translate-x-1/2 rounded-lg border border-amber-300/25 bg-[#14201b]/95 px-3 py-2 text-xs text-amber-100 shadow-lg"
    title="公共数据由服务器定时更新；缓存保存时间不等于行情成交时间，请以数据源时间为准。">
    {unavailable ? '部分公共数据尚未就绪或已过期，后台正在重试' : '部分公共数据使用上次缓存，后台正在更新'}
    {timestamp && <span className="ml-2 text-amber-100/60">缓存保存于 {timestamp}</span>}
  </div>;
}
