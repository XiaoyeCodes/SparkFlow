import { expect, test } from '@playwright/test';
import { dailyBriefDate } from '../../src/lib/dailyBriefFreshness';

test('BTC chart and sidebar recover without regenerating the brief or clearing other cards', async ({ page }) => {
  const now = Date.parse('2026-11-20T02:10:00Z');
  await page.clock.install({ time: new Date(now) });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.route(/^https:\/\/fonts\./, route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: {} }));
  const stamp = new Date(now).toISOString();
  const metric = { value: null, display: '暂无数据', source: 'fixture', sourceUrl: 'https://example.com', status: 'unavailable' };
  const points = Array.from({ length: 90 }, (_, i) => ({ time: new Date(Math.floor(now / 86400_000) * 86400_000 - (89 - i) * 86400_000).toISOString().slice(0, 10), value: 60000 + i * 50 }));
  let firstEditionReady = false, recovered = false, reads = 0, regenerations = 0, aiRequests = 0;
  const payload = () => {
    const crypto = ['BTC', 'ETH', 'SOL'].map((symbol, index) => ({ symbol, name: symbol, price: recovered ? [65000, 2000, 75][index] : null,
      changePercent: recovered ? 1 : null, history: recovered ? points : [] }));
    return { snapshot: { version: 18, date: dailyBriefDate(stamp), slot: 'morning', generatedAt: stamp, updatedAt: stamp,
      summaryMode: 'rules', summary: { headline: '原简报内容保持', regime: '平衡', tone: 'balanced', highlights: [], risks: [], watchlist: [], portfolioNotes: [] },
      markets: [], macro: [], news: [], sources: [], errors: [], portfolio: { connected: false, positions: [] },
      editorial: { generatedAt: stamp, issue: 1, indices: [], stocks: [], crypto,
        macroAssets: [{ symbol: 'QQQ', name: 'QQQ', price: 500, changePercent: 1 }], marketSeries: [], events: [],
        btcTechnical: recovered ? { source: 'OKX BTC/USDT · UTC 1D OHLCV', lookbackDays: 89, atr14: 1000, resistance: null, supportLow: null, supportHigh: null, calculatedAt: stamp } : null,
        assetGroups: [{ id: 'crypto', label: '加密', eyebrow: 'CRYPTO', description: '', items: crypto }],
        sentiment: { cryptoFearGreed: metric, stockFearGreed: metric, vix: metric, mvrvZScore: metric, lthSupplyRatio: metric, sopr: metric, stockComponents: [], cryptoHistory: [] },
        signals: { top: null, bottom: null, coverage: 0, methodology: '' },
        onchain: { sopr: metric, lthSopr: metric, wma200Multiple: metric, puellMultiple: metric, fundingRate: metric, openInterest: metric, dominance: metric },
      } }, cache: { hit: true, key: 'fixture', generated: false } };
  };
  await page.route('**/api/daily-brief', route => {
    reads++;
    return firstEditionReady ? route.fulfill({ json: payload() }) : route.fulfill({ status: 503, json: { detail: '简报正在准备，稍后自动重试' } });
  });
  await page.route('**/api/daily-brief/refresh', route => { regenerations++; return route.fulfill({ json: payload() }); });
  await page.route('**/api/daily-brief/ai-summary', route => { aiRequests++; return route.fulfill({ status: 503, json: {} }); });
  const priorDate = dailyBriefDate(now - 3 * 86400_000);
  await page.route('**/api/daily-brief/status?view=archive-preview', route => route.fulfill({ json: {
    previous: { date: priorDate, headline: '历史简报摘要', titles: ['上一期新闻'] },
  } }));
  await page.goto('http://127.0.0.1:5187/council');
  await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible();
  await expect(page.locator('.editorial-tile')).toHaveCount(0);
  await expect(page.locator('.editorial-archive')).toContainText(priorDate);
  await expect(page.locator('.editorial-archive')).toContainText('上一期新闻');
  firstEditionReady = true;
  await page.clock.fastForward(16_000);
  await expect(page.locator('.brief-viz-card.is-btc')).toContainText('后台将自动重试');
  await expect(page.locator('.brief-viz-card.is-macro')).toContainText('+1.00%');
  await expect(page.locator('.editorial-archive')).toHaveCount(0);
  const before = reads, aiBefore = aiRequests;
  recovered = true;
  await page.clock.fastForward(16_000);
  await expect(page.locator('.brief-btc-chart')).toBeVisible();
  await expect(page.locator('.brief-viz-card.is-btc')).toContainText('阻力未确认');
  await expect(page.locator('.brief-viz-card.is-btc')).toContainText('支撑未确认');
  await expect(page.locator('.brief-viz-card.is-btc')).toContainText('OKX');
  await expect(page.locator('.editorial-asset-card').filter({ hasText: 'BTC' }).first()).toContainText('65,000');
  await expect(page.locator('.editorial-asset-card').filter({ hasText: 'ETH' }).first()).toContainText('2,000');
  await expect(page.locator('.editorial-asset-card').filter({ hasText: 'SOL' }).first()).toContainText('75');
  await expect(page.locator('.brief-viz-card.is-macro')).toContainText('+1.00%');
  expect(reads).toBeGreaterThan(before);
  expect(regenerations).toBe(0);
  expect(aiRequests).toBe(aiBefore);
  // A transport can hang after the user chooses a full refresh.
  // The next automatic GET must be able to run and keep the existing charts.
  await page.route('**/api/daily-brief/refresh', () => { regenerations++; });
  await page.getByRole('button', { name: /刷新全部数据/ }).click();
  await expect.poll(() => regenerations).toBe(1);
  await page.clock.fastForward(55_100);
  await expect(page.locator('.editorial-error')).toContainText('超时');
  await expect(page.locator('.brief-btc-chart')).toBeVisible();
  const afterTimeout = reads;
  await page.clock.fastForward(16_000);
  await expect.poll(() => reads).toBeGreaterThan(afterTimeout);
  await expect(page.locator('.editorial-error')).toHaveCount(0);
});

test('news source status and articles recover on automatic polling while the selector stays open', async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.route(/^https:\/\/fonts\./, route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: {} }));
  let recovered = false, reads = 0;
  await page.route('**/api/news-feed', route => {
    reads++;
    const stamp = new Date().toISOString();
    return route.fulfill({ json: { generatedAt: stamp, proxy: '', categories: [],
      sources: [{ id: '36kr', label: '36氪', category: 'finance', categoryLabel: '金融 / 商业', origin: 'domestic', route: 'direct', ok: recovered, count: recovered ? 1 : 0, error: recovered ? undefined : '临时故障' }],
      items: recovered ? [{ id: 'restored', title: '已恢复的财经新闻', url: 'https://www.36kr.com/p/12345', source: '36氪', sourceId: '36kr', category: 'finance', categoryLabel: '金融 / 商业', origin: 'domestic', route: 'direct', publishedAt: stamp, heat: 50, importance: 70, recency: 100, weight: 75, weightLabel: '值得看' }] : [],
    } });
  });
  await page.goto('http://127.0.0.1:5187/signals');
  await page.getByRole('button', { name: '选择新闻数据源' }).click();
  const source = page.getByRole('option').filter({ hasText: '36氪' });
  await expect(source).toContainText('暂不可用');
  const before = reads;
  recovered = true;
  await page.clock.fastForward(31_000);
  await expect(source).not.toContainText('暂不可用');
  await expect(page.locator('#signals-news-list')).toContainText('已恢复的财经新闻');
  await expect(page.locator('.signals-source-notice')).toHaveCount(0);
  expect(reads).toBeGreaterThan(before);
});
