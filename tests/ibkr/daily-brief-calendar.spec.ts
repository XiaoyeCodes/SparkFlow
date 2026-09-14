import { expect, test } from '@playwright/test';

test('daily brief keeps yesterday before 09:00, rejects it after 09:00, and accepts the next edition', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-15T00:59:55Z') });
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { detail: 'fixture unavailable' } }));
  let date = '2026-09-14';
  let calls = 0;
  await page.route('**/api/daily-brief', route => {
    calls++;
    return route.fulfill({ json: { snapshot: {
      version: 18, date, slot: 'morning', generatedAt: `${date}T01:00:00Z`, updatedAt: `${date}T01:00:00Z`, summaryMode: 'ai',
      summary: { headline: `${date}专属简报`, regime: '测试', tone: 'balanced', highlights: [], risks: [], watchlist: [], portfolioNotes: [] },
      markets: [], macro: [], news: [], sources: [], errors: [], portfolio: { connected: false, positions: [] },
    }, cache: { hit: true, generated: false } } });
  });
  await page.goto('http://127.0.0.1:5187/council');
  await expect(page.getByText('2026-09-14专属简报').first()).toBeVisible();
  const status = page.locator('.editorial-edition-status');
  await expect(status).toContainText('昨日简报');
  expect(await status.evaluate(el => Boolean(el.nextElementSibling?.classList.contains('editorial-chip-row')))).toBe(true);
  await page.clock.fastForward(6000);
  await expect(page.getByText('2026-09-14专属简报')).toHaveCount(0);
  await expect(page.locator('.editorial-error')).toContainText('暂不展示往日数据');
  await expect(page.getByText(/今日简报待更新/)).toBeVisible();
  const before = calls;
  date = '2026-09-15';
  await page.clock.fastForward(60_000);
  await expect(page.getByText('2026-09-15专属简报').first()).toBeVisible();
  expect(calls).toBeGreaterThan(before);
  await expect(page.getByText('2026-09-14专属简报')).toHaveCount(0);
});
