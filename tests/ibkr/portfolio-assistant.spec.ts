import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { emptySnapshot } from '../../src/lib/ibkr/store';
import { assistantReportContent } from '../../src/lib/ibkr/portfolioRisk';
import type { WorkbenchState, AnalysisReport } from '../../src/lib/ibkr/workbenchTypes';

// Offline UI fixtures should not wait for the optional remote font stylesheet.
test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, route => route.abort());
});

const conclusion = '今日整体风险关注度：高（风险指数 78/100）——现金缓冲偏低，科技持仓集中，需关注利率事件。';
const markdown = `# 当前持仓风险研究\n\n这是界面测试示例，不是真实账户建议。\n\n## 组合结构与主要风险\n\n**现金缓冲**与科技行业集中度值得关注。完整报告以连续文章展示，保留分析依据与数据时间。\n\n## 数据与判断边界\n\n评分是 AI 的风险关注判断，并非亏损概率。请结合[原始资料](https://example.com)核对。\n\n<script>window.__unsafe = 1</script>\n\n${conclusion}`;
function fixture() {
  const snapshot = { ...emptySnapshot('live'), snapshotId: 'test-snapshot', accountKey: 'live:fixture', connection: 'connected', state: 'ready', asOf: new Date().toISOString(), baseCurrency: 'USD', metrics: { netLiquidation: '10000', unrealizedPnl: '20', buyingPower: '1000', maintenanceMargin: '100' }, cash: [{ currency: 'USD', amount: '1000' }], positions: [] } as WorkbenchState['snapshot'];
  const report = { id: '12345678-1234-4234-8234-123456789abc', accountKey: snapshot.accountKey, snapshotId: snapshot.snapshotId, snapshotHash: 'fixture', generatedAt: new Date().toISOString(), provider: 'fixture', model: 'offline', kind: 'manual', snapshot, evidence: [], quotes: [], content: assistantReportContent(markdown) } as AnalysisReport;
  return { source: 'mcp', gatewayMode: 'live', connection: { state: 'connected', detail: '离线测试', tools: [], accounts: [] }, snapshot, quotes: [], evidence: [], alerts: [], reports: [report], jobs: [], preferences: { horizon: 'both', targetWeight: null, cashFloor: null, maxDrawdown: null, daily: false, eventAnalysis: false, maxAutomatic: 4, cooldownMinutes: 60, maxAiCalls: 12 }, ai: { provider: 'fixture', model: 'offline', fingerprint: 'fixture', configured: true, enabled: true, fields: [], usedToday: 1 }, nextSyncAt: null, calendarSupported: true } as WorkbenchState;
}

for (const width of [1440, 1920, 390]) test(`risk gauge and continuous safe report ${width}`, async ({ page }) => {
  const data = fixture();
  await page.setViewportSize({ width, height: 1000 });
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/api/ibkr-workbench/state', route => route.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', route => route.fulfill({ json: [] }));
  await page.goto('http://127.0.0.1:5187/ibkr');
  const overview = page.getByRole('region', { name: '今日分析结论' });
  await expect(overview.getByRole('img', { name: '持仓风险指数 78/100，高关注度' })).toBeVisible();
  await expect(overview).toContainText(conclusion);
  await expect(overview).not.toContainText('完整报告以连续文章展示');
  await mkdir('tmp/assistant-research-qa', { recursive: true });
  await overview.screenshot({ path: `tmp/assistant-research-qa/risk-${width}.png` });
  await overview.getByRole('button', { name: '查看完整分析' }).click();
  await page.getByRole('button', { name: '查看完整报告与依据' }).click();
  const article = page.getByRole('article', { name: '完整账户研究报告' });
  await expect(article.getByRole('heading', { name: '当前持仓风险研究' })).toBeVisible();
  await expect(article).toContainText(conclusion);
  const articleBox = (await article.boundingBox())!;
  const toolbarBox = (await page.locator('.awb-analysis-toolbar').boundingBox())!;
  expect(Math.abs(articleBox.x - toolbarBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(articleBox.x + articleBox.width - toolbarBox.x - toolbarBox.width)).toBeLessThanOrEqual(1);
  await expect(page.locator('.awb-analysis-report-grid')).toHaveCount(0);
  await expect(article.locator('table,script')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__unsafe)).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await article.screenshot({ path: `tmp/assistant-research-qa/report-${width}.png` });
});

