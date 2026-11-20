import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createNasdaqPeService, parseNasdaqPe } from '../server/nasdaqForwardPe.ts';
import { peWindow } from '../src/lib/forwardPe.ts';

const load = async name => JSON.parse(await readFile(new URL('../server/data/' + name, import.meta.url), 'utf8'));
const seed = await load('nasdaqForwardPe.json');
const consensus = await load('forwardPeConsensus.json');
const latest = seed.at(-1);
const header = 'Global Equities Last MTD % Change QTD % Change YTD % Change LTM % Change Dividend Yield NTM P/E NTM P/E 10yr Avg. Last vs. 10yr Avg.';
const text = header + ' Nasdaq-100® 27,741 -2.3% -8.8% 9.9% 8.3% 0.6% 18.69 23.11 -19.1%'
  + ' S&P 500 7,521 -0.8% -1.7% 9.9% 10.1% 1.1% 18.12 19.24 -5.8% Data as of 11/10/2026';
const today = '2026-11-20';
assert.deepEqual(parseNasdaqPe(text, latest.url, today), latest);
for (const invalid of [text.replace('NTM P/E', 'Trailing P/E'), text.replace('S&P 500', 'S&P 500 Growth'),
  text.replace('18.69', 'N/A'), text.replace('11/10/2026', '2/30/2026'), text.replace('11/10/2026', '12/10/2026')]) {
  assert.throws(() => parseNasdaqPe(invalid, latest.url, today));
}
assert.throws(() => parseNasdaqPe(text, 'https://example.org/report', today));

const disk = new Map();
const store = { read: async key => disk.get(key), write: async (key, value) => { disk.set(key, value); } };
let offline = false, discoveries = 0;
const source = {
  articles: async () => { discoveries++; return []; },
  read: async url => {
    if (offline) throw Error('offline');
    return seed.find(row => row.url === url) ?? null;
  },
};
const before = seed.slice(0, -1);
const service = () => createNasdaqPeService(before, consensus, store, source, () => Date.parse(today));
const live = service();
assert.equal((await live.history('QQQ')).reports.at(-1).date, before.at(-1).date);
await Promise.all([live.refresh(), live.refresh()]);
assert.equal(discoveries, 1);
for (const ticker of ['VOO', 'QQQ']) {
  const history = await live.history(ticker);
  assert.equal(history.checkFailed, false);
  const view = peWindow(history, 'all');
  assert.deepEqual(view.latest, { date: '2026-11-10', value: latest[ticker], url: latest.url });
  assert.deepEqual(view.points.filter(p => p.date >= '2026-08-05').map(p => [p.date, p.value, p.source]),
    seed.map(p => [p.date, p[ticker], 'Nasdaq 报告']));
  assert.equal(view.stats.lastMonth, '2026-10');
  assert.equal(view.monthlyReference.length, ticker === 'QQQ' ? 18 : 0);
  assert.equal(peWindow(history, 5).latest.value, latest[ticker]);
}
offline = true;
await live.refresh();
assert.equal((await live.history('VOO')).checkFailed, true);
assert.deepEqual((await service().history('QQQ')).reports, (await live.history('QQQ')).reports);
console.log('Verified report columns, dates, both indexes, discovery, chart history, offline retention and restart.');
