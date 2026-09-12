import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

// Run against a production build without starting account/news backend services.
const root = path.resolve('dist');
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = pathname === '/' || pathname === '/hyperspeed'
    ? path.join(root, 'index.html') : path.resolve(root, `.${pathname}`);
  if (!file.startsWith(`${root}${path.sep}`)) return res.writeHead(403).end();
  try {
    const data = await fs.readFile(file);
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  if (process.env.CPU_RATE) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU_RATE) });
  }
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    let phase = 'transit';
    window.__handoffDraws = 0;
    new MutationObserver(records => {
      for (const record of records) {
        if (record.target.classList?.contains('cyber-corridor')) phase = record.target.dataset.phase;
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-phase'] });
    for (const type of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!type) continue;
      for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
        const original = type.prototype[name];
        if (!original) continue;
        type.prototype[name] = function (...args) {
          if (phase !== 'transit') window.__handoffDraws++;
          return original.apply(this, args);
        };
      }
    }
  });
  const url = `http://127.0.0.1:${server.address().port}/hyperspeed`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('.cyber-corridor[data-phase="transit"]').waitFor();
  assert.equal(await page.locator('.cyber-portal-card').count(), 15, 'Cards must be prepared before the reveal');
  assert.equal(await page.locator('.cyber-corridor__directory').evaluate(el => el.inert), true);
  const canvasBounds = await page.locator('.hyperspeed canvas').boundingBox();
  assert.ok(canvasBounds && canvasBounds.height <= 1000, 'Tunnel canvas must stay viewport-sized, not grow with the prepared directory');
  await page.locator('.cyber-portal-card').first().evaluate(el => el.focus());
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('cyber-portal-card')), false, 'Hidden links must not receive focus');

  const timings = await page.evaluate(() => new Promise(resolve => {
    const corridor = document.querySelector('.cyber-corridor');
    const firstCard = corridor.querySelector('.cyber-portal-card');
    let revealAt = 0;
    let preparingSeen = false;
    let preparingAt = 0;
    let pausedBeforeReveal = false;
    let previous = performance.now();
    const gaps = [];
    const sample = now => {
      if (corridor.dataset.phase === 'preparing') {
        preparingSeen = true;
        preparingAt ||= now;
        pausedBeforeReveal = corridor.querySelector('.hyperspeed')?.dataset.renderState === 'paused';
      }
      if (!revealAt && corridor.dataset.phase === 'directory') revealAt = now;
      if (revealAt) gaps.push(now - previous);
      previous = now;
      if (revealAt && now - revealAt >= 1800) {
        const sorted = [...gaps].sort((a, b) => a - b);
        resolve({ sameCard: firstCard === corridor.querySelector('.cyber-portal-card'), preparingSeen, pausedBeforeReveal, warmupMs: Math.round(revealAt - preparingAt), maxFrameGapMs: Math.round(Math.max(...gaps)), p95FrameGapMs: Math.round(sorted[Math.floor(sorted.length * 0.95)]), frames: gaps.length, webglDrawsDuringHandoff: window.__handoffDraws });
      } else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
  assert.equal(timings.sameCard, true, 'Reveal must reuse prepared cards');
  assert.equal(timings.preparingSeen && timings.pausedBeforeReveal, true, 'WebGL must pause before card warmup');
  assert.equal(timings.webglDrawsDuringHandoff, 0, 'No continuous WebGL rendering during card entrance');
  await page.locator('.cyber-corridor__tunnel').waitFor({ state: 'detached', timeout: 3000 });
  assert.equal(await page.locator('.cyber-corridor__directory').evaluate(el => el.inert), false);
  const cards = await page.locator('.cyber-corridor__card-entry').evaluateAll(elements => elements.map(el => ({ opacity: getComputedStyle(el).opacity, transform: getComputedStyle(el).transform })));
  assert.ok(cards.every(card => card.opacity === '1' && card.transform === 'none'));
  assert.equal(await page.locator('.cyber-corridor__card-entry').first().evaluate(el => getComputedStyle(el).willChange), 'auto');
  assert.equal(await page.locator('.cyber-portal-card').first().evaluate(el => getComputedStyle(el).transform), 'none');
  const cardBounds = await page.locator('.cyber-portal-card').first().boundingBox();
  await page.mouse.move(cardBounds.x + 30, cardBounds.y + 30);
  await page.waitForFunction(() => document.querySelector('.cyber-portal-card').style.getPropertyValue('--rotate-x') !== '');
  assert.notEqual(await page.locator('.cyber-portal-card').first().evaluate(el => getComputedStyle(el).transform), 'none');
  await page.mouse.move(0, 0);
  const filters = await page.locator('.cyber-corridor__directory').evaluate(el => {
    const values = [];
    for (let node = el; node; node = node.parentElement) values.push(getComputedStyle(node).filter);
    return values;
  });
  assert.ok(filters.every(filter => filter === 'none'), 'Directory ancestors must not allocate full-page blur surfaces');
  await fs.mkdir('output', { recursive: true });
  await page.screenshot({ path: 'output/hyperspeed-transition-desktop.png' });

  // Re-entry and reduced-motion should each have a clean lifecycle.
  await page.locator('a.sf-pill[href="/market"]').click();
  await page.locator('.cyber-corridor').waitFor({ state: 'detached' });
  await page.locator('a.sf-pill[href="/hyperspeed"]').click();
  await page.locator('.cyber-corridor[data-phase="transit"]').waitFor();
  await page.locator('.hyperspeed canvas').waitFor();
  assert.equal(await page.locator('.hyperspeed canvas').count(), 1);
  await page.goto('about:blank');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('.cyber-corridor[data-phase="directory"]').waitFor();
  assert.equal(await page.locator('.hyperspeed canvas').count(), 0);
  assert.equal(await page.locator('.cyber-portal-card').count(), 15);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'output/hyperspeed-transition-mobile.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: prepared cards, inert intro, single fade cleanup, no page blur, re-entry, reduced motion, mobile, no runtime errors.');
  console.log('Headless frame timing (diagnostic only, not a hardware FPS guarantee):', timings);
} finally {
  if (browser) await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
