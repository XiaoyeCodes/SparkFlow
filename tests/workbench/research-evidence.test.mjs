import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceExcerpt } from '../../server/ibkrResearchEvidence.ts';
import { editorialResearchContent } from '../../src/lib/ibkr/researchPresentation.ts';
import { flexibleResearchOutput } from '../../server/ibkrResearchOutput.ts';
import { relevantOriginal } from '../../server/ibkrResearch.ts';

test('evidence budget selects latest prices and never cuts a JSON record',()=>{
 const rows=Array.from({length:65},(_,i)=>({date:new Date(Date.UTC(2026,6,i+1)).toISOString().slice(0,10),close:100+i}));
 const value=JSON.parse(evidenceExcerpt(JSON.stringify({source:'fixture',rows}),600));
 assert.equal(value.rows[0].close,164);assert.ok(value.rows.length>=2);assert.ok(JSON.stringify(value).length<=600);
});
test('macro budget preserves every series instead of deleting entire indicators',()=>{
 const series=Array.from({length:7},(_,i)=>({series:'S'+i,rows:Array.from({length:14},(_,d)=>({date:`2026-08-${String(d+1).padStart(2,'0')}`,value:d}))}));
 const selected=JSON.parse(evidenceExcerpt(JSON.stringify({series}),1400));
 assert.equal(selected.series.length,7);selected.series.forEach(s=>assert.equal(s.rows[0].value,13));
});
test('note aliases become holding prose and empty/scalar cards disappear in old and new reports',()=>{
 const c=flexibleResearchOutput({text:JSON.stringify({reviewedSymbols:['SCHD','AMD'],holdings:[{symbol:'SCHD',weight:.22,type:'ETF',note:'现金流策略需要关注费率。'},{symbol:'AMD',weight:.1,type:'EQUITY'}]})},['SCHD','AMD'],[]);
 assert.equal(c.holdings.length,1);assert.match(c.holdings[0].background,/现金流/);assert.equal(c.additionalSections.length,0);
 const old={...c,holdings:[{...c.holdings[0],background:''},{symbol:'AMD',support:[]}],additionalSections:[{title:'SCHD · weight',content:'0.22'},{title:'SCHD · type',content:'ETF'},{title:'SCHD · note',content:'基金费率0.06%。'}]};
 const view=editorialResearchContent(old);assert.equal(view.holdings.length,1);assert.match(view.holdings[0].background,/0.06%/);assert.equal(view.additionalSections.length,0);assert.equal(old.holdings[0].background,'');
});
test('issuer originals and share class names match without accepting unrelated fund pages',()=>{
 assert.equal(relevantOriginal('BRK B',undefined,'Berkshire Hathaway','Quarterly results and financial statements','https://www.berkshirehathaway.com/reports'),true);
 assert.equal(relevantOriginal('TSM',undefined,'TSMC quarterly results','Revenue and earnings increased','https://pr.tsmc.com/english/news'),true);
 assert.equal(relevantOriginal('SCHD',undefined,'Other fund','An unrelated investment fund','https://www.schwab.com/other-fund'),false);
 assert.equal(relevantOriginal('',undefined,'AI investment','Artificial intelligence semiconductor announcements','https://example.com'),true);
});
test('explicit inline citations in narrative aliases prevent false missing-source warnings',()=>{
 const result=flexibleResearchOutput({text:JSON.stringify({reviewedSymbols:['SCHD'],holdings:[{symbol:'SCHD',note:'基金费率和配置需要复核（E42）'}]})},['SCHD'],[{id:'E42',symbols:['SCHD'],read:true,content:'ETF report'}]);
 assert.deepEqual(result.holdings[0].evidenceIds,['E42']);assert.ok(!result.validationWarnings.some(w=>w.includes('缺少可核查来源')));
});
