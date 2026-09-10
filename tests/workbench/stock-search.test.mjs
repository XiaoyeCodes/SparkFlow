import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStockSearch,searchStocks} from '../../server/ibkrStockSearch.ts';
import {EastmoneyTicketQuotes} from '../../server/ibkrEastmoneyTicket.ts';

const company = {Classify:'UsStock',MktNum:'106',Code:'BRK_B',Name:'伯克希尔哈撒韦-B',TypeUS:'1'};
test('Chinese search separates share classes, excludes other markets and ranks companies ahead of ETFs',async()=>{
  const raw={QuotationCodeTable:{Status:0,Data:[{...company,Code:'BRKU',Name:'二倍做多伯克希尔ETF',TypeUS:'5'},company,{...company,Code:'BRK_A',Name:'伯克希尔哈撒韦-A'},company,{...company,Classify:'HK',MktNum:'116',Code:'07777'}]}};
  const rows=await searchStocks('伯克希尔',async url=>{assert.equal(new URL(url).searchParams.get('input'),'伯克希尔');return raw;});
  assert.deepEqual(rows.map(r=>r.symbol),['BRK.B','BRK.A','BRKU']);
  assert.equal(rows[0].brokerSymbol,'BRK B');
  assert.equal(rows[0].exchange,'NYSE');
  assert.equal(rows[2].kind,'ETF');
  assert.throws(()=>parseStockSearch({},'苹果'),/暂不可用/);
  assert.deepEqual(parseStockSearch({QuotationCodeTable:{Status:0,Data:[]}},'不存在'),[]);
});
test('Gateway share-class symbols use corresponding Eastmoney quote identifiers',async()=>{
  const provider=new EastmoneyTicketQuotes(async url=>{
    assert.equal(new URL(url).searchParams.get('secid'),'106.BRK_B');
    return {rc:0,data:{f57:'BRK_B',f43:500}};
  });
  const quote=await provider.quote({conId:1,symbol:'BRK B',currency:'USD',exchange:'NYSE'});
  assert.equal(quote.symbol,'BRK B');assert.equal(quote.last,'500');
});
