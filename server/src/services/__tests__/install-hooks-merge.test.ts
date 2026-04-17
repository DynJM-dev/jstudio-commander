import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
// install-hooks.mjs lives at the repo root (outside server/). Imported
// via relative path because it's pure JS (ESM) with no server-package
// dependencies. Declared as ambient any below so the server's tsc
// typecheck doesn't try to resolve the .mjs declaration file.
// @ts-expect-error — .mjs import without a .d.ts; the module is a
// pure ESM script consumed only by this test.
import { mergeHookEvents, entryHasCommanderHook } from '../../../../scripts/install-hooks.mjs';

// Phase N.0 Patch 4 — install-script merge-semantics regression guard.
//
// Invariants:
//   1. Empty priorHooks → all 4 events added fresh.
//   2. User's Stop/PostToolUse entries are preserved when SessionStart/End
//      are added (no clobber of non-commander hooks).
//   3. Re-running the install is a no-op when every event already has
//      a commander-hook.sh entry (idempotency).
//   4. A user's custom matcher (different script) coexists — we append
//      our matcher alongside rather than replacing.

describe('install-hooks.mjs — Phase N.0 Patch 4', () => {
  test('empty settings → all 4 HOOK_EVENTS added', () => {
    const { next, additions } = mergeHookEvents(undefined) as {
      next: Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string; timeout: number }> }>>;
      additions: string[];
    };
    assert.deepEqual(
      new Set(additions),
      new Set(['SessionStart', 'SessionEnd', 'Stop', 'PostToolUse']),
    );
    assert.ok(next.SessionStart);
    assert.ok(next.SessionEnd);
    assert.ok(next.Stop);
    assert.ok(next.PostToolUse);
    for (const event of additions) {
      const entries = next[event]!;
      assert.equal(entries.length, 1);
      assert.equal(entries[0]!.matcher, '*');
      assert.equal(entries[0]!.hooks[0]!.command, '~/.claude/hooks/commander-hook.sh');
      assert.equal(entries[0]!.hooks[0]!.timeout, 5);
    }
  });

  test('existing Stop + PostToolUse with commander-hook → only SessionStart/End added', () => {
    const prior = {
      Stop: [{ matcher: '*', hooks: [{ type: 'command', command: '~/.claude/hooks/commander-hook.sh', timeout: 5 }] }],
      PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: '~/.claude/hooks/commander-hook.sh', timeout: 5 }] }],
    };
    const { next, additions } = mergeHookEvents(prior) as {
      next: Record<string, Array<{ matcher: string; hooks: Array<{ command: string }> }>>;
      additions: string[];
    };
    assert.deepEqual(new Set(additions), new Set(['SessionStart', 'SessionEnd']));
    assert.equal(next.Stop!.length, 1);
    assert.equal(next.PostToolUse!.length, 1);
    assert.equal(next.Stop![0]!.hooks[0]!.command, prior.Stop[0]!.hooks[0]!.command);
  });

  test('idempotent — re-running with fully populated hooks is a no-op', () => {
    const prior = {
      SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: '~/.claude/hooks/commander-hook.sh' }] }],
      SessionEnd: [{ matcher: '*', hooks: [{ type: 'command', command: '~/.claude/hooks/commander-hook.sh' }] }],
      Stop: [{ matcher: '*', hooks: [{ type: 'command', command: '~/.claude/hooks/commander-hook.sh' }] }],
      PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: '~/.claude/hooks/commander-hook.sh' }] }],
    };
    const { additions } = mergeHookEvents(prior);
    assert.deepEqual(additions, []);
  });

  test('user-added non-commander matcher is preserved alongside our entry', () => {
    const prior = {
      Stop: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: '/usr/local/bin/my-linter.sh' }] },
      ],
    };
    const { next, additions } = mergeHookEvents(prior) as {
      next: Record<string, Array<{ matcher: string; hooks: Array<{ command: string }> }>>;
      additions: string[];
    };
    assert.ok(additions.includes('Stop'));
    assert.equal(next.Stop!.length, 2);
    assert.equal(next.Stop![0]!.matcher, 'Bash');
    assert.equal(next.Stop![0]!.hooks[0]!.command, '/usr/local/bin/my-linter.sh');
    assert.equal(next.Stop![1]!.matcher, '*');
    assert.equal(next.Stop![1]!.hooks[0]!.command, '~/.claude/hooks/commander-hook.sh');
  });

  test('entryHasCommanderHook detects commander-hook.sh inside nested hooks arrays', () => {
    assert.equal(entryHasCommanderHook([]), false);
    assert.equal(entryHasCommanderHook(undefined), false);
    assert.equal(entryHasCommanderHook(null), false);
    assert.equal(
      entryHasCommanderHook([{ matcher: 'x', hooks: [{ type: 'command', command: '/bin/foo' }] }]),
      false,
    );
    assert.equal(
      entryHasCommanderHook([
        { matcher: 'x', hooks: [{ type: 'command', command: '/bin/foo' }] },
        { matcher: '*', hooks: [{ type: 'command', command: '/Users/me/.claude/hooks/commander-hook.sh' }] },
      ]),
      true,
    );
  });
});
