import test from 'node:test';
import assert from 'node:assert/strict';
import { IbkrProfiles, profileIdentity, verifyTradingViewProfile } from '../../server/ibkrProfiles.ts';

const holding = (symbol, extra = {}) => ({ accountKey: 'live:test', conId: 1, symbol, currency: 'USD', assetType: 'STK', quantity: '1', averageCost: '1', marketValue: '1', ...extra });

test('company profiles automatically enrich equities and classify ETFs', async () => {
  let calls = 0;
  const profiles = new IbkrProfiles(async tickers => {
    calls++;
    assert.deepEqual(tickers, ['NASDAQ:AAPL', 'NASDAQ:QQQ', 'NYSE:BRK.B']);
    return { data: [
      { s: 'NASDAQ:AAPL', d: ['AAPL', 'Apple Inc.', 'Electronic Technology', 'Telecommunications Equipment', 'stock', ['common']] },
      { s: 'NASDAQ:QQQ', d: ['QQQ', 'Invesco QQQ Trust', 'Miscellaneous', 'Investment Trusts/Mutual Funds', 'fund', ['etf']] },
      { s: 'NYSE:BRK.B', d: ['BRK.B', 'Berkshire Hathaway Inc.', 'Finance', 'Multi-Line Insurance', 'stock', ['common']] },
    ] };
  });
  const input = [holding('AAPL', { exchange: 'NASDAQ' }), holding('QQQ', { conId: 2, exchange: 'NASDAQ' }), holding('BRK B', { conId: 3, exchange: 'NYSE' })];
  const enriched = await profiles.enrich(input);
  assert.equal(enriched[0].sector, 'Electronic Technology');
  assert.equal(enriched[0].industry, 'Telecommunications Equipment');
  assert.equal(enriched[0].instrumentType, 'STK');
  assert.equal(enriched[1].instrumentType, 'ETF');
  assert.equal(enriched[2].name, 'Berkshire Hathaway Inc.');
  await profiles.enrich(input);
  assert.equal(calls, 1);
});

test('profile validation rejects mismatches and upstream failure keeps broker data', async () => {
  const identity = profileIdentity(holding('AAPL', { exchange: 'NASDAQ' }));
  assert.equal(profileIdentity(holding('brk b', { exchange: 'NYSE' })).key, 'BRK-B');
  assert.equal(verifyTradingViewProfile({ s: 'NASDAQ:MSFT', d: ['MSFT', 'Microsoft', 'Technology', 'Software', 'stock', ['common']] }, identity), undefined);
  const profiles = new IbkrProfiles(async () => { throw new Error('offline'); });
  const input = [holding('AAPL', { name: 'AAPL' })];
  assert.deepEqual(await profiles.enrich(input), input);
});
