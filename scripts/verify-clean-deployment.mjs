import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initializeUserData } from '../server/userData.ts';

const scratch = await mkdtemp(path.join(tmpdir(), 'sparkflow-clean-deployment-'));
const source = path.join(scratch, 'project');
await mkdir(path.join(source, '.sparkflow'), { recursive: true });
await mkdir(path.join(source, 'services/vibe-trading/agent/sessions'), { recursive: true });
await writeFile(path.join(source, '.sparkflow/integration-settings.json'), '{"ai":{"apiKey":"test-private-value"}}');
await writeFile(path.join(source, 'services/vibe-trading/agent/sessions/private.json'), '{"private":true}');
const originalImport = process.env.SPARKFLOW_IMPORT_LEGACY_DATA;
const originalDirectory = process.env.SPARKFLOW_USER_DATA_DIR;
const originalHome = process.env.HOME;
const originalProfile = process.env.USERPROFILE;
try {
  // Keep the positive migration check away from the real desktop home too.
  process.env.HOME = path.join(scratch, 'test-home');
  process.env.USERPROFILE = process.env.HOME;
  await mkdir(process.env.HOME);
  process.env.SPARKFLOW_USER_DATA_DIR = path.join(scratch, 'clean-user-data');
  process.env.SPARKFLOW_IMPORT_LEGACY_DATA = '0';
  const clean = initializeUserData(source);
  assert.deepEqual(await readdir(clean.settingsDir), [], 'a clean deployment must never import desktop keys');
  assert.deepEqual(await readdir(clean.assistantSessionsDir), [], 'a clean deployment must never import conversations');
  assert.equal(JSON.parse(await readFile(path.join(source, '.sparkflow/integration-settings.json'), 'utf8')).ai.apiKey, 'test-private-value', 'source personal configuration is not modified');

  process.env.SPARKFLOW_USER_DATA_DIR = path.join(scratch, 'desktop-user-data');
  delete process.env.SPARKFLOW_IMPORT_LEGACY_DATA;
  const desktop = initializeUserData(source);
  assert.equal(JSON.parse(await readFile(path.join(desktop.assistantSessionsDir, 'private.json'), 'utf8')).private, true, 'the ordinary desktop migration is preserved');
} finally {
  if (originalImport === undefined) delete process.env.SPARKFLOW_IMPORT_LEGACY_DATA;
  else process.env.SPARKFLOW_IMPORT_LEGACY_DATA = originalImport;
  if (originalDirectory === undefined) delete process.env.SPARKFLOW_USER_DATA_DIR;
  else process.env.SPARKFLOW_USER_DATA_DIR = originalDirectory;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalProfile;
}

const exported = path.join(scratch, 'export');
execFileSync(process.execPath, ['scripts/prepare-clean-deployment.mjs', '--out', exported], { stdio: 'pipe' });
const manifest = JSON.parse(await readFile(path.join(exported, 'deployment-manifest.json'), 'utf8'));
assert.ok(manifest.files.some(file => file.path === 'src/routes/Assistant.tsx'), 'AI page remains in the package');
assert.ok(manifest.files.some(file => file.path === 'src/routes/IbkrAccount.tsx'), 'IBKR page remains in the package');
assert.ok(manifest.files.some(file => file.path === 'services/vibe-trading/pyproject.toml'), 'the complete research service remains in the package');
assert.ok(manifest.files.some(file => file.path === 'services/daily-digests/worker.py'), 'digest generation code remains in the package');
const exportedConfig = await readFile(path.join(exported, 'vite.config.ts'), 'utf8');
assert.ok(exportedConfig.includes("const cozeReportDefaultUrl = '';"));
assert.ok(exportedConfig.includes("const cozeReportDefaultProjectId = '';"));
assert.match(await readFile(path.join(exported, '.env.example'), 'utf8'), /^COZE_REPORT_PROJECT_ID=\r?$/m);
for (const file of manifest.files) {
  assert.ok(!/(^|\/)(UserData|output|\.sparkflow|\.edgeone|\.venv|node_modules)(\/|$)/i.test(file.path));
  const actual = await readFile(path.join(exported, file.path));
  assert.equal(actual.length, file.bytes);
  assert.equal(createHash('sha256').update(actual).digest('hex'), file.sha256);
}
let overwriteRejected = false;
try { execFileSync(process.execPath, ['scripts/prepare-clean-deployment.mjs', '--out', exported], { stdio: 'pipe' }); }
catch { overwriteRejected = true; }
assert.ok(overwriteRejected, 'an existing export is never replaced');
console.log(`Clean deployment verified: ${manifest.files.length} source files, private migration disabled, AI and IBKR retained.`);
