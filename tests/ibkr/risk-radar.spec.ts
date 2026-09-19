import { expect, test, type Page } from '@playwright/test';

const prices = Array.from({ length: 520 }, (_, index) => ({
  time: new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10),
  close: 470 + index * .28 + Math.sin(index / 12) * 8,
}));
const qqqPrices = prices.map((point, index) => ({
  ...point,
  close: 610 + index * .22 + Math.sin(index / 2) * 14 - Math.max(0, index - 485) * 2.1,
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
  valuations: {
    VOO: { ...snapshot(24.4, 'World PE Ratio · SPY', 'https://worldperatio.com/index/sp-500/'), percentile: 50 },
    QQQ: { ...snapshot(31.8, 'World PE Ratio · QQQ', 'https://worldperatio.com/index/nasdaq-100/'), percentile: 72 },
  },
  audit: { inputs: { series: {} } },
};

const historyFor = (ticker: 'VOO' | 'QQQ') => ({
  ticker,
  proxySymbol: ticker === 'VOO' ? 'SPY' : 'QQQ',
  proxyLabel: ticker === 'VOO' ? 'SPY（标普500历史代理）' : 'QQQ',
  generatedAt: '2026-09-17T01:00:00.000Z',
  source: { label: 'Yahoo Finance · 历史日线', url: `https://finance.yahoo.com/quote/${ticker === 'VOO' ? 'SPY' : 'QQQ'}` },
  valuationSource: { label: ticker === 'VOO' ? 'S&P 500 历史市盈率' : 'Nasdaq-100 历史市盈率', url: 'https://example.com/valuation' },
  events: [
    { id: 'dotcom', label: '2000 互联网泡沫', date: '2000-03-24', marketCapRatio: 145, cape: 44.2, tenYear: 6.2, twoYear: 6.6, fear: 90, price: ticker === 'VOO' ? 153 : 115, sma: ticker === 'VOO' ? 139 : 65, pe: ticker === 'VOO' ? 28.31 : 175, volatility: ticker === 'VOO' ? 21 : 48, drawdown: 0 },
    { id: 'gfc', label: '2008 次贷危机前', date: ticker === 'VOO' ? '2007-10-09' : '2007-10-31', marketCapRatio: 110, cape: 27.5, tenYear: 4.6, twoYear: 4.2, fear: 75, price: ticker === 'VOO' ? 156 : 55, sma: ticker === 'VOO' ? 148 : 48, pe: ticker === 'VOO' ? 20.68 : 28.9, volatility: ticker === 'VOO' ? 17 : 22, drawdown: 0 },
    { id: 'rates', label: '2022 加息熊市前', date: ticker === 'VOO' ? '2022-01-03' : '2021-11-19', marketCapRatio: 195, cape: 38.3, tenYear: 1.6, twoYear: .8, fear: 75, price: ticker === 'VOO' ? 440 : 404, sma: ticker === 'VOO' ? 410 : 350, pe: ticker === 'VOO' ? 23.11 : 32.07, volatility: ticker === 'VOO' ? 13 : 19, drawdown: 0 },
  ],
});

const timelinePoints = (ticker: 'VOO' | 'QQQ', startYear: number, count: number) => Array.from({ length: count }, (_, index) => {
  const date = new Date(Date.UTC(startYear + Math.floor(index / 12), index % 12, 28)).toISOString().slice(0, 10);
  const wave = Math.sin(index / 7 + (ticker === 'QQQ' ? .8 : 0));
  return {
    date,
    values: {
      marketCapRatio: 120 + wave * 65,
      cape: 24 + wave * 14,
      tenYear: 4.2 - wave,
      twoYear: 3.8 + wave * .3,
      fear: 52 + wave * 34,
      price: 100 + index * 1.8 + wave * 12,
      sma: 96 + index * 1.72,
      pe: (ticker === 'QQQ' ? 27 : 21) + wave * 9,
      volatility: 17 + Math.abs(wave) * 19,
      drawdown: -Math.abs(wave) * 25,
      creditSpread: 2.2 + Math.abs(wave) * 4.8,
      nfci: -.5 + Math.abs(wave) * 1.8,
      vix: 15 + Math.abs(wave) * 31,
      debtService: 10.5 + Math.max(0, wave) * 3,
      priorCurveMin: -1.1,
    },
    sentimentMode: 'price-proxy',
    valuationMode: ticker === 'QQQ' ? 'scaled-forward' : 'trailing',
  };
});

const timeline = {
  generatedAt: '2026-09-17T03:00:00.000Z',
  period: { requestedYears: 30, start: '1996-09-01', end: '2026-08-31' },
  cache: {
    storedAt: '2026-09-17T03:00:00.000Z', checkedAt: '2026-09-17T03:00:00.000Z', nextCheckAt: '2026-09-17T04:00:00.000Z',
    refreshing: false, stale: false, error: null,
  },
  series: [
    { ticker: 'VOO', proxyLabel: 'VOO · SPY 历史代理', firstDate: '1996-09-28', lastDate: '2026-08-28', points: timelinePoints('VOO', 1996, 360) },
    { ticker: 'QQQ', proxyLabel: 'QQQ', firstDate: '2001-04-28', lastDate: '2026-08-28', points: timelinePoints('QQQ', 2001, 304) },
  ],
  sources: [{ label: 'Yahoo Finance · SPY / QQQ 历史日线', url: 'https://finance.yahoo.com/' }],
  methodology: ['每月取最后一个交易日，沿用页面当前八项评分函数与可调权重。', 'VOO 使用 SPY 历史代理；早期情绪使用价格代理。'],
};

async function mockRiskHistory(page: Page) {
  await page.route('**/api/risk-radar/history?**', route => {
    const ticker = new URL(route.request().url()).searchParams.get('ticker') === 'QQQ' ? 'QQQ' : 'VOO';
    return route.fulfill({ json: historyFor(ticker) });
  });
  await page.route('**/api/risk-radar/timeline**', route => route.fulfill({ json: timeline }));
}

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1024, height: 1366 }, { width: 390, height: 844 }]) {
  test(`risk radar follows the command-center layout at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route('**/api/equity-report-chart?**', route => route.fulfill({ json: {
      symbol: 'VOO', generatedAt: '2026-09-15T13:10:00.000Z', source: { label: '测试行情', url: 'https://example.com/voo' }, points: prices,
    } }));
    await page.route('**/api/ibkr-valuation/risk-radar**', route => route.fulfill({ json: valuation }));
    await mockRiskHistory(page);
    await page.goto('http://127.0.0.1:5187/risk-radar');

    const command = page.getByRole('region', { name: '风险指数与量化建议' });
    await expect(command).toBeVisible();
    await expect(command.getByRole('meter', { name: '市场崩盘风险指数' })).toBeVisible();
    await expect(command).toContainText('量化建议');
    await expect(command).toContainText('VOO 历史双层风险');
    await expect(command).toContainText('SPY 标普500历史代理');
    await expect(command).toContainText('潜在脆弱性');
    await expect(command).toContainText('即时市场压力');
    const layerCards = command.locator('.risk-layer-summary article');
    for (let index = 0; index < 2; index++) {
      const score = Number(await layerCards.nth(index).locator('strong').textContent());
      const expectedTone = score >= 70 ? 'is-high' : score >= 40 ? 'is-elevated' : 'is-low';
      await expect(layerCards.nth(index)).toHaveClass(new RegExp(expectedTone));
    }
    await expect(page.getByRole('region', { name: '风险因子分解' }).locator('.risk-factor')).toHaveCount(15);
    await expect(page.getByText('跨时代风险大比拼')).toBeVisible();
    await expect(page.locator('.risk-stress-thresholds')).toContainText('警戒线 40');
    await expect(page.locator('.risk-stress-thresholds')).toContainText('高风险线 70');
    await expect(page.locator('.risk-stress-list > div')).toHaveCount(4);
    const timelineChart = page.getByRole('region', { name: '近30年风险得分走势' });
    await expect(timelineChart).toBeVisible();
    await expect(timelineChart).toContainText('0–39');
    await expect(timelineChart).toContainText('40–69');
    await expect(timelineChart).toContainText('70–100');
    await expect(timelineChart.locator('.risk-timeline-line')).toHaveCount(2);
    await expect(timelineChart.locator('[data-series="VOO"]')).toHaveAttribute('d', /L/);
    await expect(timelineChart.locator('[data-series="QQQ"]')).toHaveAttribute('d', /L/);
    await expect(timelineChart.locator('.risk-timeline-legend .voo small')).toHaveText(/^\d{4}\/\d{2}$/);
    const timelineSvg = timelineChart.locator('.risk-timeline-frame svg');
    await timelineSvg.scrollIntoViewIfNeeded();
    for (const fraction of [.05, .5, .95]) {
      const pointer = await timelineSvg.evaluate((svg, position) => {
        const matrix = svg.getScreenCTM();
        if (!matrix) throw new Error('Timeline SVG is not rendered');
        const point = new DOMPoint(94 + position * 1072, 200).matrixTransform(matrix);
        return { x: point.x, y: point.y };
      }, fraction);
      await page.mouse.move(pointer.x, pointer.y);
      const cursorX = await timelineChart.locator('.risk-timeline-cursor').evaluate(line => {
        const matrix = line.getScreenCTM();
        if (!matrix) throw new Error('Timeline cursor is not rendered');
        return new DOMPoint(Number(line.getAttribute('x1')), 200).matrixTransform(matrix).x;
      });
      expect(Math.abs(cursorX - pointer.x)).toBeLessThan(1.5);
    }
    const indexSelector = timelineChart.getByRole('group', { name: '选择显示的指数' });
    const vooToggle = indexSelector.getByRole('button', { name: /VOO/ });
    const qqqToggle = indexSelector.getByRole('button', { name: /QQQ/ });
    await expect(vooToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(qqqToggle).toHaveAttribute('aria-pressed', 'true');
    const vooBox = await vooToggle.boundingBox();
    const vooDateBox = await vooToggle.locator('small').boundingBox();
    expect(vooBox).not.toBeNull();
    expect(vooDateBox).not.toBeNull();
    expect(vooDateBox!.y).toBeGreaterThan(vooBox!.y + 8);
    await qqqToggle.click();
    await expect(qqqToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(timelineChart.locator('[data-series="QQQ"]')).toHaveCount(0);
    await expect(timelineChart.locator('[data-series="VOO"]')).toHaveCount(1);
    await expect(vooToggle).toBeDisabled();
    await qqqToggle.click();
    await expect(timelineChart.locator('.risk-timeline-line')).toHaveCount(2);
    await expect(timelineChart).toContainText('历史快照已缓存');
    await timelineChart.getByRole('button', { name: '即时压力' }).click();
    await expect(timelineChart.getByRole('button', { name: '即时压力' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: /使用说明/ }).click();
    const guide = page.getByRole('dialog', { name: '双层风险雷达使用说明' });
    await expect(guide).toBeVisible();
    await expect(guide).toContainText('综合状态 = max');
    await expect(guide.locator('.risk-guide-weight-grid article')).toHaveCount(15);
    await expect(guide).toContainText('两层因子与当前权重');
    await page.screenshot({ path: `tmp/workbench-qa/risk-radar-guide-${viewport.width}.png`, fullPage: false });
    await guide.getByRole('button', { name: '关闭使用说明' }).click();
    await expect(guide).toBeHidden();
    await expect(page.locator('.risk-readonly-input')).toHaveCount(10);
    await expect(page.locator('.risk-readonly-input').first()).toContainText('只读');
    expect(await page.locator('.risk-readonly-input > small').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(11);
    expect(await page.locator('.risk-readonly-input > a').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(11);
    expect(await page.locator('.risk-weight-grid label > span').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
    expect(await page.locator('.risk-readonly-input header span').first().evaluate(node => getComputedStyle(node).fontFamily.toLowerCase())).toContain('system-ui');
    expect(await page.locator('.risk-weight-grid label > span').first().evaluate(node => getComputedStyle(node).fontFamily.toLowerCase())).toContain('system-ui');
    await expect(page.locator('input[type="number"]')).toHaveCount(0);
    const weightInputs = page.locator('input[type="range"]');
    await expect(weightInputs).toHaveCount(15);
    expect(await weightInputs.evaluateAll(inputs => inputs.map(input => Number((input as HTMLInputElement).value)))).toEqual([10, 15, 10, 15, 15, 20, 15, 20, 20, 15, 10, 15, 10, 5, 5]);
    await expect.poll(async () => ((await page.locator('.risk-chart-value').getAttribute('d'))?.match(/L/g) || []).length).toBeGreaterThanOrEqual(250);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.screenshot({ path: `tmp/workbench-qa/risk-radar-command-${viewport.width}.png`, fullPage: true });
  });
}

test('manual refresh updates the current snapshot and historical timeline together', async ({ page }) => {
  let valuationFreshCalls = 0;
  let timelineFreshCalls = 0;
  await page.route('**/api/equity-report-chart?**', route => route.fulfill({ json: {
    symbol: 'VOO', generatedAt: '2026-09-16T20:00:00.000Z', source: { label: '测试行情', url: 'https://example.com/voo' }, points: prices,
  } }));
  await page.route('**/api/ibkr-valuation/risk-radar**', route => {
    if (new URL(route.request().url()).searchParams.get('fresh') === '1') valuationFreshCalls += 1;
    return route.fulfill({ json: valuation });
  });
  await page.route('**/api/risk-radar/history?**', route => route.fulfill({ json: historyFor('VOO') }));
  await page.route('**/api/risk-radar/timeline**', route => {
    if (new URL(route.request().url()).searchParams.get('refresh') === '1') timelineFreshCalls += 1;
    return route.fulfill({ json: timeline });
  });

  await page.goto('http://127.0.0.1:5187/risk-radar');
  await expect(page.getByRole('meter', { name: '市场崩盘风险指数' })).toBeVisible();
  await expect(page.getByRole('region', { name: '近30年风险得分走势' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('sparkflow.risk-radar.timeline.v1')))).toBe(true);

  await page.getByRole('button', { name: '刷新数据' }).click();
  await expect.poll(() => valuationFreshCalls).toBe(1);
  await expect.poll(() => timelineFreshCalls).toBe(1);
  await expect(page.getByRole('button', { name: '刷新数据' })).toBeEnabled();
});

test('risk radar reloads from its one-hour local snapshot without another API request', async ({ page }) => {
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
  await mockRiskHistory(page);
  await page.goto('http://127.0.0.1:5187/risk-radar');
  await expect(page.getByText('已缓存 · 每小时检查')).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('sparkflow.risk-radar.v5.VOO')))).toBe(true);
  expect(valuationCalls).toBe(1);
  expect(priceCalls).toBe(1);

  await page.reload();
  await expect(page.getByText('已缓存 · 每小时检查')).toBeVisible();
  expect(valuationCalls).toBe(1);
  expect(priceCalls).toBe(1);

  await page.getByRole('button', { name: '刷新数据' }).click();
  await expect.poll(() => valuationCalls).toBe(2);
  expect(priceCalls).toBe(2);
  expect(valuationUrls.map(url => url.includes('fresh=1'))).toEqual([false, true]);
});

test('VOO and QQQ use their own valuation, volatility, drawdown and continuous trend scores', async ({ page }) => {
  await page.route('**/api/equity-report-chart?**', route => {
    const isQqq = new URL(route.request().url()).searchParams.get('symbol') === 'QQQ';
    return route.fulfill({ json: {
      symbol: isQqq ? 'QQQ' : 'VOO', generatedAt: '2026-09-16T13:10:00.000Z',
      source: { label: '测试行情', url: `https://example.com/${isQqq ? 'qqq' : 'voo'}` },
      points: isQqq ? qqqPrices : prices,
    } });
  });
  await page.route('**/api/ibkr-valuation/risk-radar**', route => route.fulfill({ json: valuation }));
  await mockRiskHistory(page);
  await page.goto('http://127.0.0.1:5187/risk-radar');

  const meter = page.getByRole('meter', { name: '市场崩盘风险指数' });
  const vooScore = Number(await meter.getAttribute('aria-valuenow'));
  await expect(page.getByText('SPY 市盈率', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('60 日实际波动', { exact: true })).toBeVisible();
  await expect(page.getByText('近一年当前回撤', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'QQQ', exact: true }).click();
  await expect(page.getByText('QQQ 市盈率', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('QQQ 历史双层风险', { exact: true })).toBeVisible();
  await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow'))).not.toBe(vooScore);
});

