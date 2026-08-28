import { fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export type DailyHotStatus = { state: 'starting' | 'ready' | 'error' | 'stopped'; frontendUrl?: string; pid?: number; error?: string; apiVersion: string };

export function createDailyHotService(options: { root: string; log?: (message: string) => void; startupTimeoutMs?: number; runner?: string; maxRestarts?: number }) {
  let child: ChildProcess | undefined;
  let pending: Promise<DailyHotStatus> | undefined;
  let closed = false;
  let restarts = 0;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let status: DailyHotStatus = { state: 'stopped', apiVersion: '2.0.8' };
  const log = options.log || console.log;
  const runner = options.runner || path.join(options.root, 'services/dailyhot/runner.mjs');

  const onParentExit = () => { child?.kill(); };
  process.once('exit', onParentExit);

  async function launch(): Promise<DailyHotStatus> {
    if (!existsSync(runner) || (!options.runner && (!existsSync(path.join(options.root, 'services/dailyhot/web-dist/index.html')) || !existsSync(path.join(options.root, 'services/dailyhot/api-runtime/app.js'))))) {
      throw new Error('DailyHot 尚未准备好，请先运行 npm run dailyhot:setup');
    }
    const stateDir = path.join(options.root, '.sparkflow/dailyhot');
    await mkdir(stateDir, { recursive: true });
    if (closed) throw new Error('DailyHot 服务已停止');
    status = { state: 'starting', apiVersion: '2.0.8' };
    return new Promise((resolve, reject) => {
      // Do not copy SparkFlow API keys, unrelated .env settings, or a user's
      // authenticated cookies into this third-party process.
      const env: NodeJS.ProcessEnv = {};
      for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE']) if (process.env[key]) env[key] = process.env[key];
      Object.assign(env, { NODE_ENV: 'production', USE_LOG_FILE: 'true', CACHE_TTL: '600', REQUEST_TIMEOUT: '8000', DISALLOW_ROBOT: 'false', ALLOWED_DOMAIN: '', ALLOWED_HOST: '127.0.0.1' });
      if (process.env.DAILYHOT_ZHIHU_COOKIE) env.ZHIHU_COOKIE = process.env.DAILYHOT_ZHIHU_COOKIE;
      const spawned = fork(runner, [], { cwd: stateDir, env, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      child = spawned;
      status.pid = spawned.pid;
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; spawned.kill(); reject(new Error('DailyHot 启动超时')); } }, options.startupTimeoutMs ?? 15_000);
      const fail = (error: Error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } };
      spawned.stdout?.on('data', (data: Buffer) => log('[dailyhot] ' + data.toString().trim().slice(0, 1000)));
      spawned.stderr?.on('data', (data: Buffer) => log('[dailyhot] ' + data.toString().trim().slice(0, 1000)));
      spawned.once('error', (error) => { if (child === spawned) child = undefined; fail(error); });
      spawned.on('message', async (message: unknown) => {
        const ready = message as { type?: string; port?: number; pid?: number };
        if (settled || ready?.type !== 'ready' || ready.pid !== spawned.pid || !Number.isInteger(ready.port) || ready.port! < 1 || ready.port! > 65535) return;
        const frontendUrl = `http://127.0.0.1:${ready.port}/`;
        try {
          const response = await fetch(frontendUrl + 'health', { signal: AbortSignal.timeout(2500) });
          const health = await response.json() as { service?: string; pid?: number; ok?: boolean };
          if (!response.ok || !health.ok || health.service !== 'sparkflow-dailyhot' || health.pid !== spawned.pid) throw new Error('DailyHot 健康检查失败');
          if (settled || closed || child !== spawned) return;
          settled = true;
          clearTimeout(timer);
          status = { state: 'ready', apiVersion: '2.0.8', frontendUrl, pid: spawned.pid };
          log(`[dailyhot] Ready ${frontendUrl} (managed PID ${spawned.pid})`);
          resolve({ ...status });
        } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); spawned.kill(); }
      });
      spawned.once('exit', (code, signal) => {
        const current = child === spawned;
        const wasReady = status.state === 'ready' && child === spawned;
        if (child === spawned) child = undefined;
        fail(new Error(`DailyHot 进程退出 (${code ?? signal})`));
        if (closed || !current) return;
        status = { state: 'error', apiVersion: '2.0.8', error: `DailyHot 进程退出 (${code ?? signal})` };
        if (wasReady && restarts < (options.maxRestarts ?? 3)) {
          restarts++;
          restartTimer = setTimeout(() => { restartTimer = undefined; void start().catch((error) => log(String(error))); }, 300 * restarts);
          restartTimer.unref();
        }
      });
    });
  }

  function start(): Promise<DailyHotStatus> {
    if (closed) return Promise.reject(new Error('DailyHot 服务已停止'));
    if (status.state === 'ready' && child?.connected) return Promise.resolve({ ...status });
    if (pending) return pending;
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = undefined; }
    pending = launch().catch((error) => {
      if (!closed) status = { state: 'error', apiVersion: '2.0.8', error: error instanceof Error ? error.message : String(error) };
      throw error;
    }).finally(() => { pending = undefined; });
    return pending;
  }

  async function stop() {
    closed = true;
    if (restartTimer) clearTimeout(restartTimer);
    const owned = child;
    status = { state: 'stopped', apiVersion: '2.0.8' };
    if (owned && owned.exitCode === null && owned.signalCode === null) {
      await new Promise<void>((resolve) => {
        const force = setTimeout(() => owned.kill('SIGKILL'), 2200);
        owned.once('exit', () => { clearTimeout(force); resolve(); });
        if (owned.connected) owned.send({ type: 'shutdown' }, (error) => { if (error) owned.kill(); });
        else owned.kill();
      });
    }
    process.removeListener('exit', onParentExit);
  }
  return { start, stop, getStatus: () => ({ ...status }) };
}
