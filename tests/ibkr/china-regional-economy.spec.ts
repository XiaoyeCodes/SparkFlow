import { expect, test, type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { FeatureCollection } from 'geojson';
import type { RegionalSnapshot } from '../../src/lib/chinaRegionalEconomy';
const provinces = JSON.parse(readFileSync('public/data/china-provinces.json', 'utf8')) as FeatureCollection;
const seed = JSON.parse(readFileSync('src/data/chinaRegionalVerified.json', 'utf8')) as RegionalSnapshot;

test('regional observations synchronize automatically and show period and source', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.clock.install({ time: new Date('2026-09-13T12:00:00Z') });
  let updated = false;
  let reads = 0;
  await page.route('**/api/china-macro-dashboard?*', route => route.fulfill({ json: {} }));
  await page.route('**/api/china-region-official-feed?*', route => route.fulfill({ json: { policies: [], news: [], errors: [] } }));
  await page.route('**/api/china-regional-economy*', route => {
    reads++;
    return route.fulfill({ json: { ...seed, observations: seed.observations.map(o =>
      updated && o.adcode === '610116' && o.metric === 'gdp' ? { ...o, period: '2025', value: 1800, editionYear: 2026 } : o) } });
  });
  const shape = provinces.features.find(feature => feature.properties?.name === '陕西省')!;
  await page.route('**/api/china-region-boundary?*', route => {
    const adcode = new URL(route.request().url()).searchParams.get('adcode');
    const properties = adcode === '610000' ? { name: '西安市', adcode: 610100, level: 'city' }
      : { name: '长安区', adcode: 610116, level: 'district' };
    return route.fulfill({ json: { type: 'FeatureCollection', features: [{ ...shape, properties }] } });
  });
  const moveToRegion = async (region: Locator, click = false) => {
    await expect(region).toBeVisible();
    await region.scrollIntoViewIfNeeded();
    const point = await region.evaluate(element => {
      const shape = element as SVGGeometryElement;
      const box = shape.getBBox();
      const matrix = shape.getScreenCTM()!;
      for (let row = 1; row < 20; row++) for (let col = 1; col < 20; col++) {
        const local = new DOMPoint(box.x + box.width * col / 20, box.y + box.height * row / 20);
        if (!shape.isPointInFill(local)) continue;
        const screen = local.matrixTransform(matrix);
        if (document.elementFromPoint(screen.x, screen.y) === shape) return { x: screen.x, y: screen.y };
      }
      throw new Error('No visible point within region');
    });
    await page.mouse.move(point.x, point.y);
    if (click) await page.mouse.click(point.x, point.y);
  };
  await page.goto('http://127.0.0.1:5187/market#china-macro');
  await moveToRegion(page.locator('.china-province[aria-label="陕西省"]'), true);
  await moveToRegion(page.locator('.china-province[aria-label="西安市"]'), true);
  const changan = page.locator('.china-province[aria-label="长安区"]');
  await expect(changan).toBeVisible();
  await moveToRegion(changan);
  await expect(page.locator('.china-map-tooltip')).toContainText('1,593.02');
  await expect(page.locator('.china-map-tooltip')).toContainText('2024 年');
  await moveToRegion(changan, true);
  await expect(page.locator('.china-regional-source')).toContainText('GDP · 2024 年');
  await expect(page.locator('.china-regional-source a').first()).toHaveAttribute('href', /tjj\.shaanxi\.gov\.cn/);
  updated = true;
  const before = reads;
  await page.clock.fastForward(60_001);
  await expect.poll(() => reads).toBeGreaterThan(before);
  await moveToRegion(changan);
  await expect(page.locator('.china-map-tooltip')).toContainText('1,800.00');
  await expect(page.locator('.china-map-tooltip')).toContainText('2025 年');
  await page.locator('.china-map-canvas').screenshot({ path: 'output/china-regional-updated.png' });
});
