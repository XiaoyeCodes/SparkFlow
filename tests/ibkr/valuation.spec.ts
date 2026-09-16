import { test, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { computeValuationDashboard } from '../../server/ibkrValuationModel';
import type { ValuationDashboard, ValuationInputs, ValuationLookback, ValuationSeriesId } from '../../src/lib/ibkr/valuationTypes';

// This suite runs on the UI-only Vite host. Every API response is synthetic;
// it never loads broker credentials, account data, or market-data plugins.
const origin = 'http://127.0.0.1:5187';
const artifact = `${origin}/artifacts/market-valuation.html`;
const apiRoute = '**/api/ibkr-valuation?*';

function fixtureInputs(): ValuationInputs {
  const fetchedAt = '2026-09-08T12:00:00Z';
  const start = Date.parse('2015-09-08T00:00:00Z');
  const end = Date.parse('2026-09-08T00:00:00Z');
  const ids: ValuationSeriesId[] = ['vix', 'spx', 'ndx', 'pe', 'qqqPe', 'forwardYield', 'treasury10y', 'fearGreed'];
  const series = Object.fromEntries(ids.map(id => {
    const value = (day: number) => {
      const t = day / 365.2425;
      switch (id) {
        case 'spx': return 1900 * Math.exp(t * 0.09 + 0.12 * Math.sin(t * 1.8));
        case 'ndx': return 4200 * Math.exp(t * 0.12 + 0.18 * Math.sin(t * 2.1));
        case 'vix': return 21 + 5 * Math.sin(t * 3.2) + Math.cos(t * 0.4);
        case 'qqqPe': return 26 + t * 0.5 + Math.sin(t);
        case 'pe': return 19 + t * 0.45 + 2 * Math.sin(t * 1.3);
        case 'forwardYield': return 4.8 + 0.65 * Math.cos(t * 1.4);
        case 'treasury10y': return 2.5 + t * 0.12 + 0.9 * Math.sin(t * 1.1);
        case 'fearGreed': return 71;
      }
    };
    const points = [];
    // Every second UTC day intentionally includes weekends: these are mathematical
    // UI fixtures, not fabricated observations presented as actual market history.
    for (let time = start; time <= end; time += 2 * 86_400_000) {
      points.push({ date: new Date(time).toISOString().slice(0, 10), value: value((time - start) / 86_400_000) });
    }
    const current = value((end - start) / 86_400_000);
    points.push({ date: '2026-09-08', value: current });
    return [id, { points: id === 'fearGreed' ? [] : points, current, asOf: '2026-09-08T00:00:00Z', source: '合成测试数据（仅界面验证）', sourceUrl: 'https://example.com/synthetic-fixture', status: 'snapshot' as const, note: 'Deterministic offline UI fixture; not actual market data.' }];
  })) as ValuationInputs['series'];
  return { fetchedAt, series };
}

function fixture(years: ValuationLookback = 5): ValuationDashboard {
  return computeValuationDashboard(fixtureInputs(), years);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/fonts.googleapis.com/**', route => route.abort());
  await page.route('**/fonts.gstatic.com/**', route => route.abort());
  await page.route('**/api/ibkr-valuation/history', route => route.fulfill({ json: { snapshots: [] } }));
  await page.route('**/api/ibkr-valuation/snapshot', route => route.fulfill({ json: {
    windows: Object.fromEntries(([1, 3, 5, 10] as const).map(years => [years, fixture(years)])),
  } }));
});

