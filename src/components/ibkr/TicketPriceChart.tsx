import {useEffect,useMemo,useRef,useState} from 'react';
import {AreaSeries,CandlestickSeries,HistogramSeries,ColorType,CrosshairMode,createChart,type IChartApi,type ISeriesApi,type Time,type UTCTimestamp} from 'lightweight-charts';
import type {PaperContract,TicketHistory,TicketPeriod} from '../../lib/ibkr/workbenchTypes';

const periods: [TicketPeriod,string][]=[['intraday','分时'],['day','日K'],['week','周K'],['month','月K'],['year','年K']];
const price=(value:number)=>value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:3});
const signed=(value:number,digits=2)=>`${value>0?'+':''}${value.toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits})}`;
const compact=(value:number,unit='')=>value>=1e8?`${(value/1e8).toFixed(2)}亿${unit}`:value>=1e4?`${(value/1e4).toFixed(2)}万${unit}`:`${value.toLocaleString('en-US',{maximumFractionDigits:0})}${unit}`;
const timeKey=(value:Time|undefined)=>typeof value==='number'||typeof value==='string'?String(value):value?`${value.year}-${value.month}-${value.day}`:'';
const shanghaiClock=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false,hourCycle:'h23'});
const shanghaiDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
const newYorkParts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,hourCycle:'h23'});
type SessionRange={from:UTCTimestamp;to:UTCTimestamp;openLabel:string;closeLabel:string;label:string};
const partsAt=(value:number,formatter:Intl.DateTimeFormat)=>Object.fromEntries(formatter.formatToParts(new Date(value)).filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)])) as Record<string,number>;
const wallTimeInNewYork=(date:Record<string,number>,hour:number,minute:number)=>{
  const target=Date.UTC(date.year,date.month-1,date.day,hour,minute);
  let stamp=target;
  for(let attempt=0;attempt<2;attempt++){
    const shown=partsAt(stamp,newYorkParts);
    stamp+=target-Date.UTC(shown.year,shown.month-1,shown.day,shown.hour,shown.minute,shown.second);
  }
  return stamp/1000 as UTCTimestamp;
};
const intradaySession=(data:TicketHistory):SessionRange|null=>{
  const sample=data.bars.map(bar=>Date.parse(bar.time.replace(' ','T')+':00+08:00')).find(Number.isFinite);
  if(sample===undefined)return null;
  const tradingDate=partsAt(sample,newYorkParts);
  const from=wallTimeInNewYork(tradingDate,9,30),to=wallTimeInNewYork(tradingDate,16,0);
  const openDate=new Date(from*1000),closeDate=new Date(to*1000);
  const openLabel=shanghaiClock.format(openDate),closeClock=shanghaiClock.format(closeDate);
  const closeLabel=`${shanghaiDay.format(openDate)===shanghaiDay.format(closeDate)?'':'次日 '}${closeClock}`;
  return {from,to,openLabel,closeLabel,label:`${openLabel}–${closeLabel}`};
};
type HoverDetail={left:number;top:number;time:string;open:number;high:number;low:number;close:number;change:number;changePct:number;volume:number|null;amount:number|null;reference:string};
function Canvas({data}:{data:TicketHistory}){
  const host=useRef<HTMLDivElement>(null),api=useRef<IChartApi|null>(null),series=useRef<ISeriesApi<'Area'>|ISeriesApi<'Candlestick'>|null>(null),volumes=useRef<ISeriesApi<'Histogram'>|null>(null),fitted=useRef(false);
  const hoverRows=useRef(new Map<string,Omit<HoverDetail,'left'|'top'>>());
  const [hover,setHover]=useState<HoverDetail|null>(null);
  const intraday=data.period==='intraday';
  const session=useMemo(()=>intraday?intradaySession(data):null,[data,intraday]);
  useEffect(()=>{
    if(!host.current)return;
    const chart=createChart(host.current,{autoSize:true,height:390,layout:{background:{type:ColorType.Solid,color:'transparent'},textColor:'#dedede',fontSize:12,fontFamily:getComputedStyle(host.current).fontFamily},grid:{vertLines:{color:'#183127'},horzLines:{color:'#20392c'}},crosshair:{mode:CrosshairMode.Normal},rightPriceScale:{borderColor:'#2a4235',scaleMargins:{top:.08,bottom:.25}},timeScale:{borderColor:'#2a4235',timeVisible:intraday,secondsVisible:false},localization:{locale:'zh-CN',timeFormatter:(time:Time)=> typeof time==='number'?new Date(time*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):typeof time==='string'?time:`${time.year}-${time.month}-${time.day}`}});
    if(intraday)chart.applyOptions({timeScale:{tickMarkFormatter:(time:Time)=>typeof time==='number'?new Date(time*1000).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}):String(time)}});
    api.current=chart;fitted.current=false;
    series.current=intraday?chart.addSeries(AreaSeries,{lineColor:'#70d6b2',topColor:'#367e6045',bottomColor:'#367e6000',lineWidth:2,priceLineVisible:false}):chart.addSeries(CandlestickSeries,{upColor:'#70cda9',downColor:'#df9588',borderVisible:false,wickUpColor:'#70cda9',wickDownColor:'#df9588',priceLineVisible:false});
    volumes.current=chart.addSeries(HistogramSeries,{priceFormat:{type:'volume'},priceScaleId:'volume',lastValueVisible:false,priceLineVisible:false});
    chart.priceScale('volume').applyOptions({scaleMargins:{top:.82,bottom:0},visible:false});
    chart.subscribeCrosshairMove(event=>{
      const bar=series.current&&event.seriesData.get(series.current);
      if(!bar||!event.point||!host.current){setHover(null);return;}
      const detail=hoverRows.current.get(timeKey(event.time));
      if(!detail){setHover(null);return;}
      const tooltipWidth=Math.min(226,host.current.clientWidth-20),tooltipHeight=218;
      const left=event.point.x+tooltipWidth+24<=host.current.clientWidth?event.point.x+14:Math.max(10,event.point.x-tooltipWidth-14);
      const top=Math.max(10,Math.min(host.current.clientHeight-tooltipHeight-10,event.point.y-80));
      setHover({...detail,left,top});
    });
    return()=>{chart.remove();api.current=null;series.current=null;volumes.current=null;};
  },[intraday]);
  useEffect(()=>{
    if(!series.current||!volumes.current)return;
    setHover(null);
    const parsedRows=data.bars.map(bar=>({...bar,label:bar.time,time:intraday?Date.parse(bar.time.replace(' ','T')+':00+08:00')/1000 as UTCTimestamp:bar.time as Time}));
    const rows=session?parsedRows.filter(bar=>typeof bar.time==='number'&&bar.time>=session.from&&bar.time<=session.to):parsedRows;
    const opening=rows[0]?.open;
    hoverRows.current=new Map(rows.map((bar,index)=>{
      const reference=intraday||index===0?opening:rows[index-1]?.close;
      const base=Number.isFinite(reference)&&reference!>0?reference!:bar.open;
      const change=bar.close-base;
      return [timeKey(bar.time),{time:intraday?bar.label.slice(5):bar.label,open:bar.open,high:bar.high,low:bar.low,close:bar.close,change,changePct:base?change/base:0,volume:bar.volume,amount:bar.volume===null?null:bar.volume*bar.close,reference:intraday||index===0?'较开盘':'较前收'}];
    }));
    if(intraday){
      const actual=new Map(rows.map(bar=>[bar.time,bar.close]));
      const timeline=session?Array.from({length:Math.floor((session.to-session.from)/60)+1},(_,index)=>session.from+index*60 as UTCTimestamp):rows.map(bar=>bar.time);
      (series.current as ISeriesApi<'Area'>).setData(timeline.map(time=>actual.has(time)?{time,value:actual.get(time)!}:{time}));
    }
    else (series.current as ISeriesApi<'Candlestick'>).setData(rows);
    volumes.current.setData(rows.flatMap(bar=>bar.volume===null?[]:[{time:bar.time,value:bar.volume,color:bar.close>=bar.open?'#5dae8a55':'#c9857855'}]));
    if(!fitted.current){
      if(intraday&&session)api.current?.timeScale().setVisibleRange({from:session.from,to:session.to});
      else if(!intraday&&rows.length>90)api.current?.timeScale().setVisibleLogicalRange({from:rows.length-90,to:rows.length+3});
      else api.current?.timeScale().fitContent();
      fitted.current=true;
    }
  },[data,intraday,session]);
  const tone=hover?(hover.change>0?'up':hover.change<0?'down':'flat'):'flat';
  return <><div className="pt-chart-hover">移动鼠标查看行情详情 · 拖动或滚轮缩放</div><div className="pt-chart-stage">
    <div className="pt-chart-canvas" ref={host} role="img" aria-label={`${data.symbol} ${periods.find(p=>p[0]===data.period)?.[1]}走势图${session?`，完整交易时段 ${session.openLabel} 至${session.closeLabel}`:''}，共 ${data.bars.length} 个数据点`}/>
    {hover&&<div className={`pt-chart-tooltip is-${tone}`} role="tooltip" aria-label="K线行情详情" style={{left:hover.left,top:hover.top}}>
      <header><strong>{hover.time}</strong><span>{hover.reference}</span></header>
      <dl>
        <div className="is-price"><dt>价格</dt><dd>{price(hover.close)}</dd></div>
        <div><dt>涨跌额</dt><dd className="pt-chart-trend">{signed(hover.change)}</dd></div>
        <div><dt>涨跌幅</dt><dd className="pt-chart-trend">{signed(hover.changePct*100)}%</dd></div>
        <div><dt>开盘</dt><dd>{price(hover.open)}</dd></div>
        <div><dt>最高</dt><dd>{price(hover.high)}</dd></div>
        <div><dt>最低</dt><dd>{price(hover.low)}</dd></div>
        <div><dt>成交量</dt><dd>{hover.volume===null?'未提供':compact(hover.volume,'股')}</dd></div>
        <div><dt>估算成交额</dt><dd>{hover.amount===null?'未提供':`$${compact(hover.amount)}`}</dd></div>
      </dl>
    </div>}
  </div></>;
}
export function TicketPriceChart({contract}:{contract?:PaperContract}){
  const [period,setPeriod]=useState<TicketPeriod>('intraday'),[revision,setRevision]=useState(0),[response,setResponse]=useState<{key:string;data:TicketHistory}|null>(null),[status,setStatus]=useState({key:'',loading:false,error:''});
  const cache=useRef(new Map<string,TicketHistory>());
  const key=JSON.stringify([contract?.conId,contract?.symbol,contract?.exchange,period]);
  const data=response?.key===key?response.data:cache.current.get(key);
  const session=data?.period==='intraday'?intradaySession(data):null;
  useEffect(()=>{
    if(!contract)return;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    const load=async()=>{
      if(document.hidden){timer=setTimeout(()=>void load(),30000);return;}
      setStatus({key,loading:true,error:''});
      try{
        const r=await fetch('/api/ibkr-workbench/paper/history',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conId:contract.conId,symbol:contract.symbol,currency:contract.currency,exchange:contract.exchange,period}),signal:controller.signal});
        const value=await r.json();if(!r.ok)throw new Error(value.error||'历史行情暂不可用');
        if(controller.signal.aborted)return;
        cache.current.set(key,value);if(cache.current.size>20)cache.current.delete(cache.current.keys().next().value!);
        setResponse({key,data:value});setStatus({key,loading:false,error:''});
      }catch(e){if(!controller.signal.aborted)setStatus({key,loading:false,error:e instanceof Error?e.message:'行情加载失败'});}
      if(!controller.signal.aborted)timer=setTimeout(()=>void load(),period==='intraday'?30000:300000);
    };
    void load();return()=>{controller.abort();clearTimeout(timer);};
  },[key,revision]);
  return <section className="pt-chart-panel" aria-label="股票走势图"><div className="pt-chart-toolbar"><div role="tablist" aria-label="行情周期">{periods.map(([value,label])=><button key={value} role="tab" aria-selected={period===value} onClick={()=>setPeriod(value)}>{label}</button>)}</div><span className={period==='intraday'?'pt-market-window':undefined}>{period==='intraday'?`北京时间${session?` · 常规交易 ${session.label}`:''}`: `${data?.adjustment||'历史行情'} · USD`}</span></div>
    {!!data?.bars.length?<Canvas key={key} data={data}/>:<div className="pt-chart-empty">{!contract?'选择股票后显示走势':status.key===key&&status.loading?'正在读取历史行情…':status.key===key&&status.error?'暂时无法读取该周期行情':'上游暂未提供该周期数据'}</div>}
    {(status.key===key&&status.error||data?.stale)&&<p className="pt-chart-error">{data?.bars.length?'刷新失败，显示上次取得的走势。':status.error}<button onClick={()=>setRevision(v=>v+1)}>重试</button></p>}
    <div className="pt-chart-foot"><span>{data?.asOf?`${data.source} · 数据截至 ${data.asOf}`:'按上游实际数据展示'}</span><span>{status.key===key&&status.loading&&data?'更新中…':data?.note||'成交量显示在图表底部'}</span></div>
  </section>;
}
