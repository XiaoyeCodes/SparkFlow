import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const service = path.join(root, 'services/daily-stock-analysis');
const venv = path.join(service, '.venv');
const python = path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const requirements = path.join(service, process.platform === 'win32' ? 'requirements-windows-lock.txt' : 'requirements.txt');
const marker = path.join(venv, '.sparkflow-ready');
const digest = createHash('sha256').update(readFileSync(requirements));
for (const file of ['stock-strategy-worker.py', 'stock_strategy_data.py', 'stock_strategy_news.py']) digest.update(readFileSync(path.join(root, 'scripts', file)));
const hash = digest.digest('hex');
if (existsSync(python) && existsSync(marker) && readFileSync(marker, 'utf8').trim() === hash) {
  console.log('Daily Stock Analysis runtime is ready.');
  process.exit(0);
}
const hasUv = spawnSync('uv', ['--version'], { windowsHide: true, stdio: 'ignore' }).status === 0;
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, env: process.env });
  if (result.status !== 0) throw new Error(`Strategy runtime setup failed: ${command}`);
}
if (!existsSync(python)) {
  if (hasUv) run('uv', ['venv', '--python', '3.11', venv]);
  else run(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'venv', venv]);
}
if (hasUv) run('uv', ['pip', 'install', '--python', python, '-r', requirements]);
else run(python, ['-m', 'pip', 'install', '-r', requirements]);
// Pre-cache tokenizer assets during setup, never on the first research click.
process.env.TIKTOKEN_CACHE_DIR = path.join(venv, 'tiktoken-cache');
run(python, ['-c', "import tiktoken; tiktoken.get_encoding('cl100k_base'); tiktoken.get_encoding('o200k_base'); print('Tokenizer resources cached.')"]);
const checkDir = mkdtempSync(path.join(tmpdir(), 'sparkflow-strategy-check-'));
try {
  const check = spawnSync(python, ['-u', path.join(root, 'scripts/stock-strategy-worker.py')], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 90_000,
    input: JSON.stringify({ check: true, dataDir: checkDir, ai: { apiKey: 'local-import-check', model: 'test-model', baseUrl: 'http://127.0.0.1:1/v1', useProxy: false } }),
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
  if (check.status !== 0 || !check.stdout.includes('"ready": true')) throw new Error(check.stdout || 'Strategy engine import check failed');
  writeFileSync(marker, hash + '\n');
  console.log('Daily Stock Analysis verified: analysis pipeline and 15 strategies ready.');
} finally {
  // Only remove the fresh temporary directory created by this script.
  if (path.dirname(checkDir) === path.resolve(tmpdir()) && path.basename(checkDir).startsWith('sparkflow-strategy-check-')) {
    try { rmSync(checkDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 }); } catch { console.warn('Import check temporary directory is still in use.'); }
  }
}
