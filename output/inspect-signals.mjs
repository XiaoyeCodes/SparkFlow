import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

await mkdir(new URL('./signals/', import.meta.url), { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const consoleErrors = [];

async function inspect(viewport, fileName) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto('http://127.0.0.1:5174/signals', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2_500);
  const cards = page.locator('.signals-item');
  const count = await cards.count();
  const sample = await cards.evaluateAll((nodes) => nodes.slice(0, 8).map((card) => {
    const ornament = card.querySelector('.signals-item-ornament');
    const style = getComputedStyle(card);
    return {
      className: card.className,
      ornament: ornament?.className || null,
      borderColor: style.borderColor,
      energy: style.getPropertyValue('--signals-card-energy').trim(),
      ornamentOpacity: ornament ? getComputedStyle(ornament).opacity : null
    };
  }));
  if (viewport.width < 600) {
    await cards.first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
  }
  await page.screenshot({ path: fileURLToPath(new URL(`./signals/${fileName}`, import.meta.url)), fullPage: false });
  await page.close();
  return { count, sample };
}

const desktop = await inspect({ width: 1728, height: 1100 }, 'news-card-identity-desktop.png');
const mobile = await inspect({ width: 390, height: 844 }, 'news-card-identity-mobile.png');
console.log(JSON.stringify({ desktop, mobile, consoleErrors }, null, 2));
await browser.close();
