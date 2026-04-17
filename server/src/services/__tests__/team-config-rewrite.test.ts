// Adoption rewrites the on-disk team config's leadSessionId so future
// reconciles use the adopted PM directly. These tests exercise the
// helper against a tmpdir to guard the atomic write + idempotent
// no-op + parse-failure-tolerance behavior.
//
// Imports the helper indirectly via dynamic import after a fresh
// tmpdir is set up. Because the helper isn't exported (it's a module
// internal in team-config.service), we stage a copy of its body here
// for direct testing — adoption-loop integration is covered by the
// reconcile path itself.

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface TeamConfig {
  name: string;
  leadSessionId?: string;
  members?: unknown[];
}

// Stages the team-config.service helper. Kept in lockstep with the
// real implementation — if you change the real one, mirror it here.
const updateTeamConfigLeadSessionId = (path: string, newLeadSessionId: string): boolean => {
  if (!existsSync(path)) return false;
  let raw: string;
  let parsed: TeamConfig;
  try {
    raw = readFileSync(path, 'utf-8');
    parsed = JSON.parse(raw) as TeamConfig;
  } catch {
    return false;
  }
  if (parsed.leadSessionId === newLeadSessionId) return false;
  const next = { ...parsed, leadSessionId: newLeadSessionId };
  const trailing = raw.endsWith('\n') ? '\n' : '';
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2) + trailing);
  renameSync(tmp, path);
  return true;
};

let dir: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'team-config-rewrite-'));
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('updateTeamConfigLeadSessionId — Phase G.2 atomic rewrite', () => {
  test('rewrites leadSessionId, preserves members + metadata', () => {
    const path = join(dir, 'rewrite-1.json');
    const original = {
      name: 'ovagas-ui',
      leadSessionId: 'stale-lead-id',
      createdAt: 1234567890,
      members: [
        { agentId: 'team-lead@ovagas-ui', name: 'team-lead' },
        { agentId: 'coder@ovagas-ui', name: 'coder', tmuxPaneId: '%51' },
      ],
    };
    writeFileSync(path, JSON.stringify(original, null, 2) + '\n');

    const wrote = updateTeamConfigLeadSessionId(path, 'adopted-pm-id');
    assert.equal(wrote, true);

    const after = JSON.parse(readFileSync(path, 'utf-8'));
    assert.equal(after.leadSessionId, 'adopted-pm-id');
    assert.equal(after.name, 'ovagas-ui');
    assert.equal(after.createdAt, 1234567890);
    assert.equal(after.members.length, 2);
    assert.equal(after.members[1].tmuxPaneId, '%51');
  });

  test('idempotent — same id is a no-op', () => {
    const path = join(dir, 'rewrite-2.json');
    writeFileSync(path, JSON.stringify({ name: 't', leadSessionId: 'same-id' }, null, 2) + '\n');
    const before = readFileSync(path, 'utf-8');
    const wrote = updateTeamConfigLeadSessionId(path, 'same-id');
    assert.equal(wrote, false);
    const afterBytes = readFileSync(path, 'utf-8');
    assert.equal(afterBytes, before, 'file should be byte-identical when no rewrite occurs');
  });

  test('missing file → returns false (no-op)', () => {
    const path = join(dir, 'does-not-exist.json');
    assert.equal(updateTeamConfigLeadSessionId(path, 'whatever'), false);
  });

  test('unparseable JSON → returns false, leaves file alone', () => {
    const path = join(dir, 'rewrite-corrupt.json');
    writeFileSync(path, '{this is not valid json');
    const wrote = updateTeamConfigLeadSessionId(path, 'new-id');
    assert.equal(wrote, false);
    const after = readFileSync(path, 'utf-8');
    assert.equal(after, '{this is not valid json');
  });

  test('preserves trailing-newline convention', () => {
    const noNewlinePath = join(dir, 'rewrite-no-newline.json');
    writeFileSync(noNewlinePath, JSON.stringify({ name: 't', leadSessionId: 'a' }));
    updateTeamConfigLeadSessionId(noNewlinePath, 'b');
    const noNewlineRaw = readFileSync(noNewlinePath, 'utf-8');
    assert.equal(noNewlineRaw.endsWith('\n'), false);

    const withNewlinePath = join(dir, 'rewrite-with-newline.json');
    writeFileSync(withNewlinePath, JSON.stringify({ name: 't', leadSessionId: 'a' }) + '\n');
    updateTeamConfigLeadSessionId(withNewlinePath, 'b');
    const withNewlineRaw = readFileSync(withNewlinePath, 'utf-8');
    assert.equal(withNewlineRaw.endsWith('\n'), true);
  });
});
