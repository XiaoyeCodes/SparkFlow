import { test, expect } from '@playwright/test';
import { emptySnapshot } from '../../src/lib/ibkr/store';
import type { AnalysisReport, WorkbenchState } from '../../src/lib/ibkr/workbenchTypes';

const makeState = (): WorkbenchState => {
  const snapshot = { ...emptySnapshot('live'), snapshotId: 'ui-snapshot', accountKey: 'live:ui-only', connection: 'connected' as const, state: 'ready' as const, baseCurrency: 'USD', asOf: new Date().toISOString(), testData: true, source: 'fixture' as const, positions: [] };
  const riskSummary = '今日整体风险关注度：高（风险指数 74/100）——现金占比 2.2%，AAPL 33.5% 与 QQQ 21.4% 形成集中风险。';
  const report: AnalysisReport = { id: 'today-analysis', version: 2, accountKey: snapshot.accountKey, snapshotId: snapshot.snapshotId, snapshotHash: 'synthetic', generatedAt: new Date().toISOString(), provider: 'fixture', model: 'offline-analysis', kind: 'manual', evidence: [], quotes: [], snapshot, content: { headline: '现金缓冲偏低，今天先控制集中度', briefPoints: ['AAPL 33.5% 与 QQQ 21.4% 形成集中风险，先检查减仓触发条件。', '输入数据仍有缺口，现金仅 2.2%，等待市场信号确认。', '最高优先级是控制仓位，确认后分批减仓，不追高。'], brief: riskSummary, rawContent: `# 现金缓冲偏低，今天先控制集中度\n\n现金占比 2.2%，AAPL 33.5% 与 QQQ 21.4% 形成集中风险。\n\n${riskSummary}`, riskSummary, accountSummary: '离线账户摘要', portfolioRisk: '集中度偏高', marketContext: '离线市场背景', holdings: [], opportunities: [], risks: ['集中度偏高'], actions: [], gaps: [] } };
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
    const risk = panel.locator('.awb-portfolio-risk');
    await expect(risk).toBeVisible();
    await expect(risk.getByRole('img', { name: '持仓风险指数 74/100，高关注度' })).toBeVisible();
    await expect(risk).toContainText('现金缓冲');
    await expect(risk).toContainText('AAPL 33.5%');
    await expect(risk).toContainText('QQQ 21.4%');
    await expect(risk).toContainText('风险指数 74/100');
    await expect(panel).toContainText('手动分析 · offline-analysis');
    await expect(panel).not.toContainText('AI 账户简报');
    await expect(panel).not.toContainText('重新生成简报');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (viewport.width === 1920) {
      const bodyBox = await panel.locator('.awb-overview-analysis-body').boundingBox();
      const chartBox = await risk.locator('.awb-portfolio-risk-chart').boundingBox();
      const conclusionBox = await risk.locator('.awb-portfolio-risk-conclusion').boundingBox();
      expect(bodyBox?.height).toBeGreaterThan(500);
      expect(chartBox?.height).toBeGreaterThan(100);
      expect(conclusionBox?.height).toBeGreaterThan(70);
    }
    await panel.screenshot({ path: `tmp/workbench-qa/today-analysis-${viewport.width}.png` });
    await panel.getByRole('button', { name: '查看完整分析' }).click();
    const fullReport = page.getByRole('article', { name: '完整账户研究报告' });
    await expect(fullReport).toBeVisible();
    await expect(fullReport).toContainText('现金缓冲偏低，今天先控制集中度');
    await expect(fullReport).toContainText('风险指数 74/100');
  });
}

