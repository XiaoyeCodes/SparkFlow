import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';

const validPort = (port: number) => Number.isInteger(port) && port >= 1024 && port <= 65535;

export function bridgePortCandidates(preferred: number) {
  const values = [preferred];
  for (let port = 18765; port <= 18865; port += 1) values.push(port);
  for (let port = 8765; port <= 8865; port += 1) values.push(port);
  return [...new Set(values.filter(validPort))];
}

export function canListenOnLoopback(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

export async function findAvailableBridgePort(preferred: number, available = canListenOnLoopback) {
  for (const port of bridgePortCandidates(preferred)) if (await available(port)) return port;
  throw new Error('没有可用的本机桥接端口（已检查 18765–18865 与 8765–8865）');
}

async function sessionToken(runtimeDir: string) {
  try { return (await readFile(path.join(runtimeDir, 'session.token'), 'utf8')).trim(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return ''; }
}

export async function isSparkFlowBridge(port: number, runtimeDir: string, timeoutMs = 900) {
  const token = await sessionToken(runtimeDir);
  if (!token) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/ibkr-terminal/session`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return false;
    const value = await response.json() as { readonly?: unknown; accounts?: unknown };
    return value.readonly === true && Array.isArray(value.accounts);
  } catch { return false; }
}

export async function startSparkFlowBridge(root: string, preferredPort: number) {
  const runtimeDir = path.join(root, '.sparkflow', 'ibkr-terminal');
  const bindings = path.join(runtimeDir, 'bindings.json');
  const script = path.join(root, 'scripts', 'start-ibkr-terminal.ps1');
  if (!existsSync(script)) throw new Error('SparkFlow 本地桥接启动脚本不存在。');

  if (await isSparkFlowBridge(preferredPort, runtimeDir)) return { port: preferredPort, reused: true };
  const port = await findAvailableBridgePort(preferredPort);
  await mkdir(runtimeDir, { recursive: true });
  const stdout = openSync(path.join(runtimeDir, 'bridge.out.log'), 'a');
  const stderr = openSync(path.join(runtimeDir, 'bridge.err.log'), 'a');
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...(existsSync(bindings) ? ['-BindingFile', bindings] : []), '-Port', String(port)], {
      cwd: root, windowsHide: true, stdio: ['ignore', stdout, stderr],
    });
  } finally { closeSync(stdout); closeSync(stderr); }
  let launchError: Error | undefined;
  child.once('error', error => { launchError = error; });
  child.unref();
  await writeFile(path.join(runtimeDir, 'bridge.pid'), String(child.pid ?? ''), 'ascii');

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await isSparkFlowBridge(port, runtimeDir, 700)) return { port, reused: false };
    if (child.exitCode !== null || launchError) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(launchError ? '本地桥接启动失败，请检查 PowerShell 和 Python 运行环境。' : child.exitCode === null ? `本地桥接已启动，但端口 ${port} 未在 10 秒内就绪。` : `本地桥接启动失败，退出码 ${child.exitCode}。`);
}

export async function discoverSparkFlowGateway(root: string, port: number, mode: 'live' | 'paper') {
  const token = await sessionToken(path.join(root, '.sparkflow', 'ibkr-terminal'));
  const response = await fetch(`http://127.0.0.1:${port}/api/ibkr-terminal/gateway/connect`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }), signal: AbortSignal.timeout(40000),
  });
  if (response.status === 404 || response.status === 403) throw new Error('本地桥接仍在运行旧版本，请重启 SparkFlow 本地桥接以启用 API 端口自动发现。');
  if (!response.ok) throw new Error('本地 IBKR API 发现服务暂不可用。');
  const value = await response.json() as { phase?: string; apiPort?: number; detail?: string };
  if (!['ready', 'waiting', 'connecting', 'retrying', 'disconnected'].includes(value.phase ?? '') || typeof value.detail !== 'string') throw new Error('本地 IBKR API 发现服务返回了无效状态。');
  return value;
}
