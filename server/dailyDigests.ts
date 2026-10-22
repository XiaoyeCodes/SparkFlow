import { mkdir, readFile, rename, unlink, writeFile, open, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { DAILY_DIGESTS, type DailyDigestId, type DigestEdition, type DigestIndex } from '../src/lib/dailyDigestTypes.ts';

const DAY = 86_400_000;
const OFFSET = 8 * 3_600_000;
export function digestSchedule(now: number, hour: number) {
  const local = new Date(now + OFFSET);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - OFFSET;
  const todayDue = midnight + hour * 3_600_000;
  const due = now >= todayDue ? todayDue : todayDue - DAY;
  return { dueDate: new Date(due + OFFSET).toISOString().slice(0, 10), nextRunAt: new Date(due + DAY).toISOString() };
}
export class DigestGenerationError extends Error {
  waiting: boolean;
  constructor(message: string, waiting = false) { super(message); this.waiting = waiting; }
}
type Generator = (id: DailyDigestId, date: string, signal: AbortSignal) => Promise<Omit<DigestEdition, 'schema' | 'revision'>>;
type Options = { cacheDir: string; generate: Generator; now?: () => number; tickMs?: number; enabledIds?: readonly DailyDigestId[]; requiresUpgrade?: (id: DailyDigestId, edition: DigestEdition) => boolean };
type Attempt = { date: string; failures: number; at: string; retry: number; error: string | null; waiting: boolean };

function validEdition(value: unknown, id: DailyDigestId): value is DigestEdition {
  const e = value as DigestEdition;
  return !!e && e.schema === 1 && e.id === id && /^\d{4}-\d{2}-\d{2}$/.test(e.editionDate)
    && e.sourceDate === e.editionDate && /^https:\/\//.test(e.sourceUrl)
    && Number.isFinite(Date.parse(e.generatedAt)) && typeof e.html === 'string' && e.html.includes('</html>')
    && e.html.length < 12_000_000 && typeof e.text === 'string' && e.text.length > 0
    && Number.isInteger(e.itemCount) && e.itemCount > 0 && ['ready', 'degraded'].includes(e.quality)
    && Array.isArray(e.warnings) && e.warnings.every(w => typeof w === 'string') && /^[a-f0-9]{64}$/.test(e.revision);
}
function editionHash(value: Omit<DigestEdition, 'schema' | 'revision'>) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function createDailyDigests(options: Options) {
  const now = options.now ?? Date.now;
  const specs = DAILY_DIGESTS.filter(spec => !options.enabledIds || options.enabledIds.includes(spec.id));
  const editions = new Map<DailyDigestId, DigestEdition>();
  const attempts = new Map<DailyDigestId, Attempt>();
  const running = new Map<DailyDigestId, Promise<void>>();
  const controller = new AbortController();
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  let ticking: Promise<void> | undefined;
  const dir = (id: DailyDigestId) => path.join(options.cacheDir, id);
  async function restore(id: DailyDigestId) {
    try {
      const raw = await readFile(path.join(dir(id), 'latest.json'), 'utf8');
      if (raw.length > 16_000_000) throw new Error('Cache too large');
      const edition: unknown = JSON.parse(raw);
      if (validEdition(edition, id)) {
        const { schema: _schema, revision, ...content } = edition;
        if (revision === editionHash(content)) editions.set(id, edition);
      }
    } catch { /* Missing or invalid snapshots never count as a generated edition. */ }
  }
  async function lock(id: DailyDigestId) {
    await mkdir(dir(id), { recursive: true });
    const file = path.join(dir(id), 'worker.lock');
    const token = randomUUID();
    for (let n = 0; n < 2; n++) {
      try {
        const handle = await open(file, 'wx');
        try { await handle.writeFile(JSON.stringify({ token, pid: process.pid, startedAt: now() })); }
        finally { await handle.close(); }
        return async () => {
          try { if (JSON.parse(await readFile(file, 'utf8')).token === token) await unlink(file); } catch { /* Already removed. */ }
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          const owner = JSON.parse(await readFile(file, 'utf8'));
          if (!Number.isInteger(owner.pid) || owner.pid <= 0) return null;
          // Generation has a four-minute hard deadline. Recover abandoned locks
          // even when Windows has since reused the former owner's process ID.
          if (typeof owner.startedAt === 'number' && now() - owner.startedAt > 600_000) { await unlink(file); continue; }
          try { process.kill(owner.pid, 0); return null; }
          catch (check) { if ((check as NodeJS.ErrnoException).code !== 'ESRCH') return null; }
          await unlink(file); // Only an owner process proven dead can lose its lock.
        } catch {
          // A crash while writing a lock can leave truncated JSON. Never remove
          // a freshly created lock that another process is still writing.
          try { if (Date.now() - (await stat(file)).mtimeMs > 60_000) { await unlink(file); continue; } } catch { /* Lock changed. */ }
          return null;
        }
      }
    }
    return null;
  }
  async function execute(id: DailyDigestId, date: string) {
    let release: (() => Promise<void>) | null = null;
    try {
      release = await lock(id);
      if (!release || stopped) return;
      await restore(id); // Another server may have completed while this process waited.
      const cached = editions.get(id);
      if (cached && cached.editionDate >= date && !options.requiresUpgrade?.(id, cached)) return;
      const previous = attempts.get(id);
      const attempt: Attempt = { date, failures: previous?.date === date ? previous.failures : 0, at: new Date(now()).toISOString(), retry: 0, error: null, waiting: false };
      attempts.set(id, attempt);
      try {
        const result = await options.generate(id, date, controller.signal);
        if (stopped || controller.signal.aborted) return;
        const revision = editionHash(result);
        const edition = { ...result, schema: 1 as const, revision };
        if (!validEdition(edition, id) || edition.editionDate !== date) throw new Error('日报输出的日期或内容校验未通过');
        const target = path.join(dir(id), 'latest.json');
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify(edition), 'utf8');
          if (stopped) return;
          await rename(temporary, target);
          editions.set(id, edition);
        } finally { await unlink(temporary).catch(() => undefined); }
      } catch (error) {
        if (stopped) return;
        attempt.failures++;
        attempt.error = error instanceof Error ? error.message.slice(0, 800) : '日报生成失败';
        attempt.waiting = error instanceof DigestGenerationError && error.waiting;
        attempt.retry = now() + Math.min(30, 5 * 2 ** Math.min(attempt.failures - 1, 3)) * 60_000;
        console.warn(`[daily-digests] ${id} ${date}: ${attempt.error}`);
      }
    } catch (error) {
      attempts.set(id, { date, failures: 1, at: new Date(now()).toISOString(), retry: now() + 300_000, error: `缓存读写失败：${String(error)}`, waiting: false });
    } finally { if (release) await release(); }
  }
  function tick() {
    if (stopped) return Promise.resolve();
    if (ticking) return ticking;
    ticking = (async () => {
      await Promise.all(specs.map(async spec => {
        if (running.has(spec.id)) return;
        await restore(spec.id);
        if (stopped || running.has(spec.id)) return;
        const { dueDate } = digestSchedule(now(), spec.hour);
        const cached = editions.get(spec.id);
        if (cached && cached.editionDate >= dueDate && !options.requiresUpgrade?.(spec.id, cached)) return;
        const attempt = attempts.get(spec.id);
        if (attempt?.date === dueDate && attempt.retry > now()) return;
        const job = execute(spec.id, dueDate).finally(() => running.delete(spec.id));
        running.set(spec.id, job);
      }));
    })().finally(() => { ticking = undefined; });
    return ticking;
  }
  function status(): DigestIndex {
    return { timezone: 'Asia/Shanghai', serverTime: new Date(now()).toISOString(), items: specs.map(spec => {
      const { dueDate, nextRunAt } = digestSchedule(now(), spec.hour);
      const cached = editions.get(spec.id);
      const attempt = attempts.get(spec.id);
      const current = cached && cached.editionDate >= dueDate && !options.requiresUpgrade?.(spec.id, cached);
      const failure = !current && attempt?.date === dueDate ? attempt.error : null;
      const edition = cached ? (({ html: _html, text: _text, data: _data, ...rest }) => rest)(cached) : null;
      const state = running.has(spec.id) ? 'generating' : current ? 'ready'
        : failure ? (attempt?.waiting ? 'waiting' : 'error') : cached ? 'stale' : 'empty';
      return { ...spec, dueDate, nextRunAt, state, edition, lastAttemptAt: attempt?.at ?? null, nextRetryAt: failure && attempt?.retry ? new Date(attempt.retry).toISOString() : null, error: failure };
    }) };
  }
  return {
    status,
    edition: (id: DailyDigestId) => editions.get(id) ?? null,
    tick,
    idle: async () => { await ticking; await Promise.all([...running.values()]); },
    start: async () => {
      if (timer || stopped) return;
      await Promise.all(specs.map(s => restore(s.id)));
      if (stopped) return;
      timer = setInterval(() => { void tick(); }, options.tickMs ?? 30_000);
      timer.unref();
      await tick(); // Dispatches independent jobs; does not wait for network generation.
    },
    stop: () => { stopped = true; clearInterval(timer); controller.abort(); },
  };
}

