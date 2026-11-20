import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { compareBriefRevisions, dailyBriefDate, dailyBriefExpiresAt, isCurrentDailyBrief, isFreshDailyBrief, nextDailyBriefUpdateAt } from '../src/lib/dailyBriefFreshness.ts';
import { runDailyBriefRepairs, type DailyBriefRepairTask } from './dailyBriefRepair.ts';
import { withinBriefDeadline } from './dailyBriefDeadline.ts';
import type {
  DailyBriefArchivePreview,
  DailyBriefResponse,
  DailyBriefSlot,
  DailyBriefSnapshot,
} from "../src/lib/dailyBriefTypes";

// An interrupted desktop process may leave a lock with no writer. Normal
// generation is bounded to 45 s; leave room for the atomic disk writes.
const LOCK_STALE_MS = 90_000;
const HISTORY_DAYS = 90;

type BriefWindow = { date: string; slot: DailyBriefSlot };
type GenerateBrief = (window: BriefWindow) => Promise<DailyBriefSnapshot>;

export function getDailyBriefWindow(now = new Date()): BriefWindow {
  // Preserve the existing file slot; generatedAt identifies each hourly revision.
  return { date: dailyBriefDate(now), slot: 'morning' };
}

export function getNextDailyBriefRun(now = new Date()) {
  return new Date(nextDailyBriefUpdateAt(now.getTime()));
}

async function exists(filePath: string) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isSnapshot(value: unknown): value is DailyBriefSnapshot {
  const item = value as Partial<DailyBriefSnapshot> | null;
  const editorial = item?.editorial;
  return Boolean(
    item &&
    item.version === 18 &&
    /^\d{4}-\d{2}-\d{2}$/.test(item.date || "") &&
    dailyBriefDate(item.generatedAt || '') === item.date &&
    ["morning", "midday", "evening"].includes(item.slot || "") &&
    typeof item.summary?.headline === 'string' && Array.isArray(item.summary.highlights) &&
    Array.isArray(item.markets) && Array.isArray(item.news) && Array.isArray(item.sources) &&
    editorial?.signals && editorial.onchain && editorial.sentiment?.vix && editorial.sentiment.cryptoFearGreed &&
    editorial.sentiment.stockFearGreed && editorial.sentiment.mvrvZScore &&
    [editorial.indices, editorial.stocks, editorial.crypto, editorial.macroAssets, editorial.assetGroups,
      editorial.marketSeries, editorial.events, editorial.sentiment.stockComponents].every(Array.isArray),
  );
}

async function readSnapshot(filePath: string) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return isSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function hasDashboardReadings(snapshot: DailyBriefSnapshot) {
  const e = snapshot.editorial;
  if (!e) return false;
  return [e.sentiment.vix.value, e.sentiment.cryptoFearGreed.value, e.sentiment.stockFearGreed.value,
    e.sentiment.mvrvZScore.value, e.futuresLongShort?.longAccount].some(Number.isFinite)
    || [...e.indices, ...e.stocks, ...e.macroAssets, ...e.crypto, ...e.assetGroups.flatMap(group => group.items)]
      .some(quote => Number(quote.price) > 0)
    || e.crypto.some(quote => quote.symbol === 'BTC' && (quote.history?.length ?? 0) > 1);
}

