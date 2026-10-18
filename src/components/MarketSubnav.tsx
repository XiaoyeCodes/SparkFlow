import { FlaskConical, Radar } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { loadStrategyState } from '../lib/stockStrategyClient';
import './MarketSubnav.css';

export function MarketSubnav() {
  const prepare = () => {
    void import('../routes/StockStrategy');
    void loadStrategyState().catch(() => {});
  };
  return <nav className="market-subnav" aria-label="股票市场子页面">
    <NavLink to="/market" end>{({ isActive }) => <><Radar aria-hidden="true" /><span role={isActive ? 'heading' : undefined} aria-level={isActive ? 1 : undefined}>市场情报</span></>}</NavLink>
    <NavLink to="/market/research" onMouseEnter={prepare} onFocus={prepare}>{({ isActive }) => <><FlaskConical aria-hidden="true" /><span role={isActive ? 'heading' : undefined} aria-level={isActive ? 1 : undefined}>策略研究</span></>}</NavLink>
  </nav>;
}
