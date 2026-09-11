import type {TicketBar,TicketHistory} from './workbenchTypes';

const validPrice=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;

export function ticketPriceChange(data:Pick<TicketHistory,'period'|'previousClose'|'sessionOpen'>,bar:Pick<TicketBar,'open'|'close'>,previous?:Pick<TicketBar,'close'>){
  let base:number,label:'较昨收'|'较开盘'|'较前收';
  if(data.period==='intraday'){
    if(validPrice(data.previousClose)){base=data.previousClose;label='较昨收';}
    else {base=validPrice(data.sessionOpen)?data.sessionOpen:bar.open;label='较开盘';}
  }else if(previous&&validPrice(previous.close)){base=previous.close;label='较前收';}
  else {base=bar.open;label='较开盘';}
  const change=bar.close-base;
  return {change,changePct:change/base,label};
}