async function atomicJsonWrite(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

export function createDailyBriefService(options: {
  stateDir: string;
  generate: GenerateBrief;
  generationTimeoutMs?: number;
  repairTasks?: () => DailyBriefRepairTask[];
  onSnapshot?: (snapshot: DailyBriefSnapshot) => Promise<unknown>;
  now?: () => Date;
}) {
  const root = path.join(options.stateDir, "daily-brief");
  const clock = options.now || (() => new Date());
  const running = new Map<string, Promise<DailyBriefResponse>>();
  const memory = new Map<string, DailyBriefSnapshot>();
  const repairs = new Map<string, Promise<void>>();
  let writes: Promise<unknown> = Promise.resolve();
  let currentSnapshot: DailyBriefSnapshot | null = null;
  let restored: Promise<void> | undefined;
  let scheduledFlight: Promise<DailyBriefResponse> | undefined;
  let retryAt = 0;
  let lastNotified = '';

  async function restoreLatest() {
    await (restored ??= (async () => {
      currentSnapshot = await latest();
      if (currentSnapshot) memory.set(locationsKey(currentSnapshot), currentSnapshot);
    })());
  }

  function notifySnapshot(snapshot: DailyBriefSnapshot) {
    if (!options.onSnapshot || !isFreshDailyBrief(snapshot, clock().getTime()) || lastNotified === snapshot.generatedAt) return;
    lastNotified = snapshot.generatedAt;
    startRepairs(snapshot);
    // Warm the model summary after selective repairs so visitors reuse its final inputs.
    void Promise.resolve(repairs.get(locationsKey(snapshot))).then(async () => {
      const completed = memory.get(locationsKey(snapshot)) || snapshot;
      if (completed.generatedAt === snapshot.generatedAt && isCurrentDailyBrief(completed, clock().getTime())) {
        await options.onSnapshot!(completed);
      }
    }).catch(() => { if (lastNotified === snapshot.generatedAt) lastNotified = ''; });
  }

  const pathsFor = ({ date, slot }: BriefWindow) => ({
    file: path.join(root, date, `${slot}.json`),
    lock: path.join(root, date, `${slot}.lock`),
    key: `${date}/${slot}`,
  });

  async function acquireLock(lockPath: string) {
    await mkdir(path.dirname(lockPath), { recursive: true });
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, createdAt: clock().toISOString() }),
      );
      return handle;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const lockStat = await stat(lockPath).catch(() => null);
      if (lockStat && clock().getTime() - lockStat.mtimeMs > LOCK_STALE_MS) {
        await rm(lockPath, { force: true });
        return acquireLock(lockPath);
      }
      return null;
    }
  }

  async function waitForPeer(filePath: string) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const snapshot = await readSnapshot(filePath);
      if (snapshot && isFreshDailyBrief(snapshot, clock().getTime())) return snapshot;
    }
    return null;
  }

  async function cleanupHistory() {
    const entries = await readdir(root, { withFileTypes: true }).catch(
      () => [],
    );
    const dated = entries
      .filter(
        (entry) =>
          entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name),
      )
      .sort()
      .reverse();
    await Promise.all(
      dated
        .slice(HISTORY_DAYS)
        .map((entry) =>
          rm(path.join(root, entry.name), { recursive: true, force: true }),
        ),
    );
  }

  async function generate(
    window: BriefWindow,
    force = false,
  ): Promise<DailyBriefResponse> {
    const locations = pathsFor(window);
    const inMemory = memory.get(locations.key);
    if (inMemory && !force) {
      return {
        snapshot: inMemory,
        cache: { hit: true, key: locations.key, generated: false },
      };
    }
    const cached = await readSnapshot(locations.file);
    if (cached && cached.date === window.date && cached.slot === window.slot) {
      if (!force) {
        memory.set(locations.key, cached);
        return {
          snapshot: cached,
          cache: { hit: true, key: locations.key, generated: false },
        };
      }
    }
    if (window.date !== dailyBriefDate(clock())) throw new Error('历史简报缓存未就绪，请读取当前小时的简报。');
    const lockHandle = await acquireLock(locations.lock);
    if (!lockHandle) {
      const peer = await waitForPeer(locations.file);
      if (peer) {
        memory.set(locations.key, peer);
        currentSnapshot = peer;
        return {
          snapshot: peer,
          cache: { hit: true, key: locations.key, generated: false },
        };
      }
      const stale = await readSnapshot(locations.file);
      if (stale) {
        memory.set(locations.key, stale);
        return {
          snapshot: stale,
          cache: { hit: true, key: locations.key, generated: false, stale: true },
        };
      }
      throw new Error("每日简报正在由另一任务生成，请稍后重试");
    }
    try {
      const snapshot = await withinBriefDeadline(options.generate(window), options.generationTimeoutMs ?? 45_000);
      if (
        !isSnapshot(snapshot) ||
        snapshot.date !== window.date ||
        snapshot.slot !== window.slot
      )
        throw new Error("每日简报生成结果无效");
      const previous = cached ?? currentSnapshot;
      if (previous && isCurrentDailyBrief(previous, clock().getTime()) && !hasDashboardReadings(snapshot) && hasDashboardReadings(previous)) {
        throw new Error('本次行情尚未就绪，继续显示上一份有效简报。');
      }
      await atomicJsonWrite(locations.file, snapshot);
      await atomicJsonWrite(path.join(root, "latest.json"), snapshot);
      memory.set(locations.key, snapshot);
      currentSnapshot = snapshot;
      for (const key of [...memory.keys()]) if (memory.size > 4 && key !== locations.key) memory.delete(key);
      notifySnapshot(snapshot);
      void cleanupHistory();
      return {
        snapshot,
        cache: { hit: false, key: locations.key, generated: true },
      };
    } finally {
      await lockHandle.close().catch(() => undefined);
      await rm(locations.lock, { force: true });
    }
  }

  function get(window = getDailyBriefWindow(clock()), force = false) {
    const key = `${window.date}/${window.slot}:${force ? "force" : "cached"}`;
    const active = running.get(key);
    if (active) return active;
    const request = generate(window, force)
      .catch(async (error) => {
        const fallback = await latest();
        if (fallback)
          return {
            snapshot: fallback,
            cache: {
              hit: true,
              key: locationsKey(fallback),
              generated: false,
              stale: true,
            },
          };
        throw error;
      })
      .finally(() => running.delete(key));
    running.set(key, request);
    return request;
  }

  async function latest() {
    // The dated edition is committed before latest.json. A crash between the
    // two renames can leave a missing, corrupt, or older pointer.
    const now = clock().getTime();
    const dates = [dailyBriefDate(now), dailyBriefDate(now - 86_400_000)];
    const candidates = await Promise.all([
      readSnapshot(path.join(root, 'latest.json')),
      ...dates.map(date => readSnapshot(pathsFor({ date, slot: 'morning' }).file)),
    ]);
    const usable = candidates.filter((item): item is DailyBriefSnapshot => !!item && Date.parse(item.generatedAt) <= now);
    if (usable.length) return usable.sort((a, b) => compareBriefRevisions(b, a))[0];
    const directories = await readdir(root, { withFileTypes: true }).catch(() => []);
    const olderDates = directories.filter(entry => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name) && entry.name < dates[1])
      .map(entry => entry.name).sort().reverse().slice(0, HISTORY_DAYS);
    for (const date of olderDates) {
      const archived = await readSnapshot(pathsFor({ date, slot: 'morning' }).file);
      if (archived?.date === date) return archived;
    }
    return null;
  }

  async function archivePreview(): Promise<DailyBriefArchivePreview | null> {
    await restoreLatest();
    const saved = currentSnapshot;
    if (!saved || isCurrentDailyBrief(saved, clock().getTime())) return null;
    return { date: saved.date, headline: saved.summary.headline, titles: (saved.news || []).slice(0, 3).map(item => item.title) };
  }

  async function getForPage(window = getDailyBriefWindow(clock())): Promise<DailyBriefResponse> {
    if (window.date !== dailyBriefDate(clock())) throw new Error('请读取当前简报，历史日期不会触发重新生成。');
    await restoreLatest();
    const cached = memory.get(pathsFor(window).key) || currentSnapshot;
    if (cached && isCurrentDailyBrief(cached, clock().getTime())) {
      if (!isFreshDailyBrief(cached, clock().getTime())) void refreshIfDue().catch(() => undefined);
      startRepairs(cached);
      notifySnapshot(cached);
      return pageResponse({ snapshot: cached, cache: { hit: true, key: locationsKey(cached), generated: false } });
    }
    const response = await refreshIfDue();
    if (!isCurrentDailyBrief(response.snapshot, clock().getTime())) {
      throw new Error('简报缓存正在准备，后台将自动重试。');
    }
    startRepairs(response.snapshot);
    return pageResponse(response);
  }

  function pageResponse(response: DailyBriefResponse): DailyBriefResponse {
    return { ...response, _pageCache: {
      state: isFreshDailyBrief(response.snapshot, clock().getTime()) ? 'fresh' : 'stale',
      storedAt: response.snapshot.generatedAt,
      expiresAt: new Date(dailyBriefExpiresAt(response.snapshot)).toISOString(),
    } };
  }

  function refreshIfDue(): Promise<DailyBriefResponse> {
    if (scheduledFlight) return scheduledFlight;
    scheduledFlight = (async () => {
      await restoreLatest();
      if (currentSnapshot && isCurrentDailyBrief(currentSnapshot, clock().getTime())) {
        if (isFreshDailyBrief(currentSnapshot, clock().getTime()) || retryAt > clock().getTime()) {
          startRepairs(currentSnapshot);
          notifySnapshot(currentSnapshot);
          return pageResponse({ snapshot: currentSnapshot, cache: { hit: true, key: locationsKey(currentSnapshot), generated: false } });
        }
      } else if (retryAt > clock().getTime()) throw new Error('简报后台正在等待重试');
      try {
        const response = await get(getDailyBriefWindow(clock()), true);
        retryAt = response.cache.stale ? clock().getTime() + 60_000 : 0;
        if (!isCurrentDailyBrief(response.snapshot, clock().getTime())) throw new Error('简报缓存已过期');
        startRepairs(response.snapshot);
        return pageResponse(response);
      } catch (error) {
        retryAt = clock().getTime() + 60_000;
        throw error;
      }
    })().finally(() => { scheduledFlight = undefined; });
    return scheduledFlight;
  }

  function startRepairs(snapshot: DailyBriefSnapshot) {
    if (!options.repairTasks || !snapshot.editorial || !isFreshDailyBrief(snapshot, clock().getTime())) return;
    const locations = pathsFor(snapshot);
    if (repairs.has(locations.key)) return;
    const task = runDailyBriefRepairs({ tasks: options.repairTasks(), now: () => clock().getTime(),
      active: () => isFreshDailyBrief(snapshot, clock().getTime()) && (memory.get(locations.key)?.generatedAt ?? snapshot.generatedAt) === snapshot.generatedAt,
      get: () => memory.get(locations.key) || snapshot,
      commit: change => {
        const write = writes.then(async () => {
          if (!isFreshDailyBrief(snapshot, clock().getTime())) return;
          const lock = await acquireLock(locations.lock);
          if (!lock) return; // A full generation owns this edition; do not race it.
          try {
            const current = await readSnapshot(locations.file);
            if (!current || current.generatedAt !== snapshot.generatedAt) return;
            const draft = structuredClone(current);
            change(draft);
            if (JSON.stringify(draft) === JSON.stringify(current)) return;
            const { repair: _beforeRepair, ...beforeData } = current;
            const { repair: _afterRepair, ...afterData } = draft;
            if (JSON.stringify(beforeData) !== JSON.stringify(afterData)) draft.updatedAt = clock().toISOString();
            await atomicJsonWrite(locations.file, draft);
            await atomicJsonWrite(path.join(root, 'latest.json'), draft);
            memory.set(locations.key, draft);
            currentSnapshot = draft;
          } finally {
            await lock.close().catch(() => undefined);
            await rm(locations.lock, { force: true });
          }
        });
        writes = write.catch(() => undefined);
        return write;
      },
    }).catch(() => undefined).finally(() => repairs.delete(locations.key));
    repairs.set(locations.key, task);
  }

  function schedule(onError: (error: unknown) => void = () => undefined) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const arm = () => {
      if (stopped) return;
      const now = clock();
      const next = getNextDailyBriefRun(now);
      const delay = Math.max(1_000, next.getTime() - now.getTime());
      timer = setTimeout(() => {
        void refreshIfDue()
          .catch(onError)
          .finally(arm);
      }, delay);
      timer.unref?.();
    };
    // Catch up missed hours after startup/sleep; readers keep the last success.
    void refreshIfDue().catch(onError);
    const recovery = setInterval(() => { if (!stopped) void refreshIfDue().catch(onError); }, 60_000);
    recovery.unref?.();
    arm();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      clearInterval(recovery);
    };
  }

  function locationsKey(snapshot: DailyBriefSnapshot) {
    return `${snapshot.date}/${snapshot.slot}`;
  }

  return { get, getForPage, latest, archivePreview, refreshIfDue, schedule, root,
    status: () => ({ generatedAt: currentSnapshot?.generatedAt || null, refreshing: running.size > 0,
      nextUpdateAt: getNextDailyBriefRun(clock()).toISOString(), retryAt: retryAt ? new Date(retryAt).toISOString() : null }) };
}
