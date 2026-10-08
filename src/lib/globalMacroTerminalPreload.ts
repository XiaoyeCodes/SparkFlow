import { GLOBAL_MACRO_BOOTSTRAP_KEYS, type GlobalMacroBootstrap } from './globalMacroPreload';
import { rememberPreparedPublicData } from './publicDataClient';

declare global {
  interface Window { __sparkflowTerminalBootstrap?: Promise<GlobalMacroBootstrap | null> }
}

let prepared: Promise<void> | undefined;
let pageModule: Promise<typeof import('../components/GlobalMacroCommandCenter')> | undefined;
let preparedAt = 0;

export function prepareGlobalMacroData() {
  if (prepared && Date.now() - preparedAt < 30_000) return prepared;
  preparedAt = Date.now();
  const early = window.__sparkflowTerminalBootstrap;
  delete window.__sparkflowTerminalBootstrap;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 2500);
  const request = early || fetch('/api/global-macro/bootstrap', { cache: 'no-store', signal: controller.signal })
    .then(response => response.ok ? response.json() as Promise<GlobalMacroBootstrap> : null);
  // An unavailable bootstrap must never delay navigation indefinitely.
  prepared = Promise.race([request, new Promise<null>(resolve => {
    controller.signal.addEventListener('abort', () => resolve(null), { once: true });
  })]).then(snapshot => {
    if (!snapshot?.resources || typeof snapshot.resources !== 'object') return;
    for (const key of GLOBAL_MACRO_BOOTSTRAP_KEYS) {
      if (key in snapshot.resources) rememberPreparedPublicData(key, snapshot.resources[key]);
    }
  }).catch(() => { preparedAt = 0; }).finally(() => window.clearTimeout(timeout));
  return prepared;
}

export function preloadGlobalMacroTerminal() {
  pageModule ??= import('../components/GlobalMacroCommandCenter').catch(error => { pageModule = undefined; throw error; });
  return Promise.all([pageModule, prepareGlobalMacroData()]).then(([module]) => module);
}
