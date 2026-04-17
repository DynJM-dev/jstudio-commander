import { test, expect } from '@playwright/test';
import { COMMANDER_API, serverUp, dismissPinIfPresent } from './helpers';

// Phase P.4 Patch 4 — statusline tick end-to-end. Exercises:
//   POST /api/session-tick {context_window, rate_limits, ...} →
//     sessionTickService.ingest → resolveOwner → session_ticks INSERT
//     → eventBus.emitSessionTick + emitSystemRateLimits →
//     WS fan-out on `session:tick` + `system:rate-limits` →
//     useSessionTick hook + useAggregateRateLimits → HeaderStatsWidget.
//
// Phase M + Phase O validation in one spec. The per-session tick bind
// is deterministic (we read GET /api/sessions/:id/tick and assert our
// exact payload came through). The aggregate REST endpoint and the
// HeaderStatsWidget UI chip are asserted with looser guards because
// Jose's live Commander dev environment has other sessions ticking
// every ~300ms — any of them could overwrite the freshest-wins
// aggregate between our POST and our GET. We assert the pipe is live
// (non-null five_hour_pct, numeric chip text), not that specific
// values stuck.

const CREATED_SESSION_IDS = new Set<string>();

test.beforeEach(async ({ page, request }) => {
  if (!(await serverUp())) test.skip(true, 'Commander API unavailable');
  await page.goto('/sessions');
  await dismissPinIfPresent(page);
  const probe = await request.post(`${COMMANDER_API}/api/session-tick`, { data: {} });
  if (probe.status() === 403) test.skip(true, 'session-tick refusing loopback — cannot test');
});

test.afterEach(async ({ request }) => {
  for (const id of CREATED_SESSION_IDS) {
    try {
      await request.delete(`${COMMANDER_API}/api/sessions/${id}`);
    } catch {
      /* best effort */
    }
  }
  CREATED_SESSION_IDS.clear();
});

test('POST /api/session-tick persists tick + pipes aggregate to widget', async ({ page, request }) => {
  const uniqueName = `e2e-tick-${Date.now()}`;

  // Seed session so we have a UUID we can use as the tick payload's
  // session_id. The hook cascade's `sessionId-as-row` strategy (the
  // same one used by Stop hooks) binds this into session_ticks.
  const createRes = await request.post(`${COMMANDER_API}/api/sessions`, {
    data: { name: uniqueName, sessionType: 'raw' },
  });
  expect(createRes.status()).toBe(201);
  const session = (await createRes.json()) as { id: string };
  CREATED_SESSION_IDS.add(session.id);

  // Realistic StatuslineRawPayload shape (see server/src/services/session-tick.service.ts
  // normalizeTick for the full fields we read). Only fill what the UI
  // actually renders — missing fields normalize to null.
  const resetsIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const payload = {
    session_id: session.id,
    cwd: '/tmp',
    model: { id: 'claude-opus-4-7', display_name: 'Opus 4.7' },
    context_window: {
      used_percentage: 45,
      remaining_percentage: 55,
      context_window_size: 200_000,
      total_input_tokens: 90_000,
      total_output_tokens: 1_200,
    },
    cost: {
      total_cost_usd: 2.34,
      total_duration_ms: 120_000,
      total_api_duration_ms: 80_000,
      total_lines_added: 42,
      total_lines_removed: 7,
    },
    rate_limits: {
      five_hour: { used_percentage: 71, resets_at: resetsIso },
      seven_day: { used_percentage: 12, resets_at: resetsIso },
    },
    version: 'e2e-test',
  };

  // POST the tick. Returns 200 {ok, sessionId} on success, 202 with
  // {ok, dropped:true} when the ingest drops the payload (dedup window
  // or unresolvable owner). A fresh session with a unique ingest =>
  // always the happy path.
  const tickRes = await request.post(`${COMMANDER_API}/api/session-tick`, { data: payload });
  expect(tickRes.ok()).toBeTruthy();
  const tickBody = await tickRes.json();
  expect(tickBody.ok).toBe(true);
  expect(tickBody.sessionId).toBe(session.id);
  expect(tickBody.dropped).toBeFalsy();

  // Deterministic per-session assertion — our payload round-trips
  // through normalize + the ON CONFLICT upsert + getLatestForSession.
  const stored = await request.get(`${COMMANDER_API}/api/sessions/${session.id}/tick`);
  expect(stored.ok()).toBeTruthy();
  const storedBody = await stored.json();
  expect(storedBody.commanderSessionId).toBe(session.id);
  expect(storedBody.contextWindow.usedPercentage).toBe(45);
  expect(storedBody.cost.totalCostUsd).toBe(2.34);
  expect(storedBody.rateLimits.fiveHour.usedPercentage).toBe(71);
  expect(storedBody.model.displayName).toBe('Opus 4.7');

  // Aggregate pipe — we just fired the freshest tick so the aggregate
  // endpoint should report non-null five_hour/seven_day pcts. We don't
  // pin our specific values here because any other session on this
  // host might tick in the interim and displace the freshest row.
  const agg = await request.get(`${COMMANDER_API}/api/system/rate-limits`);
  expect(agg.ok()).toBeTruthy();
  const aggBody = await agg.json();
  expect(aggBody.fiveHour.pct).not.toBeNull();
  expect(aggBody.sevenDay.pct).not.toBeNull();

  // HeaderStatsWidget renders four chips (CPU, Mem, 5h, 7d). Reload to
  // guarantee the widget mounts post-tick; then assert the 5h chip
  // text is a numeric percentage (not "—"), which proves the
  // aggregate → useAggregateRateLimits → Chip render pipe is live.
  await page.reload();
  await dismissPinIfPresent(page);

  // The chip's structural pattern is `<label>5h</label><primary>NN%</primary>`.
  // Playwright sees those as siblings inside the same container; we
  // locate the container that has the "5h" label and then assert the
  // text node next to it matches a percent.
  const fiveHourChip = page.locator('div').filter({
    has: page.locator('text=/^5h$/'),
  }).first();
  await expect(fiveHourChip).toBeVisible({ timeout: 5000 });
  // The chip text concatenates label + pct; `toHaveText` with a regex
  // matches the composed string regardless of element nesting.
  await expect(fiveHourChip).toHaveText(/5h\s*\d+%/);

  const sevenDayChip = page.locator('div').filter({
    has: page.locator('text=/^7d$/'),
  }).first();
  await expect(sevenDayChip).toBeVisible({ timeout: 5000 });
  await expect(sevenDayChip).toHaveText(/7d\s*\d+%/);
});
