import {expect,test} from '@playwright/test';

test('GDP card sits between Fisher and quadrant, shows annual bars and interactive details',async({page})=>{
  await page.setViewportSize({width:1600,height:1000});
  await page.route('**/api/china-macro-dashboard?*',route=>route.fulfill({json:{}}));
  await page.route('**/api/china-fisher?*',route=>route.fulfill({json:{status:'unavailable'}}));
  await page.route('**/api/china-gdp',route=>route.fulfill({json:{status:'current',years:[114.367,121.0207,126.0582,134.9084,140.1879].map((value,i)=>({year:2021+i,value,growth:5,sourceUrl:'https://www.stats.gov.cn/'})),checkedAt:new Date().toISOString(),validUntil:new Date(Date.now()+3600_000).toISOString(),nextCheckAt:new Date(Date.now()+3600_000).toISOString()}}));
  await page.goto('http://127.0.0.1:5187/market#china-macro');
  const card=page.getByRole('region',{name:'中国 GDP 柱状图'});
  await expect(card).toContainText('140.19');
  await expect(card.locator('g[role=button]')).toHaveCount(5);
  expect(await card.evaluate(node=>node.previousElementSibling?.className)).toBe('china-fisher-card');
  expect(await card.evaluate(node=>node.nextElementSibling?.className)).toBe('china-income-card');
  await card.getByRole('button',{name:/2025年 GDP/}).hover();
  await expect(card.getByRole('status')).toContainText('140.19 万亿元');
  await card.getByRole('button',{name:/2021年 GDP/}).focus();
  await expect(card.getByRole('status')).toContainText('114.37 万亿元');
  await page.keyboard.press('Escape');
  await expect(card.getByRole('status')).toHaveCount(0);
  await card.screenshot({path:'output/china-gdp-card.png'});
  await page.setViewportSize({width:390,height:844});
  await card.scrollIntoViewIfNeeded();
  expect(await card.evaluate(node=>node.scrollWidth <= node.clientWidth)).toBe(true);
});
