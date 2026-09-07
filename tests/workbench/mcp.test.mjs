import test from 'node:test';
import assert from 'node:assert/strict';
import { IbkrMcp, normalizeBoundMcpSnapshot } from '../../server/ibkrMcp.ts';

function fixture() {
  const mcp = new IbkrMcp('tmp/mcp-offline-test');
  mcp.state = 'connected'; mcp.secret = { tokens: { access_token: 'OFFLINE_TEST_ONLY', token_type: 'Bearer' } };
  mcp.tools = [
    { name: 'get_accounts', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: {} } },
    { name: 'get_positions', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: { accountId: {}, pageId: {} }, required: ['accountId'] } },
    { name: 'get_account_summary', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: { accountId: {} }, required: ['accountId'] } },
  ];
  const calls = [];
  mcp.client = { callTool: async ({ name, arguments: args }) => {
    calls.push({ name, args });
    const structuredContent = name === 'get_accounts' ? { accounts: ['U111'] } : name === 'get_account_summary' ? { accountId: 'U111', baseCurrency: 'USD', netLiquidation: 5000 } : { accountId: 'U111', positions: args.pageId === 0 ? [{ accountId: 'U111', conId: 1, symbol: 'AAPL', currency: 'USD', position: 1, secType: 'STK' }] : [] };
    return { structuredContent };
  }, close: async () => {} };
  return { mcp, calls };
}
test('MCP adapter scopes every read and exhausts positions pagination before publishing', async () => {
  const { mcp, calls } = fixture(); const result = await mcp.snapshot();
  assert.equal(result.positions.length, 1); assert.equal(calls.filter(c => c.name === 'get_positions').length, 2);
  assert.ok(calls.filter(c => c.name !== 'get_accounts').every(c => c.args.accountId === 'U111'));
  assert.equal(mcp.status().accounts[0].label, 'IBKR •••U111');
});
test('MCP adapter rejects ambiguous or non-readonly tools and missing required tool inputs', async () => {
  let { mcp } = fixture(); mcp.tools[1].annotations.readOnlyHint = false; await assert.rejects(() => mcp.snapshot(), /TOOL_UNSUPPORTED/);
  ({ mcp } = fixture()); mcp.tools.push({ ...mcp.tools[1], name: 'list_positions' }); await assert.rejects(() => mcp.snapshot(), /TOOL_UNSUPPORTED/);
  ({ mcp } = fixture()); mcp.tools[1].inputSchema.properties.unknownRequired = {}; mcp.tools[1].inputSchema.required.push('unknownRequired'); await assert.rejects(() => mcp.snapshot(), /ARGUMENT_UNSUPPORTED/);
});
test('MCP never turns a cross-account or truncated result into a complete snapshot', async () => {
  const { mcp } = fixture(); const call = mcp.client.callTool;
  mcp.client.callTool = async (input) => { const result = await call(input); if (input.name === 'get_positions') result.structuredContent.accountId = 'U999'; return result; };
  await assert.rejects(() => mcp.snapshot(), /IDENTITY_MISMATCH/);
});
test('OAuth callback rejects absent, mismatched and expired state without token exchange', async () => {
  const { mcp } = fixture(); await assert.rejects(() => mcp.callback('bad', 'code'), /STATE_INVALID/);
  mcp.secret.state = 'test-state'; mcp.secret.pendingAt = Date.now() - 700000;
  await assert.rejects(() => mcp.callback('test-state', 'code'), /STATE_INVALID/);
  mcp.secret.pendingAt = Date.now(); await assert.rejects(() => mcp.callback('otherstate', 'code'), /STATE_INVALID/);
});

function boundFixture() {
  const { mcp, calls } = fixture();
  mcp.secret.consentId = 'offline-consent-a';
  mcp.tools = ['get_account_summary', 'get_account_positions', 'get_account_balances'].map(name => ({ name, annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: {}, required: [] } }));
  const positions = { positions: [{ contract_id: 100, contract_description: 'TEST', position: 5, market_value: 600, currency: 'USD', average_price: 100, unrealized_pnl: 100, asset_class: 'STK' }] };
  const summary = { currency: 'USD', net_liquidation: 1300, buying_power: 1400, maintenance_margin: 200 };
  const balances = { balances: [{ currency: 'BASE', cash_balance: 700, unrealized_pnl: 100 }, { currency: 'USD', cash_balance: 700, unrealized_pnl: 100 }] };
  mcp.client.callTool = async ({ name, arguments: args }) => { calls.push({ name, args }); return { structuredContent: name === 'get_account_positions' ? positions : name === 'get_account_summary' ? summary : balances }; };
  return { mcp, calls, positions, summary, balances };
}

test('official consent-bound tools synchronize without an account-list endpoint and do not double-count BASE', async () => {
  const { mcp, calls } = boundFixture(); const result = await mcp.snapshot();
  assert.deepEqual(calls.map(c => c.name), ['get_account_positions', 'get_account_summary', 'get_account_balances']);
  assert.ok(calls.every(c => Object.keys(c.args).length === 0));
  assert.equal(result.metrics.netLiquidation, '1300'); assert.equal(result.metrics.unrealizedPnl, '100');
  assert.equal(result.metrics.maintenanceMargin, '200'); assert.equal(result.metrics.buyingPower, '1400');
  assert.deepEqual(result.cash, [{ currency: 'USD', amount: '700' }]);
  assert.equal(result.positions[0].averageCost, '100'); assert.equal(result.positions[0].marketValue, '600');
  assert.equal(result.positions[0].quantity, '5'); assert.equal(result.positions[0].assetType, 'STK');
  assert.ok(result.missing.includes('brokerAccountId')); assert.equal(mcp.status().authorized, true);
  assert.equal(mcp.status().accounts[0].label, 'IBKR 当前授权账户（账号未提供）');
  const again = await mcp.snapshot(result.accountKey); assert.equal(again.accountKey, result.accountKey);
  const other = boundFixture(); other.mcp.secret.consentId = 'offline-consent-b';
  await assert.rejects(() => other.mcp.snapshot(result.accountKey), /SELECT_ACCOUNT/);
});

test('consent-bound profile refuses writes, new arguments, duplicates and incomplete result sets', async () => {
  for (const mutate of [
    m => { m.tools[0].annotations.readOnlyHint = false; },
    m => { m.tools[0].inputSchema.properties.account_id = { type: 'string' }; },
    m => { m.tools.push({ ...m.tools[0] }); },
  ]) { const { mcp } = boundFixture(); mutate(mcp); await assert.rejects(() => mcp.snapshot(), /TOOL.*UNSUPPORTED/); }
  const { positions, summary, balances } = boundFixture();
  assert.throws(() => normalizeBoundMcpSnapshot('consent-a', { ...positions, hasMore: true }, summary, balances), /PAGINATION/);
  assert.throws(() => normalizeBoundMcpSnapshot('consent-a', positions, { ...summary, account_id: 'U_OTHER' }, balances), /IDENTITY/);
  assert.throws(() => normalizeBoundMcpSnapshot('consent-a', positions, summary, { balances: [balances.balances[1], balances.balances[1]] }), /BALANCES_SCHEMA/);
  const empty = normalizeBoundMcpSnapshot('consent-a', { positions: [] }, { currency: 'USD' }, { balances: [] });
  assert.equal(empty.state, 'empty'); assert.equal(empty.metrics.netLiquidation, null); assert.equal(empty.metrics.unrealizedPnl, null);
});
