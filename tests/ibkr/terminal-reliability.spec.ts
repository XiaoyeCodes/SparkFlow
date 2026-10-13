import { expect, test } from '@playwright/test';

test('VT and economic expectations render independently; slow CNN and failed quotes do not erase VIX', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.clock.install();
  await page.route(/^https:\/\/fonts\./, route => route.abort());
  const now = Date.now(), timestamp = new Date(now).toISOString();
  let release!: () => void, vixCalls = 0, vtCalls = 0, recovered = false;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const metric = (id: string, value: number) => ({ id, label: id, value, display: value.toFixed(2), change: 0.1,
    updatedAt: recovered ? new Date(now + 10_000).toISOString() : timestamp,
    status: 'delayed', sourceUrl: 'https://fred.stlouisfed.org/series/VIXCLS', history: [], provider: 'FRED' });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/global-macro-global-equity') {
      vtCalls++;
      if (vtCalls > 1 && !recovered) return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ json: { quote: { id: 'vt', symbol: 'VT', name: '全球股票 VT', price: 159.5, change: -0.33,
        changePercent: -0.21, updatedAt: timestamp, region: 'global', latitude: 0, longitude: 0,
        session: { label: '全球市场代理', tone: 'unknown' }, history: [], sourceUrl: 'https://example.com/vt' } } });
    }
    if (url.pathname === '/api/us-macro-card' && url.searchParams.get('id') === 'nonfarm') {
      return route.fulfill({ json: { card: { ...metric('nonfarm', 29), display: '+29K', updatedAt: '2026-09-01T00:00:00Z',
        stats: [{ label: '实际', display: '+29K' }, { label: '前值', display: '+133K' }, { label: '预期', display: '+90K' }] } } });
    }
    if (url.pathname === '/api/global-risk-sentiment/vix') {
      vixCalls++;
      if (vixCalls > 1 && !recovered) return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ json: { metric: metric('vix', recovered ? 15.31 : 15.21) } });
    }
    if (url.pathname === '/api/global-risk-sentiment/vxn') return route.fulfill({ json: { metric: metric('vxn', 20.55) } });
    if (url.pathname === '/api/global-risk-sentiment/fear-greed') { await waiting; return route.fulfill({ status: 503, json: {} }); }
    return route.fulfill({ status: 503, json: {} });
  });
  try {
    await page.goto('http://127.0.0.1:5187/terminal');
    await expect(page.locator('.macro-vt-name')).toContainText('159.50');
    await expect(page.locator('.macro-metric-card-nonfarm')).toContainText('+90K');
    await expect(page.locator('.macro-risk-switcher')).toContainText('15.21');
    await page.clock.fastForward(15_001);
    await expect.poll(() => vixCalls).toBeGreaterThan(1);
    await expect.poll(() => vtCalls).toBeGreaterThan(1);
    await expect(page.locator('.macro-vt-name')).toContainText('159.50');
    await expect(page.locator('.macro-risk-switcher')).toContainText('15.21');
    recovered = true;
    await page.clock.fastForward(60_001);
    await expect(page.locator('.macro-risk-switcher')).toContainText('15.31');
  } finally { release(); }
});
