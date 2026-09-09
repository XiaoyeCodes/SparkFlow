import { test, expect } from '@playwright/test';
import { emptySnapshot } from '../../src/lib/ibkr/store';
import type { AnalysisReport, WorkbenchState } from '../../src/lib/ibkr/workbenchTypes';

const makeState = (): WorkbenchState => {
  const snapshot = { ...emptySnapshot('live'), snapshotId: 'ui-snapshot', accountKey: 'live:ui-only', connection: 'connected' as const, state: 'ready' as const, baseCurrency: 'USD', asOf: new Date().toISOString(), testData: true, source: 'fixture' as const, positions: [] };
  const report: AnalysisReport = { id: 'today-analysis', version: 2, accountKey: snapshot.accountKey, snapshotId: snapshot.snapshotId, snapshotHash: 'synthetic', generatedAt: new Date().toISOString(), provider: 'fixture', model: 'offline-analysis', kind: 'manual', evidence: [], quotes: [], snapshot, content: { headline: '现金缓冲偏低，今天先控制集中度', briefPoints: ['AAPL 33.5% 与 QQQ 21.4% 形成集中风险，先检查减仓触发条件。', '输入数据仍有缺口，现金仅 2.2%，等待市场信号确认。', '最高优先级是控制仓位，确认后分批减仓，不追高。'], brief: '今天先降低组合脆弱性。', accountSummary: '离线账户摘要', portfolioRisk: '集中度偏高', marketContext: '离线市场背景', holdings: [], opportunities: [], risks: ['集中度偏高'], actions: [], gaps: [] } };
  return { source: 'mcp', connection: { state: 'connected', detail: '离线界面测试', tools: [], accounts: [] }, snapshot, quotes: [], evidence: [], alerts: [], reports: [report], jobs: [], preferences: { horizon: 'both', targetWeight: null, cashFloor: null, maxDrawdown: null, daily: false, eventAnalysis: false, maxAutomatic: 0, cooldownMinutes: 60, maxAiCalls: 12, schedules: { brief: { enabled: false, mode: 'clock', timeZone: 'Asia/Shanghai', times: ['09:00'] }, analysis: { enabled: true, mode: 'clock', timeZone: 'Asia/Shanghai', times: ['09:00'] } } }, ai: { provider: 'fixture', model: 'offline-analysis', fingerprint: 'ui-only', configured: true, enabled: true, fields: [], usedToday: 0 }, nextSyncAt: null, calendarSupported: true };
};

for (const viewport of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
  test(`today analysis conclusion is clear and fits at ${viewport.width}px`, async ({ page }) => {
    const data = makeState();
    await page.setViewportSize(viewport);
    await page.route('**/api/ibkr-workbench/**', route => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({ json: path.endsWith('/state') ? data : path.endsWith('/performance') ? { points: [], source: 'offline test', fetchedAt: null, currency: 'USD', returnMethod: null, benchmark: 'none', note: '' } : [] });
    });
    await page.goto('http://127.0.0.1:5187/ibkr');
    const panel = page.getByRole('region', { name: '今日分析结论' });
    await expect(panel).toContainText('现金缓冲偏低，今天先控制集中度');
    await expect(panel.locator('.awb-conclusion-ticker')).toHaveText(['AAPL', 'QQQ']);
    await expect(panel.locator('.awb-conclusion-number')).toHaveText(['33.5%', '21.4%', '2.2%']);
    await expect(panel.locator('li')).toHaveCount(3);
    await expect(panel).toContainText('手动分析 · offline-analysis');
    await expect(panel).not.toContainText('AI 账户简报');
    await expect(panel).not.toContainText('重新生成简报');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (viewport.width === 1920) {
      const firstCard = panel.locator('li').first();
      await firstCard.hover();
      await expect.poll(() => firstCard.evaluate(node => getComputedStyle(node).transform)).not.toBe('none');
    }
    await panel.screenshot({ path: `tmp/workbench-qa/today-analysis-${viewport.width}.png` });
  });
}

test('overview shows truthful manual-or-scheduled empty state and analysis progress', async ({ page }) => {
  const data = makeState();
  data.reports = [];
  data.preferences.schedules!.analysis.enabled = false;
  data.jobs = [{ id: 'pending-analysis', kind: 'manual', state: 'running', startedAt: new Date().toISOString() }];
  await page.route('**/api/ibkr-workbench/**', route => route.fulfill({ json: route.request().url().endsWith('/state') ? data : [] }));
  await page.goto('http://127.0.0.1:5187/ibkr');
  const panel = page.getByRole('region', { name: '今日分析结论' });
  await expect(panel).toContainText('今日账户分析正在生成');
  await expect(panel).toContainText('启动服务不会自动补跑');
  await expect(panel).toContainText('每日定时未开启');
  await expect(panel.getByRole('button', { name: '查看分析进度' })).toBeVisible();
});
