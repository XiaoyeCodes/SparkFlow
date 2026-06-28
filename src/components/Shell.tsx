import { ArrowUpRight } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { gateways } from '../data/content';
import { preloadTradingViewHeatmap } from './TradingViewHeatmap';

export function Shell({ children }: { children: ReactNode }) {
  useEffect(() => {
    preloadTradingViewHeatmap();
  }, []);

  return (
    <div className="min-h-screen bg-black text-ink">
      <header className="fixed inset-x-0 top-0 z-50 h-[var(--nav-height)] border-b border-white/10 bg-black/45 backdrop-blur-2xl">
        <nav className="mx-auto flex h-full w-full max-w-7xl items-center justify-between px-5 md:px-8">
          <Link to="/" className="flex items-center gap-3" aria-label="SparkFlow home">
            <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-[11px] border border-white/12 bg-white/[0.035] p-0.5 shadow-[0_0_24px_rgba(138,215,255,0.16)] backdrop-blur-sm">
              <img
                src="/brand/lumenary-mark-v2-transparent.png"
                alt=""
                className="h-full w-full scale-110 object-contain opacity-95 mix-blend-screen"
              />
            </span>
            <span className="text-sm font-semibold">SparkFlow</span>
          </Link>
          <div className="hidden items-center gap-1 md:flex">
            <NavLink
              to="/market"
              onFocus={preloadTradingViewHeatmap}
              onPointerEnter={preloadTradingViewHeatmap}
              className={({ isActive }) =>
                [
                  'rounded-full px-3 py-2 text-xs font-medium text-white/52 transition hover:text-white',
                  isActive ? 'bg-white/10 text-white' : ''
                ].join(' ')
              }
            >
              股票市场
            </NavLink>
            {gateways.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  [
                    'rounded-full px-3 py-2 text-xs font-medium text-white/52 transition hover:text-white',
                    isActive ? 'bg-white/10 text-white' : ''
                  ].join(' ')
                }
              >
                {item.title}
              </NavLink>
            ))}
          </div>
          <Link
            to="/signals"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-white/5 text-white/70 transition hover:border-white/24 hover:text-white"
            aria-label="Open live signals"
          >
            <ArrowUpRight size={16} strokeWidth={1.8} />
          </Link>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