for (const viewport of [{ width: 1920, height: 1080 }, { width: 2560, height: 1440 }, { width: 390, height: 844 }]) test(`overview risk card aligns with the left panels and keeps the footer close ${viewport.width}`, async ({ page }) => {
  const data = fixture();
  await page.setViewportSize(viewport);
  await page.route('**/api/**', r => r.fulfill({ json: {} }));
  await page.route('**/api/ibkr-workbench/state', r => r.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', r => r.fulfill({ json: [] }));
  for (const long of [false, true]) {
    data.reports[0].content = assistantReportContent(long ? markdown.replace(conclusion, conclusion + '集中度与现金缓冲需要结合最新资料持续核验。'.repeat(8)) : markdown);
    await page.goto('http://127.0.0.1:5187/ibkr', { waitUntil: 'domcontentloaded' });
    const card = page.getByRole('region', { name: '今日分析结论' });
    await expect(card).toContainText('风险指数 78/100');
    const bounds = await card.boundingBox();
    const footer = await card.locator('.awb-overview-analysis-footer').boundingBox();
    const padding = await card.evaluate(el => parseFloat(getComputedStyle(el).paddingBottom) + parseFloat(getComputedStyle(el).borderBottomWidth));
    expect(Math.abs(bounds!.y + bounds!.height - footer!.y - footer!.height - padding)).toBeLessThanOrEqual(2);
    if (viewport.width >= 1500) {
      const funds = (await page.locator('.awb-overview-layout .awb-funds-panel').boundingBox())!;
      const performance = (await page.locator('.awb-overview-layout .awb-performance-redesign').boundingBox())!;
      expect(Math.abs(bounds!.y - performance.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(bounds!.y + bounds!.height - funds.y - funds.height)).toBeLessThanOrEqual(1);
    }
    const summaryBox = await card.locator('.awb-portfolio-risk-conclusion').boundingBox();
    expect(footer!.y - summaryBox!.y - summaryBox!.height).toBeLessThanOrEqual(20);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await card.getByRole('button', { name: '查看完整分析' }).scrollIntoViewIfNeeded();
    await expect(card.getByRole('button', { name: '查看完整分析' })).toBeVisible();
  }
});

for (const width of [1920, 1440, 900, 390]) test(`sidebar background follows page height without moving sticky navigation ${width}`, async ({ page }) => {
  const data = fixture();
  data.reports[0].content = assistantReportContent(markdown.repeat(4));
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/api/**', r => r.fulfill({ json: {} }));
  await page.route('**/api/ibkr-workbench/state', r => r.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', r => r.fulfill({ json: [] }));
  await page.goto('http://127.0.0.1:5187/ibkr', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('region', { name: '今日分析结论' })).toContainText('风险指数 78/100');
  const sidebar = page.locator('.awb-sidebar');
  if (width > 600) {
    const measure = () => page.evaluate(() => {
      const rail = document.querySelector('.awb-sidebar')!.getBoundingClientRect();
      const main = document.querySelector('.account-workbench')!.getBoundingClientRect();
      const inner = document.querySelector('.awb-sidebar-inner')!.getBoundingClientRect();
      return { railBottom: rail.bottom, mainBottom: main.bottom, innerTop: inner.top, innerBottom: inner.bottom, height: main.height };
    });
    const overview = await measure();
    expect(Math.abs(overview.railBottom - overview.mainBottom)).toBeLessThanOrEqual(1);
    if (width > 1200) {
      await page.getByRole('region', { name: '今日分析结论' }).getByRole('button', { name: '查看完整分析' }).click();
      await page.getByRole('button', { name: '查看完整报告与依据' }).click();
      await expect(page.getByRole('article', { name: '完整账户研究报告' })).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    const initial = await measure();
    expect(initial.height).toBeGreaterThan(900);
    expect(Math.abs(initial.railBottom - initial.mainBottom)).toBeLessThanOrEqual(1);
    expect(initial.innerBottom).toBeLessThanOrEqual(901);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(async () => Math.abs((await measure()).innerTop - initial.innerTop)).toBeLessThanOrEqual(1);
    const scrolled = await measure();
    expect(Math.abs(scrolled.railBottom - scrolled.mainBottom)).toBeLessThanOrEqual(1);
    await expect(sidebar.getByRole('button', { name: '设置', exact: true })).toBeInViewport();
    await expect(sidebar.locator('.awb-sidebar-foot')).toBeInViewport();
    await mkdir('tmp/assistant-research-qa', { recursive: true });
    if (width === 1920) await page.screenshot({ path: 'tmp/assistant-research-qa/sidebar-aligned.png' });
  } else {
    await expect(sidebar).toBeHidden();
    await page.getByRole('button', { name: '展开导航' }).click();
    await expect(sidebar).toBeVisible();
    const box = (await sidebar.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(901);
    await sidebar.getByRole('button', { name: '持仓', exact: true }).click();
    await expect(sidebar).toBeHidden();
    await expect(page.getByRole('heading', { name: '我的持仓', exact: true }).first()).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const width of [1920, 390]) test(`report editorial markdown and restrained highlights ${width}`, async ({ page }) => {
  const data = fixture();
  const text = `# IBKR 主账户组合深度剖析与风险审查（2026 年 9 月 15 日）\n\n## 一、口径与数据时点说明\n\n账户快照来自 IBKR，时间为 2026/9/15 11:46。现金占比 **0.58%**，净值 **1,005,245.89美元**，前五大持仓合计 **78.8%**，其余数据保持常规文字。\n\n> 数据为账户快照，并非实时行情。请结合原始资料核验。\n\n## 二、主要判断\n\n- **集中度**需要持续关注。\n- 关注利率事件及现金缓冲。\n\n${Array.from({ length: 8 }, () => '**24.5%** 与 **1,000美元** 是用于检查高亮预算的界面示例。').join('\n\n')}\n\n${markdown}`;
  data.reports[0].content = assistantReportContent(text);
  await page.setViewportSize({ width, height: 1000 });
  await page.route('**/api/**', r => r.fulfill({ json: {} }));
  await page.route('**/api/ibkr-workbench/state', r => r.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', r => r.fulfill({ json: [] }));
  await page.goto('http://127.0.0.1:5187/ibkr', { waitUntil: 'domcontentloaded' });
  await page.getByRole('region', { name: '今日分析结论' }).getByRole('button', { name: '查看完整分析' }).click();
  await page.getByRole('button', { name: '查看完整报告与依据' }).click();
  const article = page.getByRole('article', { name: '完整账户研究报告' });
  await expect(article.locator('blockquote')).toContainText('并非实时行情');
  await expect(article.locator('ul li')).toHaveCount(2);
  await expect(article.locator('ul')).toHaveCSS('list-style-type', 'disc');
  await expect(article.locator('.awb-report-risk-callout')).toHaveText(conclusion);
  await expect(article.locator('.awb-research-number,.awb-research-ticker,.awb-research-risk,.awb-research-keyword')).toHaveCount(0);
  await expect(article.locator('.awb-report-key-data')).toHaveCount(9);
  await expect(article.locator('.awb-report-risk-callout .awb-report-key-data')).toHaveText('风险指数 78/100');
  await expect(article.locator('h1 .awb-report-key-data')).toHaveCount(0);
  await expect(article.locator('script')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__unsafe)).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir('tmp/assistant-research-qa', { recursive: true });
  await article.screenshot({ path: `tmp/assistant-research-qa/editorial-${width}.png` });
});

for (const width of [1920, 390]) test(`report follow-up aligns and targets selected report without creating a browser session ${width}`, async ({ page }) => {
  test.setTimeout(60000);
  const data = fixture();
  const current = data.reports[0]; current.assistantSessionId = 'current-session';
  const older = { ...current, id: '22345678-1234-4234-8234-123456789abc', generatedAt: '2026-09-10T00:00:00Z', assistantSessionId: 'older-session', content: assistantReportContent('# 历史持仓研究\n\n' + conclusion) };
  data.reports.push(older);
  const sent: { question: string; parentReportId: string }[] = [];
  let unavailable = false, browserSessionPosts = 0;
  await page.setViewportSize({ width, height: 1000 });
  await page.route('**/api/**', r => r.fulfill({ json: {} }));
  await page.route('**/api/ibkr-workbench/state', r => r.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', r => r.fulfill({ json: [] }));
  await page.route('**/api/vibe/research/**', r => { if (r.request().method() === 'POST') browserSessionPosts++; return r.fulfill({ json: {} }); });
  await page.route('**/api/ibkr-workbench/analyze', async r => {
    const body = r.request().postDataJSON(); sent.push(body);
    if (unavailable) return r.fulfill({ status: 400, json: { error: '原 AI 会话暂时无法连接，未新建会话。' } });
    const parent = data.reports.find(item => item.id === body.parentReportId)!;
    data.reports.unshift({ ...parent, id: `${sent.length + 3}2345678-1234-4234-8234-123456789abc`, parentReportId: parent.id, kind: 'chat', question: body.question, generatedAt: new Date().toISOString(), content: assistantReportContent(`## 追问回复\n\n这是对“${body.question}”的延续回答。\n\n${conclusion}`) });
    return r.fulfill({ status: 202, json: { state: 'completed' } });
  });
  await page.goto('http://127.0.0.1:5187/ibkr', { waitUntil: 'domcontentloaded' });
  await page.getByRole('region', { name: '今日分析结论' }).getByRole('button', { name: '查看完整分析' }).click();
  await page.getByRole('button', { name: '查看完整报告与依据' }).click();
  const article = page.getByRole('article', { name: '完整账户研究报告' });
  const composer = page.locator('.awb-analysis-report-composer');
  await expect(composer).toContainText('沿用当前报告的 AI 会话');
  const a = (await article.boundingBox())!, b = (await composer.boundingBox())!;
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
  await composer.getByRole('textbox', { name: '账户分析问题' }).fill('解释现金缓冲');
  await composer.getByRole('button', { name: '提交问题' }).click();
  await expect(page.getByRole('region', { name: '当前报告的追问' })).toContainText('解释现金缓冲');
  expect(sent[0]).toEqual({ question: '解释现金缓冲', parentReportId: current.id });
  await expect(article.getByRole('heading', { name: '当前持仓风险研究' })).toBeVisible();
  await page.getByRole('button', { name: '历史报告', exact: true }).click();
  await page.getByRole('option').last().click();
  await expect(article.getByRole('heading', { name: '历史持仓研究' })).toBeVisible();
  unavailable = true;
  await composer.getByRole('textbox', { name: '账户分析问题' }).fill('延续历史报告的问题');
  await composer.getByRole('button', { name: '提交问题' }).click();
  await expect(page.locator('.awb-message.error')).toContainText('原 AI 会话暂时无法连接');
  await expect(composer.getByRole('textbox', { name: '账户分析问题' })).toHaveValue('延续历史报告的问题');
  expect(sent[1]).toEqual({ question: '延续历史报告的问题', parentReportId: older.id });
  unavailable = false;
  await composer.getByRole('button', { name: '提交问题' }).click();
  await expect(page.getByRole('region', { name: '当前报告的追问' })).toContainText('延续历史报告的问题');
  await expect(page.getByRole('region', { name: '当前报告的追问' })).not.toContainText('解释现金缓冲');
  expect(sent[2].parentReportId).toBe(older.id); expect(browserSessionPosts).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const width of [1920, 1280, 390]) test(`analysis interaction aligns with history and omits page footer ${width}`, async ({ page }) => {
  test.setTimeout(60000);
  const data = fixture();
  const original = data.reports[0];
  await page.setViewportSize({ width, height: 1000 });
  await page.route('**/api/**', r => r.fulfill({ json: {} }));
  await page.route('**/api/ibkr-workbench/state', r => r.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', r => r.fulfill({ json: [] }));
  for (const count of [1, 6]) {
    data.reports = Array.from({ length: count }, (_, i) => ({ ...original, id: `${i + 1}2345678-1234-4234-8234-123456789abc`, generatedAt: new Date(Date.now() - i * 86400000).toISOString() }));
    await page.goto('http://127.0.0.1:5187/ibkr?tab=reports', { waitUntil: 'domcontentloaded' });
    const interaction = page.getByRole('region', { name: '分析进展与提问' });
    const history = page.getByRole('region', { name: '历史研究', exact: true });
    await expect(interaction.getByRole('textbox', { name: '账户分析问题' })).toBeVisible();
    const left = (await interaction.boundingBox())!, right = (await history.boundingBox())!;
    if (width > 900) {
      expect(Math.abs(left.y - right.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(left.y + left.height - right.y - right.height)).toBeLessThanOrEqual(1);
    } else {
      expect(right.y).toBeGreaterThanOrEqual(left.y + left.height);
    }
    await expect(page.locator('.awb-footer')).toHaveCount(0);
    await expect(page.getByText('本机服务运行期间持续更新', { exact: true })).toHaveCount(0);
    const input = await interaction.getByRole('textbox', { name: '账户分析问题' }).boundingBox();
    expect(input!.height).toBeGreaterThanOrEqual(64);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 1920 && count === 6) {
      await mkdir('tmp/assistant-research-qa', { recursive: true });
      await interaction.screenshot({ path: 'tmp/assistant-research-qa/aligned-interaction.png' });
    }
  }
});

test('missing risk score never becomes a zero score', async ({ page }) => {
  const data = fixture(); data.reports[0].content = assistantReportContent('# 报告\n\n今日整体风险关注度：暂无法评估——缺少数据');
  await page.route('**/api/**', r => r.fulfill({ json: {} }));
  await page.route('**/api/ibkr-workbench/state', r => r.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', r => r.fulfill({ json: [] }));
  await page.goto('http://127.0.0.1:5187/ibkr');
  await expect(page.getByRole('img', { name: '持仓风险指数暂缺' })).toBeVisible();
  await expect(page.locator('.awb-risk-number')).toHaveText('—');
});

test('assistant portfolio starter starts the account job once and opens that same saved session', async ({ page }) => {
  let starts = 0, duplicatePosts = 0;
  const session = { session_id: 'portfolio-fixture', title: '分析一下我的当前持仓情况', status: 'active', last_attempt_status: 'completed', last_attempt_id: 'fixture-attempt', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  await page.route('**/api/**', r => r.fulfill({ json: {} }));
  await page.route('**/api/vibe/research/sessions', r => r.fulfill({ json: starts ? [session] : [] }));
  await page.route('**/api/vibe/research/messages?*', r => r.fulfill({ json: [
    { message_id: 'q', role: 'user', content: '分析一下我的当前持仓情况', linked_attempt_id: 'fixture-attempt' },
    { message_id: 'a', role: 'assistant', content: markdown, linked_attempt_id: 'fixture-attempt' },
  ] }));
  await page.route('**/api/ibkr-workbench/analyze', async r => { starts++; await r.fulfill({ json: { id: '12345678-1234-4234-8234-123456789abc', state: 'running', assistantSessionId: session.session_id, assistantAttemptId: 'fixture-attempt' } }); });
  await page.route('**/api/vibe/research/message', r => { duplicatePosts++; return r.fulfill({ json: {} }); });
  await page.goto('http://127.0.0.1:5187/assistant');
  await page.getByRole('button', { name: '分析一下我的当前持仓情况', exact: true }).click();
  await page.getByRole('textbox', { name: '深度研究问题' }).press('Enter');
  await expect(page.getByRole('heading', { name: '当前持仓风险研究' })).toBeVisible();
  expect(starts).toBe(1); expect(duplicatePosts).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('sparkflow.vibe.session.v1'))).toBe('portfolio-fixture');
});

test('stopping while the portfolio job is being created cancels the acknowledged job', async ({ page }) => {
  let acknowledge!: () => void, started = 0, cancelled = '';
  const ready = new Promise<void>(resolve => { acknowledge = resolve; });
  await page.route('**/api/**', r => r.fulfill({ json: {} }));
  await page.route('**/api/vibe/research/sessions', r => r.fulfill({ json: [] }));
  await page.route('**/api/vibe/research/messages?*', r => r.fulfill({ json: [] }));
  await page.route('**/api/ibkr-workbench/analyze', async r => {
    started++; await ready;
    await r.fulfill({ json: { id: '12345678-1234-4234-8234-123456789abc', state: 'running', assistantSessionId: 'cancel-fixture' } });
  });
  await page.route('**/api/ibkr-workbench/cancel', r => { cancelled = r.request().postDataJSON().id; return r.fulfill({ json: { ok: true } }); });
  await page.goto('http://127.0.0.1:5187/assistant');
  await page.getByRole('button', { name: '分析一下我的当前持仓情况', exact: true }).click();
  await page.getByRole('textbox', { name: '深度研究问题' }).press('Enter');
  await expect.poll(() => started).toBe(1);
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  acknowledge();
  await expect.poll(() => cancelled).toBe('12345678-1234-4234-8234-123456789abc');
});

for (const width of [1920, 1440, 390]) test(`dynamic risk cards navigate to evidence and fit variable content ${width}`, async ({ page }) => {
  test.setTimeout(60000);
  const data = fixture();
  const text = '今日整体风险关注度：高（风险指数 74/100）——组合几乎满仓且现金仅 **0.58%**，单名 AXP **16.3%** 与 TSM **12.5%** 集中度偏高，同时叠加 9 月 16 日 FOMC 大概率加息（约85%–91%），10年期美债逼近5%，成长仓位面临估值压缩，是本组合当前最值得关注的复合风险。';
  data.reports[0].content = assistantReportContent('# 持仓报告\n\n## 现金依据\n\n现金仅 **0.58%**。\n\n' + text);
  data.reports.push({ ...data.reports[0], id: 'prior-report', generatedAt: new Date(Date.now() - 86400000).toISOString(), content: assistantReportContent(text.replace('74', '80')) });
  await page.setViewportSize({ width, height: 1000 });
  await page.route('**/api/**', r => r.fulfill({ json: {} }));
  await page.route('**/api/ibkr-workbench/state', r => r.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', r => r.fulfill({ json: [] }));
  await page.goto('http://127.0.0.1:5187/ibkr', { waitUntil: 'domcontentloaded' });
  const card = page.getByRole('region', { name: '今日分析结论' });
  await expect(card.locator('.awb-risk-highlight')).toHaveCount(4);
  await expect(card.locator('.awb-risk-change')).toHaveText('较上次风险 −6 分');
  await expect(card.locator('.awb-risk-highlights')).toContainText('AXP 16.3%');
  await expect(card.locator('.awb-risk-highlights')).toContainText('9月16日');
  await mkdir('tmp/assistant-research-qa', { recursive: true });
  await card.screenshot({ path: `tmp/assistant-research-qa/risk-cards-${width}.png` });
  if (width >= 1500) {
    const funds = (await page.locator('.awb-overview-layout .awb-funds-panel').boundingBox())!;
    const cardBox = (await card.boundingBox())!;
    expect(Math.abs(cardBox.y + cardBox.height - funds.y - funds.height)).toBeLessThanOrEqual(1);
    await page.locator('.awb-overview-layout').screenshot({ path: `tmp/assistant-research-qa/risk-aligned-${width}.png` });
  }
  for (const title of ['现金缓冲', '持仓集中度', '事件关注', '利率环境']) {
    await card.getByRole('button', { name: new RegExp(title) }).click();
    const focused = page.locator('.awb-risk-source-focus');
    await expect(focused).toHaveCount(1);
    await expect(focused).toBeFocused();
    await expect(focused).toBeInViewport();
    await page.goto('http://127.0.0.1:5187/ibkr', { waitUntil: 'domcontentloaded' });
  }
  data.reports[0].content = assistantReportContent(text + '集中度与现金缓冲需要结合最新资料持续核验。'.repeat(80));
  await page.reload();
  await expect(card.locator('.awb-portfolio-risk-conclusion')).toContainText('持续核验');
  expect(await card.locator('.awb-portfolio-risk-conclusion').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  const bounds = (await card.boundingBox())!, footer = (await card.locator('.awb-overview-analysis-footer').boundingBox())!;
  expect(footer.y + footer.height).toBeLessThanOrEqual(bounds.y + bounds.height);
  const summaryBounds = (await card.locator('.awb-portfolio-risk-conclusion').boundingBox())!;
  expect(summaryBounds.y + summaryBounds.height).toBeLessThanOrEqual(footer.y);
  expect(footer.y - summaryBounds.y - summaryBounds.height).toBeLessThanOrEqual(20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const viewport of [{ width: 1920, height: 1000 }, { width: 2560, height: 1440 }]) test(`risk card redistributes a fixed height for changing AI content ${viewport.width}`, async ({ page }) => {
  test.setTimeout(60000);
  const data = fixture();
  await page.setViewportSize(viewport);
  await page.route('**/api/**', r => r.fulfill({ json: {} }));
  await page.route('**/api/ibkr-workbench/state', r => r.fulfill({ json: data }));
  await page.route('**/api/ibkr-workbench/quotes', r => r.fulfill({ json: [] }));
  const base = '今日整体风险关注度：高（风险指数 74/100）——现金仅0.58%，单名 AXP 16.3% 与 TSM 12.5% 集中度偏高，9月16日 FOMC 会议，10年期美债收益率5%。';
  for (const [i, text] of [conclusion, base, base + '集中度与现金缓冲需要结合最新资料持续核验。'.repeat(80)].entries()) {
    data.reports[0].content = assistantReportContent(text);
    await page.goto('http://127.0.0.1:5187/ibkr', { waitUntil: 'domcontentloaded' });
    const card = page.getByRole('region', { name: '今日分析结论' });
    await expect(card).toContainText(i === 0 ? '78/100' : '74/100');
    const metrics = await card.evaluate(el => {
      const bounds = (node: Element) => { const rect = node.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, height: rect.height }; };
      const summary = el.querySelector('.awb-portfolio-risk-conclusion')!;
      return { card: bounds(el), footer: bounds(el.querySelector('.awb-overview-analysis-footer')!), summary: bounds(summary), left: bounds(document.querySelector('.awb-overview-layout .awb-funds-panel')!), body: bounds(el.querySelector('.awb-portfolio-risk')!), scroll: summary.scrollHeight > summary.clientHeight, width: document.documentElement.scrollWidth, viewport: innerWidth };
    });
    expect(Math.abs(metrics.card.bottom - metrics.left.bottom)).toBeLessThanOrEqual(1);
    expect(metrics.summary.bottom).toBeLessThanOrEqual(metrics.footer.top);
    expect(metrics.footer.top - metrics.summary.bottom).toBeLessThanOrEqual(20);
    expect(metrics.footer.bottom).toBeLessThanOrEqual(metrics.card.bottom);
    expect(metrics.width).toBeLessThanOrEqual(metrics.viewport);
    if (i === 2) expect(metrics.scroll).toBe(true);
    await mkdir('tmp/assistant-research-qa', { recursive: true });
    await card.screenshot({ path: `tmp/assistant-research-qa/risk-fit-${viewport.width}-${i}.png` });
    if (i === 1) await page.locator('.awb-overview-layout').screenshot({ path: `tmp/assistant-research-qa/risk-aligned-${viewport.width}.png` });
  }
});
