import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { UserMenu } from './UserMenu';

const primaryNavigation = [
  { label: '终端大屏', path: '/terminal' },
  { label: '股票市场', path: '/market' },
  { label: '今日新闻', path: '/signals' },
  { label: 'AI助手', path: '/assistant' },
  { label: '股票ETF定投软件', path: '/trader' }
];

export function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const autoHideNavigation = pathname === '/terminal';
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
          <div className="hidden items-center gap-2 md:flex lg:gap-3">
            {primaryNavigation.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  [
                    'group relative flex h-9 min-w-[58px] items-center justify-center gap-2 overflow-hidden rounded-[6px] border px-3 text-center text-xs font-medium transition duration-200',
                    isActive
                      ? 'border-[#69d8ff]/38 bg-[#09151a] text-white shadow-[inset_0_0_22px_rgba(105,216,255,0.07),0_8px_24px_rgba(0,0,0,0.28),0_0_16px_rgba(105,216,255,0.06)] after:absolute after:inset-x-3 after:bottom-0 after:h-px after:bg-[#69d8ff] after:shadow-[0_0_8px_rgba(105,216,255,0.85)]'
                      : 'border-white/[0.09] bg-[#06080b]/80 text-white/54 shadow-[inset_0_1px_0_rgba(255,255,255,0.025),0_6px_20px_rgba(0,0,0,0.2)] hover:border-white/18 hover:bg-white/[0.045] hover:text-white'
                  ].join(' ')
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden="true"
                      className={[
                        'h-1.5 w-1.5 shrink-0 rounded-full transition duration-200',
                        isActive
                          ? 'bg-[#69d8ff] shadow-[0_0_8px_rgba(105,216,255,0.9)]'
                          : 'bg-white/18 group-hover:bg-white/42'
                      ].join(' ')}
                    />
                    <span className="whitespace-nowrap">{item.label}</span>
                  </>
                )}
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
