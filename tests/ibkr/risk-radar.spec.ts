import { expect, test } from '@playwright/test';

const prices = Array.from({ length: 520 }, (_, index) => ({
  time: new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10),
  close: 470 + index * .28 + Math.sin(index / 12) * 8,
}));

const snapshot = (current: number, source: string, sourceUrl: string, asOf = '2026-09-15') => ({
  current, source, sourceUrl, asOf, status: 'snapshot', note: '测试自动数据', eligible: true,
});

const valuation = {
  fetchedAt: '2026-09-15T13:10:00.000Z',
  treasury: snapshot(5.04, 'FRED DGS10', 'https://fred.stlouisfed.org/series/DGS10'),
  sentiment: snapshot(45, 'CNN · Fear & Greed', 'https://www.cnn.com/markets/fear-and-greed'),
  riskRadar: {
    marketCap: snapshot(62.8, 'Federal Reserve Z.1 / FRED', 'https://fred.stlouisfed.org/series/NCBEILQ027S'),
    gdp: snapshot(31.2, 'BEA / FRED', 'https://fred.stlouisfed.org/series/GDP'),
    cape: snapshot(39.5, 'Robert Shiller / Multpl', 'https://www.multpl.com/shiller-pe'),
    treasury2y: snapshot(4.65, '新浪财经 · 美国2年期国债', 'https://stock.finance.sina.com.cn/forex/globalbd/cn2yt.html'),
  },
  audit: { inputs: { series: {} } },
};

for (const viewport of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
  test(`risk radar follows the command-center layout at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route('**/api/equity-report-chart?**', route => route.fulfill({ json: {
      symbol: 'VOO', generatedAt: '2026-09-15T13:10:00.000Z', source: { label: '测试行情', url: 'https://example.com/voo' }, points: prices,
    } }));
    await page.route('**/api/ibkr-valuation/risk-radar**', route => route.fulfill({ json: valuation }));
    await page.goto('http://127.0.0.1:5187/risk-radar');

    const command = page.getByRole('region', { name: '风险指数与量化建议' });
    await expect(command).toBeVisible();
    await expect(command.getByRole('meter', { name: '市场崩盘风险指数' })).toBeVisible();
    await expect(command).toContainText('量化建议');
    await expect(command).toContainText('历史对比参考');
    await expect(page.getByRole('region', { name: '风险因子分解' }).locator('.risk-factor')).toHaveCount(5);
    await expect(page.getByText('跨时代风险大比拼')).toBeVisible();
    await expect(page.locator('.risk-stress-list > div')).toHaveCount(4);
    await expect(page.locator('.risk-readonly-input')).toHaveCount(5);
    await expect(page.locator('.risk-readonly-input').first()).toContainText('只读');
    await expect(page.locator('input[type="number"]')).toHaveCount(0);
    const weightInputs = page.locator('input[type="range"]');
    await expect(weightInputs).toHaveCount(5);
    expect(await weightInputs.evaluateAll(inputs => inputs.map(input => Number((input as HTMLInputElement).value)))).toEqual([15, 20, 25, 20, 20]);
    await expect.poll(async () => ((await page.locator('.risk-chart-value').getAttribute('d'))?.match(/L/g) || []).length).toBeGreaterThanOrEqual(250);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.screenshot({ path: `tmp/workbench-qa/risk-radar-command-${viewport.width}.png`, fullPage: true });
  });
}

test('risk radar reloads from its six-hour local snapshot without another API request', async ({ page }) => {
  let valuationCalls = 0;
  let priceCalls = 0;
  const valuationUrls: string[] = [];
  await page.route('**/api/equity-report-chart?**', route => {
    priceCalls++;
    return route.fulfill({ json: { symbol: 'VOO', generatedAt: '2026-09-15T13:10:00.000Z', source: { label: '测试行情', url: 'https://example.com/voo' }, points: prices } });
  });
  await page.route('**/api/ibkr-valuation/risk-radar**', route => {
    valuationCalls++;
    valuationUrls.push(route.request().url());
    return route.fulfill({ json: valuation });
  });
  await page.goto('http://127.0.0.1:5187/risk-radar');
  await expect(page.getByText('本地缓存已加载')).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('sparkflow.risk-radar.v3.VOO')))).toBe(true);
  expect(valuationCalls).toBe(1);
  expect(priceCalls).toBe(1);

  await page.reload();
  await expect(page.getByText('本地缓存已加载')).toBeVisible();
  expect(valuationCalls).toBe(1);
  expect(priceCalls).toBe(1);

  await page.getByRole('button', { name: '刷新数据' }).click();
  await expect.poll(() => valuationCalls).toBe(2);
  expect(priceCalls).toBe(2);
  expect(valuationUrls.every(url => !url.includes('fresh=1'))).toBe(true);
});

test('risk radar rejects a recent empty browser cache and replaces it with usable data', async ({ page }) => {
  let valuationCalls = 0;
  await page.addInitScript(cachedPrices => {
    localStorage.setItem('sparkflow.risk-radar.v3.VOO', JSON.stringify({
      version: 3,
      ticker: 'VOO',
      storedAt: new Date().toISOString(),
      prices: { symbol: 'VOO', generatedAt: new Date().toISOString(), source: { label: '旧缓存', url: 'https://example.com' }, points: cachedPrices },
      valuation: {
        fetchedAt: new Date().toISOString(),
        treasury: { current: null, eligible: false },
        sentiment: { current: null, eligible: false },
        riskRadar: Object.fromEntries(['marketCap', 'gdp', 'cape', 'treasury2y'].map(key => [key, { current: null, eligible: false }])),
      },
    }));
  }, prices);
  await page.route('**/api/equity-report-chart?**', route => route.fulfill({ json: {
    symbol: 'VOO', generatedAt: '2026-09-15T13:10:00.000Z', source: { label: '测试行情', url: 'https://example.com/voo' }, points: prices,
  } }));
  await page.route('**/api/ibkr-valuation/risk-radar**', route => {
    valuationCalls++;
    return route.fulfill({ json: { ...valuation, complete: true } });
  });

  await page.goto('http://127.0.0.1:5187/risk-radar');
  const meter = page.getByRole('meter', { name: '市场崩盘风险指数' });
  await expect(meter).toHaveAttribute('aria-valuenow', /\d+/);
  await expect(page.getByText('等待数据')).toHaveCount(0);
  expect(valuationCalls).toBe(1);
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('sparkflow.risk-radar.v3.VOO') || 'null');
    return saved?.valuation?.riskRadar?.marketCap?.current;
  })).toBe(62.8);
});
