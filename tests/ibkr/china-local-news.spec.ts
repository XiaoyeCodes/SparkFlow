import { expect, test } from '@playwright/test';

const rankedNews = [
  { id: 'decision', title: '省委召开会议审议政府工作报告', source: '河南省人民政府门户', url: 'https://www.henan.gov.cn/1', importanceScore: 3402, highlights: ['政府工作报告', '省委'] },
  { id: 'safety', title: '启动防汛应急响应并部署安全生产工作', source: '河南省人民政府门户', url: 'https://www.henan.gov.cn/2', importanceScore: 3004, highlights: ['应急响应', '安全生产', '防汛', '部署'] },
  { id: 'major', title: '重大产业项目集中签约开工', source: '河南省人民政府门户', url: 'https://www.henan.gov.cn/3', importanceScore: 2405, highlights: ['重大', '产业', '项目', '签约', '开工'] },
  { id: 'policy', title: '新条例实施方案正式印发', source: '河南省人民政府门户', url: 'https://www.henan.gov.cn/4', importanceScore: 1804, highlights: ['条例', '实施', '方案', '印发'] },
  { id: 'economy', title: '全省经济运行与科技创新情况发布', source: '河南省人民政府门户', url: 'https://www.henan.gov.cn/5', importanceScore: 1403, highlights: ['经济运行', '科技', '创新'] },
  { id: 'livelihood', title: '教育医疗养老等民生服务持续改善', source: '河南省人民政府门户', url: 'https://www.henan.gov.cn/6', importanceScore: 1204, highlights: ['教育', '医疗', '养老', '民生'] },
];

test('地方新闻仅展示六条重要新闻、重点词和无滚动条卡片', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.route('**/api/china-macro-dashboard?*', route => route.fulfill({ json: {} }));
  await page.route('**/api/china-region-boundary?*', route => route.fulfill({ json: { type: 'FeatureCollection', features: [] } }));
  await page.route('**/api/china-region-official-feed?*', route => route.fulfill({
    json: {
      province: '河南省',
      generatedAt: new Date().toISOString(),
      policies: [],
      news: rankedNews,
      sourceStatus: 'live',
      errors: [],
    },
  }));

  await page.goto('http://127.0.0.1:5187/market#china-macro');
  await page.locator('.china-province[aria-label="河南省"]').click();

  const newsPanel = page.locator('.china-local-intel-news');
  await expect(newsPanel).toBeVisible();
  await expect(newsPanel.locator('header span')).toHaveText('6/6 · 重要度排序');
  await expect(newsPanel.locator('.china-local-intel-list > a')).toHaveCount(6);
  await expect(newsPanel.locator('.china-local-intel-list > a').first()).toContainText('省委召开会议审议政府工作报告');
  await expect(newsPanel.locator('mark')).toContainText(['省委', '政府工作报告']);

  const visualState = await newsPanel.evaluate((element) => {
    const list = element.querySelector<HTMLElement>('.china-local-intel-list')!;
    const panelStyle = getComputedStyle(element);
    const listStyle = getComputedStyle(list);
    return {
      borderRadius: Number.parseFloat(panelStyle.borderRadius),
      listOverflowY: listStyle.overflowY,
      listFitsWithoutScroll: list.scrollHeight <= list.clientHeight,
    };
  });
  expect(visualState.borderRadius).toBeGreaterThanOrEqual(10);
  expect(visualState.listOverflowY).toBe('visible');
  expect(visualState.listFitsWithoutScroll).toBe(true);
  await expect(page.locator('.china-province-inspector')).toHaveCSS('scrollbar-width', 'none');

  await page.screenshot({ path: 'output/china-local-news-priority.png', fullPage: true });
});

