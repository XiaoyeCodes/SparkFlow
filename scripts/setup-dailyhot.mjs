import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../services/dailyhot');
const lockPath = path.join(root, 'package-lock.json');
const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const dependencyHash = () => createHash('sha256').update(readFileSync(path.join(root, 'package.json'))).update(readFileSync(lockPath)).digest('hex');
const installMarker = path.join(root, 'node_modules/.sparkflow-dependency-hash');
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`DailyHot setup exited with code ${code}`)));
  });
}

// npm's hidden lock records the resolved service dependency tree. Do not
// install on every dev start; npm ci is also available explicitly for updates.
const ready = existsSync(path.join(root, 'node_modules/dailyhot-api/dist/app.js'))
  && existsSync(path.join(root, 'node_modules/dailyhot-web/src/App.vue'))
  && existsSync(path.join(root, 'node_modules/vite/package.json'));
if (!ready || !existsSync(installMarker) || readFileSync(installMarker, 'utf8') !== dependencyHash()) {
  if (!existsSync(npmCli)) throw new Error('Please run this setup via npm run dailyhot:setup.');
  await run([npmCli, existsSync(lockPath) ? 'ci' : 'install', '--no-audit', '--no-fund']);
  writeFileSync(installMarker, dependencyHash());
}
const hash = createHash('sha256');
for (const file of ['package.json', 'package-lock.json', 'build-web.mjs', 'prepare-api.mjs', 'cache-adapter.mjs']) hash.update(readFileSync(path.join(root, file)));
const marker = path.join(root, 'web-dist/.build-hash');
if (!existsSync(path.join(root, 'api-runtime/app.js')) || !existsSync(marker) || readFileSync(marker, 'utf8') !== hash.digest('hex')) {
  await run([path.join(root, 'prepare-api.mjs')]);
  await run([path.join(root, 'build-web.mjs')]);
} else console.log('[dailyhot] Local frontend and API dependencies ready.');
