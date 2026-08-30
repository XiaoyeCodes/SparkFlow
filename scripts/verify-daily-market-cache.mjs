import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDailyMarketCache, getBeijingDate } from '../src/lib/dailyMarketCache.ts';

class MemoryBackend {
  values = new Map();

  async read(key) {
    return this.values.get(key) ?? null;
  }

  async write(key, value) {
    this.values.set(key, value);
  }

  async removeOtherDates(currentDate) {
    for (const key of this.values.keys()) {
      if (!key.startsWith(`${currentDate}:`)) this.values.delete(key);
    }
  }
}

assert.equal(getBeijingDate(new Date('2026-08-29T15:59:59.000Z')), '2026-08-29');
assert.equal(getBeijingDate(new Date('2026-08-29T16:00:00.000Z')), '2026-08-30');

let now = new Date('2026-08-29T03:00:00.000Z');
const backend = new MemoryBackend();
const cache = createDailyMarketCache({ backend, now: () => now });
let valuationLoads = 0;
const valuationLoader = async () => ({ generatedAt: now.toISOString(), sequence: ++valuationLoads });

const first = await cache.load({ market: 'china', resource: 'valuation', loader: valuationLoader });
const second = await cache.load({ market: 'china', resource: 'valuation', loader: valuationLoader });
assert.equal(first.sequence, 1);
assert.equal(second.sequence, 1);
assert.equal(valuationLoads, 1, '同一北京时间日期内应只请求一次');

const restoredCache = createDailyMarketCache({ backend, now: () => now });
const restored = await restoredCache.load({ market: 'china', resource: 'valuation', loader: valuationLoader });
assert.equal(restored.sequence, 1);
assert.equal(valuationLoads, 1, '页面刷新后应从持久缓存恢复');

let concurrentLoads = 0;
const [concurrentA, concurrentB] = await Promise.all([
  cache.load({
    market: 'us',
    resource: 'valuation',
    loader: async () => {
      concurrentLoads += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { value: 42 };
    },
  }),
  cache.load({
    market: 'us',
    resource: 'valuation',
    loader: async () => {
      concurrentLoads += 1;
      return { value: 99 };
    },
  }),
]);
assert.equal(concurrentLoads, 1, '并发的相同请求应合并');
assert.deepEqual(concurrentA, concurrentB);

await cache.load({ market: 'hongkong', resource: 'valuation', loader: async () => ({ market: 'hk' }) });
assert.equal(valuationLoads, 1, '不同市场使用独立缓存键');

const forced = await cache.load({ market: 'china', resource: 'valuation', loader: valuationLoader, force: true });
assert.equal(forced.sequence, 2);
assert.equal(valuationLoads, 2, '显式刷新应绕过当天缓存');

now = new Date('2026-08-29T16:00:01.000Z');
const nextDay = await cache.load({ market: 'china', resource: 'valuation', loader: valuationLoader });
assert.equal(nextDay.sequence, 3);
assert.equal(valuationLoads, 3, '北京时间跨日后必须重新加载');
assert.ok([...backend.values.keys()].every((key) => key.startsWith('2026-08-30:')), '跨日写入后应清理旧日期缓存');

const heatmapSource = await readFile(new URL('../src/components/ChinaMarketHeatmap.tsx', import.meta.url), 'utf8');
const marketSource = await readFile(new URL('../src/routes/Market.tsx', import.meta.url), 'utf8');
assert.match(heatmapSource, /const REFRESH_INTERVAL_MS = 3_000;/, '核心热力图必须保持 3 秒刷新');
assert.doesNotMatch(heatmapSource, /loadDailyMarketData/, '实时热力图不可进入日级缓存');
assert.match(marketSource, /setInterval\(\(\) => void refreshQuotes\(\), 3000\)/, '核心指数卡必须保持 3 秒刷新');
assert.doesNotMatch(marketSource, /resource: 'heatmap'/, '板块热力图请求不可进入日级缓存');

console.log('daily analysis cache and live market refresh verification passed');
