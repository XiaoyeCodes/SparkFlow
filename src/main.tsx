import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/globals.css';
import { preloadGlobalMacroTerminal } from './lib/globalMacroTerminalPreload';

void preloadGlobalMacroTerminal().catch(() => undefined);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
