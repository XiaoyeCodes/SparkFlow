import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Transpile the pure presentation helpers so this also runs on Node 20.
const source = readFileSync(new URL('../src/lib/newsPresentation.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 }
});
const {
  formatNewsSync, formatNewsTime, getNewsCategory, newsCategoryCounts,
  newsPriority, newsTimestamp, selectNewsItems
} = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

const items = [
  { id: 'older', category: 'tech', weight: 70, heat: 10, importance: 60, publishedAt: '2026-08-28T08:00:00Z' },
  { id: 'newer', category: 'finance', weight: 70, heat: 20, importance: 40, publishedAt: '2026-08-28T10:00:00Z' },
  { id: 'invalid', category: 'tech', weight: 50, heat: 80, importance: 90, publishedAt: 'not-a-date' },
  { id: 'missing', category: 'world', weight: 40, heat: 5, importance: 30 }
];
const original = structuredClone(items);
const ids = (sort) => selectNewsItems(items, 'all', sort).map((item) => item.id);
assert.deepEqual(ids('weight'), ['newer', 'older', 'invalid', 'missing']);
assert.deepEqual(ids('time'), ['newer', 'older', 'invalid', 'missing']);
assert.deepEqual(ids('heat'), ['invalid', 'newer', 'older', 'missing']);
assert.deepEqual(ids('importance'), ['invalid', 'older', 'newer', 'missing']);
assert.deepEqual(selectNewsItems(items, 'tech', 'weight').map((item) => item.id), ['older', 'invalid']);
assert.deepEqual(selectNewsItems(items, 'livelihood', 'weight'), []);
const repeatedSourceItems = [
  { id: 'ws-1', sourceId: 'wallstreetcn', category: 'finance', weight: 81, heat: 0, importance: 72, publishedAt: '2026-08-28T10:04:00Z' },
  { id: 'ws-2', sourceId: 'wallstreetcn', category: 'finance', weight: 81, heat: 0, importance: 72, publishedAt: '2026-08-28T10:03:00Z' },
  { id: 'ws-3', sourceId: 'wallstreetcn', category: 'finance', weight: 81, heat: 0, importance: 72, publishedAt: '2026-08-28T10:02:00Z' },
  { id: 'bloomberg-1', sourceId: 'bloomberg', category: 'finance', weight: 77, heat: 0, importance: 75, publishedAt: '2026-08-28T10:01:00Z' },
  { id: 'reuters-1', sourceId: 'reuters', category: 'finance', weight: 76, heat: 0, importance: 74, publishedAt: '2026-08-28T10:00:00Z' }
];
assert.deepEqual(
  selectNewsItems(repeatedSourceItems, 'all', 'weight').map((item) => item.id),
  ['ws-1', 'ws-2', 'bloomberg-1', 'reuters-1', 'ws-3'],
  'A high-frequency source may lead with its two best items but cannot crowd out comparable sources.'
);
assert.deepEqual(
  selectNewsItems(repeatedSourceItems, 'all', 'source').map((item) => item.id),
  ['bloomberg-1', 'reuters-1', 'ws-1', 'ws-2', 'ws-3'],
  'Original source ordering remains unchanged.'
);
assert.deepEqual(items, original, 'Sorting must not mutate the source feed');
const counts = newsCategoryCounts(items);
assert.equal(counts.find((category) => category.id === 'all').count, 4);
assert.equal(counts.find((category) => category.id === 'tech').count, 2);
assert.equal(counts.filter((category) => category.id !== 'all').reduce((sum, category) => sum + category.count, 0), items.length);
assert.equal(newsCategoryCounts([]).every((category) => category.count === 0), true);
assert.equal(getNewsCategory('finance'), 'finance');
assert.equal(getNewsCategory('all'), 'all');
assert.equal(getNewsCategory(null), 'all');
assert.equal(getNewsCategory('unknown'), 'all');
assert.equal(newsPriority(78), 'high');
assert.equal(newsPriority(77), 'mid');
assert.equal(newsPriority(58), 'mid');
assert.equal(newsPriority(57), 'low');
assert.equal(newsTimestamp('bad'), 0);
assert.equal(newsTimestamp(undefined), 0);
assert.equal(formatNewsTime('bad'), '时间待核验');
assert.equal(formatNewsTime(undefined), '时间待核验');
const now = Date.parse('2026-08-28T12:00:00Z');
assert.equal(formatNewsSync(undefined, now), '尚未同步');
assert.equal(formatNewsSync('bad', now), '尚未同步');
assert.equal(formatNewsSync('2026-08-28T12:00:00Z', now), '刚刚');
assert.equal(formatNewsSync('2026-08-28T11:58:00Z', now), '2 分钟前');
assert.equal(formatNewsSync('2026-08-28T10:00:00Z', now), '2 小时前');
assert.equal(formatNewsSync('2026-08-26T12:00:00Z', now), '2 天前');
console.log('News presentation checks passed: sorting, filtering, counts, priority, invalid dates and sync time.');
