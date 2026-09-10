import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { PillNav } from './PillNav';
import { UserMenu } from './UserMenu';
import { primaryNavigation } from '../data/navigation';

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
        className={`sparkflow-shell-header fixed inset-x-0 top-0 z-50 h-[var(--nav-height)] ${autoHideNavigation ? 'market-auto-hide-header' : ''} ${touchNavigation ? 'is-touch-navigation' : ''} ${touchNavigationVisible ? 'is-touch-visible' : ''}`}
        onPointerDown={revealTouchNavigation}
        onFocusCapture={revealTouchNavigation}
      >
        <nav className="sparkflow-shell-nav">
          <PillNav items={primaryNavigation} activePath={pathname.startsWith('/council/') ? '/council' : pathname} trailing={<UserMenu />} />
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
