import { AnimatePresence } from 'framer-motion';
import { Route, Routes, useLocation } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Home } from './routes/Home';
import { Signals } from './routes/Signals';
import { Trader } from './routes/Trader';
import { Stack } from './routes/Stack';
import { Artifacts } from './routes/Artifacts';
import { Logs } from './routes/Logs';
import { RouteScrollReset } from './components/RouteScrollReset';
import { Market } from './routes/Market';

export default function App() {
  const location = useLocation();

  return (
    <Shell>
      <RouteScrollReset />
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<Home />} />
          <Route path="/signals" element={<Signals />} />
          <Route path="/trader" element={<Trader />} />
          <Route path="/market" element={<Market />} />
          <Route path="/stack" element={<Stack />} />
          <Route path="/artifacts" element={<Artifacts />} />
          <Route path="/logs" element={<Logs />} />
        </Routes>
      </AnimatePresence>
    </Shell>
  );
}
