import test from 'node:test';
import assert from 'node:assert/strict';
import {createResearch,runResearch,parseResearchSection,holdingSection,summarySection,portfolioSection,relevantOriginal,structuredFinancialQuote} from '../../server/ibkrResearch.ts';
import {normalizeMcpSnapshot} from '../../server/ibkrMcp.ts';
import {defaults} from '../../server/ibkrWorkbenchCore.ts';
import {normalizePerformance,comparePerformance,simulatePlan,portfolioMetrics,planSchema} from '../../server/ibkrPortfolio.ts';
import {quantity} from '../../src/lib/ibkr/workbenchFormat.ts';
import {reportHtml} from '../../server/ibkrWorkbench.ts';

const model={provider:'fixture',model:'offline',fingerprint:'fixture',configured:true};
const snapshot=()=>normalizeMcpSnapshot('FIXTURE',[{conId:1,symbol:'AAPL',quantity:.003,averageCost:100,marketValue:300,currency:'USD',assetType:'STK'},{conId:2,symbol:'SPY',quantity:.002,averageCost:100,marketValue:400,currency:'USD',assetType:'STK'}],{baseCurrency:'USD',netLiquidation:1000,cash:[{currency:'USD',amount:300}]});
const sentence='Company announced a new product launch; demand guidance remains uncertain.';
function makeHolding(c,symbol){const e=c.evidence.find(e=>e.symbols.includes(symbol));return {symbol,background:'公司主营仍需持续跟踪',fact:'公告确认推出新产品。',impact:'需求变化可能影响收入，但不能假定收入必然增加。',counterEvidence:'公告没有确认订单规模。',shortTerm:'等待订单或销量数据。',longTerm:'持续观察利润兑现。',invalidation:'订单或利润率持续低于公告预期则重审。',support:e?[{evidenceId:e.id,quote:sentence}]:[],evidenceIds:e?[e.id]:[]};}
function summary(c){return {headline:'新品提供观察线索，订单兑现仍需核验',briefPoints:['持仓风险来自集中配置，应核对现金约束。','AAPL 公告确认推出新品，订单增长尚未证实。','等待订单兑现；若利润率恶化，应重新评估。'],accountSummary:'配置集中',portfolioRisk:'以程序指标为准',benchmarkComparison:'基准资料不足，不能计算超额收益。',marketContext:'近期公告不等于收益增长',opportunities:['订单兑现后再评估'],risks:['利润兑现低于预期'],scenarios:[{name:'base',assumptions:'需求维持',accountImpact:'组合震荡',response:'保持观察'},{name:'upside',assumptions:'订单改善',accountImpact:'权益仓受益',response:'确认后再平衡'},{name:'downside',assumptions:'利润率恶化',accountImpact:'集中风险放大',response:'触发减仓复核'}],targetAllocation:'保留现金缓冲并控制集中度。',monitoring:[{indicator:'利润率',warningLine:'连续恶化',action:'重新评估'}],evidenceIds:c.evidence.slice(0,1).map(e=>e.id),gaps:[],limitations:['缺少长期历史'],disclaimer:'仅供研究，不构成投资建议。'};}
const checkpoint=()=>createResearch(snapshot(),defaults,[],model,true,[]);
function io(c,overrides={}){return {tool:async(name,args)=>name==='search'?{results:[{url:`https://investors.example.com/${args.query.startsWith('AAPL')?'aapl':'spy'}`,title:'公告'}]}:name==='read'?{content:sentence.repeat(4),title:'公司公告'}:{url:`https://finance.yahoo.com/quote/${args.symbol}/profile/`,description:sentence,sector:'Technology',instrumentType:args.symbol==='SPY'?'ETF':'EQUITY',data:{[`${args.symbol}.US`]:{periods:[{period:'2026-06',statement:sentence}]}}},model:async(prompt)=>{const input=JSON.parse(prompt.split('\n').find(line=>line.startsWith('{\"date\"')));const view={...c,evidence:input.evidence};return {text:JSON.stringify({...summary(view),reviewedSymbols:input.symbols,holdings:input.symbols.slice(0,2).map(s=>makeHolding(view,s)),actions:[]}),finishReason:'stop'};},save:async()=>{},reserve:async()=>{},...overrides};}
test('tiny fractional holdings never round to zero and use at most eight decimals',()=>{assert.equal(quantity('0.0030045'),'0.0030045');assert.equal(quantity(.000000001),'<0.00000001');assert.equal(quantity(null),'—');assert.equal(quantity(1234.00002),'1,234.00002');});
test('combined plan conserves cash and prevents stacked recommendations from exceeding cash',()=>{const s=snapshot();const steps=[{conId:1,targetWeight:.6},{conId:2,targetWeight:.6}];assert.throws(()=>simulatePlan(s,steps,null),/现金/);const v=simulatePlan(s,[{conId:1,targetWeight:.2},{conId:2,targetWeight:.5}],.2,-.1);assert.ok(Math.abs(v.cashAfter-300)<1e-7);assert.ok(Math.abs(v.scenarioPnl+70)<1e-7);assert.equal(v.rows[0].deltaValue,-99.99999999999997);assert.equal(v.rows.some(r=>'shares'in r),false);assert.throws(()=>simulatePlan(s,[{conId:1,targetWeight:-.1}],null));assert.throws(()=>simulatePlan(s,[{conId:1,targetWeight:.2},{conId:1,targetWeight:.3}],null),/重复/);assert.throws(()=>simulatePlan(s,[{conId:555,targetWeight:0}],null));});
test('ETF classifications stay separate without inventing constituent exposure',()=>{const s=snapshot();s.positions[0].sector='Technology';s.positions[1].instrumentType='ETF';const m=portfolioMetrics(s);assert.equal(m.sectors.find(s=>s.name==='Technology').weight,.3);assert.equal(m.sectors.find(s=>s.name.startsWith('ETF')).weight,.4);});
test('PA validates scope, uses true NAV array rather than start_nav and limits MWR comparison',()=>{const raw={portfolio_measure:'TWR',accounts:{account:{base_currency:'USD',periods:{'1Y':{start_nav:0,nav:[100,150],cps:[0,.01],dates:['20260903','20260904']}}}}};const h=normalizePerformance(raw,'cumulative returns expressed as fractions','USD');assert.equal(h.points[0].nav,100);const v=comparePerformance(h,[{date:'2026-09-03',close:100},{date:'2026-09-04',close:102}],'SPY');assert.ok(Math.abs(v.excessReturn+.01)<1e-7);assert.equal(v.volatilityRatio,null);assert.equal(comparePerformance({...h,returnMethod:'MWR'},[{date:'2026-09-03',close:100},{date:'2026-09-04',close:102}],'SPY').excessReturn,null);assert.throws(()=>normalizePerformance({...raw,accounts:{...raw.accounts,other:raw.accounts.account}},'fractions','USD'));assert.throws(()=>normalizePerformance(raw,'fractions','EUR'));});
test('output errors distinguish truncation, malformed JSON, fields and fabricated original citations',()=>{assert.throws(()=>parseResearchSection({text:'{}',finishReason:'length'},holdingSection,[],[]),/TRUNCATED/);assert.throws(()=>parseResearchSection({text:'{"holdings":['},holdingSection,[],[]),/JSON/);assert.throws(()=>parseResearchSection({text:'{}'},holdingSection,[],[]),/FIELDS/);const c=checkpoint();c.evidence=[{id:'e',symbols:['AAPL'],read:true,content:sentence}];const h=makeHolding(c,'AAPL');h.support[0].quote='The company doubled its earnings.';assert.throws(()=>parseResearchSection({text:JSON.stringify({holdings:[h],actions:[],gaps:[]})},holdingSection,['AAPL'],c.evidence),/EVIDENCE/);});