test('全国要闻只显示六条重要性优先的圆角卡片且无滚动条', async ({ page }) => {
  const news = [
    { id: 'policy', title: '国务院部署资本市场重大改革', source: '中国政府网', url: 'https://www.gov.cn/1', publishedAt: '2026-09-12T12:00:00Z', category: '政策', importance: 'critical', importanceScore: 96, highlights: ['资本市场', '国务院', '重大', '改革'] },
    { id: 'safety', title: '启动地震应急响应', source: '新华社', url: 'https://www.news.cn/2', publishedAt: '2026-09-13T09:00:00Z', category: '灾害', importance: 'critical', importanceScore: 91, highlights: ['应急响应', '地震'] },
    { id: 'macro', title: '国家统计局发布8月CPI数据', source: '国家统计局', url: 'https://www.stats.gov.cn/3', publishedAt: '2026-09-13T08:00:00Z', category: '宏观', importance: 'critical', importanceScore: 88, highlights: ['国家统计局', 'CPI'] },
    { id: 'market', title: '人民币汇率与A股市场运行情况', source: '中国经济网', url: 'https://www.ce.cn/4', publishedAt: '2026-09-13T07:00:00Z', category: '股市', importance: 'high', importanceScore: 82, highlights: ['人民币', '汇率', 'A股'] },
    { id: 'livelihood', title: '就业医疗养老民生政策发布', source: '中国政府网', url: 'https://www.gov.cn/5', publishedAt: '2026-09-13T06:00:00Z', category: '民生', importance: 'high', importanceScore: 78, highlights: ['就业', '医疗', '养老', '民生', '政策'] },
    { id: 'economy', title: '消费与进出口重点数据公布', source: '新华社', url: 'https://www.news.cn/6', publishedAt: '2026-09-13T05:00:00Z', category: '经济', importance: 'high', importanceScore: 74, highlights: ['进出口', '消费', '重点'] },
    { id: 'extra-1', title: '普通行业动态一', source: '中国经济网', url: 'https://www.ce.cn/7', publishedAt: '2026-09-13T04:00:00Z', category: '经济', importance: 'medium', importanceScore: 65, highlights: [] },
    { id: 'extra-2', title: '普通行业动态二', source: '中国经济网', url: 'https://www.ce.cn/8', publishedAt: '2026-09-13T03:00:00Z', category: '经济', importance: 'medium', importanceScore: 62, highlights: [] },
  ];
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.route('**/api/china-macro-dashboard?*', route => route.fulfill({
    json: {
      generatedAt: '2026-09-13T12:00:00Z',
      indices: [],
      metrics: [],
      quadrant: { current: '数据不足', growthDirection: 0, inflationDirection: 0, explanation: '测试数据' },
      policy: { stage: '测试', direction: '测试', creditState: '--', nextData: '测试', nextDataUrl: 'https://www.stats.gov.cn/', policies: [] },
      news,
      newsMeta: { onlineSources: 4, totalSources: 7, candidates: 8, duplicatesRemoved: 0 },
      methodology: '测试',
    },
  }));

  await page.goto('http://127.0.0.1:5187/market#china-macro');
  const board = page.locator('.china-news-board');
  const list = board.locator('.china-news-list');
  await expect(board).toBeVisible();
  await expect(board.locator('.china-section-heading b')).toHaveText('6/6 · 重要度排序');
  await expect(list.locator(':scope > a')).toHaveCount(6);
  await expect(list.locator(':scope > a').first()).toContainText('国务院部署资本市场重大改革');
  await expect(list.locator('mark')).toContainText(['国务院', '资本市场']);

  const visualState = await board.evaluate((element) => {
    const listElement = element.querySelector<HTMLElement>('.china-news-list')!;
    return {
      borderRadius: Number.parseFloat(getComputedStyle(element).borderRadius),
      listOverflowY: getComputedStyle(listElement).overflowY,
      listFitsWithoutScroll: listElement.scrollHeight <= listElement.clientHeight,
    };
  });
  expect(visualState.borderRadius).toBeGreaterThanOrEqual(10);
  expect(visualState.listOverflowY).toBe('visible');
  expect(visualState.listFitsWithoutScroll).toBe(true);
  await expect(page.locator('.china-command-right')).toHaveCSS('scrollbar-width', 'none');

  await board.screenshot({ path: 'output/china-macro-top-news.png' });
});
