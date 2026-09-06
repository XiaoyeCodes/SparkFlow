import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('reference is the exact user-supplied HTML, never a production fixture', async () => {
  const bytes = await readFile(new URL('../../docs/design/ibkr/trading_terminal.reference.html', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    'f80e02e4852d19d366544228d37b7c1878ef1d8974a8b9d21fe4628db14ee14d');
});
