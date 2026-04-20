import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computePromptDetectionCadence } from '../../hooks/usePromptDetection.js';

// Issue 15.3 Tier A Item 3 — prompt-detection cadence table.
//
// Cadence is the user-observable contract: poll interval directly
// determines worst-case delay between a permission prompt landing on
// the server's pane and the `<PermissionPrompt>` DOM node mounting on
// the client (v5 §11.3 Class A, "status-idle occlusion"). These
// assertions pin the interval in milliseconds — the observable the
// dispatch test 4 names explicitly ("pin the observable interval,
// not the timer internals").
//
// End-to-end "modal mounts within 3s" integration is covered by
// Jose's browser smoke (per feedback_self_dogfood_applies_to_status_fixes
// + guardrail 2 of the v4 rotation). These tests pin the LOGIC that
// makes the 3s bound achievable.

describe('Tier A Item 3 — computePromptDetectionCadence', () => {
  test('userJustSent=true overrides any status → 1_000 ms (instant echo after user send)', () => {
    assert.equal(computePromptDetectionCadence('idle', true), 1_000);
    assert.equal(computePromptDetectionCadence('working', true), 1_000);
    assert.equal(computePromptDetectionCadence('waiting', true), 1_000);
    assert.equal(computePromptDetectionCadence(undefined, true), 1_000);
  });

  test("sessionStatus='waiting' → 1_000 ms (approval-prompt active path — ≤ 1s mount bound)", () => {
    // Active-path tightness: once the server has flipped to waiting,
    // a 1s poll guarantees the modal mounts within ≤ 2s (one poll
    // cycle + render), well under the dispatch ≤3s contract.
    assert.equal(computePromptDetectionCadence('waiting', false), 1_000);
  });

  test("sessionStatus='working' → 2_000 ms (steady-state; doesn't hammer tmux on long turns)", () => {
    // Matches the legacy cadence for working — no regression.
    assert.equal(computePromptDetectionCadence('working', false), 2_000);
  });

  test("sessionStatus='idle' (no userJustSent) → 8_000 ms (idle path — cheap polling, still catches force-idled prompts)", () => {
    // The fix. Pre-Tier-A this returned "no polling at all". Now 8s.
    // Picked inside the dispatch's 5-10s range (§C26, justified at
    // the hook's export site).
    assert.equal(computePromptDetectionCadence('idle', false), 8_000);
  });

  test("sessionStatus='stopped' → 8_000 ms (treat stopped like idle — cheap polling)", () => {
    // Stopped sessions may revive; keeping cheap polling costs ~1
    // tmux read per 8s per stopped session which is negligible.
    assert.equal(computePromptDetectionCadence('stopped', false), 8_000);
  });

  test('sessionStatus=undefined → 8_000 ms (safe default)', () => {
    // Fresh-session edge case: session row exists but `status` field
    // hasn't populated yet. Default to idle cadence so the hook still
    // polls (the pre-fix guard would have returned early here and
    // missed a prompt that landed during the session-status flush).
    assert.equal(computePromptDetectionCadence(undefined, false), 8_000);
  });

  test('sessionStatus=unknown-string → 8_000 ms (forward-compat)', () => {
    // If a new coarse status is added server-side, the hook must not
    // crash and must keep polling. Default cadence suffices.
    assert.equal(computePromptDetectionCadence('ghost-state', false), 8_000);
  });
});

describe('Tier A Item 3 — cadence bounds (class-level invariants)', () => {
  test('idle cadence is within the dispatch-mandated 5-10s range', () => {
    // Dispatch contract: "scale to 5–10s cadence. Pick a concrete
    // integer in the range." Cement the chosen value inside the range
    // so a future caller that nudges the constant stays bounded.
    const idleCadence = computePromptDetectionCadence('idle', false);
    assert.ok(idleCadence >= 5_000, `idle cadence ${idleCadence}ms below 5s floor`);
    assert.ok(idleCadence <= 10_000, `idle cadence ${idleCadence}ms above 10s ceiling`);
  });

  test('active cadences are ≤ 2_000 ms (≤3s modal-mount contract achievable)', () => {
    // For the active paths, cadence must be tight enough that poll
    // delay + fetch RTT + React render stays under 3s. 2s cadence +
    // ~200ms fetch + ~50ms render = ~2.25s. ≤ 3s holds.
    assert.ok(computePromptDetectionCadence('working', false) <= 2_000);
    assert.ok(computePromptDetectionCadence('waiting', false) <= 2_000);
    assert.ok(computePromptDetectionCadence('idle', true) <= 2_000); // userJustSent path
  });

  test('idle cadence > active working cadence (no regression on the legacy active path)', () => {
    // The fix adds idle polling; it must not over-tighten to the
    // point where idle sessions cost more than working ones. Strict
    // ordering: idle > working (working is hot-path, idle is belt
    // and suspenders).
    assert.ok(
      computePromptDetectionCadence('idle', false) >
      computePromptDetectionCadence('working', false),
      'idle cadence must be slower than working cadence',
    );
  });
});
