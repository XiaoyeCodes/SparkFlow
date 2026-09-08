import { test, expect } from '@playwright/test';
import { emptySnapshot } from '../../src/lib/ibkr/store';
import type { BriefInsight, WorkbenchState } from '../../src/lib/ibkr/workbenchTypes';

// Synthetic account and sources only; this UI host has no broker or AI plugin.
const makeState = (): WorkbenchState => {
  const base: BriefInsight = { id: 'low', title: '等待下一次经营更新', kind: 'watch', priority: 'low', status: 'ongoing', symbols: ['AAPL'], fact: '离线公告夹具披露了经营进展。', impact: '盈利兑现决定这项变化能否持续支持持仓估值。', watch: '查看后续财报的利润率与经营现金流是否同步改善。', invalidation: '如果收入增长没有转化为现金流，当前乐观判断需要下调。', horizon: '未来一个财报季度', confidence: 'medium', confidenceReason: '公告已有原文，盈利预测尚未更新。', evidenceIds: ['company'], support: [{ evidenceId: 'company', quote: 'This is synthetic source text for UI verification.' }] };
  const snapshot = { ...emptySnapshot('live'), snapshotId: 'ui-snapshot', accountKey: 'live:ui-only', connection: 'connected' as const, state: 'ready' as const, baseCurrency: 'USD', asOf: '2026-09-08T03:00:00Z', testData: true, source: 'fixture' as const, positions: [] };
  return { source: 'mcp', connection: { state: 'connected', detail: '离线界面测试', tools: [], accounts: [] }, snapshot, quotes: [], evidence: [], alerts: [], reports: [], jobs: [], preferences: { horizon: 'both', targetWeight: null, cashFloor: null, maxDrawdown: null, daily: true, eventAnalysis: true, maxAutomatic: 4, cooldownMinutes: 60, maxAiCalls: 12 }, ai: { provider: 'fixture', model: 'offline-test', fingerprint: 'ui-only', configured: true, enabled: true, fields: [], usedToday: 0 }, nextSyncAt: null, calendarSupported: true,
    dailyBrief: { enabled: true, state: 'ready', detail: '简报已生成', nextRunAt: '2026-09-08T20:30:00Z', dueSession: '2026-09-04', calendarSupported: true, latest: { id: 'ui-brief', accountKey: snapshot.accountKey, snapshotId: snapshot.snapshotId, snapshotHash: 'synthetic', snapshotAsOf: snapshot.asOf, sessionDate: '2026-09-04', analysisAsOf: '2026-09-08T02:00:00Z', generatedAt: '2026-09-08T03:05:00Z', provider: 'fixture', model: 'offline-test', promptVersion: 'ui-v2', facts: { nav: { label: '净资产', display: '100.00 USD', source: '合成测试账户', asOf: snapshot.asOf } },
      content: { headline: '先验证盈利兑现，宏观数据决定估值空间', summary: '本期新增的经营消息提供了需求改善线索。账户判断仍取决于利润率与现金流能否兑现，同时需要观察利率变化是否抵消盈利改善。以下内容为离线界面测试，未使用真实账户或投资新闻。', risk: '旧格式兼容字段不应重复展示。', watch: ['旧格式观察项不应重复展示。'], gaps: ['盈利预期尚未更新。'], insights: [base, { ...base, id: 'high', title: '宏观利率变化影响科技持仓估值', kind: 'risk', priority: 'high', status: 'upgraded', symbols: ['AAPL', 'MSFT'], impact: '相关持仓可能同时承受折现率变化，盈利改善幅度需要覆盖估值压力。' }, { ...base, id: 'medium', title: '经营改善提供有条件的机会', kind: 'opportunity', priority: 'medium', status: 'new', impact: '若利润率与现金流同步改善，经营更新才会强化现有持仓逻辑。' }], calendar: [{ title: '公司经营说明会（测试事件）', at: '2026-09-12', dateStatus: 'estimated', symbols: ['AAPL'], watch: '检查管理层对利润率的解释。', implication: '若支出上升超过收入改善幅度，需下调盈利兑现判断。', evidenceIds: ['company'] }], changes: ['新增经营兑现条件，宏观风险由一般观察升级为重点。'] },
      evidence: [{ id: 'company', title: '公司经营公告（合成来源）', summary: 'Synthetic evidence.', url: 'https://example.com/announcement', source: 'example.com', publishedAt: '2026-09-08T01:00:00Z', fetchedAt: '2026-09-08T01:30:00Z', symbols: ['AAPL'], kind: 'filing', primary: true, read: true }, { id: 'invalid-link', title: '不可信链接测试', summary: '', url: 'javascript:alert(1)', source: 'fixture', publishedAt: null, fetchedAt: '2026-09-08T01:30:00Z', symbols: [], kind: 'news', read: false }], coverage: [{ symbol: 'AAPL', status: 'partial', areas: ['news', 'valuation'], gaps: ['估值预期数据缺失。'] }, { symbol: 'MSFT', status: 'failed', areas: [], gaps: ['公告读取失败。'] }], researchGaps: ['公告覆盖不足，不能判断没有其他事件。'] } },
  };
};

