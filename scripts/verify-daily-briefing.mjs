import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createDailyBriefService,
  getDailyBriefWindow,
  getNextDailyBriefRun,
} from "../server/dailyBriefService.ts";

function snapshot(window, index) {
  const generatedAt =
    window.slot === "morning"
      ? `${window.date}T01:00:00.000Z`
      : window.slot === "midday"
        ? `${window.date}T04:00:00.000Z`
        : `${window.date}T09:00:00.000Z`;
  return {
    version: 18,
    date: window.date,
    slot: window.slot,
    generatedAt,
    updatedAt: generatedAt,
    summaryMode: "rules",
    summary: {
      headline: `snapshot-${index}`,
      regime: "test",
      tone: "balanced",
      highlights: [],
      risks: [],
      watchlist: [],
      portfolioNotes: [],
    },
    markets: [],
    macro: [],
    news: [],
    portfolio: { connected: false, positions: [] },
    sources: [],
    errors: [],
  };
}

assert.deepEqual(getDailyBriefWindow(new Date("2026-08-30T00:59:59Z")), {
  date: "2026-08-29",
  slot: "morning",
});
assert.deepEqual(getDailyBriefWindow(new Date("2026-08-30T01:00:00Z")), {
  date: "2026-08-30",
  slot: "morning",
});
assert.deepEqual(getDailyBriefWindow(new Date("2026-08-30T09:00:00Z")), {
  date: "2026-08-30",
  slot: "morning",
});
assert.equal(
  getNextDailyBriefRun(new Date("2026-08-30T00:01:00Z")).toISOString(),
  "2026-08-30T01:00:00.000Z",
);
assert.equal(
  getNextDailyBriefRun(new Date("2026-08-30T01:01:00Z")).toISOString(),
  "2026-08-31T01:00:00.000Z",
);

const root = await mkdtemp(path.join(tmpdir(), "sparkflow-daily-brief-"));
let calls = 0;
const window = { date: "2026-08-30", slot: "morning" };
const service = createDailyBriefService({
  stateDir: root,
  now: () => new Date("2026-08-30T01:30:00Z"),
  generate: async (target) => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return snapshot(target, calls);
  },
});

try {
  const [first, duplicate] = await Promise.all([
    service.get(window),
    service.get(window),
  ]);
  assert.equal(calls, 1, "concurrent requests must share one generation");
  assert.equal(
    first.snapshot.summary.headline,
    duplicate.snapshot.summary.headline,
  );
  const cached = await service.get(window);
  assert.equal(cached.cache.hit, true);
  assert.equal(calls, 1, "same date/slot must read disk cache");
  const forced = await service.get(window, true);
  assert.equal(
    forced.cache.generated,
    true,
    "explicit refresh must regenerate the current edition",
  );
  assert.equal(calls, 2);
  const stored = JSON.parse(
    await readFile(
      path.join(root, "daily-brief", "2026-08-30", "morning.json"),
      "utf8",
    ),
  );
  assert.equal(stored.date, "2026-08-30");
  assert.equal(stored.slot, "morning");
  const fallbackService = createDailyBriefService({
    stateDir: root,
    now: () => new Date("2026-08-30T04:30:00Z"),
    generate: async () => {
      throw new Error("upstream unavailable");
    },
  });
  const fallback = await fallbackService.get({
    date: "2026-08-30",
    slot: "midday",
  });
  assert.equal(
    fallback.cache.stale,
    true,
    "failed scheduled fetch must retain the last successful snapshot",
  );
  assert.equal(fallback.snapshot.summary.headline, "snapshot-2");
  // Disk restoration must render before an incomplete edition finishes retrying.
  let finish;
  let retries = 0;
  const restored = createDailyBriefService({
    stateDir: root,
    now: () => new Date('2026-08-30T04:30:00Z'),
    generate: async target => {
      retries++;
      await new Promise(resolve => { finish = resolve; });
      return { ...snapshot(target, 3), summaryMode: 'ai' };
    },
  });
  const page = await restored.getForPage(window);
  assert.equal(page.snapshot.summary.headline, 'snapshot-2');
  assert.equal(page._pageCache.state, 'stale');
  assert.equal(page._pageCache.expiresAt, '2026-08-31T01:00:00.000Z');
  await restored.getForPage(window);
  await restored.getForPage(window);
  for (let i = 0; !finish && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(retries, 1, 'background retry is coalesced and throttled');
  finish();
  await restored.get(window, true);
  assert.equal((await restored.getForPage(window))._pageCache.state, 'fresh');
  let restartCalls = 0;
  const restart = createDailyBriefService({ stateDir: root, now: () => new Date('2026-08-30T04:30:00Z'),
    generate: async () => { restartCalls++; throw new Error('complete edition must not regenerate during warmup'); } });
  const errors = [];
  const stop = restart.schedule(error => errors.push(error));
  assert.equal((await restart.getForPage(window)).snapshot.summary.headline, 'snapshot-3');
  stop();
  assert.equal(restartCalls, 0);
  assert.deepEqual(errors, []);
  const startup = createDailyBriefService({ stateDir: root, now: () => new Date('2026-08-31T04:30:00Z'),
    generate: async target => { restartCalls++; return { ...snapshot(target, 4), summaryMode: 'ai' }; } });
  const stopStartup = startup.schedule(error => errors.push(error));
  assert.equal((await startup.getForPage()).snapshot.date, '2026-08-31');
  stopStartup();
  assert.equal(restartCalls, 1, 'startup catches up a missed morning edition once');
  console.log(
    "[daily-brief] cache, lock, schedule-window and persistence checks passed.",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