export function pythonDigestGenerator(rootDir: string, cacheDir: string): Generator {
  return async (id, date, signal) => {
    const home = path.join(rootDir, 'services', 'daily-digests');
    const python = path.join(home, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    if (!existsSync(python)) throw new Error('日报运行环境未就绪，请运行 npm run digests:setup 后重启项目');
    const runs = path.join(cacheDir, id, 'runs');
    await mkdir(runs, { recursive: true });
    // Bound retained evidence. Delete only direct, generated run directories inside this feature's cache.
    const entries = (await readdir(runs, { withFileTypes: true })).filter(e => e.isDirectory() && /^\d{13}-[a-f0-9-]{36}$/.test(e.name)).sort((a, b) => b.name.localeCompare(a.name));
    for (const entry of entries.slice(6)) await rm(path.join(runs, entry.name), { recursive: true, force: true });
    const run = path.join(runs, `${Date.now()}-${randomUUID()}`);
    await mkdir(run);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(python, [path.join(home, 'worker.py'), '--id', id, '--date', date, '--out', run], { cwd: home, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal, env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' } });
      let log = '';
      let timeout = false;
      const timer = setTimeout(() => { timeout = true; child.kill(); }, 240_000);
      const collect = (chunk: Buffer) => { log = (log + chunk.toString('utf8')).slice(-4000); };
      child.stdout.on('data', collect); child.stderr.on('data', collect);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new DigestGenerationError(timeout ? '来源请求超时，稍后自动重试' : log.trim() || `生成进程退出 ${code}`, code === 10)); });
    });
    const file = path.join(run, 'bundle.json');
    const raw = await readFile(file, 'utf8');
    if (raw.length > 16_000_000) throw new Error('日报文件超出大小限制');
    return JSON.parse(raw);
  };
}
