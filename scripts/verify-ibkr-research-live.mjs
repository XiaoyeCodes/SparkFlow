// Opt-in public-source / synthetic-account smoke test. Never reads a broker account.
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const directory=path.resolve('tmp/research-live');await mkdir(directory,{recursive:true});
const bundle=path.join(directory,'runtime.mjs');
await build({stdin:{contents:`export {createIbkrAi} from './server/ibkrAi.ts'; export {createResearch,runResearch} from './server/ibkrResearch.ts'; export {normalizeMcpSnapshot} from './server/ibkrMcp.ts'; export {defaults} from './server/ibkrWorkbenchCore.ts';`,resolveDir:process.cwd()},outfile:bundle,bundle:true,packages:'external',platform:'node',format:'esm'});
const {createIbkrAi,createResearch,runResearch,normalizeMcpSnapshot,defaults}=await import(pathToFileURL(bundle).href);
const ai=createIbkrAi(process.cwd());
const symbols=['AAPL','TSM','BRK B','SCHD'];
const controller=new AbortController();
const timeout=setTimeout(()=>controller.abort(),15*60*1000);
const results=[];
try{
 for(const symbol of symbols){
  for(const capability of ['profile','prices',symbol==='SCHD'?'fund':'financials']){
   try{
    const result=await ai.tool(capability,{symbol},controller.signal);
    const periods=Object.values(result.data||{})[0]?.periods||[];
    const row={symbol,capability,ok:true,source:result.source,latest:result.latestDate||periods[0]?.REPORT_DATE||null,records:(periods.length||result.rows?.length||result.topHoldings?.length||0),cached:!!result.cached};
    results.push(row);console.log(JSON.stringify(row));
   }catch(error){results.push({symbol,capability,ok:false,error:error.message});console.log(JSON.stringify(results.at(-1)));}
  }
 }
 const macro=await ai.tool('macro',{},controller.signal);
 console.log(JSON.stringify({macroSeries:macro.series.map(s=>({series:s.series,latest:s.rows.at(-1)?.date})),unavailable:macro.unavailable}));
 if(process.argv.includes('--model')){
  const model=await ai.status();if(!model.configured)throw new Error('MODEL_NOT_CONFIGURED');
  const snapshot=normalizeMcpSnapshot('SYNTHETIC-PUBLIC-TEST',symbols.map((symbol,i)=>({conId:i+1,symbol,quantity:1,averageCost:100,marketValue:2000,currency:'USD',assetType:'STK'})),{baseCurrency:'USD',netLiquidation:10000,cash:[{currency:'USD',amount:2000}]});
  const checkpoint=createResearch(snapshot,defaults,[],model,true,[], '这是合成测试账户，账户数值不是实际持仓。请结合取得的资料完成分析。');
  let calls=0,last='';
  const content=await runResearch(checkpoint,{
   tool:(name,args,signal)=>ai.tool(name,args,signal),
   model:(prompt,signal)=>{console.log(JSON.stringify({modelInputCharacters:prompt.length}));return ai.analyze(prompt,model,signal);},
   reserve:async()=>{if(++calls>1)throw new Error('ONE_MODEL_CALL_ONLY');},
   save:async()=>{const progress=checkpoint.progress;if(progress.stage!==last){last=progress.stage;console.log(JSON.stringify({stage:last,sources:progress.sources}));}},
  },controller.signal);
  await writeFile(path.join(directory,'synthetic-analysis.json'),JSON.stringify({content,evidence:checkpoint.evidence,progress:checkpoint.progress},null,2));
  console.log(JSON.stringify({analysisComplete:checkpoint.progress.complete,modelCalls:calls,sources:checkpoint.evidence.length,summary:content.fullSummary,risk:content.riskSummary,warnings:content.validationWarnings?.length,gaps:content.gaps.length}));
 }
 await writeFile(path.join(directory,'source-checks.json'),JSON.stringify(results,null,2));
 if(results.some(r=>!r.ok))process.exitCode=1;
}catch(error){console.error(error.message);process.exitCode=1;}
finally{clearTimeout(timeout);ai.close();}