for (const viewport of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
  test(`daily research brief prioritizes actionable content and exposes evidence at ${viewport.width}px`, async ({ page }) => {
    const data = makeState();
    await page.setViewportSize(viewport);
    await page.route('**/api/ibkr-workbench/**', route => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({ json: path.endsWith('/state') ? data : path.endsWith('/performance') ? { points: [], source: 'offline test', fetchedAt: null, currency: 'USD', returnMethod: null, benchmark: 'none', note: '' } : [] });
    });
    await page.goto('http://127.0.0.1:5187/ibkr');
    const panel = page.getByRole('region', { name: 'AI 账户简报' });
    await expect(panel).toContainText('研究截至 2026/9/8 10:00:00（北京时间）');
    await expect(panel).toContainText('最近收盘交易日 2026-09-04');
    await expect(panel).not.toContainText('旧格式兼容字段');
    await expect(panel.locator('.awb-daily-insight h4').nth(0)).toHaveText('宏观利率变化影响科技持仓估值');
    await expect(panel.locator('.awb-daily-insight h4').nth(1)).toHaveText('经营改善提供有条件的机会');
    await expect(panel.getByText('等待下一次经营更新', { exact: true })).toBeHidden();
    const bounds = await panel.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    await panel.screenshot({ path: `tmp/workbench-qa/daily-brief-v2-${viewport.width}.png` });

    const first = panel.locator('.awb-daily-insight').first();
    const expand = first.locator('summary');
    await expand.focus();
    await page.keyboard.press('Enter');
    await expect(first.getByText('什么会改变判断', { exact: true })).toBeVisible();
    await expect(first).toContainText('公告已有原文，盈利预测尚未更新');
    await expect(first.getByRole('link', { name: '公司经营公告（合成来源）' })).toHaveAttribute('href', 'https://example.com/announcement');
    await expect(first.getByText('This is synthetic source text for UI verification.')).toBeVisible();
    await panel.locator('.awb-brief-more>summary').click();
    await expect(panel.getByText('等待下一次经营更新', { exact: true })).toBeVisible();
    await panel.locator('.awb-brief-fold>summary').filter({ hasText: '未来 7 日关注' }).click();
    await expect(panel.getByText('2026-09-12（时间未确认） · 预计')).toBeVisible();
    await panel.locator('.awb-brief-fold>summary').filter({ hasText: '相较上期的变化' }).click();
    await expect(panel.getByText('新增经营兑现条件，宏观风险由一般观察升级为重点。')).toBeVisible();
    await panel.locator('.awb-brief-fold>summary').filter({ hasText: '研究覆盖与来源' }).click();
    await expect(panel.getByText('公告覆盖不足，不能判断没有其他事件。')).toBeVisible();
    await expect(panel.locator('.awb-brief-coverage-list')).toContainText('MSFT检索失败');
    await expect(panel.locator('a[href^="javascript:"]')).toHaveCount(0);
    expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  });
}

test('daily research brief displays live detail while preserving the latest successful report', async ({ page }) => {
  const data = makeState();
  data.dailyBrief!.state = 'running';
  data.dailyBrief!.detail = '正在读取公司公告，已覆盖 3/12 个持仓…';
  await page.route('**/api/ibkr-workbench/**', route => route.fulfill({ json: route.request().url().endsWith('/state') ? data : [] }));
  await page.goto('http://127.0.0.1:5187/ibkr');
  const panel = page.getByRole('region', { name: 'AI 账户简报' });
  await expect(panel.getByRole('status')).toContainText('正在读取公司公告，已覆盖 3/12 个持仓…');
  await expect(panel.getByRole('status')).toContainText('当前保留上一份成功简报');
  await expect(panel.getByRole('button', { name: '正在生成简报' })).toBeDisabled();
  await expect(panel).toContainText('先验证盈利兑现，宏观数据决定估值空间');
});
