import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const report = '# 市场研究报告\n\n' + Array.from({ length: 24 }, (_, i) => `## ${i + 1}. 观察与证据\n\n这是用于验证长报告阅读定位的测试内容。**先看问题，再读结论**，研究记录按需展开。\n\n| 观察项 | 状态 |\n| --- | --- |\n| 来源核实 | 已完成 |`).join('\n\n');
const session = (id: string) => ({ session_id: id, title: `研究记录 ${id}`, status: 'active', created_at: '2026-09-15T01:00:00Z', updated_at: '2026-09-15T02:00:00Z', last_attempt_status: 'completed' });
const history = [
  { message_id: 'q1', role: 'user', content: '上一轮研究问题' },
  { message_id: 'a1', role: 'assistant', content: report },
  { message_id: 'q2', role: 'user', content: '这次请重点分析组合的风险和观察条件。' },
  { message_id: 'a2', role: 'assistant', content: report },
];

async function expectQuestionAtTop(page: Page) {
  await expect.poll(() => page.locator('[data-latest-question]').evaluate(el => {
    const margin = parseFloat(getComputedStyle(el).scrollMarginTop);
    return Math.abs(el.getBoundingClientRect().top - margin);
  })).toBeLessThan(3);
}

for (const width of [1440, 390]) {
  test(`history opens at latest question with compact trace (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.addInitScript(() => {
      localStorage.setItem('sparkflow.vibe.session.v1', 's1');
      for (const sid of ['s1', 's2']) localStorage.setItem(`sparkflow.vibe.progress.v1.${sid}`, JSON.stringify({
        runState: 'completed', liveText: '', notice: '',
        tools: Array.from({ length: 33 }, (_, i) => ({ id: `t${i}`, tool: i % 2 ? 'read_url' : 'get_market_data', status: i < 2 ? 'error' : 'ok', elapsedMs: i * 100 })),
      }));
    });
    await page.route('**/api/vibe/research/sessions', route => route.fulfill({ json: [session('s1'), session('s2')] }));
    await page.route('**/api/vibe/research/messages?*', route => route.fulfill({ json: history }));
    await page.goto('http://127.0.0.1:5187/assistant');
    await expect(page.locator('[data-latest-question]')).toContainText('这次请重点');
    await expectQuestionAtTop(page);
    const toggle = page.locator('.research-trace-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toContainText('33 步');
    await expect(toggle).toContainText('2 项异常');
    await expect(toggle.locator('.lucide-circle-check')).toHaveCount(1);
    await expect(page.getByRole('region', { name: '研究步骤详情' })).toHaveCount(0);
    await mkdir('output', { recursive: true });
    await page.screenshot({ path: `output/assistant-reading-${width}.png` });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    const signal = page.locator('.assistant-signal');
    await expect(signal).toBeVisible();
    expect((await signal.boundingBox())!.height).toBeGreaterThanOrEqual(128);
    await page.screenshot({ path: `output/assistant-background-${width}.png` });

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const details = page.getByRole('region', { name: '研究步骤详情' });
    await expect(details).toBeVisible();
    expect(await details.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    expect((await details.boundingBox())!.height).toBeLessThanOrEqual(320);
    await expect(details.getByText('阅读来源原文').first()).toBeVisible();
    await page.screenshot({ path: `output/assistant-process-${width}.png` });

    if (width === 1440) {
      // Reopening the current session and switching sessions both reset the disclosure.
      await page.locator('.research-history-open').filter({ hasText: '研究记录 s1' }).click();
      await expectQuestionAtTop(page);
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await toggle.click();
      await page.locator('.research-history-open').filter({ hasText: '研究记录 s2' }).click();
      await expectQuestionAtTop(page);
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('completion returns to the submitted question; live tools do not pull the reader', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  await page.addInitScript(() => {
    localStorage.setItem('sparkflow.vibe.session.v1', 's1');
    class MockEventSource extends EventTarget {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        super();
        (window as any).researchEvents = this;
        setTimeout(() => this.onopen?.(), 10);
      }
      close() {}
    }
    window.EventSource = MockEventSource as any;
  });
  await page.route('**/api/vibe/research/sessions', route => route.fulfill({ json: [session('s1')] }));
  await page.route('**/api/vibe/research/messages?*', route => route.fulfill({ json: history.slice(0, 2) }));
  await page.route('**/api/vibe/research/session', route => route.fulfill({ json: { sessionId: 's1' } }));
  await page.route('**/api/vibe/research/message', route => route.fulfill({ json: { attempt_id: 'new-attempt' } }));
  await page.goto('http://127.0.0.1:5187/assistant');
  await expect(page.locator('[data-latest-question]')).toContainText('上一轮');
  await page.getByRole('textbox', { name: '深度研究问题' }).fill('请回答最新的问题');
  await page.getByRole('button', { name: '开始研究', exact: true }).click();
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).researchEvents)).toBe(true);
  await page.evaluate(() => (window as any).researchEvents.dispatchEvent(new MessageEvent('tool_call', { data: JSON.stringify({ tool: 'web_search' }) })));
  await expect(page.locator('.research-trace-toggle')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('.research-trace-toggle').click();
  // Deliberately read an earlier section while the model is still working.
  await page.evaluate(() => window.scrollTo({ top: 900, behavior: 'instant' }));
  const readingPosition = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => (window as any).researchEvents.dispatchEvent(new MessageEvent('tool_heartbeat', { data: JSON.stringify({ tool: 'web_search', elapsed_s: 8 }) })));
  await expect(page.locator('.research-trace-time')).toHaveText('8s');
  expect(await page.evaluate(() => window.scrollY)).toBe(readingPosition);
  await page.evaluate(summary => (window as any).researchEvents.dispatchEvent(new MessageEvent('attempt.completed', { data: JSON.stringify({ attempt_id: 'new-attempt', summary }) })), report);
  await expect(page.locator('.research-trace-toggle')).toContainText('研究过程完成');
  await expect(page.locator('.research-trace-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('[data-latest-question]')).toContainText('请回答最新的问题');
  await expectQuestionAtTop(page);
});
