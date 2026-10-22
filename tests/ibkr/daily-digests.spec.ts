import { expect, test } from '@playwright/test';
import { DIGEST_MARKETS } from '../../src/lib/dailyDigestTypes';

const ids = ['jin10', 'daily60', 'aibase'];
const names = ['金十财经早餐', '每日60秒', 'AIBase 日报'];
const hours = [8, 9, 18];
function article(id: string, revision = 'one') {
  const sentence = `${revision} 可阅读内容`;
  const market = { schema:1, revision:'fixture', checkedAt:'2026-10-22T07:00:00Z', available:9, nextRefreshAt:null, refreshing:false,
    rows:DIGEST_MARKETS.map(spec=>({...spec,state:'current',error:null,quote:{id:spec.id,price:spec.id==='US10Y'?4.53:101,previous:spec.id==='US10Y'?4.5:100,changePercent:1,...(spec.id==='US10Y'?{changeBp:3}:{}),quotedAt:'2026-10-22T07:00:00Z',checkedAt:'2026-10-22T07:00:00Z',source:'测试来源',sourceUrl:'https://example.com/quote',instrument:'测试报价',basis:'测试前值',delay:'测试时间',symbol:spec.symbol,evidence:{sha256:'a'.repeat(64),fields:'fixture'}}})) };
  const data = id==='jin10' ? {news:{introduction:sentence,article_html:'<div><h2>今日优选</h2>'+Array.from({length:20},(_,i)=>`<p>完整原文段落 ${i}，保留新闻内容与<strong>重点信息</strong>。</p>`).join('')+'<h2>风险预警</h2><p>最后一段原文。</p><script>window.__digestInjected=true</script><img src="https://example.com/tracker"></div>',paragraphs:Array(21)},market}
    : id==='aibase' ? {items:[{heading:'aibase 缓存日报',bullets:[sentence]}]} : {news:{news:['daily60 缓存日报',sentence]}};
  return {id,revision,sourceDate:'2026-10-22',generatedAt:'2026-10-22T07:00:00Z',sourceUrl:'https://example.com/source',data};
}
function index(state = 'ready', revision = 'one', withCache = true) {
  return { timezone: 'Asia/Shanghai', serverTime: '2026-10-22T07:00:00Z', items: ids.map((id, n) => ({ id, name: names[n], hour: hours[n], dueDate: '2026-10-22', nextRunAt: `2026-10-23T${String(hours[n] - 8).padStart(2, '0')}:00:00Z`, state,
    edition: withCache ? { schema: 1, id, editionDate: '2026-10-22', sourceDate: '2026-10-22', sourceUrl: 'https://example.com/source', generatedAt: '2026-10-22T07:00:00Z', revision, itemCount: 2, quality: 'ready', warnings: [] } : null,
    lastAttemptAt: '2026-10-22T07:00:00Z', nextRetryAt: state === 'error' ? '2026-10-22T07:05:00Z' : null, error: state === 'error' ? '测试来源暂时不可达' : null })) };
}

