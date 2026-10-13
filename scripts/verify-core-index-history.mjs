import assert from 'node:assert/strict';
import { CORE_INDEX_HISTORY_CONFIG, createCoreIndexHistoryLoader, normalizeCoreIndexHistory } from '../server/coreIndexHistory.ts';

let now = Date.parse('2026-10-13T08:00:00Z');
const history = Array.from({ length: 30 }, (_, index) => ({ time: new Date(Date.UTC(2026, 8, 13 + index)).toISOString(), value: 100 + index }));
const normalized = normalizeCoreIndexHistory([...history].reverse().concat([{ time: '2027-01-01', value: 200 }, { time: 'bad', value: 100 }, { time: '2026-10-11', value: NaN }]), now);
assert.equal(normalized.length, 22);
assert.equal(normalized.at(-1).value, 129);
assert.throws(() => normalizeCoreIndexHistory([{ time: '2026-10-12', value: 1 }], now));
assert.throws(() => normalizeCoreIndexHistory(history, now + 30 * 86400_000));
let release;
const waiting = new Promise(resolve => { release = resolve; });
const calls = [], yahooCalls = [];
const loader = createCoreIndexHistoryLoader({ now: () => now,
  fred: async id => { calls.push(id); await waiting; return history; },
  shanghai: async () => { calls.push('sh000001'); await waiting; return { history, sourceUrl: 'https://gu.qq.com/sh000001/zs' }; },
  yahoo: async symbol => { yahooCalls.push(symbol); throw Error('Yahoo blocked'); },
});
const tasks = Object.keys(CORE_INDEX_HISTORY_CONFIG).map(id => loader.get(id));
const duplicate = loader.get('nasdaq');
assert.deepEqual(calls, ['NASDAQ100', 'SP500', 'sh000001', 'NASDAQSOX'], 'four real index series start independently');
release();
const snapshots = await Promise.all(tasks);
assert.equal(await duplicate, snapshots[0], 'same-index visitors coalesce');
assert.equal(yahooCalls.length, 0, 'primary history survives a blocked Yahoo source');
assert.equal(snapshots[0].symbol, '^NDX');
assert.equal(snapshots[3].symbol, '^SOX');
assert.equal(snapshots[0].history.length, 22);
assert.match(snapshots[0].sourceUrl, /NASDAQ100$/);
await loader.get('nasdaq'); assert.equal(calls.length, 4, 'five-minute history cache prevents per-tick source requests');
now += 300_001;
await loader.get('nasdaq'); assert.equal(calls.length, 5);
const fallback = createCoreIndexHistoryLoader({ now: () => now,
  fred: async () => { throw Error('FRED offline'); }, shanghai: async () => ({ history: [], sourceUrl: 'empty' }),
  yahoo: async symbol => ({ history, sourceUrl: `https://finance.yahoo.com/quote/${symbol}` }),
});
assert.match((await fallback.get('sp500')).sourceUrl, /yahoo/);
assert.equal((await fallback.get('shanghai')).history.length, 22, 'invalid primary also uses backup');
await assert.rejects(fallback.get('unknown'), /不支持/);
console.log('Core history: exact index mapping, independent parallel loads, dedupe, bounded cache, valid daily points and source fallback passed.');
