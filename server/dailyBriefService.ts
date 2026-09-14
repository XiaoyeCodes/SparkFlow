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
import { dailyBriefDate, dailyBriefEditionDate, dailyBriefDayEnd, isCurrentDailyBrief } from '../src/lib/dailyBriefFreshness.ts';
import { runDailyBriefRepairs, type DailyBriefRepairTask } from './dailyBriefRepair.ts';
import type {
  DailyBriefResponse,
  DailyBriefSlot,
  DailyBriefSnapshot,
} from "../src/lib/dailyBriefTypes";

const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const LOCK_STALE_MS = 20 * 60_000;
const HISTORY_DAYS = 90;
const DAILY_BRIEF_HOUR = 9;

type BriefWindow = { date: string; slot: DailyBriefSlot };
type GenerateBrief = (window: BriefWindow) => Promise<DailyBriefSnapshot>;

function shanghaiParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
  };
}

export function getDailyBriefWindow(now = new Date()): BriefWindow {
  const local = shanghaiParts(now);
  if (local.hour >= DAILY_BRIEF_HOUR) return { date: local.date, slot: "morning" };
  const [year, month, day] = local.date.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 1));
  return { date: previous.toISOString().slice(0, 10), slot: "morning" };
}

export function getNextDailyBriefRun(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour);
  const targetHour = hour < DAILY_BRIEF_HOUR ? DAILY_BRIEF_HOUR : DAILY_BRIEF_HOUR + 24;
  const shanghaiAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    targetHour,
    0,
    0,
  );
  // Shanghai is UTC+8 throughout the year.
  return new Date(shanghaiAsUtc - 8 * 60 * 60_000);
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
  return Boolean(
    item &&
    item.version === 18 &&
    /^\d{4}-\d{2}-\d{2}$/.test(item.date || "") &&
    dailyBriefDate(item.generatedAt || '') === item.date &&
    ["morning", "midday", "evening"].includes(item.slot || "") &&
    item.summary &&
    Array.isArray(item.markets),
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

async function atomicJsonWrite(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

export function createDailyBriefService(options: {
  stateDir: string;
  generate: GenerateBrief;
  repairTasks?: () => DailyBriefRepairTask[];
  now?: () => Date;
}) {
  const root = path.join(options.stateDir, "daily-brief");
  const clock = options.now || (() => new Date());
  const running = new Map<string, Promise<DailyBriefResponse>>();
  const memory = new Map<string, DailyBriefSnapshot>();
  const repairs = new Map<string, Promise<void>>();
  let writes: Promise<unknown> = Promise.resolve();

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
      if (snapshot) return snapshot;
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
    if (window.date !== dailyBriefDate(clock())) throw new Error('上期简报缓存未就绪，请等待今日09:00更新。');
    const lockHandle = await acquireLock(locations.lock);
    if (!lockHandle) {
      const peer = await waitForPeer(locations.file);
      if (peer) {
        memory.set(locations.key, peer);
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
          cache: { hit: true, key: locations.key, generated: false },
        };
      }
      throw new Error("每日简报正在由另一任务生成，请稍后重试");
    }
    try {
      const snapshot = await options.generate(window);
      if (
        !isSnapshot(snapshot) ||
        snapshot.date !== window.date ||
        snapshot.slot !== window.slot
      )
        throw new Error("每日简报生成结果无效");
      await atomicJsonWrite(locations.file, snapshot);
      await atomicJsonWrite(path.join(root, "latest.json"), snapshot);
      memory.set(locations.key, snapshot);
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
    return readSnapshot(path.join(root, "latest.json"));
  }

  async function getForPage(window = getDailyBriefWindow(clock())): Promise<DailyBriefResponse> {
    if (window.date !== dailyBriefEditionDate(clock().getTime())) throw new Error('简报版次已过期，请刷新当前版次。');
    const response = await get(window);
    if (!isCurrentDailyBrief(response.snapshot, clock().getTime())) {
      throw new Error('今日简报尚未就绪，暂不展示往日数据，请稍后重试。');
    }
    startRepairs(response.snapshot);
    return { ...response, _pageCache: {
      state: response.cache.stale ? 'stale' : 'fresh',
      storedAt: response.snapshot.generatedAt,
      expiresAt: new Date(dailyBriefDayEnd(response.snapshot.date)).toISOString(),
    } };
  }

  function startRepairs(snapshot: DailyBriefSnapshot) {
    if (!options.repairTasks || !snapshot.editorial || !isCurrentDailyBrief(snapshot, clock().getTime())) return;
    const locations = pathsFor(snapshot);
    if (repairs.has(locations.key)) return;
    const task = runDailyBriefRepairs({ tasks: options.repairTasks(), now: () => clock().getTime(),
      active: () => isCurrentDailyBrief(snapshot, clock().getTime()) && (memory.get(locations.key)?.generatedAt ?? snapshot.generatedAt) === snapshot.generatedAt,
      get: () => memory.get(locations.key) || snapshot,
      commit: change => {
        const write = writes.then(async () => {
          if (!isCurrentDailyBrief(snapshot, clock().getTime())) return;
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
        void getForPage()
          .catch(onError)
          .finally(arm);
      }, delay);
      timer.unref?.();
    };
    // Restore/generate the current edition at startup, including a missed 09:00
    // run while the host was offline. Existing snapshots avoid model requests.
    void getForPage().catch(onError);
    const recovery = setInterval(() => { if (!stopped) void getForPage().catch(onError); }, 60_000);
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

  return { get, getForPage, latest, schedule, root };
}
