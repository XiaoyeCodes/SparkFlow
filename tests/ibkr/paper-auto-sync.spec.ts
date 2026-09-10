import {test,expect} from '@playwright/test';
import {emptySnapshot} from '../../src/lib/ibkr/store';
test.use({baseURL:process.env.IBKR_AUTO_TEST_URL || 'http://127.0.0.1:5187'});

test('paper orders and holdings follow broker transitions without a manual refresh or write',async({page})=>{
  const snapshot={...emptySnapshot('paper'),accountKey:'paper:auto-test',snapshotId:'fixture:auto',
    connection:'connected',state:'ready',source:'fixture',testData:true,baseCurrency:'USD',asOf:new Date().toISOString(),
    cash:[{currency:'USD',amount:'10000'}],positions:[],metrics:{netLiquidation:'10000'}};
  const stock={conId:265598,symbol:'AAPL',currency:'USD',exchange:'NASDAQ'};
  const data={source:'gateway',gatewayMode:'paper',connection:{state:'connected',tools:[],accounts:[]},snapshot,
    quotes:[],evidence:[],alerts:[],reports:[],jobs:[],plans:[],preferences:{maxAiCalls:12},
    ai:{configured:false,enabled:false,fields:[],usedToday:0},nextSyncAt:null,calendarSupported:true};
  let row:any={intent:{accountKey:snapshot.accountKey,conId:stock.conId,clientIntentId:'fixture:order',side:'BUY',quantity:'10',orderType:'MKT'},
    submission:'ACKNOWLEDGED',execution:'OPEN',filledQuantity:'0',orderId:71,reconciliationRequired:false};
  let positions:any[]=[];let polls=0,writes=0;
  await page.route('**/api/ibkr-workbench/**',r=>{
    const endpoint=new URL(r.request().url()).pathname.split('/ibkr-workbench/')[1];
    if(['paper/confirm','paper/cancel','paper/configure','paper/stop','paper/reconcile'].includes(endpoint))writes++;
    if(endpoint==='state')return r.fulfill({json:data});
    if(endpoint==='paper/status'){
      polls++;
      return r.fulfill({json:{enabled:true,available:true,accountKey:snapshot.accountKey,account:'DU***EST',supportedOrderTypes:['LMT','MKT'],
        connection:'connected',state:'ready',policy:{conIds:[stock.conId],expiresAt:new Date(Date.now()+3600000).toISOString(),limits:{}},
        orders:[row],snapshot:{...snapshot,positions}}});
    }
    if(endpoint==='paper/contract')return r.fulfill({json:[stock]});
    if(endpoint==='paper/market-quote')return r.fulfill({json:{...stock,state:'missing',last:null}});
    if(endpoint==='paper/history')return r.fulfill({json:{bars:[],period:'intraday',symbol:'AAPL'}});
    return r.fulfill({json:[]});
  });
  await page.goto('/ibkr?tab=orders');
  await expect(page.locator('.pt-order-state')).toHaveText('已报单');
  await expect(page.getByRole('button',{name:'停止新增订单'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'刷新订单',exact:true})).toHaveCount(0);
  row={...row,execution:'PARTIALLY_FILLED',filledQuantity:'4',averageFillPrice:'100'};
  positions=[{...stock,accountKey:snapshot.accountKey,quantity:'4',averageCost:'100',marketValue:'400'}];
  await expect(page.locator('.pt-order-state')).toHaveText('部分成交',{timeout:6000});
  await expect(page.locator('.pt-activity tbody')).toContainText('100.00');
  row={...row,execution:'FILLED',filledQuantity:'10',averageFillPrice:'101'};
  positions=[{...positions[0],quantity:'10',averageCost:'101',marketValue:'1010'}];
  await expect(page.locator('.pt-order-state')).toHaveText('已成交',{timeout:6000});
  await page.getByRole('tab',{name:/持仓/}).click();
  await expect(page.locator('.pt-activity tbody')).toContainText('10 股');
  await expect(page.locator('.pt-activity tbody')).toContainText('101.00');
  await page.getByRole('tab',{name:/订单/}).click();
  row={...row,intent:{...row.intent,clientIntentId:'fixture:cancel'},orderId:72,execution:'CANCEL_PENDING',filledQuantity:'0'};
  await expect(page.locator('.pt-order-state')).toHaveText('撤单中',{timeout:6000});
  row={...row,execution:'CANCELLED'};
  await expect(page.locator('.pt-order-state')).toHaveText('已撤单',{timeout:6000});
  await page.reload();
  await expect(page.locator('.pt-order-state')).toHaveText('已撤单');
  expect(polls).toBeGreaterThanOrEqual(5);
  expect(writes).toBe(0);
});
