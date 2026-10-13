import { expect, test } from '@playwright/test';

test('economic cards start in parallel and render without aggregate macro or slow PCE', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.route(/^https:\/\/fonts\./, route => route.abort());
  const seen = new Set<string>();
  let macroCalls = 0, release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const metric = (id: string, display: string) => ({ id, label: id.toUpperCase(), value: Number.parseFloat(display), display,
    change: 0.1, changeDisplay: '+0.1p', updatedAt: new Date().toISOString(), sourceUrl: 'https://example.com',
    status: 'delayed', history: [], stats: [] });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    seen.add(url.pathname + url.search);
    if (url.pathname === '/api/global-macro-dashboard' && url.searchParams.get('section') === 'macro') {
      macroCalls++;
      if (macroCalls === 1) return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ json: { generatedAt: new Date().toISOString(), macro: [metric('ppi', '1.2')] } });
    }
    if (url.pathname === '/api/us-macro-card') {
      const id = url.searchParams.get('id')!;
      if (id === 'pce') { await waiting; return route.fulfill({ status: 503, json: {} }); }
      return route.fulfill({ json: { card: metric(id, id === 'ppi' ? '8.8' : '4.2') } });
    }
    if (url.pathname === '/api/global-macro-treasury-spread') return route.fulfill({ json: { metric: metric('ust2y10y', '+0.51%') } });
    return route.fulfill({ status: 503, json: {} });
  });
  try {
    await page.clock.install();
    await page.goto('http://127.0.0.1:5187/terminal');
    await expect.poll(() => seen.has('/api/global-macro-fed-rate') && seen.has('/api/financial-conditions')
      && ['ppi', 'cpi', 'unemployment', 'nonfarm', 'pmi', 'pce'].every(id => seen.has(`/api/us-macro-card?id=${id}`))).toBe(true);
    await expect(page.locator('.macro-metric-card-ppi')).toContainText('8.8');
    await expect(page.locator('.macro-metric-card-cpi-pce')).toHaveCount(1);
    await expect(page.locator('.macro-metric-card-unemployment')).toHaveCount(1);
    await expect(page.locator('.macro-metric-card-nonfarm')).toHaveCount(1);
    await expect(page.locator('.macro-treasury-card')).toContainText('+0.51%');
    // Retry a failed aggregate request on the regular clock, without navigation.
    await page.clock.fastForward(60_001);
    await expect.poll(() => macroCalls).toBeGreaterThan(1);
    await expect(page.locator('.macro-metric-card-cpi-pce')).toHaveCount(1);
  } finally { release(); }
});
