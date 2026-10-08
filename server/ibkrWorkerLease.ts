import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rmdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

type ProcessIdentity = { alive: boolean; startedAt?: number };
type Owner = { version: 1; pid: number; startedAt: number; token: string };
type Probe = (pid: number) => Promise<ProcessIdentity>;
const execute = promisify(execFile);

export async function workerProcessIdentity(pid: number): Promise<ProcessIdentity> {
  try { process.kill(pid, 0); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return { alive: false };
    // Access denied does not prove that an owner has exited.
    return { alive: true };
  }
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if($p){[DateTimeOffset]::new($p.CreationDate).ToUnixTimeMilliseconds()}`],
      { windowsHide: true, timeout: 5000 });
      const value = stdout.trim();
      return value ? { alive: true, startedAt: Number(value) || undefined } : { alive: false };
    }
    if (process.platform === 'linux') {
      const [processStat, systemStat, ticks] = await Promise.all([
        readFile(`/proc/${pid}/stat`, 'utf8'), readFile('/proc/stat', 'utf8'), execute('getconf', ['CLK_TCK'], { timeout: 5000 }),
      ]);
      const boot = Number(systemStat.match(/^btime (\d+)$/m)?.[1]);
      const startTicks = Number(processStat.slice(processStat.lastIndexOf(')') + 2).split(' ')[19]);
      const startedAt = boot * 1000 + startTicks * 1000 / Number(ticks.stdout.trim());
      return { alive: true, startedAt: Number.isFinite(startedAt) ? startedAt : undefined };
    }
    const { stdout } = await execute('ps', ['-p', String(pid), '-o', 'lstart='], { timeout: 5000 });
    const startedAt = Date.parse(stdout.trim());
    return { alive: true, startedAt: Number.isFinite(startedAt) ? startedAt : undefined };
  } catch { return { alive: true }; }
}

/** A PID alone is unsafe across restarts: operating systems reuse process IDs. */
export class IbkrWorkerLease {
  private owner?: Owner;
  private readonly filename: string;
  private readonly guard: string;
  constructor(directory: string, private probe: Probe = workerProcessIdentity) {
    this.filename = path.join(directory, 'worker.lock');
    this.guard = `${this.filename}.claim`;
  }

  async acquire(): Promise<boolean> {
    if (this.owner) return true;
    await mkdir(path.dirname(this.filename), { recursive: true, mode: 0o700 });
    // Serialize stale-lock replacement as well as creation across processes.
    try { await mkdir(this.guard); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        if (Date.now() - (await stat(this.guard)).mtimeMs > 30_000) await rmdir(this.guard);
      } catch { /* Another contender may have already released the claim. */ }
      return false;
    }
    try {
      let text: string | undefined;
      let modified = 0;
      try { text = await readFile(this.filename, 'utf8'); modified = (await stat(this.filename)).mtimeMs; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (text !== undefined) {
        let value: unknown;
        try { value = JSON.parse(text); } catch { /* Recover an interrupted lock write after a grace period. */ }
        const record = value && typeof value === 'object' ? value as Partial<Owner> : undefined;
        const legacy = typeof value === 'number' ? value : undefined;
        const pid = record?.pid ?? legacy;
        const valid = Number.isSafeInteger(pid) && Number(pid) > 0 && (legacy !== undefined ||
          record?.version === 1 && Number.isFinite(record.startedAt) && typeof record.token === 'string' && record.token.length > 0);
        if (valid) {
          const identity = await this.probe(Number(pid));
          const reused = identity.startedAt !== undefined && (legacy !== undefined
            ? identity.startedAt > modified + 2000
            : Math.abs(identity.startedAt - Number(record!.startedAt)) > 2000);
          if (identity.alive && !reused) return false;
        } else if (Date.now() - modified < 10_000) return false;
        // Retain evidence of malformed files; valid stale leases contain no user data.
        if (!valid) await rename(this.filename, `${this.filename}.invalid-${randomUUID()}`);
        else await unlink(this.filename);
      }
      const identity = await this.probe(process.pid);
      const owner: Owner = { version: 1, pid: process.pid, startedAt: identity.startedAt ?? Date.now() - process.uptime() * 1000, token: randomUUID() };
      const handle = await open(this.filename, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(owner)); await handle.sync(); }
      finally { await handle.close(); }
      this.owner = owner;
      return true;
    } finally { await rmdir(this.guard).catch(() => {}); }
  }

  async release() {
    const owner = this.owner;
    this.owner = undefined;
    if (!owner) return;
    try {
      const current = JSON.parse(await readFile(this.filename, 'utf8')) as Owner;
      // A delayed shutdown must never delete a successor's lease.
      if (current.token === owner.token && current.pid === owner.pid) await unlink(this.filename);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
