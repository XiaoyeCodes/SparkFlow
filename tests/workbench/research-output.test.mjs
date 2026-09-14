import test from 'node:test';
import assert from 'node:assert/strict';
import { flexibleResearchOutput } from '../../server/ibkrResearchOutput.ts';
import { reportMarkdown } from '../../src/lib/ibkr/workbenchReport.ts';
import { researchDigest, sortedResearchCalendar } from '../../src/lib/ibkr/researchPresentation.ts';
import { ACCOUNT_RESEARCH_INSTRUCTIONS } from '../../server/ibkrResearchPrompt.ts';

test('editorial sections stay optional and the overview extracts only summary and explicit risk',()=>{
 const result=output({fullSummary:'现金0.58%，关注流动性。',riskSummary:'今日整体风险关注度：高——现金不足。',preMarketNews:['新闻一','新闻二'],industryRotation:'金融轮动',aiDevelopments:'AI进展',keyIssues:'需要解决的问题',briefPoints:Array.from({length:7},(_,i)=>'重点'+i)});
 assert.equal(result.briefPoints.length,7);assert.match(result.preMarketNews,/新闻一/);assert.equal(result.keyIssues,'需要解决的问题');
 assert.equal(researchDigest(result).summary,'现金0.58%，关注流动性。');assert.equal(researchDigest(result).level,'high');
 assert.equal(researchDigest(output({headline:'集中度需关注',brief:'旧版简报'})).level,'unknown');
 const raw=flexibleResearchOutput({text:'## 全文总结\n\n**现金** 0.58%。\n\n## 账户信息\n今日整体风险关注度：中——等待财报。\n\n## 总结\n其他内容'},[],[]);
 assert.equal(researchDigest(raw).summary,'**现金** 0.58%。');assert.equal(researchDigest(raw).level,'medium');
 for(const word of ['全文总结','账户信息','持仓解析','盘前新闻','行业轮动','AI发展进展','不是硬性格式约束'])assert.ok(ACCOUNT_RESEARCH_INSTRUCTIONS.includes(word));
});

test('calendar order and export follow the editorial outline without altering the input',()=>{
 const calendar=[{date:'待确认',event:'未知时间',symbols:[]},{date:'2026-09-24',event:'较晚事件',symbols:[]},{date:'2026年9月18日 10:00',event:'较早事件',symbols:[]}];
 assert.deepEqual(sortedResearchCalendar(calendar).map(e=>e.event),['较早事件','较晚事件','未知时间']);assert.equal(calendar[0].date,'待确认');
 const content=output({fullSummary:'开篇总结',riskSummary:'今日整体风险关注度：低——配置分散。',preMarketNews:'盘前关注内容',industryRotation:'轮动内容',aiDevelopments:'AI内容',keyIssues:'解决问题内容',calendar});
 const md=reportMarkdown({content,evidence,version:2,generatedAt:'2026-09-14',snapshot:{positions:[]}});
 const headings=['## 全文总结','## 账户信息','## 持仓解析','## 盘前新闻','## 总结'];
 headings.slice(1).forEach((h,i)=>assert.ok(md.indexOf(h)>md.indexOf(headings[i])));
 assert.ok(md.indexOf('较早事件')<md.indexOf('较晚事件'));assert.match(md,/解决问题内容/);
});

const evidence = [{ id:'E37',symbols:['SCHD'],read:true,content:'The fund seeks to track the performance of a dividend index.',url:'https://example.com',title:'Fund',source:'fixture' }];
const output = raw => flexibleResearchOutput({text:JSON.stringify(raw)},['SCHD'],evidence);
test('paraphrased citations publish with a warning, not a fake original quote',()=>{
 const result=output({holdings:[{symbol:'SCHD',fact:'基金跟踪股息指数。',support:[{evidenceId:'E37',quote:'基金以股息指数为跟踪目标。'}]}]});
 assert.equal(result.holdings[0].support[0].verified,false);assert.match(result.validationWarnings.join(' '),/逐字匹配/);assert.deepEqual(result.holdings[0].evidenceIds,['E37']);
 const quote=output({holdings:[{symbol:'SCHD',support:[{evidenceId:'E37',quote:'The fund seeks to track the performance of a dividend index.'}]}]});
 assert.equal(quote.holdings[0].support[0].verified,true);
});
test('missing sections, long prose, extra keys and arbitrary counts are preserved',()=>{
 const result=output({headline:'长标题'.repeat(60),briefPoints:['只有一件重点'],holdings:Array.from({length:8},(_,i)=>({symbol:'SCHD',background:'长文'.repeat(3000),other:'补充判断'+i})),scenarios:[{name:'流动性冲击',response:'保留现金'}],customSection:{观点:'自定义章节'}});
 assert.equal(result.briefPoints.length,1);assert.equal(result.holdings.length,8);assert.equal(result.holdings[0].background.length,6000);assert.equal(result.scenarios[0].name,'流动性冲击');
 assert.ok(result.additionalSections.some(s=>s.content.includes('自定义章节')));assert.deepEqual(result.actions,[]);assert.equal(result.accountSummary,'');
});
test('unknown evidence and symbol never become verified citations or executable plan items',()=>{
 const result=output({holdings:[{symbol:'OTHER',support:[{evidenceId:'E404',quote:'Claims doubled revenue'}],evidenceIds:['E404']}],actions:[{symbol:'OTHER',action:'increase',targetWeight:.5},{symbol:'SCHD',action:'purchase now',targetWeight:'50%'}]});
 assert.equal(result.holdings[0].support[0].verified,false);assert.deepEqual(result.holdings[0].evidenceIds,[]);assert.equal(result.actions.length,1);assert.equal(result.actions[0].action,'watch');assert.equal(result.actions[0].targetWeight,null);assert.ok(result.additionalSections.length>=2);
});
test('partial text and truncated JSON stay readable; genuinely empty output still fails',()=>{
 for(const text of ['## 分析\n\n现金与波动风险需要关注。','{"headline":"分析","holdings":[']){
  const result=flexibleResearchOutput({text,finishReason:'length'},[],[]);assert.equal(result.rawContent,text);assert.match(result.validationWarnings.join(' '),/截断/);
 }
 assert.throws(()=>flexibleResearchOutput({text:' '},[],[]),/EMPTY/);assert.throws(()=>output({}),/EMPTY/);
});
test('exports retain warnings and do not render a paraphrase as a direct quotation',()=>{
 const content=output({briefPoints:['两项之一','两项之二'],holdings:[{symbol:'SCHD',support:[{evidenceId:'E37',quote:'待核查概括'}]}],extra:'附加分析'});
 const markdown=reportMarkdown({content,evidence,version:2,generatedAt:'2026-09-14',snapshot:{positions:[]}});
 assert.match(markdown,/内容核查提示/);assert.match(markdown,/模型概括（未逐字核实）：待核查概括/);assert.doesNotMatch(markdown,/> 待核查概括/);assert.match(markdown,/附加分析/);
});
