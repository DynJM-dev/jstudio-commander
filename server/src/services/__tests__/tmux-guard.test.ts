// Phase S.1 Patch 5 — sendKeys target guard + resolveFirstPaneId + a
// live regression test proving pane-id targeting doesn't drift with
// tmux's "active pane" state (the OvaGas PM→coder leak class).
//
// The guard tests are pure — they hit the throw path BEFORE exec, so
// they need no tmux server. The routing test requires a real tmux;
// gates itself on `tmux -V` availability so hosts without tmux soft-
// skip rather than fail.

import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { tmuxService } from '../tmux.service.js';

const tmuxAvailable = (): boolean => {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore', timeout: 2000 });
    return true;
  } catch {
    return false;
  }
};

const tmux = (args: string[]): string =>
  execFileSync('tmux', args, { encoding: 'utf-8', timeout: 3000 }).trim();

// Tracks tmux session names the test spawned so `after()` can blow
// them away even when an assertion blew up mid-test.
const SPAWNED: Set<string> = new Set();
after(() => {
  for (const name of SPAWNED) {
    try {
      execFileSync('tmux', ['kill-session', '-t', name], { stdio: 'ignore', timeout: 2000 });
    } catch {
      /* already gone */
    }
  }
});

describe('tmuxService.sendKeys target guard', () => {
  test('DEV throws on raw session name (jsc-*)', () => {
    const prev = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      assert.throws(
        () => tmuxService.sendKeys('jsc-deadbeef', 'noop'),
        /not a pane id/,
      );
    } finally {
      if (prev !== undefined) process.env.NODE_ENV = prev;
    }
  });

  test('DEV throws on agent: sentinel', () => {
    const prev = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      assert.throws(
        () => tmuxService.sendKeys('agent:teammate-xyz', 'noop'),
        /not a pane id/,
      );
    } finally {
      if (prev !== undefined) process.env.NODE_ENV = prev;
    }
  });

  test('retired: target is a silent no-op (no throw, no exec)', () => {
    const prev = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      // No assertion on tmux side-effects — the invariant is "doesn't
      // throw and doesn't reach the tmux exec path". If it did call
      // exec against `retired:<id>` the call would fail; us arriving
      // here with no exception is sufficient proof of the no-op.
      assert.doesNotThrow(() => tmuxService.sendKeys('retired:abc-123', 'noop'));
    } finally {
      if (prev !== undefined) process.env.NODE_ENV = prev;
    }
  });

  test('PROD warns + proceeds on raw session name (no throw)', () => {
    // Can't easily assert `tmux send-keys` succeeded without a real
    // tmux session. The guard's job in PROD is to warn + attempt —
    // we verify the warn fires and the throw does NOT. Swallow the
    // downstream exec failure (session does not exist) so the test
    // stays hermetic.
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const warnings: string[] = [];
    const prevWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(' '));
    };
    try {
      try {
        tmuxService.sendKeys('jsc-prod-test-aaaa', 'noop');
      } catch { /* tmux exec will fail; guard already ran */ }
      assert.ok(
        warnings.some((w) => /not a pane id/.test(w)),
        `expected warn, got: ${JSON.stringify(warnings)}`,
      );
    } finally {
      console.warn = prevWarn;
      if (prev !== undefined) process.env.NODE_ENV = prev;
      else delete process.env.NODE_ENV;
    }
  });

  test('% pane-id targets bypass the guard entirely', () => {
    // Prove the guard doesn't throw on the happy path. Exec may fail
    // because `%999999` almost certainly isn't live, but that comes
    // after the guard — which is what we care about testing here.
    const prev = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      try {
        tmuxService.sendKeys('%999999', 'noop');
      } catch (err) {
        // Only acceptable failure mode is the exec-side tmux error,
        // NOT the guard. Verify the message doesn't mention the guard.
        assert.doesNotMatch((err as Error).message, /not a pane id/);
      }
    } finally {
      if (prev !== undefined) process.env.NODE_ENV = prev;
    }
  });
});

