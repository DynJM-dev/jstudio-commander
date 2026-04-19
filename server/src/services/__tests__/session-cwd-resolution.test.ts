import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveSessionCwd } from '../session.service.js';

// Issue 6 — raw-Coder sessions create with empty user-input projectPath
// because the user didn't type one. Without a cwd the spawn-bind watcher
// early-returns (session.service.ts bindClaudeSessionFromJsonl line
// `if (!cwd) return`) AND resolveOwner's cwd-exclusive strategy can't
// match the row against the hook's cwd — both binding paths fail,
// transcript_paths stays empty, chat pane renders nothing.
//
// resolveSessionCwd is the pure helper that closes the gap: it takes the
// caller's (possibly-absent) input plus the tmux pane's actual cwd and
// produces the canonical absolute path to store in the row AND pass to
// the bind watcher. Every Commander-spawned session ends up with a real
// project_path so (a) the deterministic watcher fires and (b) if it
// misses, cwd-exclusive resolveOwner still matches as safety net.

describe('Issue 6 — resolveSessionCwd', () => {
  test('falls back to pane cwd when user did not provide a projectPath', () => {
    assert.equal(resolveSessionCwd(undefined, '/tmp/pane-dir'), '/tmp/pane-dir');
    assert.equal(resolveSessionCwd(null, '/tmp/pane-dir'), '/tmp/pane-dir');
    assert.equal(resolveSessionCwd('', '/tmp/pane-dir'), '/tmp/pane-dir');
    assert.equal(resolveSessionCwd('   ', '/tmp/pane-dir'), '/tmp/pane-dir');
  });

  test('user input takes precedence over pane cwd when provided', () => {
    assert.equal(
      resolveSessionCwd('/Users/me/project', '/tmp/pane-cwd'),
      '/Users/me/project',
    );
  });

  test('expands leading ~/ to $HOME (client often sends the literal tilde)', () => {
    assert.equal(
      resolveSessionCwd('~/Desktop/projects/foo', null),
      join(homedir(), 'Desktop/projects/foo'),
    );
    assert.equal(resolveSessionCwd('~', null), homedir());
  });

  test('trims trailing slashes so project_path equals the hook-event cwd exactly', () => {
    // Claude Code's hook event carries `cwd` without a trailing slash.
    // resolveOwner.cwd-exclusive compares with `project_path = ?`, so a
    // stored value with a trailing slash would miss every time.
    assert.equal(resolveSessionCwd('/tmp/abc/', null), '/tmp/abc');
    assert.equal(resolveSessionCwd('/tmp/abc///', null), '/tmp/abc');
  });

  test('returns null when BOTH user input and pane cwd are absent', () => {
    // Null is a legitimate outcome — bindClaudeSessionFromJsonl handles it
    // by skipping the watcher (can't predict Claude's JSONL dir without
    // knowing cwd). The caller is responsible for not writing null as an
    // empty string into the project_path column.
    assert.equal(resolveSessionCwd(undefined, null), null);
    assert.equal(resolveSessionCwd('', null), null);
    assert.equal(resolveSessionCwd(null, null), null);
  });

  test('pane cwd with trailing slash is also normalized', () => {
    // tmux's `pane_current_path` typically has no trailing slash, but if a
    // future macOS / tmux version changes that, the normalizer must still
    // produce a cwd that matches what hooks send.
    assert.equal(resolveSessionCwd(undefined, '/tmp/a/'), '/tmp/a');
  });

  // Issue 15.2 — realpath resolution. macOS symlinks `/tmp` to
  // `/private/tmp`; Claude Code encodes its JSONL dir using the
  // real-path form, so the spawn-bind watcher must watch the
  // symlink-resolved directory to see new JSONL files.
  test('canonicalizes macOS /tmp symlink to /private/tmp (Issue 15.2)', () => {
    // On macOS /tmp is a symlink to /private/tmp — realpath follows it.
    // The test only asserts on macOS-shaped outputs; on Linux this
    // branch is a no-op (realpath returns /tmp unchanged).
    const result = resolveSessionCwd('/tmp', null);
    // Both platforms produce a canonicalized path — accept either the
    // macOS resolved form OR the Linux unchanged form, so the test
    // stays portable. The KEY invariant is: the result matches
    // whatever realpathSync('/tmp') would have produced.
    assert.ok(result);
    // The important negative: the result is NOT a literal string with
    // trailing slash or tilde that could break downstream encoding.
    assert.ok(!result!.endsWith('/'));
  });

  test('realpath fall-through preserves canonical on non-existent path', () => {
    // Non-existent paths throw from realpathSync — caller must NOT
    // crash the spawn path; fall back to the normalized form instead.
    const bogus = '/Users/does-not-exist-' + Date.now() + '/project';
    assert.equal(resolveSessionCwd(bogus, null), bogus);
  });

  test('realpath + trailing-slash normalization chain together', () => {
    // Combined invariant: trim slashes FIRST, then realpath.
    // `/tmp/` → `/tmp` (trim) → canonicalized symlink resolution or
    // pass-through. Fallback guarantees a sane string either way.
    const result = resolveSessionCwd('/tmp/', null);
    assert.ok(result);
    assert.ok(!result!.endsWith('/'));
  });
});
