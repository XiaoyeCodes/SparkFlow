import type { PaperContract, TicketHistory, TicketBar, TicketPeriod } from '../src/lib/ibkr/workbenchTypes.ts';
import type { JsonFetcher } from './ibkrMarket.ts';

export const historySymbol = (symbol:string) => symbol.replace(/[ .]/g,'_');
export function historyUrl(secid:string,period:TicketPeriod) {
  const common={secid,fields1:'f1,f2,f3,f4,f5,f6,f7,f8',fields2:'f51,f52,f53,f54,f55,f56,f57,f58'};
  return period==='intraday'
    ? 'https://push2.eastmoney.com/api/qt/stock/trends2/get?'+new URLSearchParams({...common,ndays:'1',iscr:'0'})
    : 'https://push2his.eastmoney.com/api/qt/stock/kline/get?'+new URLSearchParams({...common,klt:period==='day'?'101':period==='week'?'102':'103',fqt:'0',end:'20500101',lmt:period==='year'?'1000':'300'});
}
export function parseTicketHistory(raw:any,symbol:string,period:TicketPeriod):TicketHistory {
  if(raw?.rc!==0 || raw?.data?.code!==historySymbol(symbol))throw new Error('东方财富未返回匹配的历史行情');
  const lines=period==='intraday'?raw.data.trends:raw.data.klines;
  if(!Array.isArray(lines))throw new Error('东方财富暂未提供该周期数据');
  const unique=new Map<string,TicketBar>();
  for(const line of lines){
    if(typeof line!=='string')continue;
    const [time,o,c,h,l,v]=line.split(',');
    if(!(period==='intraday'?/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/:/^\d{4}-\d{2}-\d{2}$/).test(time))continue;
    const stamp=Date.parse(time.replace(' ','T')+(period==='intraday'?':00+08:00':'T00:00:00Z'));
    const calendarStamp=Date.parse(time.replace(' ','T')+(period==='intraday'?':00Z':'T00:00:00Z'));
    if(!Number.isFinite(calendarStamp)||new Date(calendarStamp).toISOString().slice(0,10)!==time.slice(0,10))continue;
    if(!Number.isFinite(stamp)||[o,c,h,l].some(x=>!x?.trim()||!Number.isFinite(Number(x))||Number(x)<=0))continue;
    const [open,close,high,low]=[o,c,h,l].map(Number);
    if(high<Math.max(open,close)||low>Math.min(open,close)||high<low)continue;
    unique.set(time,{time,open,close,high,low,volume:v?.trim()&&Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null});
  }
  let bars=[...unique.values()].sort((a,b)=>a.time.localeCompare(b.time));
  if(period==='year'){
    const years=new Map<string,TicketBar>();
    for(const bar of bars){const key=bar.time.slice(0,4);const prior=years.get(key);
      if(prior){prior.close=bar.close;prior.high=Math.max(prior.high,bar.high);prior.low=Math.min(prior.low,bar.low);prior.volume=prior.volume===null||bar.volume===null?null:prior.volume+bar.volume;}
      else years.set(key,{...bar,time:key+'-01-01'});
    }
    bars=[...years.values()];
  }
  return {symbol,period,bars,asOf:[...unique.keys()].sort().at(-1)||null,fetchedAt:new Date().toISOString(),source:'东方财富',adjustment:'不复权',timeZone:period==='intraday'?'北京时间':'交易日期',note:period==='year'?'年K由月K汇总；首年可能不完整，本年尚未结束。':'最近周期可能尚未结束。'};
}

