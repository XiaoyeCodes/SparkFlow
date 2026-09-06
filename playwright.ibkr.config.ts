import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ibkr',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results/ibkr',
  timeout: 30_000,
  workers: 1,
  reporter: [['list']],
  webServer: { command: 'node node_modules/vite/bin/vite.js --config vite.ibkr-test.config.ts', url: 'http://127.0.0.1:5187', reuseExistingServer: false },
  use: { browserName: 'chromium', channel: process.env.IBKR_TEST_BROWSER_CHANNEL || 'chrome', headless: true, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' },
});
