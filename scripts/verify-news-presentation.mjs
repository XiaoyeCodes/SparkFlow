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
