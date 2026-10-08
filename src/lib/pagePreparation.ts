import { marketBootstrapKeys, MARKET_DATA_PREPARED, NEWS_DATA_PREPARED, type MarketBootstrap } from './marketPreload';
import { rememberHeatmapSources } from './heatmapSources';
import { rememberPreparedPublicData } from './publicDataClient';
import { pageDataFetch, pageDataRevision, peekPageData, rememberPageData } from './pageDataClient';
import type { NewsFeed } from './newsTypes';
import { prepareHeatmapLogoResources } from './heatmapLogoPreload';

declare global {
  interface Window {
    __sparkflowMarketBootstrap?: Promise<MarketBootstrap | null>;
    __sparkflowNewsPrepared?: Promise<NewsFeed | null>;
  }
}
let marketFlight: Promise<void> | undefined;
let marketAt = 0;
let newsFlight: Promise<void> | undefined;
let newsAt = 0;
let assistantFlight: Promise<void> | undefined;
let assistantAt = 0;
let workbenchFlight: Promise<void> | undefined;
let workbenchAt = 0;

async function fetchPrepared<T>(url: string): Promise<T | null> {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
  return response.ok && response.status !== 204 ? response.json() : null;
}

export function prepareMarketData() {
  if (marketFlight) return marketFlight;
  if (marketAt && Date.now() - marketAt < 30_000) return Promise.resolve();
  const early = window.__sparkflowMarketBootstrap;
  delete window.__sparkflowMarketBootstrap;
  marketAt = Date.now();
  marketFlight = (early || fetchPrepared<MarketBootstrap>('/api/market/bootstrap')).then(snapshot => {
    if (!snapshot?.sources || !snapshot.resources) { marketAt = 0; return; }
    rememberHeatmapSources(snapshot.sources);
    for (const key of marketBootstrapKeys(snapshot.sources)) {
      if (key in snapshot.resources) rememberPreparedPublicData(key, snapshot.resources[key]);
    }
    void prepareHeatmapLogoResources(snapshot.resources);
    window.dispatchEvent(new Event(MARKET_DATA_PREPARED));
  }).catch(() => { marketAt = 0; }).finally(() => { marketFlight = undefined; });
  return marketFlight;
}

export function prepareNewsData() {
  if (newsFlight) return newsFlight;
  if (newsAt && Date.now() - newsAt < 30_000) return Promise.resolve();
  const early = window.__sparkflowNewsPrepared;
  delete window.__sparkflowNewsPrepared;
  const previous = peekPageData<NewsFeed>('/api/news-feed');
  const after = previous ? `?after=${encodeURIComponent(`${previous.generatedAt}:${previous._pageCache?.storedAt}`)}` : '';
  const revision = pageDataRevision('/api/news-feed');
  newsAt = Date.now();
  newsFlight = (early || fetchPrepared<NewsFeed>('/api/news-feed/prepared' + after)).then(feed => {
    if (feed && pageDataRevision('/api/news-feed') === revision) {
      rememberPageData('/api/news-feed', feed);
      window.dispatchEvent(new Event(NEWS_DATA_PREPARED));
    }
  }).catch(() => { newsAt = 0; }).finally(() => { newsFlight = undefined; });
  return newsFlight;
}

function preparePrivateData(url: string) {
  return pageDataFetch(url)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    });
}

export function prepareAssistantData() {
  if (assistantFlight) return assistantFlight;
  if (assistantAt && Date.now() - assistantAt < 30_000) return Promise.resolve();
  assistantAt = Date.now();
  assistantFlight = preparePrivateData('/api/vibe/research/sessions')
    .catch(() => { assistantAt = 0; })
    .finally(() => { assistantFlight = undefined; });
  return assistantFlight;
}

export function prepareWorkbenchData() {
  if (workbenchFlight) return workbenchFlight;
  if (workbenchAt && Date.now() - workbenchAt < 30_000) return Promise.resolve();
  workbenchAt = Date.now();
  workbenchFlight = preparePrivateData('/api/ibkr-workbench/state')
    .catch(() => { workbenchAt = 0; })
    .finally(() => { workbenchFlight = undefined; });
  return workbenchFlight;
}