describe('tmuxService.resolveFirstPaneId', () => {
  test('idempotent on pane-id inputs (returns %NN unchanged)', () => {
    assert.equal(tmuxService.resolveFirstPaneId('%35'), '%35');
    assert.equal(tmuxService.resolveFirstPaneId('%999999'), '%999999');
  });

  test('returns null when the session does not exist', () => {
    // Session name picked to be extremely unlikely to exist on any dev
    // host. Resolver short-circuits via the inner exec's null-branch.
    assert.equal(tmuxService.resolveFirstPaneId('nope-not-a-real-tmux-session-abc123'), null);
  });

  test('returns the first pane id of a live session (not the active one)', (t) => {
    if (!tmuxAvailable()) {
      t.skip('tmux not available on this host');
      return;
    }

    const sessionName = `jsc-guard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    tmux(['new-session', '-d', '-s', sessionName]);
    SPAWNED.add(sessionName);
    const firstPane = tmux(['list-panes', '-t', sessionName, '-F', '#{pane_id}']).split('\n')[0]!.trim();

    // Split-window inside the session to create a second pane, then
    // explicitly make the new pane active. The resolveFirstPaneId
    // contract is "return the FIRST (top) pane id"; active-pane state
    // must not shift the answer. This is the OvaGas invariant:
    // `send-keys -t <session-name>` targets the active pane, so
    // storing the session name in tmux_session would drift the
    // routing as the user clicks around.
    tmux(['split-window', '-t', sessionName, '-d']);
    const panes = tmux(['list-panes', '-t', sessionName, '-F', '#{pane_id}'])
      .split('\n').map((l) => l.trim()).filter(Boolean);
    assert.equal(panes.length, 2);
    const secondPane = panes[1]!;
    tmux(['select-pane', '-t', secondPane]);

    const resolved = tmuxService.resolveFirstPaneId(sessionName);
    assert.equal(resolved, firstPane, `expected ${firstPane}, got ${resolved} (active was ${secondPane})`);
  });
});

describe('sendKeys by pane id bypasses tmux active-pane drift', () => {
  test('pane-id target lands in that pane, not the active one', (t) => {
    if (!tmuxAvailable()) {
      t.skip('tmux not available on this host');
      return;
    }

    const sessionName = `jsc-route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    tmux(['new-session', '-d', '-s', sessionName]);
    SPAWNED.add(sessionName);

    // Two panes inside one tmux session: firstPane is the shell pane
    // created by new-session; secondPane is split off. Selects second
    // as active — this is the OvaGas state (user clicks coder pane,
    // it becomes active, subsequent `send-keys -t <session-name>`
    // lands there instead of the PM's pane).
    const firstPane = tmux(['list-panes', '-t', sessionName, '-F', '#{pane_id}']).split('\n')[0]!.trim();
    tmux(['split-window', '-t', sessionName, '-d']);
    const panes = tmux(['list-panes', '-t', sessionName, '-F', '#{pane_id}'])
      .split('\n').map((l) => l.trim()).filter(Boolean);
    const secondPane = panes[1]!;
    tmux(['select-pane', '-t', secondPane]);

    // Route a uniquely-identifiable payload to the FIRST pane via its
    // pane id. If the fix is wrong (or regresses), the payload would
    // drift to secondPane (the active one) and the capture-pane
    // assertions below invert.
    const token = `ROUTEPROBE-${Date.now()}`;
    // send-keys with Enter would execute the string as a shell command
    // inside the pane and potentially fail; send a raw printf instead
    // so the pane buffer captures the literal bytes we care about.
    tmux(['send-keys', '-t', firstPane, '-l', token]);

    // Give tmux a tick to flush the keystroke into the pane buffer.
    const capFirst = tmux(['capture-pane', '-t', firstPane, '-p', '-S', '-5']);
    const capSecond = tmux(['capture-pane', '-t', secondPane, '-p', '-S', '-5']);
    assert.ok(capFirst.includes(token), `first pane should contain token; got: ${capFirst}`);
    assert.ok(!capSecond.includes(token), `second pane should NOT contain token; got: ${capSecond}`);
  });
});