for (const accountState of ['pending', 'failed'] as const) {
  test(`market dashboard remains accessible while the account request is ${accountState}`, async ({ page }) => {
    let finishAccount: (() => void) | undefined;
    const pending = new Promise<void>(resolve => { finishAccount = resolve; });
    await page.route('**/api/ibkr-workbench/state', async route => {
      if (accountState === 'pending') await pending;
      await route.fulfill({ status: 503, json: { error: 'Synthetic account service failure' } }).catch(() => {});
    });
    await page.route(apiRoute, route => route.fulfill({ status: 503, json: { error: 'Synthetic market source failure' } }));
    try {
      await page.goto(`${origin}/ibkr`);
      const nav = page.getByRole('navigation', { name: '账户工作台导航' });
      const labels = await nav.getByRole('button').allTextContents();
      expect(labels.indexOf('大盘估值')).toBeGreaterThan(labels.indexOf('AI 分析'));
      await nav.getByRole('button', { name: '大盘估值', exact: true }).click();
      await expect(nav.getByRole('button', { name: '大盘估值', exact: true })).toHaveAttribute('aria-current', 'page');
      const frame = page.frameLocator('iframe[title="大盘估值分位监控"]');
      await expect(frame.getByRole('heading', { name: '大盘估值分位监控', exact: true })).toBeVisible();
      await expect(frame.getByTestId('score-value')).toHaveText('—');
      await expect(frame.getByTestId('source-status')).toContainText(/失败|不可用|未连接/);
    } finally {
      finishAccount?.();
    }
  });
}

test('embedded valuation uses the outer SparkFlow page scrollbar', async ({ page }) => {
  await page.setViewportSize({ width: 451, height: 873 });
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ status: 503, json: { error: 'Synthetic account service failure' } }));
  await page.route(apiRoute, route => route.fulfill({ json: fixture() }));
  await page.goto(`${origin}/ibkr?tab=valuation`);
  const iframe = page.locator('iframe[title="大盘估值分位监控"]');
  const frame = page.frameLocator('iframe[title="大盘估值分位监控"]');
  await expect(frame.getByTestId('metric-vix')).toBeVisible();
  await expect.poll(() => iframe.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(1_200);
  const outer = await page.evaluate(() => ({ viewport: innerHeight, content: document.documentElement.scrollHeight }));
  const inner = await frame.locator('body').evaluate(() => ({ viewport: innerHeight, content: document.documentElement.scrollHeight, overflow: getComputedStyle(document.documentElement).overflowY }));
  expect(outer.content).toBeGreaterThan(outer.viewport);
  expect(Math.abs(inner.content - inner.viewport)).toBeLessThanOrEqual(1);
  expect(inner.overflow).toBe('hidden');
});

test('an unavailable first response never produces a fabricated score or chart', async ({ page }) => {
  await page.route(apiRoute, route => route.fulfill({ status: 503, json: { error: 'Synthetic market source failure' } }));
  await page.goto(artifact);
  await expect(page.getByTestId('score-value')).toHaveText('—');
  await expect(page.getByTestId('source-status')).toContainText(/失败|不可用|未连接/);
  await expect(page.getByTestId('chart').locator('path,polyline')).toHaveCount(0);
  await expect(page.locator('[role="meter"][aria-valuenow]')).toHaveCount(0);
  await page.locator('summary').filter({ hasText: '评分规则与数据溯源' }).click();
  await expect(page.getByRole('button', { name: '下载计算记录', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '刷新', exact: true })).toBeEnabled();
});

