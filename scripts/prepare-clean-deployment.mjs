import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { out: { type: 'string' } } });
if (!values.out) throw new Error('Specify a new export directory with --out <directory>.');
const destination = path.resolve(values.out);
const relativeDestination = path.relative(root, destination);
if (!relativeDestination.startsWith('..' + path.sep) && relativeDestination !== '..' && !path.isAbsolute(relativeDestination)) {
  throw new Error('The export must be outside the source checkout.');
}

// An export contains reviewed source, never everything found on the disk.
// In particular, an untracked output/ folder must never enter a deployment.
const additions = ['scripts/prepare-clean-deployment.mjs', 'scripts/verify-clean-deployment.mjs', 'deploy/makers/README.md'];
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString('utf8').split('\0').filter(Boolean);
const privatePath = name => /(^|\/)(?:\.git|\.edgeone|\.sparkflow|UserData|output|node_modules|\.venv|__pycache__|\.pytest_cache|test-results|playwright-report)(\/|$)/i.test(name)
  || /(^|\/)\.env(?:\..+)?$/i.test(name) && !/\.env\.(?:example|sample|template)$/i.test(name)
  || /\.(?:log|tsbuildinfo|pfx|p12|key)$/i.test(name);
const sourceNames = [...new Set([...tracked, ...additions])].sort();
const omitted = sourceNames.filter(privatePath);
const names = sourceNames.filter(name => !privatePath(name));
const entries = [];
const pending = [];
const problems = [];
const sanitizedDefaults = [];
const tokenPatterns = [
  /\bsk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{24,}/g,
  /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{30,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];
for (const name of names) {
  if (name.includes('\\') || name.split('/').includes('..') || path.isAbsolute(name)) throw new Error('Invalid export path.');
  const original = path.join(root, name);
  const info = await lstat(original);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Only regular source files may be exported: ${name}`);
  let content = await readFile(original);
  if (['vite.config.ts', 'scripts/generate-equity-report.py', '.env.example'].includes(name)) {
    let text = content.toString('utf8');
    const before = text;
    if (name === 'vite.config.ts') text = text.replace(/(const cozeReportDefault(?:Url|ProjectId) = )'[^']*'/g, "$1''");
    if (name === 'scripts/generate-equity-report.py') text = text.replace(/^(DEFAULT_URL = )"[^"]*"/m, '$1""');
    if (name === '.env.example') text = text.replace(/^(COZE_REPORT_(?:URL|PROJECT_ID|TOKEN)=).*$/gm, '$1');
    if (text !== before) {
      content = Buffer.from(text);
      sanitizedDefaults.push({ file: name, setting: 'personal Coze endpoint, project identifier or token; feature code retained' });
    }
  }
  if (content.length < 8 * 1024 * 1024 && !content.includes(0)) {
    const source = content.toString('utf8');
    for (const pattern of tokenPatterns) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        if (!/(?:example|dummy|placeholder|testing|sk-test|your[_-]?key)/i.test(match[0])) {
          problems.push({ file: name, line: source.slice(0, match.index).split('\n').length, reason: 'Possible credential; inspect locally before uploading.' });
        }
      }
    }
  }
  pending.push({ name, content });
  entries.push({ path: name, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') });
}
if (problems.length) {
  // Never echo a matching credential into a build log.
  process.stderr.write(JSON.stringify({ status: 'blocked', findings: problems }, null, 2) + '\n');
  process.exit(1);
}

// Never replace a previous export, build result, or user directory.
await mkdir(destination);
for (const { name, content } of pending) {
  const target = path.join(destination, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, { flag: 'wx' });
}
const manifest = {
  version: 1,
  createdAt: new Date().toISOString(),
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim(),
  // This is a clean source export, not a claim that a static host can run the backend.
  status: 'source-export-only; backend runtime must be adapted and verified before publication',
  personalConfiguration: 'excluded',
  aiApiKey: '',
  ibkrConnection: 'unconfigured',
  sanitizedDefaults,
  files: entries,
  omitted,
};
await writeFile(path.join(destination, 'deployment-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ directory: destination, files: entries.length,
  bytes: entries.reduce((sum, item) => sum + item.bytes, 0), omitted: omitted.length,
  status: manifest.status }, null, 2) + '\n');