test('toolbar opens only Jin10; no status/header tabs; narrow reading column has ornaments and wheel scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 2200, height: 1000 });
  await page.route(/^https:\/\/fonts\./, route => route.abort());
  const reads: string[] = [], methods: string[] = [];
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/daily-digests')) {
      reads.push(url.pathname); methods.push(route.request().method());
      if (url.pathname === '/api/daily-digests') return route.fulfill({ json: index() });
      return route.fulfill({ json: article(url.pathname.split('/')[3]) });
    }
    return route.fulfill({ status: 503, json: {} });
  });
  await page.goto('http://127.0.0.1:5187/terminal');
  const button = page.getByRole('button', { name: '打开金十财经早餐', exact: true });
  await expect(button).toBeVisible(); expect(reads).toEqual([]);
  await button.click();
  const region = page.getByRole('region', { name: '财经早餐阅读区', exact:true });
  await expect(region).toBeVisible();
  await expect(region.getByRole('tablist')).toHaveCount(0);
  await expect(region).not.toContainText('每日60秒'); await expect(region).not.toContainText('AIBase');
  await expect(region).not.toContainText('已缓存'); await expect(region).not.toContainText('下次');
  await expect(region.getByRole('article', {name:'财经早餐 · 2026-10-22'})).toBeVisible();
  await expect(region.locator('.digest-market-cell')).toHaveCount(9);
  await expect(region.locator('iframe, script, img')).toHaveCount(0);
  const reader = region.locator('.terminal-digests-reader');
  const bounds = await reader.boundingBox();
  await page.mouse.move(bounds!.x+bounds!.width/2,bounds!.y+bounds!.height/2); await page.mouse.wheel(0,450);
  await expect.poll(()=>reader.evaluate(el=>el.scrollTop)).toBeGreaterThan(100);
  expect(await reader.evaluate(el=>getComputedStyle(el).scrollbarWidth)).toBe('none');
  expect((await region.locator('.digest-editorial').boundingBox())!.width).toBeLessThanOrEqual(780);
  await expect(region.locator('.digest-reading-ornament')).toHaveCount(2);
  await expect(region.locator('.digest-reading-ornament').first()).toBeVisible();
  const market = (await region.locator('.digest-market-grid').boundingBox())!;
  const prose = (await region.locator('.digest-report-prose').boundingBox())!;
  const outline = (await region.locator('.digest-report-index').boundingBox())!;
  const report = (await region.locator('.digest-editorial').boundingBox())!;
  expect(Math.abs(prose.x-market.x)).toBeLessThan(1);
  expect(Math.abs(prose.width-market.width)).toBeLessThan(1);
  expect(outline.x+outline.width).toBeLessThan(report.x);
  await region.locator('.digest-report-index').getByRole('link', {name:/风险预警/}).click();
  await expect(region.getByRole('heading', {name:'风险预警',exact:true})).toBeInViewport();
  await expect(region.getByRole('article')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(region).toHaveCount(0); await expect(button).toBeFocused();
  expect(methods.every(m => m === 'GET')).toBe(true);
  expect(reads.some(p => /generate|refresh/.test(p))).toBe(false);
  expect(reads.filter(p=>/aibase|daily60/.test(p))).toEqual([]);
});

test('background generation retains reading position, then swaps only on successful revision; failure keeps readable cache', async ({ page }) => {
  await page.clock.install();
  let state = 'generating', revision = 'old', count = 0;
  await page.route(/^https:\/\/fonts\./, route => route.abort());
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/daily-digests') return route.fulfill({ json: index(state, revision) });
    if (/\/api\/daily-digests\/.+\/article$/.test(url.pathname)) { count++; return route.fulfill({ json:article(url.pathname.split('/')[3],revision) }); }
    return route.fulfill({ status: 503, json: {} });
  });
  await page.goto('http://127.0.0.1:5187/terminal');
  await page.getByRole('button', { name: '打开金十财经早餐', exact: true }).click();
  await expect(page.getByText('old 可阅读内容',{exact:true})).toBeVisible();
  await expect(page.locator('.terminal-digests-state')).toHaveCount(0);
  const reader=page.locator('.terminal-digests-reader');
  await reader.evaluate(el=>{el.scrollTop=300;});
  await page.clock.runFor(10_100); expect(count).toBe(1);
  expect(await reader.evaluate(el=>el.scrollTop)).toBe(300);
  state = 'ready'; revision = 'new'; await page.clock.runFor(10_100);
  await expect(page.getByText('new 可阅读内容',{exact:true})).toHaveCount(1); expect(count).toBe(2);
  state = 'error'; await page.clock.runFor(30_100);
  await expect(page.getByText('new 可阅读内容',{exact:true})).toHaveCount(1); expect(count).toBe(2);
});

test('empty first generation shows schedule and recoverable source status on compact viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(/^https:\/\/fonts\./, route => route.abort());
  await page.route('**/api/**', route => new URL(route.request().url()).pathname === '/api/daily-digests' ? route.fulfill({ json: index('error', 'none', false) }) : route.fulfill({ status: 503, json: {} }));
  await page.goto('http://127.0.0.1:5187/terminal');
  await page.getByRole('button', { name: '打开金十财经早餐', exact: true }).click();
  await expect(page.locator('.terminal-digests-empty')).toContainText('本期内容尚未准备好');
  await expect(page.locator('.digest-editorial')).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('button', {name:'关闭财经早餐，返回地球'})).toBeVisible();
});
