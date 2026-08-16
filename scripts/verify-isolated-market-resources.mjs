import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ISOLATED_RESOURCE_MAX_ATTEMPTS,
  ISOLATED_RESOURCE_TIMEOUT_MS,
  requestIsolatedJson,
} from '../src/lib/isolatedResource.ts';

assert.equal(ISOLATED_RESOURCE_TIMEOUT_MS, 60_000, '每次独立请求应允许 60 秒');
assert.equal(ISOLATED_RESOURCE_MAX_ATTEMPTS, 3, '每条独立链路最多尝试 3 次');

let recoveredAttempts = 0;
const recovered = await requestIsolatedJson('/isolated/recovered', {
  retryDelayMs: 0,
  fetchImpl: async () => {
    recoveredAttempts += 1;
    if (recoveredAttempts < 3) return new Response(JSON.stringify({ error: 'temporary' }), { status: 503 });
    return new Response(JSON.stringify({ value: 42 }), { status: 200 });
  },
});
assert.deepEqual(recovered, { value: 42 });
assert.equal(recoveredAttempts, 3, '第三次成功后应立即停止重试');

let failedAttempts = 0;
await assert.rejects(
  requestIsolatedJson('/isolated/failed', {
    retryDelayMs: 0,
    fetchImpl: async () => {
      failedAttempts += 1;
      return new Response(JSON.stringify({ error: 'still unavailable' }), { status: 503 });
    },
  }),
  /still unavailable/,
);
assert.equal(failedAttempts, 3, '连续失败时必须在第三次后停止');

let timedOutAttempts = 0;
await assert.rejects(
  requestIsolatedJson('/isolated/timeout', {
    timeoutMs: 10,
    maxAttempts: 3,
    retryDelayMs: 0,
    fetchImpl: async (_url, init) => {
      timedOutAttempts += 1;
      return await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      });
    },
  }),
  /请求超过 0 秒/,
);
assert.equal(timedOutAttempts, 3, '超时同样只能独立尝试三次');

let healthyAttempts = 0;
let brokenAttempts = 0;
const isolatedResults = await Promise.allSettled([
  requestIsolatedJson('/isolated/healthy', {
    retryDelayMs: 0,
    fetchImpl: async () => {
      healthyAttempts += 1;
      return new Response(JSON.stringify({ id: 'healthy' }), { status: 200 });
    },
  }),
  requestIsolatedJson('/isolated/broken', {
    retryDelayMs: 0,
    fetchImpl: async () => {
      brokenAttempts += 1;
      return new Response(JSON.stringify({ error: 'broken' }), { status: 500 });
    },
  }),
]);
assert.equal(isolatedResults[0].status, 'fulfilled', '失败卡片不能拖累正常卡片');
assert.equal(isolatedResults[1].status, 'rejected');
assert.equal(healthyAttempts, 1);
assert.equal(brokenAttempts, 3);

const assetIds = ['vix', 'dxy', 'us10y', 'gold', 'brent', 'bitcoin', 'ethereum'];
const assetAttempts = new Map();
const assetResults = await Promise.allSettled(assetIds.map((id) => requestIsolatedJson(
  `/api/global-macro-asset?id=${id}`,
  {
    retryDelayMs: 0,
    fetchImpl: async () => {
      assetAttempts.set(id, (assetAttempts.get(id) || 0) + 1);
      if (id === 'gold') return new Response(JSON.stringify({ error: 'gold unavailable' }), { status: 503 });
      return new Response(JSON.stringify({ asset: { id } }), { status: 200 });
    },
  },
)));
assetResults.forEach((result, index) => {
  const id = assetIds[index];
  assert.equal(result.status, id === 'gold' ? 'rejected' : 'fulfilled', `${id} 的结果必须与其他资产隔离`);
  assert.equal(assetAttempts.get(id), id === 'gold' ? 3 : 1, `${id} 必须拥有独立重试计数`);
});

const frontend = await readFile(new URL('../src/components/GlobalMacroCommandCenter.tsx', import.meta.url), 'utf8');
const server = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
for (const endpoint of [
  '/api/global-macro-core-index',
  '/api/global-macro-fx-rate',
  '/api/global-macro-asset',
  '/api/global-macro-fed-rate',
]) {
  assert.match(frontend, new RegExp(endpoint), `前端缺少独立链路 ${endpoint}`);
  assert.match(server, new RegExp(endpoint), `服务端缺少独立接口 ${endpoint}`);
}
assert.match(frontend, /ISOLATED_CORE_INDEX_IDS\.forEach/, '核心指数必须逐项启动');
assert.match(frontend, /ISOLATED_FX_RATE_IDS\.forEach/, '汇率必须逐项启动');
assert.match(frontend, /ISOLATED_MARKET_ASSET_IDS\.forEach/, '七项高频资产必须逐项启动');
for (const id of assetIds) {
  assert.match(frontend, new RegExp(`['"]${id}['"]`), `前端缺少 ${id} 独立资源声明`);
  assert.match(server, new RegExp(`\\b${id}: \\{`), `服务端缺少 ${id} 独立资源配置`);
}

console.log('独立市场数据链路验证通过：60 秒超时、最多 3 次、七项资产单卡失败隔离。');