test('risk radar refreshes a browser snapshot older than one hour', async ({ page }) => {
  let valuationCalls = 0;
  let priceCalls = 0;
  await page.addInitScript(({ cachedPrices, cachedValuation, cachedHistory }) => {
    localStorage.setItem('sparkflow.risk-radar.v5.VOO', JSON.stringify({
      version: 5,
      ticker: 'VOO',
      storedAt: new Date(Date.now() - 61 * 60_000).toISOString(),
      prices: { symbol: 'VOO', generatedAt: '2026-09-15T13:10:00.000Z', source: { label: '旧缓存', url: 'https://example.com' }, points: cachedPrices },
      valuation: cachedValuation,
      history: cachedHistory,
    }));
  }, { cachedPrices: prices, cachedValuation: valuation, cachedHistory: historyFor('VOO') });
  await page.route('**/api/equity-report-chart?**', route => {
    priceCalls++;
    return route.fulfill({ json: { symbol: 'VOO', generatedAt: '2026-09-16T13:10:00.000Z', source: { label: '测试行情', url: 'https://example.com/voo' }, points: prices } });
  });
  await page.route('**/api/ibkr-valuation/risk-radar**', route => {
    valuationCalls++;
    return route.fulfill({ json: valuation });
  });
  await mockRiskHistory(page);

  await page.goto('http://127.0.0.1:5187/risk-radar');
  await expect.poll(() => valuationCalls).toBe(1);
  expect(priceCalls).toBe(1);
  await expect(page.getByText('已缓存 · 每小时检查')).toBeVisible();
  await expect(page.getByText(/最新交易日 2026\/09\/16/)).toBeVisible();
});

