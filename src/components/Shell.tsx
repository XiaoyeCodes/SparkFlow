import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { gateways } from '../data/content';
import { UserMenu } from './UserMenu';

export function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const autoHideNavigation = pathname === '/market';
  const [touchNavigation, setTouchNavigation] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(hover: none), (pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  });
  const [touchNavigationVisible, setTouchNavigationVisible] = useState(false);
  const touchNavigationTimerRef = useRef<number | null>(null);

  const clearTouchNavigationTimer = useCallback(() => {
    if (touchNavigationTimerRef.current === null) return;
    window.clearTimeout(touchNavigationTimerRef.current);
    touchNavigationTimerRef.current = null;
  }, []);

  const revealTouchNavigation = useCallback(() => {
    if (!autoHideNavigation || !touchNavigation) return;

    clearTouchNavigationTimer();
    setTouchNavigationVisible(true);
    touchNavigationTimerRef.current = window.setTimeout(() => {
      setTouchNavigationVisible(false);
      touchNavigationTimerRef.current = null;
    }, 3200);
  }, [autoHideNavigation, clearTouchNavigationTimer, touchNavigation]);

  useEffect(() => {
    const touchMedia = window.matchMedia('(hover: none), (pointer: coarse)');
    const updateTouchNavigation = () => {
      setTouchNavigation(touchMedia.matches || navigator.maxTouchPoints > 0);
    };

    updateTouchNavigation();
    touchMedia.addEventListener?.('change', updateTouchNavigation);
    return () => touchMedia.removeEventListener?.('change', updateTouchNavigation);
  }, []);

  useEffect(() => {
    if (autoHideNavigation && touchNavigation) return;
    clearTouchNavigationTimer();
    setTouchNavigationVisible(false);
  }, [autoHideNavigation, clearTouchNavigationTimer, touchNavigation]);

  useEffect(() => clearTouchNavigationTimer, [clearTouchNavigationTimer]);

  return (
    <div className={`min-h-screen bg-black text-ink ${autoHideNavigation ? 'market-auto-hide-shell' : ''}`}>
      {autoHideNavigation ? (
        <button
          type="button"
          className="market-nav-hover-zone"
          aria-label="显示顶部导航"
          aria-controls="sparkflow-global-navigation"
          aria-expanded={touchNavigationVisible}
          onPointerDown={revealTouchNavigation}
          onFocus={revealTouchNavigation}
        />
      ) : null}
      <header
        id="sparkflow-global-navigation"
        className={`fixed inset-x-0 top-0 z-50 h-[var(--nav-height)] border-b border-white/10 bg-black/45 backdrop-blur-2xl ${autoHideNavigation ? 'market-auto-hide-header' : ''} ${touchNavigation ? 'is-touch-navigation' : ''} ${touchNavigationVisible ? 'is-touch-visible' : ''}`}
        onPointerDown={revealTouchNavigation}
        onFocusCapture={revealTouchNavigation}
      >
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
          <UserMenu />
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
