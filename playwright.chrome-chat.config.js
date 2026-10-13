import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: 'chrome-chat.spec.js',
  workers: 1,
  timeout: 30000,
  expect: { timeout: 7000 },
  reporter: [['list']],
});
