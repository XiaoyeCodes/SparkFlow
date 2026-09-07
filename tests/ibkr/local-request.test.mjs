import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedLocalRequest } from '../../server/localRequest.ts';

test('local workbench checks host, origin and fetch metadata before reading its token', () => {
  assert.equal(allowedLocalRequest({ host: '127.0.0.1:5180' }, 5180), true);
  assert.equal(allowedLocalRequest({ host: 'evil.example:5180' }, 5180), false);
  assert.equal(allowedLocalRequest({ host: '127.0.0.1:5180', origin: 'https://evil.example' }, 5180), false);
  assert.equal(allowedLocalRequest({ host: '127.0.0.1:5180', 'sec-fetch-site': 'cross-site' }, 5180), false);
});

