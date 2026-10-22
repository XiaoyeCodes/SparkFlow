// Optional local smoke check. Requires the project service already running.
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const base = process.env.SPARKFLOW_SMOKE_URL || 'http://127.0.0.1:5180';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route(/^https:\/\/fonts\./, route => route.abort());
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto(base + '/terminal', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.getByRole('button', { name: '打开金十财经早餐', exact: true }).click({ timeout: 30_000 });
  const article = page.locator('.digest-editorial');
  await expect(article).toBeVisible({timeout:20_000});
  await expect(page.locator('.digest-market-cell')).toHaveCount(9);
  const captured = await (await page.request.get(base+'/api/daily-digests/jin10/article')).json();
  if(captured.data.market.available!==9 || captured.data.market.rows.some(row=>!Number.isFinite(row.quote?.price)||row.quote.price<=0)) throw new Error('Incomplete real quote snapshot');
  await expect(page.locator('.terminal-digests-state,.terminal-digests-tabs,.terminal-digests-meta')).toHaveCount(0);
  const rawText = await page.evaluate(markup=>{const template=document.createElement('template');template.innerHTML=markup;return template.content.textContent.replace(/\s+/g,'');},captured.data.news.article_html);
  const rendered = await page.locator('.digest-report-prose').evaluate(el=>el.textContent.replace(/\s+/g,''));
  if(rendered!==rawText) throw new Error('Original news text was lost during rendering');
  await mkdir('output/daily-digests', { recursive: true });
  const reader=page.locator('.terminal-digests-reader');
  for (const width of [2200,1440,768,390]) {
    await page.setViewportSize({width,height:1000});
    await reader.evaluate(el=>{el.scrollTop=0;});
    await page.screenshot({ path: `output/daily-digests/jin10-${width}.png` });
    if(width===2200) {
      await expect(page.locator('.digest-reading-ornament').first()).toBeVisible();
      await page.locator('.terminal-digests').screenshot({path:'output/daily-digests/jin10-reading-layout.png'});
    }
    const layout=await reader.evaluate(el=>({width:el.clientWidth,contentWidth:el.scrollWidth,scrollbar:getComputedStyle(el).scrollbarWidth}));
    if(layout.contentWidth>layout.width+1||layout.scrollbar!=='none') throw new Error('Reading overflow/scrollbar: '+JSON.stringify(layout));
    const market=await page.locator('.digest-market-grid').boundingBox();
    const prose=await page.locator('.digest-report-prose').boundingBox();
    if(Math.abs(market.x-prose.x)>1 || Math.abs(market.width-prose.width)>1) throw new Error('Market and prose columns are not aligned');
    if(width===2200) {
      const nav=await page.locator('.digest-report-index').boundingBox();
      const ornament=await page.locator('.digest-reading-ornament.is-left').boundingBox();
      if(nav.x+nav.width>(await article.boundingBox()).x || ornament.y+ornament.height>nav.y-12) throw new Error('Outline is not outside the report or overlaps left artwork');
    }
    const box=await reader.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,600);
    await expect.poll(()=>reader.evaluate(el=>el.scrollTop)).toBeGreaterThan(200);
    await page.screenshot({path:`output/daily-digests/jin10-${width}-reading.png`});
    if(width===2200) await page.locator('.terminal-digests').screenshot({path:'output/daily-digests/jin10-outline-outside.png'});
    console.log('viewport',width,'reading width',(await article.boundingBox()).width,'wheel/hidden scrollbar OK');
  }
  await page.getByRole('button', { name: '关闭财经早餐，返回地球' }).click();
  if (failures.length) throw new Error(failures.join('\n'));
  console.log('Jin10 live UI smoke passed: nine real quotes, full original text, no status bars, four viewport widths.');
} finally { await browser.close(); }
