import { expect, test } from '@playwright/test';
import { createChinaRegionalFeedService } from '../../server/chinaRegionalFeed';

test('opt-in live regional media renders inside an equal-height inspector', async ({ page }) => {
  test.skip(process.env.SPARKFLOW_LIVE_REGIONAL_TEST !== '1', 'External newsroom smoke test is opt-in.');
  test.setTimeout(90_000);
  const feed = await createChinaRegionalFeedService().get({region:'陕西省',province:'陕西省',level:'province'});
  expect(feed.policies.length).toBeGreaterThanOrEqual(6);
  expect(feed.news.filter(item=>item.sourceKind==='media').length).toBeGreaterThanOrEqual(6);
  await page.setViewportSize({width:2500,height:1500});
  await page.route('**/api/**', route=>route.fulfill({json:{}}));
  await page.route('**/api/china-region-boundary?*', route=>route.fulfill({json:{type:'FeatureCollection',features:[]}}));
  await page.route('**/api/china-region-official-feed?*', route=>route.fulfill({json:feed}));
  await page.goto('http://127.0.0.1:5187/market#china-macro');
  // The concave province's bounding-box center lies in Gansu. Find a real
  // interior point and click it with the browser mouse (no synthetic event).
  const province = page.locator('.china-province[aria-label="陕西省"]');
  await province.scrollIntoViewIfNeeded();
  const point = await province.evaluate(node => {
    const path = node as SVGPathElement, bounds = path.getBBox(), matrix = path.getScreenCTM()!;
    for(let x=0.1;x<1;x+=0.1)for(let y=0.1;y<1;y+=0.1){
      const local = new DOMPoint(bounds.x+bounds.width*x,bounds.y+bounds.height*y);
      const screen = local.matrixTransform(matrix);
      if(path.isPointInFill(local) && document.elementFromPoint(screen.x,screen.y)===node)return {x:screen.x,y:screen.y};
    }
    throw Error('No visible province interior found');
  });
  await page.mouse.click(point.x, point.y);
  const inspector = page.locator('.china-province-inspector');
  await expect(inspector.locator('.china-local-intel-news .china-local-intel-group > a')).toHaveCount(6);
  await inspector.scrollIntoViewIfNeeded();
  const sizes = await inspector.locator('.china-local-intel > section').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));
  expect(Math.abs(sizes[0]-sizes[1])).toBeLessThanOrEqual(1);
  await inspector.screenshot({path:'output/regional-feed-live-shaanxi.png'});
});
