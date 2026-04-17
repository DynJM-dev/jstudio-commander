import { defineConfig, devices } from '@playwright/test';

// Commander E2E configuration.
//
// SETUP CONTRACT: the suite assumes `pnpm dev` is already running on
// the host (server + Vite). There is no `webServer` block because
// auto-spawning conflicts with Jose's ambient dev setup — the server
// port and Vite port are both managed outside the test harness. See
// client/e2e/README.md for full setup + env var documentation.
//
// CI note: when we eventually wire GitHub Actions, the CI job will
// need its own webServer block pointing at the concrete ports the
// image uses. That's a separate phase.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // Serial — every spec shares the live DB + tmux server. Running
  // parallel would race on the sessions table and on tmux pane
  // creation. `workers: 1` is redundant with fullyParallel:false but
  // pins the intent explicitly for readers.
  fullyParallel: false,
  workers: 1,
  // Retry once in CI to absorb a flaky tmux spawn without flipping
  // a whole run red. Locally: no retries — if a test fails, the
  // author sees it immediately.
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    // COMMANDER_URL overrides the Vite URL; COMMANDER_API overrides
    // the Fastify URL used by the request fixture in helpers.ts.
    // Separate vars because the two can diverge when ~/.jstudio-commander/config.json
    // sets a non-default server port (e.g. 3002) while Vite stays on
    // its default 11573.
    baseURL: process.env.COMMANDER_URL ?? 'http://localhost:11573',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