test('account-only QQQ holding does not require unrelated web citations',()=>{
 const c=checkpoint();c.evidence=[{id:'E1',symbols:['QQQ'],read:true,content:'Investor relations page for a different company.'}];
 const h={...makeHolding(c,'QQQ'),basis:'account',fact:'账户中该持仓占比需要结合现金复核。',support:[],evidenceIds:[]};
 const result=()=>({text:JSON.stringify({holdings:[h],actions:[],gaps:[]})});
 assert.equal(parseResearchSection(result(),holdingSection,['QQQ'],c.evidence).holdings.length,1);
 h.basis='external';assert.throws(()=>parseResearchSection(result(),holdingSection,['QQQ'],c.evidence),/QQQ 外部事实缺少原文摘录/);
 h.evidenceIds=['E404'];h.support=[{evidenceId:'E404',quote:sentence}];assert.throws(()=>parseResearchSection(result(),holdingSection,['QQQ'],c.evidence),/EVIDENCE/);
});

test('empty provider content is distinct from malformed JSON and truncation',()=>{
 assert.throws(()=>parseResearchSection({text:' ',finishReason:'stop'},portfolioSection,[],[]),/OUTPUT_EMPTY/);
 assert.throws(()=>parseResearchSection({text:'',finishReason:'length'},portfolioSection,[],[]),/OUTPUT_TRUNCATED/);
 assert.throws(()=>parseResearchSection({text:'{"headline":',finishReason:'stop'},portfolioSection,[],[]),/OUTPUT_JSON/);
});

