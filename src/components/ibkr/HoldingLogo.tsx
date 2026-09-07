import { useEffect, useState } from 'react';
import type { Holding } from '../../lib/ibkr/workbenchTypes';

export function HoldingLogo({ holding }: { holding: Holding }) {
  const { symbol, currency, assetType, exchange } = holding;
  const query = new URLSearchParams({ symbol, currency, assetType: assetType ?? '', exchange: exchange ?? '' }).toString();
  const [image, setImage] = useState<{ key: string; src: string } | null>(null);
  const [loaded, setLoaded] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setImage(null); setLoaded('');
    void fetch(`/api/ibkr-workbench/logo?${query}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) return;
        const logo = await response.json();
        if (!controller.signal.aborted && typeof logo.src === 'string' && (/^\/stock-logos\/[\w.-]+\.svg$/.test(logo.src) || logo.src === `/api/ibkr-workbench/logo?${query}&image=1`)) setImage({ key: query, src: logo.src });
      }).catch(() => { /* Keep the symbol placeholder when the source is unavailable. */ });
    return () => controller.abort();
  }, [query]);
  const src = image?.key === query ? image.src : null;
  return <span className={`awb-company-icon${src && loaded === query ? ' has-logo' : ''}`} aria-hidden="true">
    <span>{symbol.slice(0, 2)}</span>
    {src && <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onLoad={() => setLoaded(query)} onError={() => { setImage(null); setLoaded(''); }} />}
  </span>;
}
