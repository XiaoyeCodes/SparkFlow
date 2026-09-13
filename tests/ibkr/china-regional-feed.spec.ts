import { expect, test } from '@playwright/test';

test('province and city use the same six-card layout with vertical expansion', async ({page}) => {
  await page.setViewportSize({width:2500,height:1500});
  await page.route('**/api/**', route=>route.fulfill({json:{}}));
  await page.route('**/api/china-region-boundary?*', route=>route.fulfill({json:{type:'FeatureCollection',features:[{type:'Feature',properties:{name:'南阳市',adcode:411300},geometry:{type:'Polygon',coordinates:[[[110,32],[113,32],[113,35],[110,35],[110,32]]]}}]}}));
  await page.route('**/api/china-region-official-feed?*', route=>{
    const region=new URL(route.request().url()).searchParams.get('region')!;
    const articles=(type:string)=>Array.from({length:9},(_,i)=>({id:`${region}-${type}-${i}`,title:type==='政策'?`${region}产业支持办法（测试 ${i+1}）`:`${region}新闻：重点产业与民生保障实施方案，推进公共服务和经济高质量发展，进一步完善城市公共交通与文旅服务体验（测试条目 ${i+1}）`,source:type==='政策'?`${region}政府（测试来源）`:'地方媒体（测试来源）',url:`https://example.gov.cn/${i}`,publishedAt:'2026-09-12',...(type==='新闻'?{category:['民生','财经','文旅','社会','热点','民生'][i%6],sourceKind:'media'}:{})}));
    return route.fulfill({json:{province:region,region,policies:articles('政策'),news:articles('新闻'),sourceStatus:'live',generatedAt:'2026-09-13T08:00:00Z',errors:[]}});
  });
  await page.goto('http://127.0.0.1:5187/market#china-macro');
  await page.locator('.china-province[aria-label="河南省"]').click();
  const inspector=page.locator('.china-province-inspector');
  await expect(inspector.locator('header').first()).toContainText('河南省');
  const check=async()=>{
    const containedAndEqual=async()=>{
      const geometry=await inspector.evaluate(node=>{
        const sections=[...node.querySelectorAll('.china-local-intel > section')].map(n=>n.getBoundingClientRect());
        const status=node.querySelector('.china-local-intel-status')!.getBoundingClientRect();
        return {heights:sections.map(r=>r.height),bottoms:sections.map(r=>r.bottom),bottom:node.getBoundingClientRect().bottom,statusBottom:status.bottom};
      });
      expect(Math.abs(geometry.heights[0]-geometry.heights[1])).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.bottoms[0]-geometry.bottoms[1])).toBeLessThanOrEqual(1);
      expect(geometry.statusBottom).toBeLessThan(geometry.bottom);
      expect(Math.max(...geometry.bottoms)).toBeLessThan(geometry.bottom);
    };
    for(const category of ['policy','news']){
      const section=page.locator(`.china-local-intel-${category}`);
      await expect(section.locator('.china-local-intel-group > a')).toHaveCount(6);
      const cards=await section.locator('.china-local-intel-group > a').evaluateAll(nodes=>nodes.map(n=>({x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y})));
      expect(cards[0].x).toBe(cards[2].x);expect(cards[3].x).toBeGreaterThan(cards[0].x);expect(cards[0].y).toBe(cards[3].y);
      const noScroll=await section.locator('.china-local-intel-list').evaluate(node=>({overflow:getComputedStyle(node).overflowY,height:node.clientHeight,scroll:node.scrollHeight}));
      expect(noScroll.overflow).toBe('visible');expect(noScroll.scroll).toBeLessThanOrEqual(noScroll.height+1);
      const before=await inspector.evaluate(node=>node.getBoundingClientRect().height);
      await section.getByRole('button',{name:'向下展开其余 3 条'}).click();
      await expect(section.locator('.china-local-intel-group > a')).toHaveCount(9);
      expect(await inspector.evaluate(node=>node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(before);
      await containedAndEqual();
      await section.getByRole('button',{name:'收起更多内容'}).click();
    }
    await containedAndEqual();
    const stage=page.locator('.china-map-stage');
    expect(await stage.evaluate(node=>getComputedStyle(node).scrollbarWidth)).toBe('none');
    expect(await stage.evaluate(node=>getComputedStyle(node).overflowY)).toBe('auto');
    const scroll=await stage.evaluate(node=>{node.scrollTop=node.scrollHeight;return {top:node.scrollTop,max:node.scrollHeight-node.clientHeight};});
    if(scroll.max>0)expect(scroll.top).toBeGreaterThan(0);
    await expect(page.locator('.china-local-intel-topic').first()).toHaveText('民生');
  };
  await check();
  await inspector.scrollIntoViewIfNeeded();
  await inspector.screenshot({path:'output/regional-feed-province.png'});
  await page.locator('.china-province[aria-label="南阳市"]').click();
  await expect(inspector.locator('header').first()).toContainText('南阳市');
  await expect(page.locator('.china-local-intel')).not.toContainText('河南省');
  await check();
  await inspector.screenshot({path:'output/regional-feed-city.png'});
  await page.setViewportSize({width:390,height:844});
  const group=page.locator('.china-local-intel-policy .china-local-intel-group');
  const columns=await group.locator('a').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().x));
  expect(new Set(columns).size).toBe(1);
  expect(await group.evaluate(node=>node.scrollWidth)).toBeLessThanOrEqual(await group.evaluate(node=>node.clientWidth));
});

test('source failure is explicit and portal entries do not count as articles', async({page})=>{
  await page.route('**/api/**',route=>route.fulfill({json:{}}));
  await page.route('**/api/china-region-boundary?*',route=>route.fulfill({json:{type:'FeatureCollection',features:[]}}));
  await page.route('**/api/china-region-official-feed?*',route=>route.fulfill({json:{province:'湖北省',policies:[{id:'portal',title:'湖北省政府官网入口',url:'https://www.hubei.gov.cn/',fallback:true}],news:[],sourceStatus:'unavailable',errors:[]}}));
  await page.goto('http://127.0.0.1:5187/market#china-macro');
  await page.locator('.china-province[aria-label="湖北省"]').click();
  await expect(page.locator('.china-local-intel-group > a')).toHaveCount(0);
  await expect(page.locator('.china-local-intel-empty')).toHaveCount(2);
  await expect(page.getByRole('button',{name:'重新加载',exact:true})).toBeEnabled();
});
