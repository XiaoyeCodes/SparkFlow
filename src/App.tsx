import { AnimatePresence } from 'framer-motion';
import { Route, Routes, useLocation } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Home } from './routes/Home';
import { Signals } from './routes/Signals';
import { DailyHot } from './routes/DailyHot';
import { Trader } from './routes/Trader';
import { Stack } from './routes/Stack';
import { Artifacts } from './routes/Artifacts';
import { Logs } from './routes/Logs';
import { RouteScrollReset } from './components/RouteScrollReset';
import { Market } from './routes/Market';
import { Starmap } from './routes/Starmap';
import { GalaxyRoute } from './routes/GalaxyRoute';
import { Assistant } from './routes/Assistant';
import { HyperspeedRoute } from './routes/HyperspeedRoute';
import { IbkrAccount } from './routes/IbkrAccount';
import { StartupGate } from './components/StartupGate';
import { DailyBrief } from './routes/DailyBrief';

export default function App() {
  const location = useLocation();

  return (
    <StartupGate>
      <Shell>
        <RouteScrollReset />
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<Home />} />
            <Route path="/signals" element={<Signals />} />
            <Route path="/signals/daily-hot" element={<DailyHot />} />
            <Route path="/trader" element={<Trader />} />
            <Route path="/terminal" element={<Market initialDashboardView="global" />} />
            <Route path="/market" element={<Market initialDashboardView="markets" />} />
            <Route path="/council" element={<DailyBrief />} />
            <Route path="/assistant" element={<Assistant />} />
            <Route path="/starmap" element={<Starmap />} />
            <Route path="/galaxy" element={<GalaxyRoute />} />
            <Route path="/hyperspeed" element={<HyperspeedRoute />} />
            <Route path="/ibkr" element={<IbkrAccount />} />
            <Route path="/stack" element={<Stack />} />
            <Route path="/artifacts" element={<Artifacts />} />
            <Route path="/logs" element={<Logs />} />
          </Routes>
        </AnimatePresence>
      </Shell>
    </StartupGate>
  );
}
