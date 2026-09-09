import { z } from 'zod';
import type { AccountSnapshot, AdjustmentPlan, PlanImpact, PortfolioMetrics, PortfolioPerformance, PerformancePoint } from '../src/lib/ibkr/workbenchTypes.ts';
import { numeric, accountRisk } from './ibkrWorkbenchCore.ts';
export const planSchema = z.object({ id: z.string().uuid().optional(), title: z.string().min(1).max(120), reportId: z.string().uuid().optional(), alertId: z.string().optional(), status: z.enum(['watching', 'triggered', 'handled', 'invalidated']).default('watching'), steps: z.array(z.object({ conId: z.number().int().positive(), targetWeight: z.number().min(0).max(1), trigger: z.string().min(1).max(1000), exit: z.string().max(1000), batches: z.string().max(1000), priceCondition: z.object({ direction: z.enum(['above','below']), price: z.number().positive() }).strict().optional() }).strict()).min(1).max(200) }).strict();
export function portfolioMetrics(snapshot: AccountSnapshot, cashFloor: number | null = null, targetWeight: number | null = null): PortfolioMetrics {
 const risk = accountRisk(snapshot), nav = risk.nav; const sectors = new Map<string, number>(); let known = 0;
 for (const p of snapshot.positions) {
  if (!nav || nav <= 0 || p.currency !== snapshot.baseCurrency || numeric(p.marketValue) === null) continue;
  const name = p.instrumentType === 'ETF' ? 'ETF（不穿透）' : p.sector || '行业待核实';
  const weight = Math.abs(Number(p.marketValue)) / nav; sectors.set(name, (sectors.get(name) ?? 0) + weight); if (name !== '行业待核实') known += weight;
 }
 const reasons: string[] = []; const top = risk.weights.length ? Math.max(...risk.weights.map(w => w.weight ?? 0)) : null;
 const cash = nav && risk.cash !== null ? risk.cash / nav : null;
 if (top !== null && top > (targetWeight ?? .25)) reasons.push(`单标的最大权重 ${(top*100).toFixed(1)}%，超过${((targetWeight??.25)*100).toFixed(0)}% 观察线`);
 if (cash !== null && cash < (cashFloor ?? .1)) reasons.push(`现金占比 ${(cash*100).toFixed(1)}%，低于${((cashFloor??.1)*100).toFixed(0)}% 底线`);
 const marginHigh = Boolean(nav && risk.margin !== null && risk.margin / nav > .5);
 if (marginHigh) reasons.push('维持保证金超过净资产的 50%');
 if (risk.missingCurrencyConversion) reasons.push('部分币种尚未换算，组合指标不完整');
 return { investedWeight: nav && risk.gross !== null ? risk.gross/nav : null, cashWeight: cash, topWeight: top, riskLevel: !nav || risk.missingCurrencyConversion ? '数据不足' : marginHigh || reasons.length >= 2 ? '偏高' : reasons.length ? '需关注' : '未触发', reasons, sectors: [...sectors].map(([name,weight])=>({name,weight})).sort((a,b)=>b.weight-a.weight), sectorCoverage: known };
}
export function simulatePlan(snapshot: AccountSnapshot, steps: AdjustmentPlan['steps'], cashFloor: number | null, shock = -.1): PlanImpact {
 const risk=accountRisk(snapshot), nav=risk.nav;
 if(snapshot.positions.some(p=>Number(p.quantity)===0&&Number(p.marketValue)!==0))throw new Error('持仓数量与市值不一致，无法核实可卖数量');
 if(snapshot.positions.some(p=>numeric(p.quantity)===null||Number(p.quantity)<0||Number(p.marketValue)<0))throw new Error('含空头或数量缺失的组合暂不支持计划模拟');
 if (!nav || nav<=0 || risk.cash===null || risk.missingCurrencyConversion) throw new Error('需要完整的同币种净值、现金和持仓估值才能模拟');
 if (!Number.isFinite(shock) || shock < -1 || shock>1) throw new Error('情景涨跌幅应在 -100% 到 100% 之间');
 if (new Set(steps.map(s=>s.conId)).size!==steps.length) throw new Error('同一持仓不能在计划中重复设置目标');
 const targets=new Map(steps.map(s=>[s.conId,s]));
 for(const step of steps) {
  const p=snapshot.positions.find(p=>p.conId===step.conId);
  if(!p || p.assetType!=='STK' || p.currency!=='USD' || Number(p.quantity)<0) throw new Error('计划仅支持已持有的美股／ETF 多头仓位');
  if(!Number.isFinite(step.targetWeight)||step.targetWeight<0||step.targetWeight>1) throw new Error('目标仓位无效');
 }
 const rows=snapshot.positions.map(p=>{const before=Number(p.marketValue)/nav, after=targets.get(p.conId)?.targetWeight??before;return {conId:p.conId,symbol:p.symbol,before,after,deltaValue:(after-before)*nav};});
 const cashAfter=risk.cash-rows.reduce((n,r)=>n+r.deltaValue,0);
 if(cashAfter < -1e-8 || cashFloor!==null && cashAfter/nav<cashFloor-1e-8) throw new Error('整份计划超出可用现金或突破现金底线，请降低目标仓位');
 const sectors=new Map<string,{before:number;after:number}>();
 for(const r of rows){const p=snapshot.positions.find(p=>p.conId===r.conId)!;const name=p.instrumentType==='ETF'?'ETF（不穿透）':p.sector||'行业待核实';const v=sectors.get(name)??{before:0,after:0};v.before+=r.before;v.after+=r.after;sectors.set(name,v);}
 return {cashBefore:risk.cash,cashAfter:Math.max(0,cashAfter),investedBefore:risk.gross!/nav,investedAfter:rows.reduce((n,r)=>n+Math.abs(r.after),0),concentrationBefore:Math.max(0,...rows.map(r=>Math.abs(r.before))),concentrationAfter:Math.max(0,...rows.map(r=>Math.abs(r.after))),scenarioPnl:rows.reduce((n,r)=>n+r.after*nav*shock,0),rows,sectors:[...sectors].map(([name,v])=>({name,...v})),asOf:snapshot.asOf,assumptions:['按券商快照估值，所有目标作为同一份计划统一计算','不含手续费、滑点及税费；仅展示金额和权重，碎股交易精度未核实',`持仓价格统一变化 ${(shock*100).toFixed(1)}%，现金不变；这是情景假设，不是预测`]};
}
export function comparePerformance(history: PortfolioPerformance, benchmark: {date:string;close:number}[], name: string): PortfolioPerformance {
 const result={...history,benchmark:name,excessReturn:null as number|null,volatilityRatio:null as number|null,points:history.points.map(p=>({...p,benchmarkReturn:null as number|null}))};
 if(name==='none'||history.currency!=='USD'||history.returnMethod!=='TWR') return result;
 const bm=new Map(benchmark.filter(p=>p.close>0).map(p=>[p.date,p.close]));
 const aligned=result.points.filter(p=>p.cumulativeReturn!==null&&bm.has(p.date));
 if(aligned.length<2)return result;
 const base=aligned[0]; const basePrice=bm.get(base.date)!;
 for(const p of aligned)p.benchmarkReturn=bm.get(p.date)!/basePrice-1;
 const last=aligned.at(-1)!; result.excessReturn=(1+last.cumulativeReturn!)/(1+base.cumulativeReturn!)-1-last.benchmarkReturn!;
 if(aligned.length>=61){const a:number[]=[],b:number[]=[];for(let i=1;i<aligned.length;i++){a.push((1+aligned[i].cumulativeReturn!)/(1+aligned[i-1].cumulativeReturn!)-1);b.push(bm.get(aligned[i].date)!/bm.get(aligned[i-1].date)!-1);}const sd=(xs:number[])=>{const mean=xs.reduce((n,v)=>n+v,0)/xs.length;return Math.sqrt(xs.reduce((n,v)=>n+(v-mean)**2,0)/(xs.length-1));};if(sd(b)>0)result.volatilityRatio=sd(a)/sd(b);}
 return result;
}
export function normalizePerformance(raw:any, description:string, currency:string|null):PortfolioPerformance {
 const accounts=raw?.accounts; if(!accounts||Array.isArray(accounts)||Object.keys(accounts).length!==1)throw new Error('MCP_HISTORY_ACCOUNT_SCOPE');
 const account:any=Object.values(accounts)[0], period=account.periods?.['1Y'];
 if(account.base_currency!==currency||!period||!Array.isArray(period.dates)||period.dates.length!==period.nav?.length||period.dates.length!==period.cps?.length)throw new Error('MCP_HISTORY_SCHEMA');
 const method=['TWR','MWR'].includes(raw.portfolio_measure)&&/cumulative returns expressed as fractions/i.test(description)?raw.portfolio_measure:null;
 const points:PerformancePoint[]=period.dates.map((value:unknown,i:number)=>{
  const d=String(value),date=/^\d{8}$/.test(d)?`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`:d.slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||typeof period.nav[i]!=='number'||!Number.isFinite(period.nav[i])||typeof period.cps[i]!=='number'||!Number.isFinite(period.cps[i])||period.cps[i]<=-1)throw new Error('MCP_HISTORY_VALUE');
  return {date,nav:period.nav[i],cumulativeReturn:method?period.cps[i]:null};
 });
 if(new Set(points.map(p=>p.date)).size!==points.length)throw new Error('MCP_HISTORY_DUPLICATE_DATE');
 points.sort((a,b)=>a.date.localeCompare(b.date));
 // All-periods exposes at most 1Y. Only recognize inception when the broker's
 // zero-opening YTD and 1Y windows agree and begin AFTER the year boundary.
 // Matching short series or zero NAV alone cannot establish lifetime coverage.
 const dateOf=(value:unknown)=>{const d=String(value??'');const iso=/^\d{8}$/.test(d)?`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`:d;return /^\d{4}-\d{2}-\d{2}$/.test(iso)&&Number.isFinite(Date.parse(iso))&&new Date(iso).toISOString().slice(0,10)===iso?iso:null;};
 const start=dateOf(account.start), end=dateOf(account.end), baseline=dateOf(period.start_date), ytd=account.periods?.YTD;
 const complete=Boolean(start&&end&&baseline&&points.length&&start===points[0].date&&end===points.at(-1)!.date&&baseline<start&&baseline>=`${end.slice(0,4)}-01-01`&&period.start_nav===0&&ytd?.start_nav===0&&ytd.start_date===period.start_date&&JSON.stringify(ytd.dates)===JSON.stringify(period.dates)&&JSON.stringify(ytd.cps)===JSON.stringify(period.cps));
 const inception={value:complete&&method?points.at(-1)!.cumulativeReturn:null,start:complete?start:null,end:complete?end:null,note:complete&&method?`IBKR ${method==='TWR'?'时间加权':'资金加权'}累计回报 · 保留首日收益，非年化`:!method?'券商收益口径尚未核实':'当前接口未提供可核实的自始以来完整业绩'};
 return {points,inception,source:'IBKR PortfolioAnalyst',currency,returnMethod:method,benchmark:'SPY',fetchedAt:new Date().toISOString(),note:method==='TWR'?'IBKR 时间加权收益；基准仅比较共同交易日期。':method==='MWR'?'IBKR 资金加权收益；受现金流时点影响，不进行区间重基或基准比较。':'历史净值可用，收益口径尚未核实。'};
}
export function localPerformance(points: PerformancePoint[], currency: string|null): PortfolioPerformance {return {points,source:'本地账户快照',currency,returnMethod:null,benchmark:'SPY',fetchedAt:points.at(-1)?.date??null,note:'净值变化包含出入金；收益口径未核实，不计算收益或超额表现。'};}
export function samePortfolioIdentity(gateway: AccountSnapshot, mcp: AccountSnapshot) {
 if (!gateway.baseCurrency || gateway.baseCurrency !== mcp.baseCurrency || !gateway.positions.length || gateway.positions.length !== mcp.positions.length) return false;
 const signature=(snapshot:AccountSnapshot)=>snapshot.positions.map(row=>{
  const quantity=numeric(row.quantity);
  return quantity===null?null:`${row.conId}:${row.symbol}:${row.currency}:${quantity}`;
 }).sort();
 const left=signature(gateway),right=signature(mcp);
 if(left.some(value=>value===null)||right.some(value=>value===null)||JSON.stringify(left)!==JSON.stringify(right))return false;
 const gatewayNav=numeric(gateway.metrics.netLiquidation),mcpNav=numeric(mcp.metrics.netLiquidation);
 if(gatewayNav===null||mcpNav===null)return false;
 return Math.abs(gatewayNav-mcpNav)<=Math.max(.05,Math.abs(gatewayNav)*.005);
}
