import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/globals.css';
import { preloadGlobalMacroTerminal } from './lib/globalMacroTerminalPreload';
import { prepareAssistantData, prepareMarketData, prepareNewsData, prepareWorkbenchData } from './lib/pagePreparation';

void preloadGlobalMacroTerminal().catch(() => undefined);
void prepareMarketData();
void prepareNewsData();
void prepareAssistantData();
void prepareWorkbenchData();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
