import test from 'node:test';
import assert from 'node:assert/strict';
import { paperPeFact } from '../../src/lib/ibkr/paperValuation.ts';

test('TTM and dynamic cards use independent values and preserve negative source values', () => {
  const quote = {peSource:'东方财富',peDynamic:'-22',peTtm:'-237.68',peStatic:'-395.64'};
  assert.equal(paperPeFact(quote).label,'市盈率（TTM）');
  assert.equal(paperPeFact(quote).value,'-237.68');
  assert.match(paperPeFact(quote).title,/最近四个季度.*为负/);
  assert.equal(paperPeFact(quote,'dynamic').label,'市盈率（动）');
  assert.equal(paperPeFact(quote,'dynamic').value,'-22');
  assert.equal(paperPeFact({...quote,peDynamic:'0'},'dynamic').value,null);
});

test('missing dynamic PE never substitutes static, TTM or an unqualified ratio', () => {
  const quote={peSource:'腾讯财经',peDynamic:null,peTtm:'37.45',peStatic:'43.78',peRatio:'37.45'};
  assert.equal(paperPeFact(quote,'dynamic').value,null);
  assert.match(paperPeFact(quote,'dynamic').title,/腾讯财经暂未提供/);
  assert.equal(paperPeFact({...quote,peTtm:null}).value,null);
  for (const missing of [undefined,'','-','0','Infinity','NaN']) {
    assert.equal(paperPeFact({peDynamic:missing,peStatic:'43.78'},'dynamic').value,null);
    assert.equal(paperPeFact({peTtm:missing,peDynamic:'22'}).value,null);
  }
});

test('Tencent dynamic and Eastmoney static facts display the requested provider values', () => {
  const dynamic=paperPeFact({peDynamic:'35.60',peStatic:'43.78',peSource:'腾讯财经'},'dynamic');
  assert.equal(dynamic.value,'35.60');assert.match(dynamic.title,/腾讯财经.*接口原值/);
  const quote={peDynamic:'0',peStatic:'42.55',peTtm:'36.97',peSource:'东方财富'};
  const fixed=paperPeFact(quote,'static');
  assert.equal(fixed.label,'市盈率（静）');assert.equal(fixed.value,'42.55');
  assert.match(fixed.title,/东方财富.*上一年度盈利口径.*接口原值/);
  assert.equal(paperPeFact({...quote,peStatic:null},'static').value,null);
  assert.equal(paperPeFact({...quote,peStatic:'-395.64'},'static').value,'-395.64');
});
