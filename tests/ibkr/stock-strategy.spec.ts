import { expect, test } from '@playwright/test';
import type { StrategyJob, StrategyState } from '../../src/lib/stockStrategyTypes';
import { readFile } from 'node:fs/promises';

const report = {
  stock_name: '测试公司',
  report: {
    meta: { stock_name: '测试公司', stock_code: 'AAPL', current_price: 200, change_pct: -1.2 },
    summary: { analysis_summary: '这是测试报告。价格仍在关键均线上方，需要量能确认。', operation_advice: '观望', sentiment_score: 62, trend_prediction: '震荡' },
    strategy: { ideal_buy: '190–195', secondary_buy: '185', stop_loss: '180', take_profit: '220' },
    details: { technical_analysis: '## 量价依据\n\n等待突破确认。', fundamental_analysis: '观察盈利变化。', news_summary: '测试新闻来源。', risk_warning: '避免过度集中。' },
  },
};

for (const viewport of [{ width: 1440, height: 1050 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
  test(`strategy workspace, analysis, history and follow-up at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route('**/api/**', route => route.fulfill({ status: 503, json: {} }));
    const state: StrategyState = { ready: true, configured: true, model: 'test-model', provider: 'custom', jobs: [], strategies: [
      { id: 'bull_trend', name: '多头趋势', description: '趋势确认和回踩观察', category: 'trend' },
      { id: 'growth_quality', name: '成长质量', description: '盈利和现金流', category: 'fundamental' },
    ] };
    let latest: StrategyJob | null = null;
    const submitted: Record<string, unknown>[] = [];
    await page.route('**/api/stock-strategy/**', async route => {
      const request = route.request(); const url = new URL(request.url());
      if (url.pathname.endsWith('/state')) return route.fulfill({ json: state });
      if (request.method() === 'POST' && url.pathname.endsWith('/jobs')) {
        const body = request.postDataJSON(); submitted.push(body);
        latest = { id: `aaaaaaaa-aaaa-aaaa-aaaa-${String(submitted.length).padStart(12, '0')}`, symbol: body.symbol, mode: body.mode,
          question: body.question, strategies: body.strategies, sessionId: body.sessionId || 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001',
          status: 'running', progress: 30, message: '正在收集行情', createdAt: '2026-10-18T12:00:00Z', updatedAt: '2026-10-18T12:00:00Z', model: 'test-model' };
        state.jobs.unshift(latest); return route.fulfill({ status: 202, json: latest });
      }
      const id = url.pathname.split('/').pop();
      return route.fulfill({ json: state.jobs.find(job => job.id === id) || {} });
    });
    await page.goto('http://127.0.0.1:5187/market');
    await expect(page.getByRole('heading', { name: '市场情报', exact: true })).toBeVisible();
    await page.getByRole('navigation', { name: '股票市场子页面' }).getByRole('link', { name: '策略研究' }).click();
    await expect(page.getByRole('heading', { name: '策略研究', exact: true })).toBeVisible();
    await expect(page.getByText('把直觉，变成有依据的判断。')).toBeVisible();
    expect(submitted).toHaveLength(0);
    await page.screenshot({ path: `test-results/stock-strategy-empty-${viewport.width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'AAPL', exact: true }).click();
    await page.locator('.strategy-picker summary').click();
    await page.getByRole('checkbox', { name: /多头趋势/ }).check();
    await page.locator('.strategy-picker summary').click();
    await page.getByRole('button', { name: '开始研究', exact: true }).click();
    await expect(page.getByRole('heading', { name: '正在研究 AAPL' })).toBeVisible();
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({ symbol: 'AAPL', mode: 'report', strategies: ['bull_trend'] });
    expect(JSON.stringify(submitted)).not.toContain('apiKey');
    Object.assign(latest!, { status: 'completed', progress: 100, result: report, updatedAt: '2026-10-18T12:01:00Z' });
    // Completion must appear automatically, without a manual refresh or navigation.
    await expect(page.getByRole('heading', { name: '测试公司' })).toBeVisible();
    await expect(page.getByText('避免过度集中。')).toBeVisible();
    await expect(page.locator('.strategy-quote .is-down')).toContainText('-1.20%');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/stock-strategy-report-${viewport.width}.png`, fullPage: true });
    await page.reload();
    await expect(page.getByRole('heading', { name: '测试公司' })).toBeVisible();
    expect(submitted).toHaveLength(1);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 Markdown' }).click();
    expect((await download).suggestedFilename()).toMatch(/AAPL.*\.md/);
    await page.getByRole('button', { name: '继续追问' }).click();
    await page.getByRole('textbox', { name: '研究问题' }).fill('有哪些风险需要优先验证？');
    await page.getByRole('button', { name: '开始问答', exact: true }).click();
    await expect.poll(() => submitted.length).toBe(2);
    expect(submitted[1]).toMatchObject({ mode: 'chat', sessionId: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001', symbol: 'AAPL' });
    Object.assign(latest!, { status: 'completed', result: { content: '优先验证成交量和基本面。' }, updatedAt: '2026-10-18T12:02:00Z' });
    await page.getByRole('button', { name: '刷新研究记录' }).click();
    await expect(page.getByText('优先验证成交量和基本面。')).toBeVisible();
    await page.getByRole('navigation', { name: '股票市场子页面' }).getByRole('link', { name: '市场情报' }).click();
    await expect(page.getByRole('heading', { name: '市场情报', exact: true })).toBeVisible();
  });
}

test('missing configuration, failed requests, and cancellation have explicit states', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: {} }));
  const state: StrategyState = { ready: true, configured: false, model: '', provider: 'custom', strategies: [], jobs: [] };
  let fail = false;
  await page.route('**/api/stock-strategy/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/state')) return route.fulfill({ json: state });
    if (path.endsWith('/cancel')) { state.jobs[0].status = 'cancelled'; state.jobs[0].message = '已停止研究'; return route.fulfill({ json: state.jobs[0] }); }
    if (route.request().method() === 'POST') return route.fulfill({ status: 400, json: { detail: '测试服务暂不可用' } });
    return route.fulfill(fail ? { status: 404, json: { detail: '研究记录不存在' } } : { json: state.jobs[0] });
  });
  await page.goto('http://127.0.0.1:5187/market/research');
  await page.getByRole('button', { name: 'AAPL', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始研究', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /先配置模型/ })).toBeVisible();
  Object.assign(state, { configured: true, model: 'test-model' });
  await page.getByRole('button', { name: '刷新研究记录' }).click();
  await page.getByRole('button', { name: '开始研究', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('测试服务暂不可用');
  const job: StrategyJob = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-000000000005', symbol: 'AAPL', mode: 'report', question: '', strategies: [], sessionId: 'session', status: 'running', progress: 15, message: '正在采集', createdAt: '2026-10-18T12:00:00Z', updatedAt: '2026-10-18T12:00:00Z', model: 'test-model' };
  state.jobs.push(job);
  await page.goto(`http://127.0.0.1:5187/market/research?job=${job.id}`);
  await page.getByRole('button', { name: '停止研究', exact: true }).click();
  await expect(page.getByRole('heading', { name: '已停止', exact: true })).toBeVisible();
  fail = true;
  await page.goto('http://127.0.0.1:5187/market/research?job=missing');
  await expect(page.getByRole('alert')).toContainText('研究记录不存在');
});

test('saved agent dashboard evidence renders and exports without rerunning analysis', async ({ page }) => {
  const job: StrategyJob = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-000000000001', symbol: '000001', mode: 'report', question: '', strategies: ['bull_trend'], sessionId: 'stored', status: 'completed', progress: 100, message: '已完成', createdAt: '2026-10-18T12:00:00Z', updatedAt: '2026-10-18T12:00:00Z', model: 'test-model',
    result: { stock_name: '历史报告测试', report: { summary: { analysis_summary: '已有分析结论。' }, details: {
      technical_analysis: '', fundamental_analysis: '', risk_warning: '', empty_news_disclosure: '当时未取得新闻资料。',
      raw_result: { dashboard: { data_perspective: { trend_status: { ma_alignment: 'MA20 附近等待确认' } },
        intelligence: { earnings_outlook: '已有财报观察', risk_alerts: ['成交量不足，需要关注'] }, battle_plan: { position_strategy: { risk_control: '已有仓位控制条件' } } } },
    } } } };
  let posts = 0;
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: {} }));
  await page.route('**/api/stock-strategy/**', route => {
    if (route.request().method() === 'POST') posts++;
    return route.fulfill({ json: route.request().url().endsWith('/state') ? { ready: true, configured: true, model: 'test-model', provider: 'custom', strategies: [], jobs: [job] } : job });
  });
  await page.goto(`http://127.0.0.1:5187/market/research?job=${job.id}`);
  for (const text of ['MA20 附近等待确认', '已有财报观察', '成交量不足，需要关注', '已有仓位控制条件', '当时未取得新闻资料。']) await expect(page.getByText(text, { exact: false })).toBeVisible();
  await expect(page.getByText('本次未取得足够资料，暂不形成判断。')).toHaveCount(0);
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Markdown' }).click();
  const download = await waiting;
  const content = await readFile((await download.path())!, 'utf8');
  expect(content).toContain('已有财报观察'); expect(content).toContain('已有仓位控制条件');
  expect(posts).toBe(0);
});
