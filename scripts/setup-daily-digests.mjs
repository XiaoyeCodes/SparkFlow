import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = path.join(root, 'services/daily-digests');
const venv = path.join(home, '.venv');
const python = path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const requirements = path.join(home, 'requirements.txt');
const marker = path.join(venv, '.sparkflow-ready');
const hash = createHash('sha256').update(readFileSync(requirements)).digest('hex');
if (existsSync(python) && existsSync(marker) && readFileSync(marker, 'utf8').trim() === hash) {
  console.log('Daily digest runtime is ready.'); process.exit(0);
}
const uv = spawnSync('uv', ['--version'], { windowsHide: true, stdio: 'ignore' }).status === 0;
function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error(`日报环境准备失败：${cmd}`);
}
if (!existsSync(python)) {
  if (uv) run('uv', ['venv', '--python', '3.11', venv]);
  else run(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'venv', venv]);
}
if (uv) run('uv', ['pip', 'install', '--python', python, '-r', requirements]);
else run(python, ['-m', 'pip', 'install', '-r', requirements]);
run(python, ['-c', "import lxml.html; from zoneinfo import ZoneInfo; ZoneInfo('America/New_York'); print('Daily digest dependencies verified.')"]);
writeFileSync(marker, hash + '\n');
