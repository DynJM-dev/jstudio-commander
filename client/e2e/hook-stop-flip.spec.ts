import { test, expect } from '@playwright/test';
import { COMMANDER_API, serverUp, dismissPinIfPresent } from './helpers';

// Phase P.4 Patch 3 — Stop hook flips session to idle. Exercises the
// full Phase N.0 P1 chain:
//   POST /api/hook-event {event:'Stop', sessionId} →
//     resolveOwner cascade →
//     sessions.UPDATE status='idle' →
//     eventBus.emitSessionStatus →
//     WS fan-out →
//     useSessions handler → SessionCard badge flips to Idle.
//
// Closes the C-2 gap from the Phase P E2E audit — the hook-event route
// has zero integration coverage today. Per-strategy SQL predicates are
// unit-tested in server/src/services/__tests__/stop-hook-idle.test.ts,
// but the route handler itself never runs in a test.
//
// Strategy: create a real session (via REST — not the UI path, which
// the session-creation spec already covers), fire a realistic Stop
// hook at the session's UUID id, assert the status flips to idle via
// both REST poll AND a navigated Sessions page render.

const CREATED_SESSION_IDS = new Set<string>();

test.beforeEach(async ({ page, request }) => {
  if (!(await serverUp())) test.skip(true, 'Commander API unavailable');
  await page.goto('/sessions');
  await dismissPinIfPresent(page);
  // Quiet-check that /api/hook-event exists and isn't behind the PIN
  // wall for loopback requests. A 400 (missing body) means the route is
  // alive; a 403 means we've been locked out.
  const probe = await request.post(`${COMMANDER_API}/api/hook-event`, { data: {} });
  if (probe.status() === 403) test.skip(true, 'hook-event route refusing loopback — cannot test');
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

test('POST /api/hook-event Stop flips session row to idle + UI reflects it', async ({ page, request }) => {
  const uniqueName = `e2e-stop-${Date.now()}`;

  // Seed: REST-create a session. Boots to 'working' per Phase N.0
  // session.service.createSession — tmux + claude already launched.
  // Use sessionType=raw to avoid PM bootstrap file I/O.
  const createRes = await request.post(`${COMMANDER_API}/api/sessions`, {
    data: { name: uniqueName, sessionType: 'raw' },
  });
  expect(createRes.status()).toBe(201);
  const session = (await createRes.json()) as { id: string; status: string };
  CREATED_SESSION_IDS.add(session.id);

  // Sanity: id should be a UUID (the hook's resolveOwner cascade depends
  // on that — "sessionId-as-row" strategy queries `WHERE id = ?` with
  // the hook payload's sessionId. A non-UUID id would not match the
  // UUID_RE guard on the hook side, but the DB query works regardless;
  // this is belt-and-suspenders.
  expect(session.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

  // Initial status — standalone create boots 'working' but the poller
  // may have already flipped to 'idle' if the claude CLI isn't installed
  // on the host. Either is acceptable; we care about the post-hook
  // state, not the starting value.
  expect(['working', 'idle']).toContain(session.status);

  // Fire the Stop hook. Shape matches what
  // ~/.claude/hooks/commander-hook.js sends — event + sessionId +
  // data.transcript_path/cwd/tool_name. For this test we omit
  // transcript_path so resolveOwner falls to sessionId-as-row (step 2
  // in hook-event.routes.ts:62+). Including a transcript_path would
  // require allowlist-valid paths under ~/.claude/projects/, which this
  // session doesn't own.
  const hookRes = await request.post(`${COMMANDER_API}/api/hook-event`, {
    data: {
      event: 'Stop',
      sessionId: session.id,
      data: { cwd: '/tmp', tool_name: '' },
    },
  });
  expect(hookRes.ok()).toBeTruthy();
  const hookBody = await hookRes.json();
  expect(hookBody.ok).toBe(true);

  // Poll /api/sessions/:id until status flips to 'idle'. Phase N.0 P1
  // guarantees this fires within the same HTTP request — but the route
  // is serialized through hookQueue, so assume up to 2s for queued
  // events ahead of ours.
  await expect.poll(
    async () => {
      const res = await request.get(`${COMMANDER_API}/api/sessions/${session.id}`);
      if (!res.ok()) return null;
      const body = (await res.json()) as { status: string };
      return body.status;
    },
    { timeout: 5_000, intervals: [200, 400, 800] },
  ).toBe('idle');

  // UI assertion: reload /sessions + find the card by name, assert the
  // status label now reads "Idle". Reload (vs relying on WS fan-out) is
  // the robust path — the WS event may have already fired before the
  // page had a listener attached.
  await page.reload();
  await dismissPinIfPresent(page);

  // The card contains both the session name (as an h3 heading) and the
  // StatusBadge label text. Playwright's `filter({ has: ... })` is the
  // idiomatic way to scope "the glass-card that contains this heading"
  // without XPath fragility.
  const heading = page.getByRole('heading', { level: 3, name: new RegExp(uniqueName) });
  await expect(heading).toBeVisible({ timeout: 5000 });

  const card = page.locator('.glass-card', { has: heading });
  await expect(card).toHaveCount(1);
  // StatusBadge renders the label as a span with exact text "Idle".
  await expect(card.getByText(/^idle$/i).first()).toBeVisible({ timeout: 5000 });
});