test('financial field citations resolve to one original record without combining periods or changing values',()=>{
 const row={REPORT_DATE:'2026-06-27',FISCAL_YEAR:2026,FISCAL_PERIOD:'Q3',FORM:'10-Q',Revenue:100,NetIncome:20};
 const source=JSON.stringify({periods:[row,{REPORT_DATE:'2026-03-28',Revenue:90,NetIncome:30}]});
 assert.equal(structuredFinancialQuote('REPORT_DATE\\":\\"2026-06-27\\"，\\"Revenue\\":100，\\"NetIncome\\":20',source),JSON.stringify(row));
 assert.equal(structuredFinancialQuote('"REPORT_DATE":"2026-06-27","Revenue":100,"NetIncome":30',source),null);
 assert.equal(structuredFinancialQuote('"REPORT_DATE":"2026-06-27","Revenue":101',source),null);
 assert.equal(structuredFinancialQuote('"Revenue":100',source),null);
 assert.equal(structuredFinancialQuote('"REPORT_DATE":"2026-06-27","Revenue":100',source.slice(0,60)),null);
});

test('search association requires the company and financial context in the original',()=>{
 assert.equal(relevantOriginal('QQQ',undefined,'TMX Investor Relations','Quarterly revenue rose.','https://tmx.com/investors'),false);
 assert.equal(relevantOriginal('TSLA',undefined,'Truck traffic bans','September traffic calendar','https://trafficban.com/2026'),false);
 assert.equal(relevantOriginal('QQQ',undefined,'QQQ overseas reactions','Gaming discussions','https://example.com/qqq'),false);
 assert.equal(relevantOriginal('QQQ',undefined,'Invesco QQQ ETF','Fund investment objectives','https://invesco.com/qqq'),true);
});
test('research reads original sources, preserves event mechanism and verifies all holdings',async()=>{const c=checkpoint();let calls=0;const content=await runResearch(c,io(c,{reserve:async()=>{calls++;}}),new AbortController().signal);assert.equal(calls,1);assert.equal(c.progress.complete,true);assert.equal(content.briefPoints.length,3);assert.equal(content.holdings.length,2);assert.match(content.holdings[0].invalidation,/利润率/);assert.ok(c.evidence.every(e=>e.read&&e.fetchedAt&&e.url));assert.ok(c.progress.trace.some(t=>t.tool==='read'));});
test('invalid portfolio output is not repaired with a second model call',async()=>{const c=checkpoint();let reserved=0,calls=0;await assert.rejects(()=>runResearch(c,io(c,{reserve:async()=>{reserved++;},model:async()=>{calls++;return {text:'bad json',finishReason:'stop'};}}),new AbortController().signal),/OUTPUT_JSON/);assert.equal(reserved,1);assert.equal(calls,1);assert.equal(c.progress.modelCalls,1);assert.equal(c.progress.maxCalls,1);assert.ok(c.failures.portfolio);const original=c.progress.searches;await assert.rejects(()=>runResearch(c,io(c,{reserve:async()=>{reserved++;}}),new AbortController().signal),/BUDGET/);assert.equal(reserved,1);assert.equal(c.progress.searches,original);assert.deepEqual(Object.keys(c.sections),[]);});

