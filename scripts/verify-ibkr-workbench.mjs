import { build } from 'esbuild';
import { mkdir, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
// Bundling keeps the tests runnable on the project's existing Node 20 runtime.
const output = path.resolve('tmp/workbench-tests');
await mkdir(output, { recursive: true });
const files = (await readdir('tests/workbench')).filter(x => x.endsWith('.test.mjs'));
await build({ entryPoints: files.map(x => `tests/workbench/${x}`), outdir: output, bundle: true, packages: 'external', platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' } });
const result = spawnSync(process.execPath, ['--test', ...files.map(x => path.join(output, x))], { stdio: 'inherit', windowsHide: true });
process.exit(result.status ?? 1);
