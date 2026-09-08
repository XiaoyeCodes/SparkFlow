import { test, expect } from '@playwright/test';
const report = { market: 'cn', date: '2026-09-08', generatedAt: '2026-09-08T07:12:00Z', provider: 'fixture', model: 'configured-model', indices: [], sources: [], gaps: [], markdown: '# 📊 A 股收盘总结\n\n## 📌 主要指数收盘\n\n| 指数 | 收盘点位 | 涨跌额 | 涨跌幅 |\n| :--- | ---: | ---: | ---: |\n| 上证指数 | 3,940.55 | +7.85 | +0.20% |\n\n## 🌊 市场概况\n\n指数分化，关注板块变化。\n\n## ⚠️ 风险提示\n\n不构成投资建议。' };
test('market reading switches reports, renders Markdown and never generates on selection', async ({ page }) => {
  let posts = 0;
  await page.route('**/api/market-close?*', async route => {
    const market = new URL(route.request().url()).searchParams.get('market');
    if (route.request().method() === 'POST') posts++;
    await route.fulfill({ json: { market, dueDate: '2026-09-08', nextRunAt: '2026-09-09T07:10:00Z', calendarSupported: true, attempts: 1, status: 'complete', report: { ...report, market, markdown: market === 'us' ? report.markdown.replace('A 股', '美股') : report.markdown } } });
  });
  await page.route('**/qa-market-close', route => route.fulfill({ contentType: 'text/html', body: '<html><body style="margin:0;background:#050a09"><div id="root"></div></body></html>' }));
  await page.goto('http://127.0.0.1:5187/qa-market-close');
  await page.evaluate(async () => {
    // @ts-expect-error Vite runtime preamble
    const refresh = await import('/@react-refresh'); refresh.default.injectIntoGlobalHook(window);
    Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type, __vite_plugin_react_preamble_installed__: true });
    // @ts-expect-error Browser fixture module
    await import('/tests/ibkr/fixtures/marketCloseHarness.tsx');
  });
  await expect(page.getByText('Day1 原有深度解读内容')).toBeVisible();
  await expect(page.getByText('查看原始简报')).toHaveCount(0);
  const selector = page.getByRole('combobox', { name: '简报类型' });
  await selector.selectOption('cn');
  await expect(page.getByRole('heading', { name: '📊 A 股收盘总结' })).toBeVisible();
  await expect(page.getByRole('table')).toContainText('3,940.55');
  await selector.selectOption('us');
  await expect(page.getByRole('heading', { name: '📊 美股收盘总结' })).toBeVisible();
  expect(posts).toBe(0);
  await page.getByRole('button', { name: '重新生成' }).click();
  await expect.poll(() => posts).toBe(1);
  for (const width of [1440, 808, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(selector).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `tmp/market-close-${width}.png`, fullPage: true });
  }
});