test('overview shows truthful manual-or-scheduled empty state and analysis progress', async ({ page }) => {
  const data = makeState();
  await page.setViewportSize({ width: 1920, height: 1080 });
  data.reports = [];
  data.preferences.schedules!.analysis.enabled = false;
  data.jobs = [{ id: 'pending-analysis', kind: 'manual', state: 'running', startedAt: new Date().toISOString() }];
  await page.route('**/api/ibkr-workbench/**', route => route.fulfill({ json: route.request().url().endsWith('/state') ? data : [] }));
  await page.goto('http://127.0.0.1:5187/ibkr');
  const panel = page.getByRole('region', { name: '今日分析结论' });
  await expect(panel).toHaveAttribute('aria-busy', 'true');
  await expect(panel.getByRole('heading', { name: '正在生成今日账户分析' })).toBeVisible();
  await expect(panel.locator('.awb-brief-notice')).toHaveCount(0);
  await expect(panel.getByRole('status')).toContainText('正在构建今日账户结论');
  await expect(panel.locator('.awb-analysis-orbital')).toBeVisible();
  await expect(panel.locator('.awb-analysis-orbit')).toHaveCount(2);
  await panel.screenshot({ path: 'tmp/workbench-qa/today-analysis-processing-1920.png' });
  await expect(panel).toContainText('启动服务不会自动补跑');
  await expect(panel).toContainText('定时未开启');
  await expect(panel.getByRole('button', { name: '查看分析进度' })).toBeVisible();
  await expect(panel.getByRole('button', { name: '生成今日分析' })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.locator('.awb-analysis-orbital')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.screenshot({ path: 'tmp/workbench-qa/today-analysis-processing-390.png' });
});

test('overview empty state can start today analysis directly', async ({ page }) => {
  const data = makeState();
  data.reports = [];
  data.jobs = [];
  data.preferences.schedules!.analysis.enabled = false;
  let started = 0;
  await page.route('**/api/ibkr-workbench/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/analyze')) { started++; return route.fulfill({ status: 202, json: { ok: true } }); }
    return route.fulfill({ json: path.endsWith('/state') ? data : [] });
  });
  await page.goto('http://127.0.0.1:5187/ibkr');
  const panel = page.getByRole('region', { name: '今日分析结论' });
  const button = panel.getByRole('button', { name: /生成今日分析/ });
  await expect(button).toBeVisible();
  await expect(panel.locator('.awb-analysis-orbital')).toHaveCount(0);
  await expect(button).toContainText('读取最新账户与全部持仓');
  await button.click();
  await expect.poll(() => started).toBe(1);
  await panel.screenshot({ path: 'tmp/workbench-qa/today-analysis-empty-action.png' });
});

test('overview falls back to the most recent completed analysis when today has no report', async ({ page }) => {
  const data = makeState();
  data.jobs = [{ id: 'later-incomplete-task', kind: 'manual', state: 'partial', startedAt: new Date(Date.parse(data.reports[0].generatedAt) + 60_000).toISOString() }];
  await page.route('**/api/ibkr-workbench/**', route => route.fulfill({ json: route.request().url().endsWith('/state') ? data : [] }));
  await page.goto('http://127.0.0.1:5187/ibkr');
  const panel = page.getByRole('region', { name: '今日分析结论' });
  await expect(panel.getByRole('img', { name: '持仓风险指数 74/100，高关注度' })).toBeVisible();
  await expect(panel.locator('.awb-brief-notice')).toHaveCount(0);
  data.reports[0].generatedAt = new Date(Date.now() - 86_400_000).toISOString();
  data.jobs = [];
  await page.reload();
  const recentPanel = page.getByRole('region', { name: '最近一次分析' });
  await expect(recentPanel).toContainText('最近一次分析');
  await expect(recentPanel).toContainText('非今日数据');
  await expect(recentPanel.getByRole('img', { name: '持仓风险指数 74/100，高关注度' })).toBeVisible();
  await expect(recentPanel.locator('.awb-brief-notice')).toHaveCount(0);
  await expect(recentPanel.getByRole('button', { name: '查看完整分析' })).toBeVisible();
  await recentPanel.screenshot({ path: 'tmp/workbench-qa/recent-analysis-fallback-1920.png' });
});
