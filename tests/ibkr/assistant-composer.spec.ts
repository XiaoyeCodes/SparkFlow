import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('assistant prompt grows upward with long text and collapses after clearing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  const sessions = Array.from({ length: 18 }, (_, index) => ({
    session_id: `session-${index}`,
    title: `历史市场研究 ${index + 1}`,
    status: 'active',
    created_at: `2026-09-${String(10 - Math.min(index, 9)).padStart(2, '0')}T08:00:00Z`,
    updated_at: `2026-09-${String(10 - Math.min(index, 9)).padStart(2, '0')}T09:00:00Z`,
    last_attempt_status: 'completed',
  }));
  await page.route('**/api/vibe/research/sessions', route => route.fulfill({ json: sessions }));
  await page.goto('http://127.0.0.1:5187/assistant');

  const input = page.getByRole('textbox', { name: '深度研究问题' });
  const composer = input.locator('xpath=..');
  const history = page.locator('.assistant-history-scroll');
  await expect(history.getByText('历史市场研究 1', { exact: true })).toBeVisible();
  const historyScroll = await history.evaluate(element => ({
    scrollable: element.scrollHeight > element.clientHeight,
    width: getComputedStyle(element).scrollbarWidth,
    color: getComputedStyle(element).scrollbarColor,
    thumb: getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundImage,
    button: getComputedStyle(element, '::-webkit-scrollbar-button').display,
  }));
  expect(historyScroll).toMatchObject({ scrollable: true, width: 'thin' });
  expect(historyScroll.color).not.toBe('auto');
  expect(historyScroll.thumb).toContain('linear-gradient');
  expect(historyScroll.button).toBe('none');
  await input.evaluate(element => element.scrollIntoView({ block: 'end' }));
  await input.fill('分析今天的市场。');
  const compactInput = await input.boundingBox();
  const compactComposer = await composer.boundingBox();

  const longPrompt = Array.from({ length: 18 }, (_, index) => `${index + 1}. 请结合指数点位、成交额、板块轮动和持仓数据给出明确判断。`).join('\n');
  await input.fill(longPrompt);
  await expect.poll(async () => (await input.boundingBox())?.height ?? 0).toBeGreaterThan(250);
  const expandedInput = await input.boundingBox();
  const expandedComposer = await composer.boundingBox();
  const promptScroll = await input.evaluate(element => ({
    direction: getComputedStyle(element).direction,
    clientLeft: element.clientLeft,
    value: (element as HTMLTextAreaElement).value,
    thumb: getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundImage,
  }));

  expect(expandedInput!.height).toBeGreaterThan(compactInput!.height + 180);
  expect(expandedInput!.height).toBeLessThanOrEqual(Math.floor(800 * 0.38) + 1);
  expect(Math.abs((expandedComposer!.y + expandedComposer!.height) - (compactComposer!.y + compactComposer!.height))).toBeLessThanOrEqual(2);
  expect(expandedComposer!.y).toBeLessThan(compactComposer!.y);
  expect(promptScroll).toMatchObject({ direction: 'rtl', value: longPrompt });
  expect(promptScroll.clientLeft).toBeGreaterThan(0);
  expect(promptScroll.thumb).toContain('linear-gradient');
  await expect(input).toHaveCSS('overflow-y', 'auto');

  await mkdir('tmp/workbench-qa', { recursive: true });
  await page.screenshot({ path: 'tmp/workbench-qa/assistant-growing-input.png', fullPage: false });

  await input.fill('');
  await expect.poll(async () => (await input.boundingBox())?.height ?? 0).toBeLessThanOrEqual(44);
});
