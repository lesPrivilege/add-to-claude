import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 7000 },
  reporter: [['list']],
  use: {
    headless: true,
    launchOptions: { executablePath: process.env.CHROMIUM_PATH },
  },
});
