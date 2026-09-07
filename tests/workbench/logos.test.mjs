import test from 'node:test';
import assert from 'node:assert/strict';
import { CompanyLogos, CompanyLogoImages, logoIdentity } from '../../server/ibkrCompanyLogos.ts';

const stock = { symbol: 'NEWCO', currency: 'USD', assetType: 'STK', exchange: 'SMART' };
test('image proxy caches verified SVGs and rejects arbitrary URLs and non-images', async () => {
  let calls = 0;
  const images = new CompanyLogoImages(async () => { calls++; return new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'); });
  const url = 'https://s3-symbol-logo.tradingview.com/invesco--big.svg';
  await Promise.all([images.get(url), images.get(url)]); await images.get(url);
  assert.equal(calls, 1);
  await assert.rejects(() => images.get('http://127.0.0.1/private'));
  await assert.rejects(() => new CompanyLogoImages(async () => new TextEncoder().encode('<html>error</html>')).get(url));
});
test('new symbols resolve dynamically and concurrent requests share a cached lookup', async () => {
  let calls = 0;
  const logos = new CompanyLogos(async tickers => {
    calls++;
    assert.ok(tickers.includes('NASDAQ:NEWCO'));
    return { data: [{ s: 'NASDAQ:NEWCO', d: ['new-company'] }] };
  }, async () => false);
  const result = await Promise.all([logos.resolve(stock), logos.resolve(stock)]);
  assert.equal(result[0].src, 'https://s3-symbol-logo.tradingview.com/new-company--big.svg');
  assert.deepEqual(result[0], result[1]);
  await logos.resolve(stock);
  assert.equal(calls, 1);
});
test('existing heatmap logos are reused without external requests', async () => {
  const logos = new CompanyLogos(async () => { throw Error('must not fetch'); }, async file => file === 'us-AAPL.svg');
  assert.equal((await logos.resolve({ ...stock, symbol: 'AAPL' })).src, '/stock-logos/us-AAPL.svg');
});
test('ambiguous matches, mismatched symbols and unsafe logo identifiers stay empty', async () => {
  for (const rows of [
    [{ s: 'NASDAQ:NEWCO', d: ['one'] }, { s: 'NYSE:NEWCO', d: ['two'] }],
    [{ s: 'NASDAQ:OTHER', d: ['other'] }],
    [{ s: 'NASDAQ:NEWCO', d: ['../../evil'] }],
  ]) {
    const logos = new CompanyLogos(async () => ({ data: rows }), async () => false);
    assert.equal((await logos.resolve(stock)).src, null);
  }
});
test('market identity separates listings and rejects unsupported contracts and paths', () => {
  assert.deepEqual(logoIdentity({ ...stock, symbol: 'BRK B', exchange: 'NYSE' }).tickers, ['NYSE:BRK.B']);
  assert.deepEqual(logoIdentity({ ...stock, symbol: '00700', currency: 'HKD', exchange: 'SEHK' }).tickers, ['HKEX:700']);
  for (const value of [{ ...stock, symbol: '../AAPL' }, { ...stock, assetType: 'OPT' }, { ...stock, currency: 'EUR', exchange: 'SMART' }]) assert.equal(logoIdentity(value), null);
});
test('missing and failed sources are briefly cached without rejecting the page', async () => {
  let calls = 0;
  const logos = new CompanyLogos(async () => { calls++; throw Error('offline'); }, async () => false);
  assert.equal((await logos.resolve(stock)).src, null);
  assert.equal((await logos.resolve(stock)).src, null);
  assert.equal(calls, 1);
});
