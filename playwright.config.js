import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 7000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:43120',
    viewport: { width: 1100, height: 900 },
    headless: true,
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox'],
    },
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node src/server.js',
    env: { PORT: '43120' },
    url: 'http://127.0.0.1:43120/health',
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