const tencentSymbol = (symbol:string) => symbol.replace(/[ _]/g,'.');
export function tencentHistoryUrl(ticker:string,period:TicketPeriod) {
  const interval=period==='year'?'month':period;
  return 'https://web.ifzq.gtimg.cn/appstock/app/usfqkline/get?'+new URLSearchParams({param:`${ticker},${interval},,,640,qfq`});
}
export function verifyTencentIdentity(raw:any,ticker:string,symbol:string) {
  const quote=raw?.data?.[ticker]?.qt?.[ticker];
  const id=quote?.[2];
  if(raw?.code!==0 || quote?.[35]!=='USD' || typeof id!=='string' || !/\.(N|OQ|AM|P|Z)$/.test(id) || id.replace(/\.(N|OQ|AM|P|Z)$/,'')!==tencentSymbol(symbol))throw new Error('备用历史行情未匹配当前美元股票');
  return 'us'+id;
}
export function parseTencentHistory(raw:any,ticker:string,symbol:string,period:TicketPeriod):TicketHistory {
  if(verifyTencentIdentity(raw,ticker,symbol)!==ticker)throw new Error('备用历史行情交易所不匹配');
  const interval=period==='year'?'month':period;
  const rows=raw.data[ticker]['qfq'+interval];
  if(!Array.isArray(rows)||!rows.length)throw new Error('备用历史行情没有有效数据');
  const mapped={rc:0,data:{code:historySymbol(symbol),klines:rows.flatMap((row:unknown)=>Array.isArray(row)&&row.length>=6?[row.slice(0,6).join(',')]:[])}};
  const result=parseTicketHistory(mapped,symbol,period);
  if(!result.bars.length)throw new Error('备用历史行情没有有效价格');
  return {...result,source:'腾讯财经（备用）',adjustment:'前复权',note:period==='year'?'前复权月K汇总；首年可能不完整，本年尚未结束。':'前复权历史行情；最近周期可能尚未结束。'};
}
export class TicketHistories {
  private cache=new Map<string,{at:number,value:TicketHistory}>();
  private flights=new Map<string,Promise<TicketHistory>>();
  private tickers=new Map<string,Promise<string>>();
  private eastmoneyRetryAt=0;
  constructor(private get:JsonFetcher){}
  private async fallback(contract:PaperContract,period:TicketPeriod) {
    const symbol=contract.symbol;
    if(!this.tickers.has(symbol)){
      const base='us'+tencentSymbol(symbol);
      const request=this.get(tencentHistoryUrl(base,'day')).then(raw=>verifyTencentIdentity(raw,base,symbol)).catch(error=>{this.tickers.delete(symbol);throw error;});
      this.tickers.set(symbol,request);
      if(this.tickers.size>50)this.tickers.delete(this.tickers.keys().next().value!);
    }
    const ticker=await this.tickers.get(symbol)!;
    const suffix=ticker.split('.').at(-1),venue=contract.exchange?.toUpperCase();
    if((['NASDAQ','ISLAND'].includes(venue||'')&&suffix!=='OQ')||(venue==='NYSE'&&suffix!=='N')||(['ARCA','NYSEARCA','AMEX'].includes(venue||'')&&!['AM','P'].includes(suffix||'')))throw new Error('备用行情与当前合约交易所不匹配');
    return parseTencentHistory(await this.get(tencentHistoryUrl(ticker,period)),ticker,symbol,period);
  }
  async history(contract:PaperContract,period:TicketPeriod):Promise<TicketHistory>{
    const venue=contract.exchange?.toUpperCase();
    const markets=['NASDAQ','ISLAND'].includes(venue||'')?['105']:venue==='NYSE'?['106']:['ARCA','NYSEARCA','AMEX'].includes(venue||'')?['107']:['105','106','107'];
    const key=JSON.stringify([contract.symbol,markets,period]);const cached=this.cache.get(key);
    if(cached&&Date.now()-cached.at<(period==='intraday'?15000:300000))return cached.value;
    if(this.flights.has(key))return this.flights.get(key)!;
    const flight=(async()=>{
      try{
        const results=period!=='intraday'&&Date.now()<this.eastmoneyRetryAt?[]:await Promise.allSettled(markets.map(async market=>parseTicketHistory(await this.get(historyUrl(market+'.'+historySymbol(contract.symbol),period)),contract.symbol,period)));
        const matches=results.flatMap(r=>r.status==='fulfilled'?[r.value]:[]);
        let value:TicketHistory;
        if(matches.length===1&&matches[0].bars.length)value=matches[0];
        else if(period!=='intraday'&&matches.length<=1){
          if(results.length&&results.every(r=>r.status==='rejected'))this.eastmoneyRetryAt=Date.now()+60000;
          value=await this.fallback(contract,period);
        }else if(matches.length===1)value=matches[0];
        else throw new Error('历史行情暂不可用，请点击重试。');
        this.cache.set(key,{at:Date.now(),value});if(this.cache.size>50)this.cache.delete(this.cache.keys().next().value!);
        return value;
      }catch(error){if(cached)return {...cached.value,stale:true};throw error;}
      finally{this.flights.delete(key);}
    })();this.flights.set(key,flight);return flight;
  }
}
