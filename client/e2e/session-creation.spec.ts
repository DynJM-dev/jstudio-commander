import { test, expect } from '@playwright/test';
import { COMMANDER_API, serverUp, dismissPinIfPresent } from './helpers';

// Phase P.4 Patch 2 — end-to-end session creation. Exercises:
//   UI click → POST /api/sessions → sessionService.createSession
//     → tmuxService.createSession (real tmux spawn on the test host)
//     → DB INSERT + eventBus.emitSessionCreated → WS fan-out
//     → useSessions WS handler → React re-render → SessionCard in DOM.
//
// This is the highest-ROI E2E because every stage in the chain above is
// covered by a unit test at the piece level, but the seams between them
// (route → service, service → eventBus, eventBus → WS, WS → React) have
// zero coverage before this spec.
//
// Side-effect caveat: this test really does spawn a tmux session on the
// host it runs against. The afterEach DELETE cleans the row + kills the
// pane; if it leaks on a crash, the orphan row will get swept by the
// next server boot's startup recovery and the tmux pane will linger
// until a `tmux kill-server` or a reboot. Acceptable blast radius for a
// throwaway `jsc-<8-char-id>` session.

// Track sessions we create so afterEach can always clean up, even if
// the UI assertions failed mid-test.
const CREATED_SESSION_IDS = new Set<string>();

test.beforeEach(async ({ page }) => {
  if (!(await serverUp())) test.skip(true, 'Commander API unavailable');
  await page.goto('/sessions');
  await dismissPinIfPresent(page);
});

test.afterEach(async ({ request }) => {
  // Delete everything this test created. DELETE /api/sessions/:id kills
  // the tmux pane + marks the row stopped (soft delete on standalone
  // sessions). Iterating through the set rather than clearing it mid-
  // test guards against partial failure.
  for (const id of CREATED_SESSION_IDS) {
    try {
      await request.delete(`${COMMANDER_API}/api/sessions/${id}`);
    } catch {
      /* best effort */
    }
  }
  CREATED_SESSION_IDS.clear();
});

test('create new session — click → modal → submit → card appears + DB row exists', async ({ page, request }) => {
  const uniqueName = `e2e-${Date.now()}`;

  // Snapshot the existing sessions list BEFORE we create ours — useful
  // for diffing afterward (e.g. to find the row we just added by
  // exclusion, even if another session in the list happens to share
  // a name prefix).
  const beforeRes = await request.get(`${COMMANDER_API}/api/sessions`);
  expect(beforeRes.ok()).toBeTruthy();
  const before = (await beforeRes.json()) as Array<{ id: string }>;
  const beforeIds = new Set(before.map((s) => s.id));

  // Click the "New Session" button in the page header. This opens the
  // CreateSessionModal (see client/src/components/sessions/CreateSessionModal.tsx).
  await page.getByRole('button', { name: /new session/i }).click();

  // Modal opens with role=dialog + aria-labelledby="create-session-title"
  // per the Phase P.2 C2 a11y work.
  const dialog = page.getByRole('dialog', { name: /new session/i });
  await expect(dialog).toBeVisible();

  // Default session-type is PM; tests use Raw to avoid pulling in the PM
  // bootstrap prompt (which reads a separate file at
  // ~/.claude/prompts/pm-session-bootstrap.md and tries to inject it
  // into the fresh pane). Raw is a plain `claude` launch.
  await dialog.getByRole('button', { name: /raw session/i }).click();

  // Fill the name field. The placeholder reads "Auto-generated if empty";
  // we pin a known value so the card is searchable by text.
  await dialog.getByPlaceholder(/auto-generated if empty/i).fill(uniqueName);

  // Leave projectPath empty on purpose — tmuxService then uses $HOME as
  // the pane cwd (no -c flag), which always exists. Passing a fake path
  // like /tmp/nope would make the tmux spawn fail and crash the create.

  // Submit. Modal closes on success (see CreateSessionModal.handleSubmit
  // → await onCreate → onClose()).
  await dialog.getByRole('button', { name: /^create$/i }).click();

  // Modal should disappear. If it doesn't, the create failed and the
  // modal stays open with the submit spinner still spinning.
  await expect(dialog).toBeHidden({ timeout: 10_000 });

  // Poll /api/sessions until we see the new id. WS fan-out should have
  // already delivered session:created; the REST call is the ground
  // truth check independent of WS.
  await expect.poll(
    async () => {
      const res = await request.get(`${COMMANDER_API}/api/sessions`);
      const list = (await res.json()) as Array<{ id: string; name: string }>;
      return list.some((s) => !beforeIds.has(s.id) && s.name === uniqueName);
    },
    { timeout: 10_000, intervals: [300, 500, 1000] },
  ).toBe(true);

  // Capture the new session id for afterEach cleanup + asserting the
  // DOM update picked it up too.
  const afterRes = await request.get(`${COMMANDER_API}/api/sessions`);
  const after = (await afterRes.json()) as Array<{ id: string; name: string; status: string }>;
  const created = after.find((s) => !beforeIds.has(s.id) && s.name === uniqueName);
  expect(created).toBeDefined();
  CREATED_SESSION_IDS.add(created!.id);

  // New sessions boot to `working` per session.service.ts:295 (tmux +
  // claude just launched). Poller may have flipped to idle already if
  // the claude CLI isn't installed; accept either as evidence the row
  // is alive.
  expect(['working', 'idle']).toContain(created!.status);

  // Assert the SessionCard rendered in the DOM. The card carries the
  // session's name as text somewhere inside its tree. getByText matches
  // across the page, but the grid is the only place the name would
  // appear.
  await expect(page.getByText(uniqueName, { exact: false }).first()).toBeVisible({ timeout: 5000 });
});
