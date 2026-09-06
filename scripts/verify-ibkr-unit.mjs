import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const files = readdirSync('tests/ibkr').filter(name => name.endsWith('.test.mjs')).map(name => `tests/ibkr/${name}`);
const js = spawnSync(process.execPath, ['--no-warnings', '--experimental-strip-types', '--test', ...files], { stdio: 'inherit', windowsHide: true });
if (js.error) throw js.error;
if (js.status !== 0) process.exit(js.status ?? 1);
const python = process.env.SPARKFLOW_TEST_PYTHON || resolve('services/vibe-trading/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const py = spawnSync(python, ['-m', 'pytest', 'services/vibe-trading/agent/tests/ibkr_terminal', '-q'], { stdio: 'inherit', windowsHide: true });
if (py.error) throw py.error;
process.exit(py.status ?? 1);
