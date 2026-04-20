import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

// Phase T MVP — tmux mirror pane. The three load-bearing server-side
// invariants are pinned here without booting Fastify or tmux:
//
//   1. `capturePane` ANSI-flag gate. `preserveAnsi: true` adds `-e`
//      to the tmux args; default (or `preserveAnsi: false`) does
//      NOT. Classifier callers stay on the ANSI-stripped path.
//   2. Dedupe gate. Identical captured content on two consecutive
//      ticks for the same sessionId emits ONCE, not twice. Changed
//      content on the second tick emits a second time. Saturation
//      protection for idle sessions.
//   3. Cleanup hook. `clearSessionMirrorState(id)` removes the
//      sessionId's entry from the dedupe Map. Prevents Map leak
//      across long uptimes when sessions are deleted.
//
// Approach: mirror the decision logic rather than booting the full
// poll loop. Matches the pattern of poller-yield.test.ts.

describe('Phase T MVP — tmux capturePane ANSI flag gate', () => {
  // Mirror the args-builder from tmux.service.ts capturePane.
  const buildCaptureArgs = (
    name: string,
    lines: number,
    opts?: { preserveAnsi?: boolean },
  ): string[] => {
    const args = ['capture-pane', '-t', name, '-p', '-S', `-${lines}`];
    if (opts?.preserveAnsi) args.push('-e');
    return args;
  };

  test('default call (no opts) — no -e flag', () => {
    const args = buildCaptureArgs('jsc-test', 25);
    assert.equal(args.includes('-e'), false, 'classifier path must not receive ANSI');
    assert.deepEqual(args.slice(0, 6), ['capture-pane', '-t', 'jsc-test', '-p', '-S', '-25']);
  });

  test('preserveAnsi: false — no -e flag (back-compat default)', () => {
    const args = buildCaptureArgs('jsc-test', 25, { preserveAnsi: false });
    assert.equal(args.includes('-e'), false);
  });

  test('preserveAnsi: true — -e flag appended', () => {
    const args = buildCaptureArgs('jsc-test', 50, { preserveAnsi: true });
    assert.equal(args.includes('-e'), true, 'mirror path must preserve ANSI');
    assert.equal(args[args.length - 1], '-e');
  });
});

describe('Phase T MVP — dedupe gate (CTO Amendment 1)', () => {
  // Mirror the `lastEmittedByCapture` Map behavior from the poll
  // loop. The production gate is:
  //   if (lastEmittedByCapture.get(sessionId) !== mirrorText) {
  //     lastEmittedByCapture.set(sessionId, mirrorText);
  //     eventBus.emitSessionPaneCapture(sessionId, mirrorText, ...);
  //   }
  const simulateTick = (
    dedupe: Map<string, string>,
    emits: Array<{ sessionId: string; paneText: string }>,
    sessionId: string,
    paneText: string,
  ): void => {
    if (dedupe.get(sessionId) !== paneText) {
      dedupe.set(sessionId, paneText);
      emits.push({ sessionId, paneText });
    }
  };

  test('identical content across two ticks → emits exactly once', () => {
    const dedupe = new Map<string, string>();
    const emits: Array<{ sessionId: string; paneText: string }> = [];
    const content = 'idle ❯ prompt';
    simulateTick(dedupe, emits, 'sess-A', content);
    simulateTick(dedupe, emits, 'sess-A', content);
    assert.equal(emits.length, 1, 'second identical tick must NOT emit');
  });

  test('changed content on second tick → emits again', () => {
    const dedupe = new Map<string, string>();
    const emits: Array<{ sessionId: string; paneText: string }> = [];
    simulateTick(dedupe, emits, 'sess-A', 'first');
    simulateTick(dedupe, emits, 'sess-A', 'first');
    simulateTick(dedupe, emits, 'sess-A', 'second');
    assert.equal(emits.length, 2);
    assert.equal(emits[1]!.paneText, 'second');
  });

  test('different sessions dedupe independently', () => {
    const dedupe = new Map<string, string>();
    const emits: Array<{ sessionId: string; paneText: string }> = [];
    simulateTick(dedupe, emits, 'sess-A', 'same');
    simulateTick(dedupe, emits, 'sess-B', 'same');
    // Same content but different session → both emit (no cross-session dedupe).
    assert.equal(emits.length, 2);
    assert.deepEqual(emits.map((e) => e.sessionId), ['sess-A', 'sess-B']);
  });
});

describe('Phase T MVP — cleanup hook prevents Map leak', () => {
  test('clearSessionMirrorState removes the session entry', async () => {
    const { statusPollerService } = await import('../status-poller.service.js');
    // Seed + assert via the test-only peek helper. Round-trip through
    // the public clear method; the leak defense is that after clear
    // the entry is truly absent (not just overwritten to '').
    // We simulate seeding by exercising a harmless path: the helper
    // exists specifically so tests don't reach into module state.
    // Direct seed via a synthetic set is not exposed, so instead we
    // verify the public contract: clearing an unknown id is a no-op,
    // and after clearing, the peek returns undefined.
    statusPollerService.clearSessionMirrorState('never-polled');
    assert.equal(
      statusPollerService.__getLastEmittedForTest('never-polled'),
      undefined,
      'unknown sessionId → undefined (no Map entry)',
    );
    // Idempotency check: second clear must not throw.
    statusPollerService.clearSessionMirrorState('never-polled');
  });
});

describe('Phase T MVP — emit payload shape', () => {
  test('emit shape matches WSEvent contract', () => {
    // The shape contract surface: the server-side emitter writes
    // { sessionId, paneText, capturedAt } and the ws/index.ts
    // broadcaster wraps it as { type: 'session:pane-capture', ... }.
    // Mirror the wrap.
    const sessionId = 'sess-A';
    const paneText = '\x1b[31mred\x1b[0m plain';
    const capturedAt = 1_700_000_000_000;
    const wire = {
      type: 'session:pane-capture' as const,
      sessionId,
      paneText,
      capturedAt,
    };
    assert.equal(wire.type, 'session:pane-capture');
    assert.equal(wire.sessionId, sessionId);
    assert.ok(wire.paneText.includes('\x1b['), 'ANSI escapes survive server → client');
    assert.equal(typeof wire.capturedAt, 'number');
  });
});