test('all twelve holdings reach one CIO portfolio call without twelve individual writeups',async()=>{const c=checkpoint();for(let i=3;i<=12;i++){c.snapshot.positions.push({...c.snapshot.positions[0],conId:i,symbol:`STK${i}`});c.targets.push(`STK${i}`);}c.snapshot.positions.forEach(h=>h.accountKey='PRIVATE_ACCOUNT');let calls=0;const base=io(c);const report=await runResearch(c,io(c,{model:async prompt=>{calls++;assert.ok(!prompt.includes('PRIVATE_ACCOUNT'));assert.match(prompt,/20年以上/);assert.match(prompt,/只进行一次综合推理/);assert.match(prompt,/完整的 Interactive Brokers 账户快照/);assert.match(prompt,/基准、乐观、悲观/);for(const s of c.targets)assert.ok(prompt.includes(s));return base.model(prompt);}}),new AbortController().signal);assert.equal(calls,1);assert.equal(c.progress.maxCalls,1);assert.equal(report.holdings.length,2);assert.equal(report.scenarios.length,3);assert.equal(c.progress.covered.length,12);assert.ok(report.holdings.every(h=>h.evidenceIds.every(id=>c.evidence.some(e=>e.id===id))));});

test('old holding checkpoint migrates to portfolio synthesis and does not repeat completed calls',async()=>{const c=checkpoint();await runResearch(c,io(c),new AbortController().signal);c.sections={'holdings:0':{holdings:[],actions:[],gaps:[]}};delete c.progress.strategy;c.progress.complete=false;c.progress.modelCalls=9;c.failures={summary:{code:'OUTPUT_EVIDENCE',text:'invalid old summary'}};let calls=0;await runResearch(c,io(c,{tool:async()=>{throw new Error('should reuse');},reserve:async()=>{calls++;}}),new AbortController().signal);assert.equal(calls,1);assert.equal(c.progress.modelCalls,10);assert.ok(c.sections.portfolio);assert.equal(c.progress.strategy,'portfolio');});

test('source outage never fabricates news and cancellation preserves collected evidence',async()=>{const c=checkpoint();const content=await runResearch(c,io(c,{tool:async()=>{throw new Error('offline');}}),new AbortController().signal);assert.equal(c.evidence.length,0);assert.ok(content.gaps.some(g=>g.includes('来源暂不可用')));const d=checkpoint(),controller=new AbortController();await assert.rejects(()=>runResearch(d,io(d,{save:async()=>{if(d.evidence.length)controller.abort();}}),controller.signal),/CANCELLED/);assert.ok(d.evidence.length);});
test('tool concurrency is bounded to three before the single model call',async()=>{const c=checkpoint();for(let i=3;i<=8;i++){c.snapshot.positions.push({...c.snapshot.positions[0],conId:i,symbol:`STK${i}`});c.targets.push(`STK${i}`);}let running=0,max=0;const base=io(c);await assert.rejects(()=>runResearch(c,io(c,{tool:async(name,args)=>{running++;max=Math.max(max,running);await new Promise(r=>setTimeout(r,1));const v=await base.tool(name,args);running--;return v;},reserve:async()=>{throw new Error('RESEARCH_BUDGET');}}),new AbortController().signal),/BUDGET/);assert.ok(max<=3);assert.equal(c.progress.modelCalls,0);});
test('downloaded HTML escapes source markup and keeps readable sections',()=>{const html=reportHtml('# Report\n\n## Evidence\n\n<script>alert(1)</script>\n\n[Source](https://example.com)');assert.ok(!html.includes('<script>'));assert.match(html,/<h2>Evidence<\/h2>/);assert.match(html,/href="https:\/\/example.com"/);});


test('volatility ratio requires sixty common daily returns and ignores unmatched benchmark dates',()=>{
 const points=[],bm=[];for(let i=0;i<61;i++){const date=new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10);points.push({date,nav:100,cumulativeReturn:(1.001+(i%2)*.0001)**i-1});bm.push({date,close:100*(1.001+(i%2)*.0002)**i});}
 const history={points,source:'fixture',currency:'USD',returnMethod:'TWR',benchmark:'SPY',fetchedAt:null,note:''};assert.equal(comparePerformance({...history,points:points.slice(0,60)},bm,'SPY').volatilityRatio,null);assert.ok(Number.isFinite(comparePerformance(history,bm,'SPY').volatilityRatio));assert.equal(comparePerformance(history,bm.slice(1),'SPY').volatilityRatio,null);
});
test('research deadline stops before any further model reservation',async()=>{
 const c=checkpoint(),original=Date.now;let clock=original(),reserved=0;Date.now=()=>clock;
 try{await assert.rejects(()=>runResearch(c,io(c,{tool:async()=>{clock+=1000000;throw new Error('source timeout');},reserve:async()=>{reserved++;}}),new AbortController().signal),/TIMEOUT/);assert.equal(reserved,0);}
 finally{Date.now=original;}
});
