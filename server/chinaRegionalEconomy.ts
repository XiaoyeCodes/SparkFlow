import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { latestRegionalObservations, validRegionalObservation, type RegionalObservation, type RegionalSnapshot, type RegionalScopeStatus } from '../src/lib/chinaRegionalEconomy.ts';

const DAY = 86_400_000;
export function regionalNextCheck(status: RegionalScopeStatus['status'], now: number) {
  return new Date(now + (status === 'updated' ? 30 : status === 'partial' ? 7 : 1) * DAY).toISOString();
}

export function createRegionalEconomyService(options: {
  root: string; cacheFile: string; seed: RegionalSnapshot;
  sources: { scope: string; name: string }[];
  run?: (scope: string) => Promise<{ observations: RegionalObservation[]; errors: RegionalScopeStatus['errors'] }>;
  now?: () => number;
}) {
  const now = options.now || Date.now;
  let state: RegionalSnapshot = { observations: latestRegionalObservations(options.seed.observations), scopes: { ...options.seed.scopes } };
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let startup: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let child: ReturnType<typeof execFile> | undefined;
  const ready = readFile(options.cacheFile, 'utf8').then(raw => {
    const saved = JSON.parse(raw) as RegionalSnapshot;
    if (!Array.isArray(saved.observations)) return;
    state.observations = latestRegionalObservations([...state.observations, ...saved.observations]);
    for (const source of options.sources) {
      const status = saved.scopes?.[source.scope];
      if (status && Number.isFinite(Date.parse(status.nextCheckAt)) &&
        (!state.scopes[source.scope] || status.checkedAt > state.scopes[source.scope].checkedAt)) state.scopes[source.scope] = status;
    }
  }).catch(() => { /* First launch or corrupt cache: retain checked bundled data. */ });

  const run = options.run || ((scope: string) => new Promise<{ observations: RegionalObservation[]; errors: RegionalScopeStatus['errors'] }>((resolve, reject) => {
    child = execFile('python', [path.join(options.root, 'scripts/refresh_china_regional_economy.py'), '--scope', scope],
      { cwd: options.root, windowsHide: true, timeout: 240_000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout) => {
        child = undefined;
        if (error) { reject(new Error('官方数据检查失败；请确认 Python 及 requirements-china-regional.txt 中的依赖可用')); return; }
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error('官方数据检查未返回有效结果')); }
      });
  }));

  async function persist() {
    await mkdir(path.dirname(options.cacheFile), { recursive: true });
    const temp = `${options.cacheFile}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify({ observations: state.observations, scopes: state.scopes }), 'utf8');
    await rename(temp, options.cacheFile);
  }

  async function refresh(scope?: string) {
    await ready;
    if (stopped || running) return running;
    const due = options.sources.filter(s => !state.scopes[s.scope] || Date.parse(state.scopes[s.scope].nextCheckAt) <= now());
    const source = scope ? due.find(s => s.scope === scope) : due.sort((a, b) =>
      (state.scopes[a.scope]?.checkedAt || '').localeCompare(state.scopes[b.scope]?.checkedAt || ''))[0];
    if (!source) return;
    state.running = source.scope;
    running = (async () => {
      try {
        const result = await run(source.scope);
        if (stopped) return;
        if (!Array.isArray(result.observations) || !Array.isArray(result.errors)) throw new Error('数据格式不正确');
        const observations = result.observations.filter(o => validRegionalObservation(o) && o.adcode.startsWith(source.scope));
        const status = observations.length ? result.errors.length ? 'partial' : 'updated' : 'unavailable';
        state.observations = latestRegionalObservations([...state.observations, ...observations]);
        state.scopes[source.scope] = { name: source.name, status, count: observations.length,
          checkedAt: new Date(now()).toISOString(), nextCheckAt: regionalNextCheck(status, now()), errors: result.errors.slice(0, 50) };
      } catch (error) {
        if (stopped) return;
        state.scopes[source.scope] = { name: source.name, status: 'unavailable', count: 0,
          checkedAt: new Date(now()).toISOString(), nextCheckAt: regionalNextCheck('unavailable', now()),
          errors: [{ reason: error instanceof Error ? error.message : '检查失败' }] };
      }
      try { await persist(); }
      catch { state.scopes[source.scope].errors.push({ reason: '本机缓存写入失败，下次启动将重新检查' }); }
    })().finally(() => { running = null; state.running = null; });
    return running;
  }

  return {
    refresh,
    async snapshot(scope?: string) {
      await ready;
      if (scope && options.sources.some(s => s.scope === scope)) void refresh(scope);
      return { ...state, revision: createHash('sha1').update(JSON.stringify(state.observations)).digest('hex').slice(0, 12) };
    },
    start() {
      if (timer) return;
      stopped = false;
      startup = setTimeout(() => { void refresh(); }, 15_000);
      startup.unref();
      timer = setInterval(() => { void refresh(); }, 10 * 60_000);
      timer.unref();
    },
    stop() {
      stopped = true;
      if (startup) clearTimeout(startup);
      if (timer) clearInterval(timer);
      timer = undefined;
      child?.kill();
    },
  };
}
