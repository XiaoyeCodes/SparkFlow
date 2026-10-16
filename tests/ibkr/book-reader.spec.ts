import { expect, test } from '@playwright/test';
import { jsPDF } from 'jspdf';
import { financialFreedomBooks } from '../../src/data/financialFreedomBooks';

const sample = new jsPDF();
for (let page = 1; page <= 3; page++) {
  if (page > 1) sample.addPage();
  sample.text(`SparkFlow reader test - page ${page}`, 20, 30);
  sample.setFillColor(30 * page, 90, 160);
  sample.rect(20, 50, 100, 80, 'F');
}
const pdf = Buffer.from(sample.output('arraybuffer'));
const localPdfPattern = /\/api\/books\/financial-freedom\?file=/;

test.beforeEach(async ({ page }) => {
  // Opening or switching books must work even when the browser cannot reach GitHub.
  await page.route('https://raw.githubusercontent.com/**', route => route.abort());
});

test('all 17 source PDFs have unique, encoded reading links', () => {
  expect(financialFreedomBooks).toHaveLength(15);
  const documents = financialFreedomBooks.flatMap(book => book.documents!);
  expect(documents).toHaveLength(17);
  expect(new Set(documents.map(file => file.url)).size).toBe(17);
  for (const file of documents) {
    const url = new URL(file.url);
    expect(decodeURIComponent(url.pathname.split('/').at(-1)!)).toBe(file.fileName);
    expect(file.fileName).toMatch(/\.pdf$/);
    expect(file.sourceUrl).toContain('/blob/322f1bc132e879e8ddbf4485d6a931735622f086/');
    expect(new URL(file.readerUrl, 'http://books.local').searchParams.get('file')).toBe(file.fileName);
  }
});

for (const size of [{ width: 1440, height: 1000 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
  test(`read, navigate and zoom without downloading other books (${size.width}px)`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.route('**/api/**', route => route.fulfill({ status: 503, json: {} }));
    let requests = 0;
    let externalRequests = 0;
    page.on('request', request => { if (request.url().includes('raw.githubusercontent.com')) externalRequests++; });
    await page.route(localPdfPattern, route => { requests++; return route.fulfill({ body: pdf, contentType: 'application/pdf' }); });
    await page.goto('http://127.0.0.1:5187/stack');
    await expect(page.getByRole('heading', { name: '投资与财富管理', exact: true, level: 2 })).toBeVisible();
    expect(requests).toBe(0);
    const card = page.getByRole('button', { name: /富爸爸，穷爸爸/ });
    await card.click();
    const dialog = page.getByRole('dialog', { name: '富爸爸，穷爸爸' });
    const canvas = dialog.getByRole('img', { name: '富爸爸，穷爸爸 第 1 页' });
    await expect(canvas).toBeVisible();
    await expect(dialog.getByLabel('总页数')).toHaveText('/ 3');
    await expect(dialog.getByRole('button', { name: '上一页' })).toBeDisabled();
    await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => {
      const data = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data;
      return data.some((value, index) => index % 4 === 0 && value < 200);
    })).toBe(true);
    const beforeWidth = await canvas.evaluate(element => element.getBoundingClientRect().width);
    await dialog.getByRole('button', { name: '放大', exact: true }).click();
    await expect.poll(() => canvas.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(beforeWidth);
    await dialog.getByRole('button', { name: '下一页' }).click();
    await expect(dialog.getByRole('img', { name: '富爸爸，穷爸爸 第 2 页' })).toBeVisible();
    await dialog.getByRole('spinbutton', { name: '页码' }).fill('3');
    await dialog.getByRole('spinbutton', { name: '页码' }).press('Enter');
    await expect(dialog.getByRole('img', { name: '富爸爸，穷爸爸 第 3 页' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '下一页' })).toBeDisabled();
    await dialog.getByRole('spinbutton', { name: '页码' }).fill('999');
    await dialog.getByRole('spinbutton', { name: '页码' }).press('Enter');
    await expect(dialog.getByRole('spinbutton', { name: '页码' })).toHaveValue('3');
    expect(requests).toBe(1);
    expect(externalRequests).toBe(0);
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.width).toBeLessThanOrEqual(size.width);
    await page.screenshot({ path: `test-results/book-reader-${size.width}.png` });
    await dialog.getByRole('button', { name: '关闭阅读器' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(card).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    // Existing recommendations retain their detail-only interaction.
    await page.getByRole('button', { name: /经济学原理：微观经济学分册/ }).click();
    await expect(page.getByRole('heading', { name: '内容介绍' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: '内容介绍' })).toHaveCount(0);
  });
}

test('existing titles are deduplicated and both source editions open', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: {} }));
  const filenames: string[] = [];
  await page.route(localPdfPattern, route => { filenames.push(new URL(route.request().url()).searchParams.get('file')!); return route.fulfill({ body: pdf, contentType: 'application/pdf' }); });
  await page.goto('http://127.0.0.1:5187/stack');
  await expect(page.getByRole('heading', { name: '纳瓦尔宝典', exact: true, level: 3 })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: '穷查理宝典', exact: true, level: 3 })).toHaveCount(1);
  const firstShelf = page.locator('#category-investment-wealth');
  await expect(firstShelf.locator('h3')).toHaveText(financialFreedomBooks.map(book => book.title));
  await page.getByRole('button', { name: /纳瓦尔宝典/ }).click();
  const dialog = page.getByRole('dialog', { name: '纳瓦尔宝典' });
  await expect(dialog.getByRole('img', { name: '纳瓦尔宝典 第 1 页' })).toBeVisible();
  await dialog.getByRole('button', { name: '下一页' }).click();
  await dialog.getByRole('combobox', { name: '书籍版本' }).selectOption('1');
  await expect(dialog.getByRole('img', { name: '纳瓦尔宝典 第 1 页' })).toBeVisible();
  expect(filenames).toEqual(['《纳瓦尔宝典》.pdf', '《纳瓦尔宝典财富和幸福指南》.pdf']);
  await dialog.getByRole('button', { name: '查看书籍介绍' }).click();
  await expect(page.getByRole('heading', { name: '内容介绍' })).toBeVisible();
  await page.getByRole('button', { name: '在线阅读原书' }).click();
  await expect(page.getByRole('dialog', { name: '纳瓦尔宝典' }).getByRole('img', { name: '纳瓦尔宝典 第 1 页' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('failed source has a useful retry and working external file links', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: {} }));
  let attempts = 0;
  await page.route(localPdfPattern, route => ++attempts === 1 ? route.fulfill({ status: 404 }) : route.fulfill({ body: pdf, contentType: 'application/pdf' }));
  await page.goto('http://127.0.0.1:5187/stack');
  await page.getByRole('button', { name: /富爸爸，穷爸爸/ }).click();
  const dialog = page.getByRole('dialog', { name: '富爸爸，穷爸爸' });
  await expect(dialog.getByRole('alert')).toContainText('本地书籍暂时无法读取');
  await expect(dialog.getByRole('link', { name: '打开原始 PDF' })).toHaveAttribute('href', financialFreedomBooks[0].documents![0].readerUrl);
  await expect(dialog.getByRole('link', { name: '打开本地 PDF' })).toHaveAttribute('href', financialFreedomBooks[0].documents![0].readerUrl);
  await dialog.getByRole('button', { name: '重新加载' }).click();
  await expect(dialog.getByRole('img', { name: '富爸爸，穷爸爸 第 1 页' })).toBeVisible();
  expect(attempts).toBe(2);
});
