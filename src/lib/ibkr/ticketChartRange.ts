export type TicketLogicalRange={from:number;to:number};

export const usesPinnedIntradayZoom=(period:string)=>period==='intraday';

export function zoomTicketRange(range:TicketLogicalRange,cursor:number,firstData:number,lastData:number,wheelDelta:number,minSpan=6):TicketLogicalRange{
  const span=range.to-range.from;
  if(!Number.isFinite(span)||span<=0||!Number.isFinite(cursor)||!Number.isFinite(firstData)||!Number.isFinite(lastData)||wheelDelta===0)return range;
  const hasRightWhitespace=range.to>lastData;
  const anchor=hasRightWhitespace?firstData:Math.max(firstData,Math.min(cursor,lastData));
  const anchorRatio=Math.max(0,Math.min(1,(anchor-range.from)/span));
  const normalized=Math.max(-1,Math.min(1,wheelDelta/100));
  const nextSpan=Math.max(minSpan,span*Math.exp(normalized*.18));
  let from=anchor-anchorRatio*nextSpan,to=from+nextSpan;
  if(from<0){to-=from;from=0;}
  return {from,to};
}
