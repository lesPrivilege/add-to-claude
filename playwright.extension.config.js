import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: 'browser-extension.spec.js',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 7000 },
  reporter: [['list']],
  webServer: {
    command: 'node src/server.js',
    env: { PORT: '43119' },
    url: 'http://127.0.0.1:43119/health',
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
