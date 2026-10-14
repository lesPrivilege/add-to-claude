import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: 'chrome.spec.js',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 7000 },
  reporter: [['list']],
});
