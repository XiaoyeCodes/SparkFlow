import { expect, test } from '@playwright/test';

test('NewsNow opens in a new window without loading a local board or prefetching the remote site', async ({ page, context }) => {
  const retiredRequests: string[] = [], remoteRequests: string[] = [], pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await context.route('https://newsnow.busiyi.world/**', route => {
    remoteRequests.push(route.request().url());
    return route.fulfill({ contentType: 'text/html', body: '<title>NewsNow navigation fixture</title>' });
  });
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/dailyhot/')) retiredRequests.push(url.pathname);
    return url.pathname === '/api/news-feed'
      ? route.fulfill({ json: { generatedAt: new Date().toISOString(), sources: [], items: [] } })
      : route.fulfill({ status: 503, json: {} });
  });
  await page.route(/^https:\/\/fonts\./, route => route.abort());
  await page.goto('http://127.0.0.1:5187/signals?category=tech&sort=time&lang=all');
  const entry = page.getByRole('link', { name: '打开 NewsNow 今日热榜（新窗口）' });
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAttribute('href', 'https://newsnow.busiyi.world/');
  await expect(entry).toHaveAttribute('target', '_blank');
  await expect(entry).toHaveAttribute('rel', /noopener.*noreferrer/);
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(remoteRequests).toEqual([]);
  const popupPromise = page.waitForEvent('popup');
  await entry.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL('https://newsnow.busiyi.world/');
  await expect(page).toHaveURL(/\/signals\?category=tech&sort=time&lang=all$/);
  expect(retiredRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('old hot-board bookmarks return to the news filters without contacting the removed service', async ({ page }) => {
  const retiredRequests: string[] = [];
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/dailyhot/')) retiredRequests.push(url.pathname);
    return url.pathname === '/api/news-feed'
      ? route.fulfill({ json: { generatedAt: new Date().toISOString(), sources: [], items: [] } })
      : route.fulfill({ status: 503, json: {} });
  });
  await page.route(/^https:\/\/fonts\./, route => route.abort());
  await page.goto('http://127.0.0.1:5187/signals/daily-hot?source=all&sort=heat&lang=all');
  await expect(page).toHaveURL('http://127.0.0.1:5187/signals?source=all&sort=heat&lang=all');
  await expect(page.getByRole('link', { name: '打开 NewsNow 今日热榜（新窗口）' })).toBeVisible();
  expect(retiredRequests).toEqual([]);
});
