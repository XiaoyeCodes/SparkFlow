import { expect, test } from '@playwright/test';
import { emptySnapshot } from '../../src/lib/ibkr/store';
import type { WorkbenchState } from '../../src/lib/ibkr/workbenchTypes';

test('account polling removes an obsolete lock error after the worker recovers', async ({ page }) => {
  const lockError = '另一个服务持有账户后台锁，或锁文件不可用；本实例不会同步或调用 AI。';
  const state: WorkbenchState = {
    source: 'gateway', gatewayMode: 'paper', connection: { state: 'disconnected', detail: lockError, tools: [], accounts: [] },
    snapshot: emptySnapshot('paper'), quotes: [], evidence: [], alerts: [], reports: [], jobs: [],
    preferences: { horizon: 'both', targetWeight: null, cashFloor: null, maxDrawdown: null, daily: false, eventAnalysis: false, maxAutomatic: 0, cooldownMinutes: 60, maxAiCalls: 12 },
    ai: { provider: '', model: '', fingerprint: '', configured: false, enabled: false, fields: [], usedToday: 0 }, nextSyncAt: null, calendarSupported: true,
  };
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: {} }));
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: state }));
  await page.route('**/api/ibkr-workbench/sync', route => route.fulfill({ status: 400, json: { error: lockError } }));
  await page.goto('http://127.0.0.1:5187/ibkr?tab=settings');
  await page.getByRole('button', { name: '刷新账户', exact: true }).click();
  await expect(page.locator('.awb-message.error')).toContainText(lockError);
  state.connection.detail = '账户后台已恢复，等待 Gateway 登录。';
  await expect(page.locator('.awb-message.error')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText(state.connection.detail, { exact: true }).first()).toBeVisible();
});
