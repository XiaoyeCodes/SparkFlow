import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { createUserDataPaths } from './userData.ts';
import type { StockStrategy, StrategyJob } from '../src/lib/stockStrategyTypes.ts';

type Ai = { apiKey: string; model: string; provider: string; baseUrl: string; useProxy: boolean };
type StoredJob = StrategyJob & { ownerPid?: number };
type Runner = (payload: Record<string, unknown>, onEvent: (event: Record<string, unknown>) => void, signal: AbortSignal) => Promise<void>;
const active = (job: StrategyJob) => job.status === 'queued' || job.status === 'running';
const alive = (pid?: number) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };
const publicJob = ({ ownerPid: _owner, ...job }: StoredJob): StrategyJob => job;
const safeError = (error: unknown, key = '') => {
  const message = error instanceof Error ? error.message : String(error);
  return (key ? message.split(key).join('[redacted]') : message)
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/sk-[\w-]{12,}/g, '[redacted]').slice(0, 800);
};

export function pythonStrategyRunner(root: string): Runner {
  return (payload, onEvent, signal) => new Promise((resolve, reject) => {
    const python = process.env.SPARKFLOW_STRATEGY_PYTHON || path.join(root, 'services/daily-stock-analysis/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const child: ChildProcessWithoutNullStreams = spawn(python, ['-u', path.join(root, 'scripts/stock-strategy-worker.py')], {
      cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    let pending = ''; let received = 0; let error = ''; let result = false;
    const cancel = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      // Windows venv python.exe is a launcher; terminate its worker child too.
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } else child.kill();
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      received += Buffer.byteLength(chunk);
      if (received > 8 * 1024 * 1024) { error = '研究结果超出大小限制'; cancel(); return; }
      pending += chunk;
      let end: number;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        try {
          const event = JSON.parse(line);
          if (event.type === 'error') error = String(event.message);
          if (event.type === 'result') result = true;
          onEvent(event);
        } catch { /* Ignore non-protocol output from a provider. */ }
      }
    });
    // Never forward raw third-party stderr; it can contain model credentials.
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', () => { signal.removeEventListener('abort', cancel); reject(new Error('研究引擎无法启动，请运行 npm run strategy:setup')); });
    child.on('close', code => {
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) reject(new Error('研究任务已停止'));
      else if (code !== 0 || !result) reject(new Error(error || '研究引擎未返回结果，请稍后重试'));
      else resolve();
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export async function readStrategyCatalog(root: string): Promise<StockStrategy[]> {
  const directory = path.join(root, 'services/daily-stock-analysis/strategies');
  const files = (await readdir(directory)).filter(name => name.endsWith('.yaml'));
  const rows = await Promise.all(files.map(async name => {
    const source = await readFile(path.join(directory, name), 'utf8');
    const field = (key: string) => source.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1].trim().replace(/^["']|["']$/g, '') || '';
    return { id: field('name'), name: field('display_name'), description: field('description'), category: field('category') };
  }));
  return rows.filter(row => row.id && row.name).sort((a, b) => a.id === 'bull_trend' ? -1 : b.id === 'bull_trend' ? 1 : a.name.localeCompare(b.name, 'zh-CN'));
}

export function createStockStrategyService(options: {
  root: string; directory: string; getAi: () => Promise<Ai>; runner?: Runner;
  runtimeReady?: () => boolean; timeoutMs?: number;
}) {
  const jobs = new Map<string, StoredJob>();
  const controllers = new Map<string, AbortController>();
  const runner = options.runner || pythonStrategyRunner(options.root);
  const jobsDirectory = path.join(options.directory, 'jobs');
  let loaded: Promise<void> | undefined;
  let mutation: Promise<unknown> = Promise.resolve();
  let pumping = false;
  let disposed = false;
  const writes = new Map<string, Promise<void>>();
  const catalogPromise = readStrategyCatalog(options.root);
  const runtimeReady = options.runtimeReady || (() => existsSync(path.join(options.root, 'services/daily-stock-analysis/.venv/.sparkflow-ready')));
  const persist = (job: StoredJob) => {
    const json = JSON.stringify(job, null, 2);
    const flight = (writes.get(job.id) || Promise.resolve()).catch(() => {}).then(async () => {
      await mkdir(jobsDirectory, { recursive: true });
      const filename = path.join(jobsDirectory, `${job.id}.json`);
      const temporary = `${filename}.${randomUUID()}.tmp`;
      await writeFile(temporary, json, { mode: 0o600 });
      await rename(temporary, filename);
    });
    writes.set(job.id, flight);
    return flight;
  };
  const ensure = () => loaded ||= (async () => {
    await mkdir(jobsDirectory, { recursive: true });
    for (const name of await readdir(jobsDirectory)) {
      if (!/^[\da-f-]{36}\.json$/.test(name)) continue;
      // Do not overwrite unreadable history; surface the failure instead.
      const job: StoredJob = JSON.parse(await readFile(path.join(jobsDirectory, name), 'utf8'));
      if (active(job) && !alive(job.ownerPid)) {
        job.status = 'interrupted'; job.message = '服务已重启，任务中断，可手动重新分析';
        job.updatedAt = new Date().toISOString(); await persist(job);
      }
      jobs.set(job.id, job);
    }
  })();
  const run = async (job: StoredJob) => {
    let key = '';
    const controller = new AbortController(); controllers.set(job.id, controller);
    const timeout = setTimeout(() => controller.abort(new Error('分析超时，请重试或更换策略')), options.timeoutMs ?? 12 * 60_000);
    try {
      const ai = await options.getAi(); key = ai.apiKey;
      if (!ai.apiKey || !ai.model || !ai.baseUrl) throw new Error('请先在设置中保存模型、API Key 和 Base URL');
      if (controller.signal.aborted) throw new Error('任务已停止');
      job.status = 'running'; job.model = ai.model; job.message = '正在启动研究引擎'; job.progress = 3;
      await persist(job);
      let result: StrategyJob['result'];
      const previousReport = job.mode === 'chat' ? jobs.get(job.sessionId)?.result?.report : undefined;
      await runner({ ...publicJob(job), ai, previousReport, dataDir: options.directory, proxyUrl: process.env.SPARKFLOW_STRATEGY_PROXY || 'http://127.0.0.1:7890' }, event => {
        if (controller.signal.aborted) return;
        if (event.type === 'progress') {
          job.progress = Math.max(job.progress, Math.min(95, Number(event.progress) || 5));
          job.message = safeError(event.message || '正在分析', key); job.updatedAt = new Date().toISOString();
          void persist(job).catch(() => controller.abort(new Error('研究进度无法保存')));
        }
        if (event.type === 'result') result = JSON.parse(JSON.stringify(event.result).split(key).join('[redacted]'));
      }, controller.signal);
      if (controller.signal.aborted) throw controller.signal.reason;
      if (!result?.report && !result?.content) throw new Error('研究引擎返回了空报告');
      job.result = result; job.status = 'completed'; job.progress = 100; job.message = '研究已完成';
    } catch (error) {
      if (job.status !== 'cancelled') {
        job.status = disposed ? 'interrupted' : 'failed';
        job.message = safeError(controller.signal.aborted ? controller.signal.reason || error : error, key);
      }
    } finally {
      clearTimeout(timeout); controllers.delete(job.id);
      job.updatedAt = new Date().toISOString(); await persist(job);
    }
  };
  const pump = async () => {
    if (pumping || disposed) return;
    pumping = true;
    try {
      let next: StoredJob | undefined;
      while (!disposed && (next = [...jobs.values()].find(job => job.status === 'queued' && job.ownerPid === process.pid))) await run(next);
    } finally { pumping = false; }
  };
  return {
    async state() {
      await ensure();
      await Promise.all(writes.values());
      const ai = await options.getAi();
      return {
        ready: runtimeReady(), configured: Boolean(ai.apiKey && ai.model && ai.baseUrl), model: ai.model, provider: ai.provider,
        strategies: await catalogPromise,
        jobs: [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(job => {
          const { result, ...summary } = publicJob(job);
          return { ...summary, ...(result ? { result: { stock_name: result.stock_name } } : {}) };
        }),
      };
    },
    async get(id: string) { await ensure(); await writes.get(id); const job = jobs.get(id); return job ? publicJob(job) : null; },
    async start(body: Record<string, unknown>) {
      const operation = mutation.catch(() => {}).then(async () => {
        await ensure();
        if (disposed) throw new Error('研究服务正在重启，请稍后重试');
        if (!runtimeReady()) throw new Error('研究引擎尚未安装，请运行 npm run strategy:setup');
        const ai = await options.getAi();
        if (!ai.apiKey || !ai.model || !ai.baseUrl) throw new Error('请先在设置中保存模型、API Key 和 Base URL');
        const symbol = String(body.symbol || '').trim().toUpperCase();
        if (!/^(?:\d{6}|HK\d{5}|[A-Z][A-Z0-9.-]{0,14}|\d{4,6}\.(?:T|TW|TWO|KS|KQ|HK|SH|SZ))$/.test(symbol)) throw new Error('请输入股票代码，例如 600519、HK00700 或 AAPL');
        const mode = body.mode === 'chat' ? 'chat' : 'report';
        const question = mode === 'chat' ? String(body.question || '').trim() : '';
        if (mode === 'chat' && (!question || question.length > 4000)) throw new Error('请输入 1–4000 字的研究问题');
        const catalog = await catalogPromise;
        const strategies = [...new Set(Array.isArray(body.strategies) ? body.strategies.map(String) : [])];
        if (strategies.length > 3 || strategies.some(id => !catalog.some(row => row.id === id))) throw new Error('请从策略列表中选择最多 3 项');
        const parent = body.sessionId ? jobs.get(String(body.sessionId)) || [...jobs.values()].find(job => job.sessionId === body.sessionId) : undefined;
        if (body.sessionId && (!parent || parent.symbol !== symbol)) throw new Error('问答会话与当前股票不一致，请新建研究');
        const duplicate = [...jobs.values()].find(job => active(job) && job.symbol === symbol && job.mode === mode && job.question === question && job.strategies.join(',') === strategies.join(',') && (mode !== 'chat' || (parent ? job.sessionId === parent.sessionId : job.sessionId === job.id)));
        if (duplicate) return publicJob(duplicate);
        if ([...jobs.values()].filter(active).length >= 10) throw new Error('待处理任务较多，请等待当前研究完成');
        const id = randomUUID(); const now = new Date().toISOString();
        const job: StoredJob = { id, symbol, mode, question, strategies, sessionId: parent?.sessionId || id,
          status: 'queued', progress: 0, message: '等待开始研究', createdAt: now, updatedAt: now, model: ai.model, ownerPid: process.pid };
        await persist(job); jobs.set(id, job);
        void pump().catch(() => {});
        return publicJob(job);
      });
      mutation = operation; return operation;
    },
    async cancel(id: string) {
      await ensure(); const job = jobs.get(id);
      if (!job) throw new Error('任务不存在');
      if (active(job)) {
        if (job.ownerPid !== process.pid) throw new Error('任务由另一个 SparkFlow 服务运行，请在该服务中停止');
        job.status = 'cancelled'; job.message = '已停止研究'; job.updatedAt = new Date().toISOString();
        controllers.get(id)?.abort(new Error('用户停止研究')); await persist(job);
      }
      return publicJob(job);
    },
    dispose() {
      disposed = true;
      for (const controller of controllers.values()) controller.abort(new Error('服务已停止，研究中断'));
      for (const job of jobs.values()) if (job.status === 'queued' && job.ownerPid === process.pid) {
        job.status = 'interrupted'; job.message = '服务已停止，任务尚未执行'; job.updatedAt = new Date().toISOString();
        void persist(job).catch(() => {});
      }
    },
  };
}

export function stockStrategyPlugin(getAi: () => Promise<Ai>): Plugin {
  let service: ReturnType<typeof createStockStrategyService>;
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/stock-strategy/')) return next();
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const send = (status: number, value: unknown) => { res.statusCode = status; res.end(JSON.stringify(value)); };
    try {
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(403, { detail: '请从 SparkFlow 页面操作' });
      if (url.pathname === '/api/stock-strategy/state' && req.method === 'GET') return send(200, await service.state());
      const id = url.pathname.match(/^\/api\/stock-strategy\/jobs\/([\da-f-]{36})(\/cancel)?$/);
      if (id && req.method === 'GET' && !id[2]) {
        const job = await service.get(id[1]); return send(job ? 200 : 404, job || { detail: '研究记录不存在' });
      }
      if (id?.[2] && req.method === 'POST') return send(200, await service.cancel(id[1]));
      if (url.pathname === '/api/stock-strategy/jobs' && req.method === 'POST') {
        if (!String(req.headers['content-type']).startsWith('application/json')) return send(415, { detail: '需要 JSON 请求' });
        let bytes = 0; const chunks: Buffer[] = [];
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 32_768) return send(413, { detail: '研究请求过长' }); chunks.push(Buffer.from(chunk)); }
        return send(202, await service.start(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
      }
      return send(405, { detail: '不支持的研究操作' });
    } catch (error) { send(400, { detail: safeError(error) }); }
  };
  return {
    name: 'sparkflow-stock-strategy',
    configResolved(config) { service = createStockStrategyService({ root: config.root, directory: createUserDataPaths(config.root).strategyResearchDir, getAi }); },
    configureServer(server) { server.middlewares.use((req, res, next) => void handler(req, res, next)); server.httpServer?.on('close', () => service.dispose()); },
    configurePreviewServer(server) { server.middlewares.use((req, res, next) => void handler(req, res, next)); server.httpServer?.on('close', () => service.dispose()); },
  };
}