test('changing horizons refreshes the score, metrics and trend as one coherent snapshot', async ({ page }) => {
  const requested: number[] = [];
  await page.route(apiRoute, route => {
    const years = Number(new URL(route.request().url()).searchParams.get('years')) as ValuationLookback;
    requested.push(years);
    return route.fulfill({ json: fixture(years) });
  });
  await page.goto(artifact);
  for (const years of [5, 1, 3, 10] as const) {
    if (years !== 5) await page.getByRole('button', { name: `${years}年`, exact: true }).click();
    const expected = fixture(years);
    expect(expected.score.value).not.toBeNull();
    await expect(page.getByRole('button', { name: `${years}年`, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => Number(await page.getByTestId('score-value').innerText())).toBe(expected.score.value);
    await expect(page.locator('#chart-title')).toContainText(`${years} 年`);
    for (const metric of expected.metrics.filter(m => m.id !== 'forwardYield')) {
      await expect(page.getByTestId(`metric-${metric.id}`)).toBeVisible();
      const position = metric.id === 'vix' ? Math.max(0, Math.min(100, metric.current! / 40 * 100))
        : metric.id === 'erp' ? Math.max(0, Math.min(100, metric.current! / 6 * 100)) : metric.percentile;
      await expect(page.getByTestId(`metric-${metric.id}`).getByRole('meter')).toHaveAttribute('aria-valuenow', String(position));
      await expect(page.getByTestId(`metric-state-${metric.id}`)).not.toContainText('等待数据');
    }
    await expect(page.getByTestId('chart').locator('path')).toHaveCount(2);
  }
  expect(requested).toEqual([5, 1, 3, 10]);
});

test('metric cards explain their thresholds and expose the current state', async ({ page }) => {
  await page.route(apiRoute, route => route.fulfill({ json: fixture() }));
  await page.goto(artifact);
  await expect(page.locator('.metric-state')).toHaveCount(6);
  await expect(page.locator('.metric .threshold')).toHaveCount(12);
  await expect(page.getByTestId('metric-vix')).toContainText(/平静|适中|恐惧/);
  await expect(page.getByTestId('metric-spx')).toContainText(/相对低估|合理区间|相对高估/);
  await expect(page.getByTestId('metric-erp')).toContainText(/相对低估|合理区间|相对高估/);
  await expect(page.locator('.metric-scale-labels')).toHaveCount(6);
  const scaleSizing = await page.locator('.metric .scale').first().evaluate(element => ({
    bar: Number.parseFloat(getComputedStyle(element).height),
    tick: Number.parseFloat(getComputedStyle(element.querySelector('.threshold')!).height),
    marker: Number.parseFloat(getComputedStyle(element.querySelector('.marker')!).width),
    label: Number.parseFloat(getComputedStyle(element.nextElementSibling!).fontSize),
  }));
  expect(scaleSizing).toEqual({ bar: 8, tick: 20, marker: 13, label: 10.5 });
  await page.getByRole('button', { name: '指标使用说明', exact: true }).click();
  const guide = page.getByRole('dialog', { name: '大盘估值监控使用说明' });
  await expect(guide).toBeVisible();
  await expect(guide).toContainText('各指标怎样判断');
  await expect(guide).toContainText('为什么市盈率不用固定倍数');
  await expect(guide.getByRole('link', { name: /Cboe VIX/ })).toHaveAttribute('href', /cboe\.com/);
  await page.getByRole('button', { name: '关闭使用说明' }).click();
  await expect(guide).not.toBeVisible();
});

test('a missing required component leaves the total blank and names the uncovered weight', async ({ page }) => {
  const inputs = fixtureInputs();
  inputs.series.pe = { ...inputs.series.pe, current: null, points: [], status: 'missing', note: 'Synthetic missing TTM source' };
  const data = computeValuationDashboard(inputs, 5);
  expect(data.score.coverageWeight).toBe(65);
  await page.route(apiRoute, route => route.fulfill({ json: data }));
  await page.goto(artifact);
  await expect(page.getByTestId('score-value')).toHaveText('—');
  await expect(page.getByTestId('metric-pe')).toContainText(/缺失|未取得|不可用|无可用历史|待接入/);
  await expect(page.locator('#coverage')).toHaveText(/有效权重 65\.0 \/ 100/);
  await expect(page.getByTestId('metric-pe').locator('[role="meter"][aria-valuenow]')).toHaveCount(0);
});

test('a failed refresh labels retained values as stale instead of presenting a fresh score', async ({ page }) => {
  const data = fixture();
  let calls = 0;
  await page.route(apiRoute, route => ++calls === 1
    ? route.fulfill({ json: data })
    : route.fulfill({ status: 503, json: { error: 'Synthetic refresh outage' } }));
  await page.goto(artifact);
  await expect.poll(async () => Number(await page.getByTestId('score-value').innerText())).toBe(data.score.value);
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.getByTestId('source-status')).toContainText(/失败|过期|旧快照/);
  await expect(page.getByText(/保留.*快照|旧快照|上次.*快照/).first()).toBeVisible();
  await expect.poll(async () => Number(await page.getByTestId('score-value').innerText())).toBe(data.score.value);
});

test('calculation rules are keyboard accessible and exported inputs reproduce the displayed score', async ({ page }) => {
  const data = fixture();
  await page.route(apiRoute, route => route.fulfill({ json: data }));
  await page.goto(artifact);
  await expect.poll(async () => Number(await page.getByTestId('score-value').innerText())).toBe(data.score.value);
  const summary = page.locator('summary').filter({ hasText: '评分规则与数据溯源' });
  await summary.focus();
  await page.keyboard.press('Enter');
  const rules = summary.locator('..');
  await expect(rules).toHaveAttribute('open', '');
  await expect(rules).toContainText('35%');
  await expect(rules).toContainText('17.5%');
  await expect(rules).toContainText('7.5%');
  await expect(rules).toContainText(data.rules.version);
  await expect(rules).toContainText(/不重分配|不重新分配/);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载计算记录', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  const record = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(Object.keys(record.windows).sort()).toEqual(['1', '10', '3', '5']);
  const audit = record.windows[record.selectedYears].audit;
  expect(audit.rules.version).toBe(data.rules.version);
  expect(audit.inputs.series.spx.source).toBe('合成测试数据（仅界面验证）');
  const replay = computeValuationDashboard(audit.inputs, audit.lookbackYears);
  expect(replay.score.value).toBe(data.score.value);
  expect(replay.score.contributions).toEqual(data.score.contributions);
});

test('exported HTML preserves the computed snapshot and opens without a backend', async ({ page, context }) => {
  const data = fixture();
  await page.route(apiRoute, route => route.fulfill({ json: data }));
  await page.goto(`${artifact}?embed=1`);
  await expect.poll(async () => Number(await page.getByTestId('score-value').innerText())).toBe(data.score.value);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 HTML', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\.html$/);
  await mkdir('tmp/valuation-qa', { recursive: true });
  const savedPath = `${process.cwd()}/tmp/valuation-qa/valuation-offline-synthetic.html`;
  await download.saveAs(savedPath);
  const offline = await context.newPage();
  let apiCalls = 0;
  await offline.route('**/api/**', route => { apiCalls++; return route.abort(); });
  await offline.goto(pathToFileURL(savedPath).href);
  await expect.poll(async () => Number(await offline.getByTestId('score-value').innerText())).toBe(data.score.value);
  await expect(offline.getByText(/离线快照/).first()).toBeVisible();
  await expect(offline.locator('#chart-title')).toContainText('5 年');
  await offline.getByRole('button', { name: '10年', exact: true }).click();
  await expect(offline.locator('#chart-title')).toContainText('10 年');
  const tenYear = fixture(10);
  await expect.poll(async () => Number(await offline.getByTestId('score-value').innerText())).toBe(tenYear.score.value);
  expect(apiCalls).toBe(0);
  await offline.close();
});

test('a late archived snapshot cannot overwrite a newer explicit live refresh', async ({ page }) => {
  const live = fixture();
  const oldInputs = fixtureInputs();
  oldInputs.fetchedAt = '2026-09-07T12:00:00Z';
  for (const [id, series] of Object.entries(oldInputs.series)) {
    series.points = series.points.filter(point => point.date < '2026-09-08');
    series.asOf = '2026-09-07T00:00:00Z';
    series.current = id === 'fearGreed' ? 15 : series.points.at(-1)!.value;
  }
  const archived = Object.fromEntries(([1, 3, 5, 10] as const).map(years => [years, computeValuationDashboard(oldInputs, years)]));
  expect(archived[5].score.value).not.toBe(live.score.value);
  let resolveArchive: (() => void) | undefined;
  const archiveGate = new Promise<void>(resolve => { resolveArchive = resolve; });
  let archiveStarted = false;
  await page.route('**/api/ibkr-valuation/history', route => route.fulfill({ json: { snapshots: [{ id: 'synthetic-old', fetchedAt: oldInputs.fetchedAt }] } }));
  await page.route('**/api/ibkr-valuation/audit/synthetic-old', async route => {
    archiveStarted = true;
    await archiveGate;
    await route.fulfill({ json: { windows: archived } }).catch(() => {});
  });
  await page.route(apiRoute, route => route.fulfill({ json: live }));
  await page.goto(artifact);
  await expect.poll(async () => Number(await page.getByTestId('score-value').innerText())).toBe(live.score.value);
  await page.locator('summary').filter({ hasText: '评分规则与数据溯源' }).click();
  await expect(page.locator('#history option[value="synthetic-old"]')).toHaveCount(1);
  const archiveFinished = new Promise<void>(resolve => {
    const done = (request: { url: () => string }) => {
      if (!request.url().endsWith('/audit/synthetic-old')) return;
      page.off('requestfinished', done);
      page.off('requestfailed', done);
      resolve();
    };
    page.on('requestfinished', done);
    page.on('requestfailed', done);
  });
  await page.locator('#history').selectOption('synthetic-old');
  await expect.poll(() => archiveStarted).toBe(true);
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  resolveArchive?.();
  await archiveFinished;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect.poll(async () => Number(await page.getByTestId('score-value').innerText())).toBe(live.score.value);
  await expect(page.getByTestId('source-status')).not.toContainText('历史快照');
});

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 1000 }, { width: 808, height: 986 }, { width: 390, height: 844 }]) {
  test(`market valuation stays within the viewport at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route(apiRoute, route => route.fulfill({ json: fixture() }));
    await page.goto(artifact);
    await expect(page.getByTestId('metric-vix')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const id of ['metric-vix', 'metric-spx', 'metric-ndx', 'metric-pe', 'metric-qqqPe', 'metric-erp', 'chart']) {
      const bounds = await page.getByTestId(id).boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
    }
    await mkdir('tmp/valuation-qa', { recursive: true });
    await page.screenshot({ path: `tmp/valuation-qa/valuation-${viewport.width}.png`, fullPage: true });
  });
}


test('reload displays the browser cache without fetching again within one hour', async ({ page }) => {
  let calls = 0;
  await page.route(apiRoute, route => { calls++; return route.fulfill({ json: fixture() }); });
  await page.goto(artifact);
  await expect(page.getByTestId('metric-qqqPe')).toContainText('纳指100 市盈率（QQQ）');
  await expect.poll(() => calls).toBe(1);
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('sparkflow.market-valuation.v5')))).toBe(true);
  await page.reload();
  await expect(page.getByTestId('source-status')).toContainText('已加载缓存');
  await expect.poll(async () => Number(await page.getByTestId('score-value').innerText())).toBe(fixture().score.value);
  expect(calls).toBe(1);
  expect(await page.locator('.metric-heading h2').allTextContents()).toEqual(['VIX 恐慌指数','标普500 · 趋势偏离','纳指100 · 趋势偏离','股权风险溢价 (ERP)','标普500 市盈率（SPY）','纳指100 市盈率（QQQ）']);
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect.poll(() => calls).toBe(2);
});

test('hourly update keeps cached values visible while the market request is pending', async ({ page }) => {
  await page.clock.install();
  let calls = 0, release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(apiRoute, async route => { if (++calls > 1) await gate; await route.fulfill({ json: fixture() }).catch(() => {}); });
  try {
    await page.goto(artifact);
    await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('sparkflow.market-valuation.v5')))).toBe(true);
    await page.clock.fastForward(59 * 60 * 1000);
    expect(calls).toBe(1);
    await page.clock.fastForward(2 * 60 * 1000);
    await expect.poll(() => calls).toBe(2);
    await expect.poll(async () => Number(await page.getByTestId('score-value').innerText())).toBe(fixture().score.value);
  } finally { release?.(); }
});
