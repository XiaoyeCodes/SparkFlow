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
  if (!existsSync(bindings)) throw new Error('尚未建立 Gateway 账户绑定，请先登录 IBKR Gateway 并完成首次只读连接。');
  if (!existsSync(script)) throw new Error('SparkFlow 本地桥接启动脚本不存在。');

  if (await isSparkFlowBridge(preferredPort, runtimeDir)) return { port: preferredPort, reused: true };
  const port = await findAvailableBridgePort(preferredPort);
  await mkdir(runtimeDir, { recursive: true });
  const stdout = openSync(path.join(runtimeDir, 'bridge.out.log'), 'a');
  const stderr = openSync(path.join(runtimeDir, 'bridge.err.log'), 'a');
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-BindingFile', bindings, '-Port', String(port)], {
      cwd: root, detached: true, windowsHide: true, stdio: ['ignore', stdout, stderr],
    });
  } finally { closeSync(stdout); closeSync(stderr); }
  child.unref();
  await writeFile(path.join(runtimeDir, 'bridge.pid'), String(child.pid ?? ''), 'ascii');

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await isSparkFlowBridge(port, runtimeDir, 700)) return { port, reused: false };
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(child.exitCode === null ? `本地桥接已启动，但端口 ${port} 未在 10 秒内就绪。` : `本地桥接启动失败，退出码 ${child.exitCode}。`);
}
