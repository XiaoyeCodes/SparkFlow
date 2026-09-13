import assert from 'node:assert/strict';
import { createChinaRegionalFeedService, parseRegionalArticles, rankRegionalArticles, regionalGovernmentUrl, discoverRegionalPortalCandidates, REGIONAL_GOVERNMENT_PORTALS, regionalNewsSourceUrl, parseRegionalMediaArticles, decodeRegionalPage } from '../server/chinaRegionalFeed.ts';
import { REGIONAL_MEDIA_SOURCES, matchesRegionalNews, rankDiverseRegionalNews, regionalNewsCategory } from '../server/chinaRegionalMedia.ts';

const now = Date.parse('2026-09-13T08:00:00Z');
const anchor = (i, kind, name = '湖北省') => `<li><a href="/2026/09-12/${1400000 + i}.html" title="${name}${kind === 'policy' ? '关于印发产业支持实施方案' : '重点项目开工推动民生经济发展'}（${i}）">截断的标题...</a><time>2026-09-12</time></li>`;
const sample = { url: 'https://www.hubei.gov.cn/', html: `<title>湖北省人民政府</title>${anchor(1,'policy')}${anchor(2,'news')}
<a href="/col/col12345/index.html">湖北省人民政府政策文件</a><a href="https://www.henan.gov.cn/2026/09-12/888888.html">河南省重大项目开工建设</a>
<a href="/2026/09-12/999999.html">国务院召开全国工作会议</a><a href="javascript:alert(1)">关于公布不安全链接的通知</a>` };
const parsed = parseRegionalArticles('湖北省', sample);
assert.equal(parsed.policies.length,1); assert.equal(parsed.news.length,1);
assert.equal(parsed.policies[0].publishedAt,'2026-09-12'); assert.match(parsed.policies[0].title,/产业支持/);
assert.equal(rankRegionalArticles([parsed.news[0], {...parsed.news[0],id:'duplicate',title:'简介：'+parsed.news[0].title}], 'news', now).length,1);
assert.equal(rankRegionalArticles([{...parsed.news[0],publishedAt:'2020-01-01'}], 'news',now).length,0);
const ranked = rankRegionalArticles([parsed.news[0], {...parsed.news[0],id:'major',url:'https://www.hubei.gov.cn/2026/09-12/333333.html', title:'省委召开会议审议重大民生政策'}], 'news',now);
assert.equal(ranked[0].id,'major');
const embedded = parseRegionalArticles('江西省',{url:'http://www.jiangxi.gov.cn/',html:`<title>江西省人民政府</title><script>const data=${JSON.stringify([{title:'江西省重点产业项目加快建设',pubDate:'2026-09-12',urls:JSON.stringify({pc:'/jxsrmzf/jxyw/pc/content/content_1234567890.html'})}])};</script>`});
assert.equal(embedded.news.length,1,'literal embedded article JSON is supported without evaluating scripts');
for (const url of ['http://127.0.0.1/', 'https://example.com/', 'file:///C:/secret','https://www.hubei.gov.cn:9000/','https://gov.cn.attacker.test/']) assert.throws(()=>regionalGovernmentUrl(url));
const target='https://www.nanyang.gov.cn/';
assert.deepEqual(discoverRegionalPortalCandidates(`<a href="https://www.bing.com/ck/a?u=a1${Buffer.from(target).toString('base64url')}">南阳市人民政府</a>`,'南阳市','https://www.henan.gov.cn/'),[target]);

let requests=0, active=0, peak=0, fail=false, clock=now;
const service=createChinaRegionalFeedService({now:()=>clock,fetchPage:async(...args)=>{
  assert.equal(args.length,1,'array indices must never be forwarded as a timeout');
  requests++;active++;peak=Math.max(peak,active); await new Promise(resolve=>setTimeout(resolve,2));active--;
  if(fail)throw Error('offline');
  const [url]=args; const name=Object.entries(REGIONAL_GOVERNMENT_PORTALS).find(([,portal])=>new URL(portal).hostname===new URL(url).hostname)?.[0]
    || Object.entries(REGIONAL_MEDIA_SOURCES).find(([,sources])=>sources.some(source=>source.url===url))?.[0] || '湖北省';
  return {url,html:`<title>${name}人民政府</title>${Array.from({length:6},(_,i)=>anchor(i+1,'policy',name)+anchor(i+101,'news',name)).join('')}`};
}});
const q={region:'北京市',province:'北京市',level:'province'};
const first=await Promise.all(Array.from({length:15},()=>service.get(q)));
assert.equal(requests,3,'15 concurrent callers share one government and two media requests');
assert.ok(first.every(result=>result===first[0]),'same in-flight result');assert.equal(first[0].policies.length,6);assert.ok(first[0].news.length>=6);
assert.equal(Object.keys(REGIONAL_MEDIA_SOURCES).length,34);
for(const region of Object.keys(REGIONAL_GOVERNMENT_PORTALS)){const result=await service.get({region,province:region,level:'province'});assert.ok(result.policies.length>=6&&result.news.length>=6,`${region}: shared national collector`);}
assert.ok(peak<=4,'bounded network concurrency');
fail=true;clock+=601_000;
assert.equal((await service.get(q)).sourceStatus,'cached','failed refresh retains bounded last-good data');
clock+=31*60_000;assert.equal((await service.get(q)).sourceStatus,'unavailable','expired data is not silently renewed');
await assert.rejects(service.get({...q,region:'../other'}));

