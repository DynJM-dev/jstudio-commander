import { test, expect } from '@playwright/test';
import { COMMANDER_API, serverUp, dismissPinIfPresent } from './helpers';

// Phase P.4 Patch 1 — repaired: the old file held five tests, four of
// which were REST probes that pointlessly walked through a browser to
// reach endpoints that now have real Fastify integration coverage
// (server/src/__tests__/integration/*). What remains is the one thing a
// Playwright test uniquely gives us — a real Chromium rendering the
// React app + hitting the live server. The stub became a smoke.
//
// Invariant asserted: the Sessions page renders to a stable state. That
// means:
//   1. The /api/sessions list request completes (200).
//   2. Either the empty-state card ("No active sessions") OR the session
//      grid (a `.glass-card`-bearing SessionCard) renders — whichever
//      matches the current DB.
// The old test only asserted heading + button visibility, which passes
// even on a broken data layer (those two nodes render before the first
// fetch settles). Waiting for the sessions API round-trip + asserting
// the resulting DOM closes that gap.

test.beforeEach(async ({ page }) => {
  if (!(await serverUp())) test.skip(true, 'Commander API unavailable');
  await page.goto('/sessions');
  await dismissPinIfPresent(page);
});

test('sessions page renders sessions grid or empty state', async ({ page, request }) => {
  // Heading + CTA are the static chrome — they render before fetch.
  await expect(page.getByRole('heading', { name: /sessions/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /new session/i })).toBeVisible();

  // Probe the live sessions list ourselves — useSessions has already
  // fired its mount fetch by the time we're here, and page.waitForResponse
  // can't rewind. Hitting /api/sessions directly gives us the same truth
  // and is stable against the mount-timing race.
  const resp = await request.get(`${COMMANDER_API}/api/sessions`);
  expect(resp.ok()).toBeTruthy();
  const body = (await resp.json()) as Array<{ id: string; status: string }>;
  expect(Array.isArray(body)).toBe(true);

  // After the page settles, it commits to one of two DOM states — empty
  // state card OR a session grid. We assert we're not stuck on the
  // loading skeleton (which never renders either of these).
  const nonStopped = body.filter((s) => s.status !== 'stopped');
  if (nonStopped.length === 0) {
    await expect(page.getByText(/no active sessions/i)).toBeVisible({ timeout: 5000 });
  } else {
    const grid = page.locator('.grid').first();
    await expect(grid).toBeVisible({ timeout: 5000 });
  }
});

// Preferences round-trip kept as a single cross-boundary check — proves
// the PUT/GET pair stays consistent through serialization. This one
// doesn't need a browser but it's cheap and catches regressions in the
// Preferences table / route wiring that unit tests don't.
test('preferences PUT then GET round-trips', async ({ request }) => {
  const key = `e2e-probe-${Date.now()}`;
  const payload = { marker: 'playwright', n: 42 };
  const put = await request.put(`${COMMANDER_API}/api/preferences/${encodeURIComponent(key)}`, {
    data: { value: payload },
  });
  expect(put.ok()).toBeTruthy();
  const get = await request.get(`${COMMANDER_API}/api/preferences/${encodeURIComponent(key)}`);
  expect(get.ok()).toBeTruthy();
  const body = await get.json();
  expect(body.value).toEqual(payload);
});
