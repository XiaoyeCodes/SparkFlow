import {expect,test} from '@playwright/test';
import {VERIFIED_INCOME_REPORT} from '../../server/chinaIncome';

test('income card renders official groups, median, sources and expires safely in a compact rail',async({page})=>{
  await page.setViewportSize({width:1600,height:1000});
  await page.clock.install({time:new Date('2026-09-13T04:00:00Z')});
  await page.route('**/api/china-macro-dashboard?*',route=>route.fulfill({json:{}}));
  await page.route('**/api/china-gdp',route=>route.fulfill({json:{status:'unavailable',years:[],validUntil:'2026-09-13T04:00:00Z',nextCheckAt:'2026-09-13T04:15:00Z'}}));
  await page.route('**/api/china-fisher?*',route=>route.fulfill({json:{mode:new URL(route.request().url()).searchParams.get('mode'),status:'unavailable',validUntil:'2026-09-13T04:00:00Z',nextCheckAt:'2026-09-13T04:15:00Z'}}));
  await page.route('**/api/china-income',route=>route.fulfill({json:{status:'snapshot',report:VERIFIED_INCOME_REPORT,checkedAt:'2026-09-13T04:00:00Z',validUntil:'2026-09-13T04:15:00Z',nextCheckAt:'2026-09-13T04:15:00Z'}}));
  await page.goto('http://127.0.0.1:5187/market#china-macro');
  const card=page.getByRole('region',{name:'居民收入变化',exact:true});
  await expect(card).toContainText('22,981');await expect(card).toContainText('19,036');await expect(card).toContainText('82.8%');
  await expect(card).toContainText('30,126元');await expect(card).toContainText('12,699元');
  await expect(card.locator('.china-income-sources > div')).toHaveCount(4);
  await expect(card).toContainText('官方快照');
  expect(await card.evaluate(node=>node.previousElementSibling?.className)).toBe('china-gdp-card');
  expect(await card.evaluate(node=>node.nextElementSibling?.className)).toBe('china-quadrant-board');
  const box=await card.boundingBox();expect(box!.height).toBeLessThan(410);
  await card.scrollIntoViewIfNeeded();await card.screenshot({path:'output/china-income-card.png'});
  await page.setViewportSize({width:390,height:844});await card.scrollIntoViewIfNeeded();
  expect(await card.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  await page.clock.fastForward(15*60_000+1500);
  await expect(card).not.toContainText('22,981');await expect(card).toContainText('待核实');
});
