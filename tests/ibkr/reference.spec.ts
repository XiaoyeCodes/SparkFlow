import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

for (const viewport of [{ width: 1440, height: 1000 }, { width: 1920, height: 1080 }]) {
  test(`archived layout ${viewport.width}×${viewport.height}`, async ({ page }) => {
    // The reference has synthetic data and remote fonts. Render only local bytes.
    await page.route(/^https?:/, route => route.abort('blockedbyclient'));
    await page.setViewportSize(viewport);
    await page.clock.install({ time: new Date('2026-09-04T12:00:00Z') });
    await page.addInitScript(() => { Math.random = () => 0.5; });
    await page.goto(pathToFileURL(resolve('docs/design/ibkr/trading_terminal.reference.html')).href);
    await expect(page.locator('header')).toHaveCSS('height', '58px');
    await expect(page.locator('.app')).toBeVisible();
    await mkdir('docs/design/ibkr/screenshots', { recursive: true });
    await page.screenshot({ path: `docs/design/ibkr/screenshots/reference-${viewport.width}x${viewport.height}.png`, animations: 'disabled' });
  });
}
