import { defineConfig, devices } from '@playwright/test';

// Playwright foundation — 5 core flow tests only. Scope on purpose stays
// thin because the UI moves fast and brittle assertions (exact pixel
// counts, specific selectors) would rot faster than they protect. Each
// test uses a "soft-fail" pattern via test.skip when a precondition
// isn't available (no active session, server unreachable).
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,  // serial so we don't race on the single shared DB
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.COMMANDER_URL ?? 'http://localhost:11573',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