const city=createChinaRegionalFeedService({now:()=>now,search:async()=>'<a href="https://www.henan.gov.cn/">南阳市人民政府</a><a href="https://www.nanyang.gov.cn/">南阳市人民政府</a>',fetchPage:async url=>({url,html:`<title>${url.includes('nanyang')?'南阳市人民政府':'河南省人民政府'}</title>${Array.from({length:6},(_,i)=>anchor(i,'policy','南阳市')+anchor(i+100,'news','南阳市')).join('')}`})});
const cityResult=await city.get({region:'南阳市',province:'河南省',level:'city'});
assert.equal(cityResult.portalUrl,'https://www.nanyang.gov.cn/');assert.equal(cityResult.policies.length,6);
assert.ok(cityResult.news.every(item=>new URL(item.url).hostname!=='www.henan.gov.cn'),'never label parent-government news as city news');

const source=REGIONAL_MEDIA_SOURCES['陕西省'][0], query={region:'陕西省',province:'陕西省',level:'province'};
for(const url of ['https://news.cnwest.com.attacker.test/','http://127.0.0.1/','http://news.cnwest.com:8080/','https://user:pass@news.cnwest.com/','https://random-blog.example/'])assert.throws(()=>regionalNewsSourceUrl(url));
assert.equal(regionalNewsSourceUrl('https://www.gx.chinanews.com/2026-09-13/detail-1.shtml').hostname,'www.gx.chinanews.com');
const sampleMedia={url:source.url,html:`<a href="/2026/2026-09-12/12345678.html"><h2>西安市新开通地铁线路方便市民出行</h2><p>忽略摘要与作者 2026-09-12</p></a><a href="/2026/09-12/12345679.html">北京市重大产业项目开工建设</a>`};
const media=parseRegionalMediaArticles(query,source,sampleMedia);
assert.match(decodeRegionalPage(Buffer.from('<meta charset="utf-8">广西新闻网<script charset="gb2312"></script>')),/广西新闻网/,'script encoding never overrides document encoding');
assert.equal(decodeRegionalPage(Buffer.from([0xd6,0xd0,0xb9,0xfa]),'text/html; charset=gb2312'),'中国');
assert.equal(media.length,1);assert.equal(media[0].title,'西安市新开通地铁线路方便市民出行');assert.equal(media[0].publishedAt,'2026-09-12');assert.equal(media[0].category,'民生');
assert.equal(parseRegionalMediaArticles({...query,region:'安康市',level:'city'},source,sampleMedia).length,0);
assert.equal(matchesRegionalNews('鼓楼区开展便民义诊活动',{province:'江苏省',region:'鼓楼区',level:'county',adcode:'320106'},REGIONAL_MEDIA_SOURCES['江苏省'][0]),false,'same-province homonymous counties require city evidence');
assert.equal(matchesRegionalNews('南京鼓楼区开展便民义诊活动',{province:'江苏省',region:'鼓楼区',level:'county',adcode:'320106'},REGIONAL_MEDIA_SOURCES['江苏省'][0]),true);
assert.equal(matchesRegionalNews('安康市重大项目开工',{province:'陕西省',region:'长安区',level:'county',adcode:'610116'},source),false);
const diverse=['陕西省省委召开工作会议','西安地铁新线路开通方便市民出行','陕西企业投资项目开工建设','陕西文旅美食节吸引游客','陕西博物馆走红登上热搜','陕西警方公布案件调查进展','陕西启动暴雨红色应急响应'].map((title,i)=>({...media[0],id:String(i),url:`${source.url}2026/09-12/${i}.html`,title,category:regionalNewsCategory(title)}));
const selected=rankDiverseRegionalNews(diverse,now);
assert.equal(selected[0].id,'6','emergencies precede all other categories');
assert.equal(new Set(selected.slice(0,6).map(item=>item.category)).size,5);
assert.ok(!selected.slice(0,6).some(item=>item.category==='政务'),'routine meetings do not monopolize first screen');
assert.equal(rankDiverseRegionalNews([{...media[0],publishedAt:undefined}],now).length,0,'undated media is not passed off as recent');
assert.equal(rankDiverseRegionalNews([{...media[0],publishedAt:'2020-01-01'}],now).length,0);
const independent=createChinaRegionalFeedService({now:()=>now,fetchPage:async url=>{
  if(url.includes('.gov.'))throw Error('government offline');
  return {url,html:Array.from({length:6},(_,i)=>`<a href="/2026/09-12/${12345678+i}.html">陕西文旅市场发展项目第${i+1}次报告</a>`).join('')};
}});
const independentResult=await independent.get(query);
assert.equal(independentResult.policies.length,0);assert.equal(independentResult.news.length,6,'government failure does not block media');
assert.ok(independentResult.news.every(item=>item.sourceKind==='media'));
console.log('Regional feed: 34-region fixtures, exact city/county identity, 6+6, diverse media, source independence, dates, parsing, ranking, cache/coalescing, timeout regression and safe links passed.');
