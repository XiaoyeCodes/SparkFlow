import type { DailyBriefSnapshot } from '../src/lib/dailyBriefTypes.ts';

export type DailyBriefRepairTask = {
  id: string;
  label: string;
  needed: (snapshot: DailyBriefSnapshot) => boolean;
  blocked?: (snapshot: DailyBriefSnapshot) => string | undefined;
  load: (snapshot: DailyBriefSnapshot) => Promise<(draft: DailyBriefSnapshot) => void>;
};

/** At most two missing sources at once; successful fields are never reloaded. */
export async function runDailyBriefRepairs(options: {
  tasks: DailyBriefRepairTask[];
  get: () => DailyBriefSnapshot;
  commit: (change: (draft: DailyBriefSnapshot) => void) => Promise<void>;
  now?: () => number;
  active?: () => boolean;
}) {
  const now = options.now ?? Date.now;
  let next = 0;
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (next < options.tasks.length) {
      if (options.active && !options.active()) return;
      const task = options.tasks[next++];
      const current = options.get();
      if (!task.needed(current)) continue;
      const previous = current.repair?.[task.id];
      if (previous?.nextRetryAt && Date.parse(previous.nextRetryAt) > now()) continue;
      const blocked = task.blocked?.(current);
      let patch: ((draft: DailyBriefSnapshot) => void) | undefined;
      let error = blocked;
      if (!blocked) {
        try { patch = await task.load(structuredClone(current)); }
        catch { error = '数据源请求失败，稍后自动重试'; }
      }
      await options.commit(draft => {
        if (!task.needed(draft)) return;
        try {
          const candidate = structuredClone(draft);
          patch?.(candidate);
          Object.assign(draft, candidate);
        } catch { error = '数据格式未通过校验，稍后自动重试'; }
        const incomplete = task.needed(draft);
        const attempts = incomplete ? (previous?.attempts ?? 0) + 1 : 0;
        const delay = blocked ? 300_000 : Math.min(300_000, 30_000 * 2 ** Math.min(attempts - 1, 4));
        draft.repair = { ...draft.repair, [task.id]: {
          label: task.label, state: !incomplete ? 'ready' : blocked ? 'blocked' : 'failed', attempts,
          checkedAt: new Date(now()).toISOString(),
          ...(incomplete ? { nextRetryAt: new Date(now() + delay).toISOString(), detail: error || '来源尚未提供完整数据，稍后自动重试' } : {}),
        } };
      }).catch(() => undefined); // Keep other jobs isolated when persistence fails.
    }
  }));
}
