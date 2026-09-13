import { expect, test } from '@playwright/test';

test('Fisher card shows calculation above policy and hides expired or failed data', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.clock.install({ time: new Date('2026-09-13T03:00:00Z') });
  await page.addInitScript(() => localStorage.setItem('china-fisher-mode', 'loan'));
  let requests = 0;
  await page.route('**/api/china-macro-dashboard?*', route => route.fulfill({ json: {} }));
  await page.route('**/api/china-fisher?*', route => {
    requests++;
    if (requests > 1) return route.abort();
    return route.fulfill({ json: {
      mode:'loan',status:'current',realRate:2.2,nominal:{value:3,period:'2026-08',publishedAt:'2026-08-20',sourceUrl:'https://www.pbc.gov.cn/'},
      inflation:{value:0.8,period:'2026-08',publishedAt:'2026-09-09',sourceUrl:'https://www.stats.gov.cn/'},
      checkedAt:'2026-09-13T03:00:00Z',validUntil:'2026-09-13T03:05:00Z',nextCheckAt:'2026-09-13T03:05:00Z',
    }});
  });
  await page.goto('http://127.0.0.1:5187/market#china-macro');
  const card = page.getByRole('region', {name:'费雪方程式实际利率'});
  await expect(card.getByTestId('fisher-result')).toHaveText('+2.20%');
  await expect(card).toContainText('+3.00%');
  await expect(card).toContainText('+0.80%');
  expect(await card.evaluate(node => node.parentElement?.firstElementChild === node)).toBe(true);
  await page.screenshot({path:'output/china-fisher-desktop.png'});
  await page.clock.fastForward(5 * 60_000 + 1_000);
  await expect(card.getByTestId('fisher-result')).toHaveText('—');
  await expect(card).not.toContainText('+3.00%');
  await expect.poll(() => requests).toBeGreaterThan(1);
  await expect(card.getByRole('status')).toHaveText('待更新');
  await page.setViewportSize({width:390,height:844});
  await card.scrollIntoViewIfNeeded();
  expect(await card.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await card.screenshot({path:'output/china-fisher-mobile-unavailable.png'});
});

test('Fisher mode switch changes rates and sources, survives reload and isolates late responses', async ({ page }) => {
  await page.setViewportSize({width:1600,height:1000});
  await page.route('**/api/china-macro-dashboard?*', route => route.fulfill({json:{}}));
  let delayDeposit = false;
  await page.route('**/api/china-fisher?*', async route => {
    const mode = new URL(route.request().url()).searchParams.get('mode');
    if (delayDeposit && mode === 'deposit') await new Promise(resolve => setTimeout(resolve,500));
    await route.fulfill({json:{mode,status:'current',realRate:mode === 'deposit' ? 0.15 : 2.2,
      nominal:{value:mode === 'deposit' ? 0.95 : 3,period:'2026-08',publishedAt:mode === 'deposit' ? '2025-05-20' : '2026-08-20',sourceUrl:mode === 'deposit' ? 'https://www.bankofchina.com/' : 'https://www.pbc.gov.cn/'},
      inflation:{value:0.8,period:'2026-08',publishedAt:'2026-09-09',sourceUrl:'https://www.stats.gov.cn/'},
      checkedAt:new Date().toISOString(),validUntil:new Date(Date.now()+300_000).toISOString(),nextCheckAt:new Date(Date.now()+300_000).toISOString(),
    }});
  });
  await page.goto('http://127.0.0.1:5187/market#china-macro');
  const card = page.getByRole('region',{name:'费雪方程式实际利率'});
  await expect(card.getByTestId('fisher-result')).toHaveText('+0.15%');
  await expect(card).toContainText('中行 · 1 年整存整取');
  await expect(card.locator('footer')).toHaveCount(0);
  await card.screenshot({path:'output/china-fisher-deposit.png'});
  await card.getByRole('button',{name:'贷款成本',exact:true}).click();
  await expect(card.getByTestId('fisher-result')).toHaveText('+2.20%');
  await expect(card).toContainText('1 年期 LPR');
  await expect(card).not.toContainText('更新规则与口径');
  await page.reload();
  await expect(card.getByRole('button',{name:'贷款成本',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(card.getByTestId('fisher-result')).toHaveText('+2.20%');
  delayDeposit = true;
  await card.getByRole('button',{name:'存款购买力',exact:true}).click();
  await expect(card.getByTestId('fisher-result')).toHaveText('—');
  await card.getByRole('button',{name:'贷款成本',exact:true}).click();
  await expect(card.getByTestId('fisher-result')).toHaveText('+2.20%');
  await page.waitForTimeout(650);
  await expect(card.getByTestId('fisher-result')).toHaveText('+2.20%');
  await page.setViewportSize({width:390,height:844});
  await card.scrollIntoViewIfNeeded();
  await card.getByRole('button',{name:'存款购买力',exact:true}).click();
  await expect(card.getByTestId('fisher-result')).toHaveText('+0.15%');
  expect(await card.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await card.screenshot({path:'output/china-fisher-deposit-mobile.png'});
});
