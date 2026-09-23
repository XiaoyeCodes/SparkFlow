import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { initializeUserData, safeExportName } from '../../server/userData.ts';

test('personal files migrate into the git-ignored UserData layout without deleting legacy data', async () => {
  await mkdir(path.resolve('tmp/user-data'), { recursive: true });
  const root = await mkdtemp(path.resolve('tmp/user-data/root-'));
  await mkdir(path.join(root, '.sparkflow', 'ibkr-workbench'), { recursive: true });
  await mkdir(path.join(root, 'services', 'vibe-trading', 'agent', 'sessions', 'session-1'), { recursive: true });
  await writeFile(path.join(root, '.sparkflow', 'ibkr-workbench', 'state.json'), '{"version":1}');
  await writeFile(path.join(root, '.sparkflow', 'ibkr-workbench', 'worker.lock'), '999');
  await writeFile(path.join(root, 'services', 'vibe-trading', 'agent', 'sessions', 'session-1', 'messages.json'), '[]');

  const previous = process.env.SPARKFLOW_USER_DATA_DIR;
  process.env.SPARKFLOW_USER_DATA_DIR = path.join(root, 'UserData');
  try {
    const paths = initializeUserData(root);
    assert.equal(await readFile(path.join(paths.ibkrWorkbenchDir, 'state.json'), 'utf8'), '{"version":1}');
    await assert.rejects(readFile(path.join(paths.ibkrWorkbenchDir, 'worker.lock'), 'utf8'), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(paths.assistantSessionsDir, 'session-1', 'messages.json'), 'utf8'), '[]');
    assert.equal(await readFile(path.join(root, '.sparkflow', 'ibkr-workbench', 'state.json'), 'utf8'), '{"version":1}');
  } finally {
    if (previous === undefined) delete process.env.SPARKFLOW_USER_DATA_DIR;
    else process.env.SPARKFLOW_USER_DATA_DIR = previous;
  }
});

test('PDF archive names cannot escape the export directory', () => {
  assert.equal(safeExportName('../../private?.pdf'), '.. .. private .pdf');
  assert.equal(safeExportName('statement.txt'), 'SparkFlow-export.pdf');
});
