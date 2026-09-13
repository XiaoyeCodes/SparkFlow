import { expect, test } from '@playwright/test';

test('China regional map pans from a province without triggering drill-down', async ({ page }) => {
  let regionRequests = 0;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/api/china-macro-dashboard?*', route => route.fulfill({ json: {} }));
  await page.route('**/api/china-region-boundary?*', route => {
    regionRequests += 1;
    return route.fulfill({ json: { type: 'FeatureCollection', features: [] } });
  });
  await page.goto('http://127.0.0.1:5187/market#china-macro');

  const map = page.locator('.china-map-canvas');
  const provinces = page.locator('.china-province');
  await expect(map.getByRole('img', { name: '中国省级经济地图' })).toBeVisible();
  await expect(provinces.first()).toBeVisible();
  await expect(map).toHaveAttribute('data-map-scale', '1.000');
  await expect(map).toHaveClass(/is-draggable/);
  await expect(map.locator('.china-context-national')).toHaveAttribute('d', /^M/);
  await expect(map.locator('.china-context-countries, .china-context-labels, .china-map-attribution')).toHaveCount(0);
  await expect(map.locator('.china-map-context')).toHaveCSS('pointer-events', 'none');
  await map.screenshot({ path: 'output/china-map-only.png' });
  await map.getByRole('img', { name: '中国省级经济地图' }).hover();
  await page.mouse.wheel(0, -80);
  await expect(map).toHaveAttribute('data-map-scale', '1.180');
  await page.mouse.wheel(0, 80);
  await expect(map).toHaveAttribute('data-map-scale', '1.000');

  const province = page.locator('.china-province[aria-label="四川省"]');
  const box = await province.boundingBox();
  expect(box).not.toBeNull();
  await province.click();
  await expect(page.locator('.china-province-inspector')).toBeVisible();
  await expect.poll(() => regionRequests).toBe(1);
  await page.locator('.china-inspector-close').click();
  await expect(page.locator('.china-province-inspector')).toHaveCount(0);
  const initialX = Number(await map.getAttribute('data-map-x'));
  const performanceSession = await page.context().newCDPSession(page);
  await performanceSession.send('Performance.enable');
  const before = await performanceSession.send('Performance.getMetrics');

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await expect(map).toHaveAttribute('data-dragging', 'false');
  await page.mouse.move(box!.x + box!.width / 2 + 70, box!.y + box!.height / 2 + 35, { steps: 6 });
  await expect(map).toHaveAttribute('data-dragging', 'true');
  await page.mouse.up();

  await expect(map).toHaveAttribute('data-dragging', 'false');
  await expect.poll(async () => Number(await map.getAttribute('data-map-x'))).not.toBe(initialX);
  expect(regionRequests).toBe(1);
  await expect(page.locator('.china-province-inspector')).toHaveCount(0);

  await page.getByTitle('复位地图').click();
  for (let index = 0; index < 9; index += 1) await page.getByTitle('放大地图').click();
  await expect.poll(async () => Number(await map.getAttribute('data-map-scale'))).toBeGreaterThan(7);
  const mapBox = await map.boundingBox();
  expect(mapBox).not.toBeNull();
  await page.mouse.move(mapBox!.x + mapBox!.width * 0.55, mapBox!.y + mapBox!.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(mapBox!.x + mapBox!.width * 0.1, mapBox!.y + mapBox!.height * 0.15, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Number(await map.getAttribute('data-map-x'))).toBeLessThan(-3100);
  await expect.poll(async () => Number(await map.getAttribute('data-map-y'))).toBeLessThan(-2100);
  expect(regionRequests).toBe(1);

  for (let index = 0; index < 8; index += 1) {
    await page.mouse.move(mapBox!.x + mapBox!.width * 0.1, mapBox!.y + mapBox!.height * 0.15);
    await page.mouse.down();
    await page.mouse.move(mapBox!.x + mapBox!.width * 0.9, mapBox!.y + mapBox!.height * 0.85, { steps: 4 });
    await page.mouse.up();
  }
  await expect.poll(async () => Number(await map.getAttribute('data-map-x'))).toBeGreaterThan(-500);
  await expect.poll(async () => Number(await map.getAttribute('data-map-y'))).toBeGreaterThan(-500);
  expect(regionRequests).toBe(1);

  await page.getByTitle('复位地图').click();
  await province.click();
  await expect(page.locator('.china-province-inspector')).toBeVisible();
  await expect.poll(() => regionRequests).toBe(2);
  const after = await performanceSession.send('Performance.getMetrics');
  console.log('Map gesture CPU (ms)', Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'].map(name => [
    name, Math.round(1000 * ((after.metrics.find(row => row.name === name)?.value || 0) - (before.metrics.find(row => row.name === name)?.value || 0))),
  ])));
  await performanceSession.detach();
});
