import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStockSearch,parseTencentStockSearch,searchStocks} from '../../server/ibkrStockSearch.ts';
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
test('Chinese search falls back to Tencent suggestions and ranks the exact company ahead of themed ETFs',async()=>{
  const raw='v_hint="us~aapl.oq~\\u82f9\\u679c~pg~GP^us~aapy.am~\\u82f9\\u679c\\u671f\\u6743\\u6536\\u76caETF~pgqqsy~GP^hk~11063~\\u82f9\\u679c\\u6cd5\\u5174~pgfx~QZ"';
  const rows=parseTencentStockSearch(raw,'苹果');
  assert.deepEqual(rows.map(row=>row.symbol),['AAPL','AAPY']);
  assert.deepEqual(rows[0],{symbol:'AAPL',brokerSymbol:'AAPL',name:'苹果',exchange:'NASDAQ',kind:'股票'});
  assert.equal(rows[1].kind,'ETF');
  const requested=[];
  const fallback=await searchStocks('苹果',async url=>{requested.push(url);if(url.includes('eastmoney'))throw new SyntaxError("Unexpected token 'j'");return raw;});
  assert.equal(fallback[0].symbol,'AAPL');
  assert.equal(new URL(requested[1]).searchParams.get('q'),'苹果');
});
test('malformed provider scripts are never evaluated and return a stable user-facing error',async()=>{
  assert.throws(()=>parseTencentStockSearch('v_hint=(globalThis.pwned=true)','苹果'),/暂不可用/);
  await assert.rejects(()=>searchStocks('苹果',async()=>'{not json'),/中文股票搜索暂不可用/);
});
