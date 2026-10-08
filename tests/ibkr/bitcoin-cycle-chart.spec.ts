import { expect, test } from '@playwright/test';

test('bitcoin cycle draws on initial data arrival without toggling controls and restores after navigation', async ({ page }) => {
  const generatedAt = new Date().toISOString();
  const intelligence = { generatedAt, dataMode: 'live', confidence: 100, confidenceLabel: '测试', warning: '', errors: [],
    summary: { score: 50, scoreLabel: '测试', stance: '测试', riskLevel: '测试', headline: '测试', disclaimer: '测试' },
    indices: [{ id: 'btc', code: 'BTC', name: '比特币', region: 'CRYPTO', market: 'crypto', price: 83000,
      change: 1, changePercent: 0.1, sourceUrl: 'https://example.com', updatedAt: generatedAt, validation: { status: 'verified', source: '测试' } }],
    breadth: { advancers: 1, decliners: 0, flat: 0, advanceRatio: 1 },
    sectors: { total: 1, sampleSize: 1, positiveRatio: 1, flowBalance: 0, leaders: [], laggards: [] },
    reports: [], news: [], scores: [], sources: [] };
  const history = { generatedAt, source: { label: '周期测试来源', url: 'https://example.com' }, methodology: '测试历史序列',
    points: [{ time: '2012-11-28', value: 12 }, { time: '2016-07-09', value: 650 },
      { time: '2020-05-11', value: 8500 }, { time: '2024-04-20', value: 64000 }, { time: '2026-10-07', value: 83000 }],
    halvings: [{ date: '2012-11-28', label: '第一次减半', blockReward: '50 → 25 BTC' },
      { date: '2016-07-09', label: '第二次减半', blockReward: '25 → 12.5 BTC' },
      { date: '2020-05-11', label: '第三次减半', blockReward: '12.5 → 6.25 BTC' },
      { date: '2024-04-20', label: '第四次减半', blockReward: '6.25 → 3.125 BTC' }],
    projection: { horizon: '2035', model: '测试情景', points: [{ time: '2026-10-07', value: 83000 }, { time: '2035-01-01', value: 150000 }],
      futureHalvings: [], horizonScenario: { low: 50000, base: 150000, high: 200000 }, assumptions: [], researchSources: [] } };
  let release!: () => void, historyRequests = 0;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.route(/^https:\/\/fonts\./, route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: {} }));
  await page.route('**/api/public-market-intelligence*', route => route.fulfill({ json: intelligence }));
  await page.route('**/api/bitcoin-cycle-history*', async route => { historyRequests++; await waiting; await route.fulfill({ json: history }); });
  const chart = page.getByTestId('bitcoin-cycle-chart');
  const assertRendered = async () => {
    await expect(chart.locator('canvas').first()).toBeAttached();
    await expect.poll(async () => chart.locator('canvas').evaluateAll(canvases => canvases.some(element => {
      const canvas = element as HTMLCanvasElement, context = canvas.getContext('2d');
      if (!context || canvas.width < 100 || canvas.height < 100) return false;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index] > 100 && pixels[index + 1] > 70 && pixels[index + 2] < pixels[index] * 0.7) return true;
      }
      return false;
    }))).toBe(true);
  };
  try {
    await page.goto('http://127.0.0.1:5187/market?market=crypto');
    await expect.poll(() => historyRequests).toBe(1);
    await expect(chart.locator('.animate-spin')).toBeAttached();
    release();
    await expect(chart.getByText('数据：周期测试来源', { exact: false })).toBeAttached();
    await assertRendered();
    await chart.scrollIntoViewIfNeeded();
    await chart.getByRole('button', { name: '对数', exact: true }).click();
    await assertRendered();
    await chart.getByRole('switch', { name: '2035 周期推演' }).click();
    await assertRendered();
    await page.locator('.sf-pill-nav-desktop a[href="/signals"]').click({ force: true });
    await expect(chart).toHaveCount(0);
    await page.locator('.sf-pill-nav-desktop a[href="/market"]').click();
    await page.getByRole('button', { name: '加密', exact: true }).click();
    await assertRendered();
    expect(historyRequests).toBe(1);
  } finally { release(); }
});
