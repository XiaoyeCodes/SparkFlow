import type { PaperContract, TicketHistory, TicketBar, TicketPeriod, TicketDataSource } from '../src/lib/ibkr/workbenchTypes.ts';
import type { JsonFetcher } from './ibkrMarket.ts';
import { newYorkTimestamp } from './ibkrEastmoneyTicket.ts';

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
  const previousClose=Number(raw.data.preClose);
  return {symbol,period,bars,asOf:[...unique.keys()].sort().at(-1)||null,fetchedAt:new Date().toISOString(),source:'东方财富',adjustment:'不复权',timeZone:period==='intraday'?'北京时间':'交易日期',
    ...(period==='intraday'&&Number.isFinite(previousClose)&&previousClose>0?{previousClose}:{}),
    note:period==='year'?'年K由月K汇总；首年可能不完整，本年尚未结束。':'最近周期可能尚未结束。'};
}

const tencentSymbol = (symbol:string) => symbol.replace(/[ _]/g,'.');
export function tencentHistoryUrl(ticker:string,period:TicketPeriod) {
  if(period==='intraday')return 'https://web.ifzq.gtimg.cn/appstock/app/UsMinute/query?'+new URLSearchParams({code:ticker});
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
  if(period==='intraday')return parseTencentMinutes(raw,ticker,symbol);
  const interval=period==='year'?'month':period;
  const adjusted=Array.isArray(raw.data[ticker]['qfq'+interval]);
  const rows=adjusted?raw.data[ticker]['qfq'+interval]:raw.data[ticker][interval];
  if(!Array.isArray(rows)||!rows.length)throw new Error('备用历史行情没有有效数据');
  const mapped={rc:0,data:{code:historySymbol(symbol),klines:rows.flatMap((row:unknown)=>Array.isArray(row)&&row.length>=6?[row.slice(0,6).join(',')]:[])}};
  const result=parseTicketHistory(mapped,symbol,period);
  if(!result.bars.length)throw new Error('备用历史行情没有有效价格');
  const adjustment=adjusted?'前复权':'不复权';
  return {...result,source:'腾讯财经（备用）',adjustment,note:period==='year'?`${adjustment}月K汇总；首年可能不完整，本年尚未结束。`:`${adjustment}历史行情；最近周期可能尚未结束。`};
}

// Tencent's own US chart uses UsMinute/query: NY-local HHmm, price,
// cumulative shares. Preserve price points; do not invent minute OHLC.
function parseTencentMinutes(raw:any,ticker:string,symbol:string):TicketHistory {
  const entry=raw.data[ticker],date=entry.data?.date,rows=entry.data?.data;
  if(typeof date!=='string'||!/^\d{8}$/.test(date)||!Array.isArray(rows))throw new Error('腾讯财经暂未提供分时数据');
  const day=`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
  const points=new Map<string,{price:number;volume:number|null}>();
  for(const row of rows){
    if(typeof row!=='string')continue;
    const [clock,price,volume]=row.trim().split(/\s+/);
    if(!/^\d{4}$/.test(clock)||clock<'0930'||clock>'1600'||!Number.isFinite(Number(price))||Number(price)<=0)continue;
    const stamp=newYorkTimestamp(`${day} ${clock.slice(0,2)}:${clock.slice(2)}:00`,Date.now());
    if(!stamp)continue;
    const time=new Date(Date.parse(stamp)+8*3600000).toISOString().slice(0,16).replace('T',' ');
    points.set(time,{price:Number(price),volume:volume!==undefined&&Number.isFinite(Number(volume))&&Number(volume)>=0?Number(volume):null});
  }
  let previousVolume:number|null=0;
  const bars=[...points.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([time,point])=>{
    const volume=point.volume!==null&&previousVolume!==null&&point.volume>=previousVolume?point.volume-previousVolume:null;
    previousVolume=point.volume;
    return {time,open:point.price,close:point.price,high:point.price,low:point.price,volume};
  });
  if(!bars.length)throw new Error('腾讯财经分时行情没有有效价格');
  const open=Number(entry.qt[ticker][5]),previousClose=Number(entry.qt[ticker][4]);
  return {symbol,period:'intraday',bars,asOf:bars.at(-1)!.time,fetchedAt:new Date().toISOString(),source:'腾讯财经',adjustment:'不复权',timeZone:'北京时间',pointPrices:true,
    sessionOpen:Number.isFinite(open)&&open>0?open:undefined,previousClose:Number.isFinite(previousClose)&&previousClose>0?previousClose:undefined,
    note:'美东时间已转为北京时间；分时涨跌按昨收计算，成交量为累计成交量差值。'};
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
  async history(contract:PaperContract,period:TicketPeriod,source?:TicketDataSource):Promise<TicketHistory>{
    const venue=contract.exchange?.toUpperCase();
    const markets=['NASDAQ','ISLAND'].includes(venue||'')?['105']:venue==='NYSE'?['106']:['ARCA','NYSEARCA','AMEX'].includes(venue||'')?['107']:['105','106','107'];
    const key=JSON.stringify([contract.symbol,markets,period,source??'auto']);const cached=this.cache.get(key);
    if(cached&&Date.now()-cached.at<(period==='intraday'?15000:300000))return cached.value;
    if(this.flights.has(key))return this.flights.get(key)!;
    const flight=(async()=>{
      try{
        if(source==='tencent'){
          const value={...await this.fallback(contract,period),source:'腾讯财经'};
          this.cache.set(key,{at:Date.now(),value});if(this.cache.size>50)this.cache.delete(this.cache.keys().next().value!);
          return value;
        }
        const results=!source&&period!=='intraday'&&Date.now()<this.eastmoneyRetryAt?[]:await Promise.allSettled(markets.map(async market=>parseTicketHistory(await this.get(historyUrl(market+'.'+historySymbol(contract.symbol),period)),contract.symbol,period)));
        const matches=results.flatMap(r=>r.status==='fulfilled'?[r.value]:[]);
        let value:TicketHistory;
        if(matches.length===1&&matches[0].bars.length)value=matches[0];
        else if(!source&&period!=='intraday'&&matches.length<=1){
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
