import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedLocalRequest, allowedTerminalHttpRequest } from '../../server/ibkrTerminalProxy.ts';

test('manual paper routes are an exact allowlist', () => {
  for (const name of ['configure','preview','confirm','cancel','stop']) assert.equal(allowedTerminalHttpRequest('POST', `/api/ibkr-terminal/paper/${name}`), true);
  for (const name of ['status','contract','reconcile']) assert.equal(allowedTerminalHttpRequest('GET', `/api/ibkr-terminal/paper/${name}`), true);
  for (const name of ['live','submit','configure/extra','../live']) assert.equal(allowedTerminalHttpRequest('POST', `/api/ibkr-terminal/paper/${name}`), false);
});

test('market browsing never exposes a write or wildcard route', () => {
  for (const name of ['contracts','quote']) {
    assert.equal(allowedTerminalHttpRequest('GET', `/api/ibkr-terminal/market/${name}`), true);
    assert.equal(allowedTerminalHttpRequest('POST', `/api/ibkr-terminal/market/${name}`), false);
  }
  assert.equal(allowedTerminalHttpRequest('GET', '/api/ibkr-terminal/market/submit'), false);
});

test('local proxy checks host, origin and fetch metadata before reading its token', () => {
  assert.equal(allowedLocalRequest({ host: '127.0.0.1:5180' }, 5180), true);
  assert.equal(allowedLocalRequest({ host: 'evil.example:5180' }, 5180), false);
  assert.equal(allowedLocalRequest({ host: '127.0.0.1:5180', origin: 'https://evil.example' }, 5180), false);
  assert.equal(allowedLocalRequest({ host: '127.0.0.1:5180', 'sec-fetch-site': 'cross-site' }, 5180), false);
});

test('local proxy exposes only scoped terminal APIs and explicit local actions', () => {
  assert.equal(allowedTerminalHttpRequest('GET', '/api/ibkr-terminal/session'), true);
  assert.equal(allowedTerminalHttpRequest('GET', '/api/ibkr-terminal/snapshot'), true);
  assert.equal(allowedTerminalHttpRequest('POST', '/api/ibkr-terminal/orders/preview'), true);
  assert.equal(allowedTerminalHttpRequest('POST', '/api/ibkr-terminal/orders/previews/preview%3Aabc/confirm'), true);
  assert.equal(allowedTerminalHttpRequest('GET', '/api/ibkr-terminal/strategies'), true);
  assert.equal(allowedTerminalHttpRequest('GET', '/api/ibkr-terminal/backtests'), true);
  assert.equal(allowedTerminalHttpRequest('GET', `/api/ibkr-terminal/backtests/jobs/backtest%3A${'a'.repeat(32)}`), true);
  assert.equal(allowedTerminalHttpRequest('POST', `/api/ibkr-terminal/backtests/jobs/backtest%3A${'a'.repeat(32)}/cancel`), true);
  assert.equal(allowedTerminalHttpRequest('GET', '/api/ibkr-terminal/analysis/risk'), true);
  assert.equal(allowedTerminalHttpRequest('GET', '/api/ibkr-terminal/market-data'), true);
  assert.equal(allowedTerminalHttpRequest('GET', '/api/ibkr-terminal/ai/status'), true);
  assert.equal(allowedTerminalHttpRequest('GET', '/api/ibkr-terminal/reports'), true);
  assert.equal(allowedTerminalHttpRequest('POST', '/api/ibkr-terminal/reports'), true);
  assert.equal(allowedTerminalHttpRequest('POST', '/api/ibkr-terminal/reports/jobs'), true);
  assert.equal(allowedTerminalHttpRequest('GET', '/api/ibkr-terminal/reports/jobs'), true);
  assert.equal(allowedTerminalHttpRequest('GET', `/api/ibkr-terminal/reports/jobs/report-job%3A${'c'.repeat(32)}`), true);
  assert.equal(allowedTerminalHttpRequest('POST', `/api/ibkr-terminal/reports/jobs/report-job%3A${'c'.repeat(32)}/cancel`), true);
  assert.equal(allowedTerminalHttpRequest('POST', `/api/ibkr-terminal/reports/jobs/report-job%3A${'c'.repeat(32)}/retry`), false);
  assert.equal(allowedTerminalHttpRequest('GET', `/api/ibkr-terminal/reports/${'a'.repeat(64)}/pdf`), true);
  assert.equal(allowedTerminalHttpRequest('GET', '/api/ibkr-terminal/reports/../../session/pdf'), false);
  assert.equal(allowedTerminalHttpRequest('POST', '/api/ibkr-terminal/ai/grants'), false);
  assert.equal(allowedTerminalHttpRequest('GET', '/api/ibkr-terminal/strategy-runtime'), true);
  assert.equal(allowedTerminalHttpRequest('GET', `/api/ibkr-terminal/strategy-runtime/activation%3A${'b'.repeat(32)}/decisions`), true);
  assert.equal(allowedTerminalHttpRequest('POST', `/api/ibkr-terminal/strategy-runtime/activation%3A${'b'.repeat(32)}/stop`), true);
  assert.equal(allowedTerminalHttpRequest('POST', '/api/ibkr-terminal/strategy-runtime/activate'), false);
  assert.equal(allowedTerminalHttpRequest('POST', '/api/ibkr-terminal/backtests/run'), false);
  assert.equal(allowedTerminalHttpRequest('POST', '/api/ibkr-terminal/orders'), false);
  assert.equal(allowedTerminalHttpRequest('PUT', '/api/ibkr-terminal/orders/preview'), false);
  assert.equal(allowedTerminalHttpRequest('GET', '/api/ibkr-terminal/orders/preview'), false);
});
