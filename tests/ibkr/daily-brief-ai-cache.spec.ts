import { expect, test, type BrowserContext } from '@playwright/test';
import { createDailyBriefAiSummaryCache } from '../../server/dailyBriefAiSummaryCache';
import type { DailyBriefSnapshot, DailyBriefSummary } from '../../src/lib/dailyBriefTypes';

// Cache tests should not wait for external font servers.
test.beforeEach(async ({ context }) => {
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
});

const summary = (headline: string): DailyBriefSummary => ({ headline, regime: '测试', tone: 'balanced', highlights: [], risks: [], watchlist: [], portfolioNotes: [],
  assessment: { rating: '中性', score: 50, confidence: '中', rationale: '缓存测试', disclaimer: '测试说明',
    advice: Array.from({ length: 5 }, (_, index) => ({ label: `建议 ${index}`, detail: '缓存验证内容' })) } });
const snapshot = (): DailyBriefSnapshot => {
  const now = new Date();
  const date = new Date(now.getTime() - 3600_000).toISOString().slice(0, 10);
  return { version: 18, date, slot: 'morning',
    generatedAt: `${date}T01:00:00Z`, updatedAt: now.toISOString(), summaryMode: 'rules', summary: summary('简报基础内容'),
    markets: [], macro: [], news: [], portfolio: { connected: false, positions: [] }, sources: [], errors: [] };
};

test('two new visitors share one AI generation; refresh and model changes invalidate it', async ({ browser }) => {
  let current = snapshot();
  let modelCalls = 0;
  let aiRequests = 0;
  let model = 'model-one';
  let disk: string | null = null;
  const service = createDailyBriefAiSummaryCache({ promptVersion: 'test-v1',
    store: { read: async () => disk, write: async (_, value) => { disk = value; } },
    generate: async () => { const count = ++modelCalls; await new Promise(resolve => setTimeout(resolve, 50)); return summary(`共享摘要第${count}版`); },
  });
  const contexts: BrowserContext[] = [];
  try {
    const first = await browser.newContext(); contexts.push(first);
    const second = await browser.newContext(); contexts.push(second);
    await first.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
      key: `sparkflow.daily-brief.ai-summary.v4:${current.date}:${current.slot}:${current.generatedAt}`, value: summary('不应显示的旧浏览器摘要'),
    });
    for (const context of contexts) {
      await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
      await context.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'not_in_fixture' } }));
      await context.route('**/api/daily-brief', route => route.fulfill({ json: { snapshot: current, cache: { hit: true, generated: false } } }));
      await context.route('**/api/daily-brief/refresh', route => {
        current = snapshot();
        return route.fulfill({ json: { snapshot: current, cache: { hit: false, generated: true } } });
      });
      await context.route('**/api/daily-brief/ai-summary', async route => {
        aiRequests++;
        const expected = route.request().postDataJSON().snapshot;
        expect(expected).toEqual({ date: current.date, slot: current.slot, generatedAt: current.generatedAt });
        const payload = await service.get(current, { provider: 'test', model, apiKey: 'fixture-key', baseUrl: 'https://example.com', protocol: 'chat', useProxy: false });
        await route.fulfill({ json: payload });
      });
    }
    const a = await first.newPage(), b = await second.newPage();
    await Promise.all([a.goto('http://127.0.0.1:5187/council'), b.goto('http://127.0.0.1:5187/council')]);
    await expect(a.getByText('共享摘要第1版').first()).toBeVisible();
    await expect(b.getByText('共享摘要第1版').first()).toBeVisible();
    await expect(a.getByText('不应显示的旧浏览器摘要')).toHaveCount(0);
    expect(aiRequests).toBeGreaterThanOrEqual(2);
    expect(modelCalls).toBe(1);
    await a.getByRole('button', { name: /刷新全部数据/ }).click();
    await expect(a.getByText('共享摘要第2版').first()).toBeVisible();
    expect(modelCalls).toBe(2);
    await b.reload();
    await expect(b.getByText('共享摘要第2版').first()).toBeVisible();
    expect(modelCalls).toBe(2);
    model = 'model-two';
    await a.locator('a[href="/signals"]').first().click();
    await a.locator('a[href="/council"]').first().click();
    await expect(a.getByText('共享摘要第3版').first()).toBeVisible();
    expect(modelCalls).toBe(3);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('a mismatched or failed AI response keeps the briefing fallback visible', async ({ page }) => {
  const current = snapshot();
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: {} }));
  await page.route('**/api/daily-brief', route => route.fulfill({ json: { snapshot: current, cache: { hit: true, generated: false } } }));
  await page.route('**/api/daily-brief/ai-summary', route => route.fulfill({ json: {
    summary: summary('错版摘要不可显示'), snapshot: { date: '2020-01-01', slot: current.slot, generatedAt: current.generatedAt },
    cache: { expiresAt: new Date(Date.now() + 60_000).toISOString() },
  } }));
  await page.goto('http://127.0.0.1:5187/council');
  await expect(page.getByText('简报基础内容').first()).toBeVisible();
  await expect(page.getByText('错版摘要不可显示')).toHaveCount(0);
  await page.route('**/api/daily-brief/ai-summary', route => route.fulfill({ status: 503, json: { detail: '模型暂不可用' } }));
  await page.reload();
  await expect(page.getByText('简报基础内容').first()).toBeVisible();
});
