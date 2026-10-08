import { expect, test } from '@playwright/test';

test('hourly briefing keeps the previous snapshot during refresh and synchronizes without reload', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-08T02:59:55Z') });
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { detail: 'fixture unavailable' } }));
  let edition = 1;
  let calls = 0;
  await page.route('**/api/daily-brief', route => {
    calls++;
    const generatedAt = edition === 1 ? '2026-10-08T02:05:00Z' : '2026-10-08T03:00:00Z';
    return route.fulfill({ json: { snapshot: {
      version: 18, date: '2026-10-08', slot: 'morning', generatedAt, updatedAt: generatedAt, summaryMode: 'rules',
      summary: { headline: `第${edition}小时简报`, regime: '测试', tone: 'balanced', highlights: [], risks: [], watchlist: [], portfolioNotes: [] },
      markets: [], macro: [], news: [], sources: [], errors: [], portfolio: { connected: false, positions: [] },
    }, cache: { hit: true, generated: false }, _pageCache: {
      state: edition === 1 ? 'stale' : 'fresh', storedAt: generatedAt, expiresAt: '2026-10-09T02:05:00Z',
    } } });
  });
  await page.goto('http://127.0.0.1:5187/council');
  await expect(page.getByText('第1小时简报').first()).toBeVisible();
  await expect(page.locator('.editorial-edition-status')).toContainText('每小时后台更新');
  const before = calls;
  await page.clock.fastForward(6000);
  await expect(page.getByText('第1小时简报').first()).toBeVisible();
  expect(calls).toBeGreaterThan(before);
  await expect(page.locator('.editorial-edition-status')).toContainText('上次成功缓存');
  edition = 2;
  await page.clock.fastForward(60_000);
  await expect(page.getByText('第2小时简报').first()).toBeVisible();
  await expect(page.getByText('第1小时简报')).toHaveCount(0);
  await expect(page.locator('.editorial-error')).toHaveCount(0);
});
