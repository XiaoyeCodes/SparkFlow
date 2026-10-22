import { expect, test, type Page } from '@playwright/test';

const ids = ['jin10', 'daily60', 'aibase'];
const names = ['金十财经早餐', '每日60秒', 'AIBase 日报'];
const dates = ['2026-10-22', '2026-10-22', '2026-10-21'];
function digestIndex() {
  return { timezone: 'Asia/Shanghai', items: ids.map((id, position) => ({ id, name: names[position], hour: [8,9,18][position], dueDate: '2026-10-22', state: 'ready', edition: { revision: id, sourceDate: dates[position] } })) };
}
function article(id: string) {
  const data = id === 'jin10' ? { news: { introduction: '金十财经早餐的完整内容。', article_html: '<h2>全球财经</h2>' + '<p>金十新闻段落，保留完整财经原文。</p>'.repeat(30) + '<script>window.__newsInjected=true</script>' } }
    : id === 'daily60' ? { calendar: {weekday:'星期四',lunar_year:'丙午年',lunar_date:'九月十三'}, news: { news: ['每日60秒独立内容', '世界新闻第二条'], tip: '每日寄语正文' } }
      : { article_title: 'AIBase 每日精选', items: [{ heading:'1、这是用于检查窄屏阅读的很长中文新闻标题，人工智能的技术与产品更新应当完整显示并且自然换行',bullets:['AIBase 独立正文第一段','AIBase 独立正文第二段'] }] };
  return { id, revision:id, sourceDate:dates[ids.indexOf(id)], sourceUrl:'https://example.com/'+id, generatedAt:'2026-10-22T07:00:00Z', data };
}
async function setup(page: Page) {
  const reads: string[] = [];
  await page.route(/^https:\/\/fonts\./, route => route.abort());
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/daily-digests') { reads.push(url.pathname); return route.fulfill({ json:digestIndex() }); }
    if (/\/api\/daily-digests\/.+\/article$/.test(url.pathname)) {
      reads.push(url.pathname);
      expect(route.request().method()).toBe('GET');
      return route.fulfill({ json:article(url.pathname.split('/')[3]) });
    }
    return url.pathname === '/api/news-feed' ? route.fulfill({json:{generatedAt:new Date().toISOString(),sources:[],items:[]}}) : route.fulfill({status:503,json:{}});
  });
  await page.goto(`${process.env.SPARKFLOW_UI_TEST_URL || 'http://127.0.0.1:5187'}/signals?sort=time&lang=all`);
  return reads;
}

test('news toolbar opens paper reader; all three sources switch independently and preserve real edition dates', async ({page}) => {
  await page.setViewportSize({width:1440,height:1000});
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const reads = await setup(page);
  const entry = page.getByRole('button',{name:'每日新闻',exact:true});
  await expect(entry).toBeVisible();
  expect(reads).toEqual([]);
  await entry.click();
  const dialog = page.getByRole('dialog',{name:'每日新闻',exact:true});
  await expect(dialog.getByRole('article',{name:'财经早餐 · 2026-10-22'})).toBeVisible();
  await expect(dialog.locator('script,iframe,img')).toHaveCount(0);
  const tabPanel = dialog.getByRole('tabpanel');
  await tabPanel.evaluate(element => { element.scrollTop=450; });
  await dialog.getByRole('tab',{name:/每日60秒/}).click();
  await expect(dialog.getByText('每日60秒独立内容',{exact:true})).toBeVisible();
  await expect(dialog.getByText('每日寄语正文',{exact:true})).toBeVisible();
  await expect(dialog.getByText('星期四 · 农历 丙午年九月十三',{exact:true})).toBeVisible();
  expect(await tabPanel.evaluate(element => element.scrollTop)).toBe(0);
  await expect(dialog.getByText('金十财经早餐的完整内容。',{exact:true})).toHaveCount(0);
  await dialog.getByRole('tab',{name:/AIBase 日报/}).click();
  await expect(dialog.getByRole('article',{name:'AIBase 日报 · 2026-10-21'})).toBeVisible();
  await expect(dialog.getByText('AIBase 独立正文第二段',{exact:true})).toBeVisible();
  await expect(dialog.getByRole('status')).toContainText('2026-10-21');
  await expect(dialog.getByRole('link',{name:'查看原文'})).toHaveAttribute('href','https://example.com/aibase');
  await dialog.getByRole('tab',{name:/金十财经早餐/}).click();
  await expect(dialog.getByRole('article',{name:'财经早餐 · 2026-10-22'})).toBeVisible();
  expect(reads.filter(path=>path.endsWith('/article'))).toHaveLength(3);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(entry).toBeFocused();
  await expect(page).toHaveURL(/sort=time&lang=all$/);
  expect(errors).toEqual([]);
});

for (const width of [768,390]) test(`reader at ${width}px supports keyboard tabs, close and long headlines without overflow`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await setup(page);
  await page.getByRole('button',{name:'每日新闻',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'每日新闻',exact:true});
  const first=dialog.getByRole('tab',{name:/金十财经早餐/});
  await first.focus(); await page.keyboard.press('End');
  await expect(dialog.getByRole('tab',{name:/AIBase 日报/})).toBeFocused();
  await expect(dialog.getByText('AIBase 独立正文第二段',{exact:true})).toBeVisible();
  expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  expect(await dialog.getByRole('tabpanel').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  const heading=dialog.getByRole('heading',{name:/这是用于检查窄屏阅读/});
  await expect(heading).toBeVisible();
  for(let i=0;i<10;i++) { await page.keyboard.press('Tab'); expect(await page.evaluate(()=>!!document.activeElement?.closest('.daily-news-dialog'))).toBe(true); }
  await dialog.getByRole('button',{name:'关闭每日新闻'}).click();
  await expect(dialog).toHaveCount(0);
});

test('article failures offer retry and an unready source never shows the previous source body',async({page})=>{
  await setup(page);
  let fail=true;
  await page.route('**/api/daily-digests/daily60/article?*',route=> fail ? route.fulfill({status:503,json:{}}) : route.fulfill({json:article('daily60')}));
  await page.getByRole('button',{name:'每日新闻',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'每日新闻',exact:true});
  await expect(dialog.getByRole('article')).toBeVisible();
  await dialog.getByRole('tab',{name:/每日60秒/}).click();
  await expect(dialog.getByText('正文暂时无法加载',{exact:true})).toBeVisible();
  await expect(dialog.getByRole('article')).toHaveCount(0);
  fail=false;
  await dialog.getByRole('button',{name:'重试',exact:true}).click();
  await expect(dialog.getByText('每日60秒独立内容',{exact:true})).toBeVisible();
});