test('risk radar rejects a recent empty browser cache and replaces it with usable data', async ({ page }) => {
  let valuationCalls = 0;
  await page.addInitScript(cachedPrices => {
    localStorage.setItem('sparkflow.risk-radar.v5.VOO', JSON.stringify({
      version: 5,
      ticker: 'VOO',
      storedAt: new Date().toISOString(),
      prices: { symbol: 'VOO', generatedAt: new Date().toISOString(), source: { label: '旧缓存', url: 'https://example.com' }, points: cachedPrices },
      valuation: {
        fetchedAt: new Date().toISOString(),
        treasury: { current: null, eligible: false },
        sentiment: { current: null, eligible: false },
        riskRadar: Object.fromEntries(['marketCap', 'gdp', 'cape', 'treasury2y'].map(key => [key, { current: null, eligible: false }])),
      },
      history: null,
    }));
  }, prices);
  await page.route('**/api/equity-report-chart?**', route => route.fulfill({ json: {
    symbol: 'VOO', generatedAt: '2026-09-15T13:10:00.000Z', source: { label: '测试行情', url: 'https://example.com/voo' }, points: prices,
  } }));
  await page.route('**/api/ibkr-valuation/risk-radar**', route => {
    valuationCalls++;
    return route.fulfill({ json: { ...valuation, complete: true } });
  });
  await mockRiskHistory(page);

  await page.goto('http://127.0.0.1:5187/risk-radar');
  const meter = page.getByRole('meter', { name: '市场崩盘风险指数' });
  await expect(meter).toHaveAttribute('aria-valuenow', /\d+/);
  await expect(page.getByText('等待数据')).toHaveCount(0);
  expect(valuationCalls).toBe(1);
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('sparkflow.risk-radar.v5.VOO') || 'null');
    return saved?.valuation?.riskRadar?.marketCap?.current;
  })).toBe(62.8);
});
