import { expect, test, type Page } from '@playwright/test';

const labels = {
  globe: '全息地球',
  map: '平板地图',
  ai: '打开 AI 市场分析舱',
  digests: '打开金十财经早餐',
} as const;

async function prepareTerminal(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(/^https:\/\/fonts\./, route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: {} }));
  const edition = {
    id: 'jin10', revision: 'navigation-fixture', sourceDate: '2026-11-05',
    sourceUrl: 'https://example.com/breakfast',
  };
  await page.route('**/api/daily-digests', route => route.fulfill({ json: {
    timezone: 'Asia/Shanghai', items: [{ id: 'jin10', state: 'ready', edition }],
  } }));
  await page.route('**/api/daily-digests/jin10/article?*', route => route.fulfill({ json: {
    ...edition, data: { news: { article_html: '<h2>今日优选</h2><p>财经早餐阅读内容。</p>' } },
  } }));
  await page.goto('http://127.0.0.1:5187/terminal');
}

for (const viewport of [{ width: 1600, height: 1000 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
  test(`all four terminal views remain reachable at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await prepareTerminal(page);
    const controls = page.getByRole('group', { name: '终端视图切换' });
    await expect(controls.getByRole('button', { name: labels.globe, exact: true })).toHaveAttribute('aria-pressed', 'true');

    // Starting at globe, this sequence covers every directed transition between the four views.
    const sequence = ['map', 'ai', 'digests', 'globe', 'ai', 'map', 'digests', 'ai', 'globe', 'digests', 'map', 'globe'] as const;
    const captured = new Set<string>();
    for (const view of sequence) {
      await controls.getByRole('button', { name: labels[view], exact: true }).click();
      await expect(page.locator('.macro-ai-panel')).toHaveCount(view === 'ai' ? 1 : 0);
      await expect(page.locator('.terminal-digests')).toHaveCount(view === 'digests' ? 1 : 0);
      await expect(controls).toHaveCount(1);
      await expect(controls.getByRole('button')).toHaveCount(4);
      for (const label of Object.values(labels)) {
        await expect(controls.getByRole('button', { name: label, exact: true })).toBeVisible();
      }
      await expect(controls.locator('[aria-pressed="true"]')).toHaveCount(1);
      await expect(controls.getByRole('button', { name: labels[view], exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(controls.getByRole('button', { name: labels[view], exact: true })).toBeFocused();
      if (view === 'ai' || view === 'digests') {
        await expect(page.locator('.macro-error')).toHaveCount(0);
        await expect(page.locator('.macro-loading')).toHaveCount(0);
      }
      if (view === 'digests') {
        await expect(page.getByRole('article', { name: '财经早餐 · 2026-11-05' })).toBeVisible();
      }
      if (viewport.width === 1600 && (view === 'ai' || view === 'digests') && !captured.has(view)) {
        await page.locator('.macro-main').screenshot({ path: testInfo.outputPath(`terminal-${view}.png`) });
        captured.add(view);
      }
    }
    await expect(page.getByRole('button', { name: '关闭 AI 分析舱', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '关闭财经早餐，返回地球', exact: true })).toHaveCount(0);
  });
}

test('switching views preserves the AI draft and Escape returns focus to the view controls', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await prepareTerminal(page);
  const controls = page.getByRole('group', { name: '终端视图切换' });
  await controls.getByRole('button', { name: labels.ai, exact: true }).click();
  await page.getByRole('button', { name: '选择 AI 分析模式', exact: true }).click();
  await page.getByRole('tab', { name: '具体股票 公司名 / 代码（二选一）' }).click();
  const query = page.getByPlaceholder('输入公司或代码，例如：AAPL；团队深度研究：AAPL v2');
  await query.fill('MSFT');
  await controls.getByRole('button', { name: labels.digests, exact: true }).click();
  await expect(page.locator('.macro-ai-panel')).toHaveCount(0);
  await controls.getByRole('button', { name: labels.ai, exact: true }).click();
  await expect(query).toHaveValue('MSFT');
  await page.keyboard.press('Escape');
  await expect(page.locator('.macro-ai-panel')).toHaveCount(0);
  await expect(controls.getByRole('button', { name: labels.globe, exact: true })).toBeFocused();
  await controls.getByRole('button', { name: labels.digests, exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.terminal-digests')).toHaveCount(0);
  await expect(controls.getByRole('button', { name: labels.globe, exact: true })).toBeFocused();
});
