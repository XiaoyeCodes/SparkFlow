import { useEffect, useState, type ReactNode } from 'react';
import { Menu, X } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';
import './PillNav.css';

export type PillNavItem = {
  label: string;
  path: string;
  disabled?: boolean;
};

type PillNavProps = {
  items: PillNavItem[];
  activePath: string;
  trailing?: ReactNode;
};

export function PillNav({ items, activePath, trailing }: PillNavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [activePath]);

  return (
    <div className="sf-pill-nav-shell">
      <Link to="/" className="sf-pill-brand" aria-label="SparkFlow 首页">
        <span className="sf-pill-brand-mark">
          <img src="/brand/lumenary-mark-v2-transparent.png" alt="" />
        </span>
        <span className="sf-pill-brand-name">SparkFlow</span>
      </Link>

      <div className="sf-pill-nav-desktop" aria-label="主导航">
        <ul className="sf-pill-list">
          {items.map((item) => (
            <li key={item.path}>
              {item.disabled ? (
                <button
                  type="button"
                  className="sf-pill sf-pill-disabled"
                  disabled
                  title="每日策略暂未开放"
                >
                  <span className="sf-pill-label">{item.label}</span>
                </button>
              ) : (
                <NavLink
                  to={item.path}
                  className={({ isActive }) => `sf-pill${isActive ? ' is-active' : ''}`}
                >
                  <span className="sf-pill-hover-circle" aria-hidden="true" />
                  <span className="sf-pill-label">{item.label}</span>
                  <span className="sf-pill-label-hover" aria-hidden="true">
                    {item.label}
                  </span>
                </NavLink>
              )}
            </li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        className="sf-pill-menu-button"
        onClick={() => setMobileOpen((value) => !value)}
        aria-label={mobileOpen ? '关闭导航菜单' : '打开导航菜单'}
        aria-expanded={mobileOpen}
        aria-controls="sparkflow-mobile-navigation"
      >
        {mobileOpen ? <X size={18} /> : <Menu size={18} />}
      </button>

      {trailing ? <div className="sf-pill-nav-trailing">{trailing}</div> : null}

      <div
        id="sparkflow-mobile-navigation"
        className={`sf-pill-mobile-menu${mobileOpen ? ' is-open' : ''}`}
      >
        {items.map((item) =>
          item.disabled ? (
            <button key={item.path} type="button" disabled className="sf-pill-mobile-link is-disabled">
              {item.label}
              <small>暂未开放</small>
            </button>
          ) : (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `sf-pill-mobile-link${isActive ? ' is-active' : ''}`}
            >
              {item.label}
            </NavLink>
          )
        )}
      </div>
    </div>
  );
}
