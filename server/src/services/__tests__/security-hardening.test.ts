import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve as resolvePath } from 'node:path';
import Database from 'better-sqlite3';
import { isLoopbackIp, isLoopbackHost, refuseBindWithoutPin } from '../../config.js';
import { isAllowedWsOrigin } from '../../ws/index.js';

// Phase P.1 — security hardening regression guards.
//
// Exercises the pure predicates extracted during C1/H1/H2. The middleware
// glue (pinAuthMiddleware) and Fastify route wiring are covered end-to-end
// by the live-server smoke in the PHASE_REPORT — unit tests here pin
// the logic that would otherwise drift silently if the config/middleware
// module is refactored later.

describe('C1 — ip-based loopback check replaces Host-header trust', () => {
  test('isLoopbackIp accepts every loopback representation, rejects anything else', () => {
    // Legitimate loopback forms emitted by node's socket layer on
    // macOS + Linux (IPv4, IPv6, IPv4-mapped IPv6).
    assert.equal(isLoopbackIp('127.0.0.1'), true);
    assert.equal(isLoopbackIp('::1'), true);
    assert.equal(isLoopbackIp('::ffff:127.0.0.1'), true);
    // LAN + arbitrary remote peers must NOT resolve as loopback.
    // Previous code consulted Host header → attacker could lie. Now
    // we use raw socket peer so these paths stay rejected.
    assert.equal(isLoopbackIp('192.168.1.42'), false);
    assert.equal(isLoopbackIp('10.0.0.5'), false);
    assert.equal(isLoopbackIp('8.8.8.8'), false);
    assert.equal(isLoopbackIp(undefined), false);
    assert.equal(isLoopbackIp(''), false);
    assert.equal(isLoopbackIp(null), false);
  });

  test('refuseBindWithoutPin returns true when non-loopback bind AND empty PIN', () => {
    // The dangerous combo: operator opts into LAN exposure via
    // bindHost/COMMANDER_HOST but forgot the PIN.
    assert.equal(refuseBindWithoutPin('0.0.0.0', ''), true);
    assert.equal(refuseBindWithoutPin('192.168.1.42', ''), true);
  });

  test('refuseBindWithoutPin stays false on loopback regardless of PIN', () => {
    // Loopback default is always safe — no PIN required.
    assert.equal(refuseBindWithoutPin('127.0.0.1', ''), false);
    assert.equal(refuseBindWithoutPin('localhost', ''), false);
    assert.equal(refuseBindWithoutPin('::1', ''), false);
  });

  test('refuseBindWithoutPin stays false when PIN is set on non-loopback', () => {
    // Non-loopback + PIN set = explicitly-configured LAN/tunnel mode.
    assert.equal(refuseBindWithoutPin('0.0.0.0', '1234'), false);
    assert.equal(refuseBindWithoutPin('192.168.1.42', 'long-pin-ok'), false);
  });

  test('isLoopbackHost is generous with string forms the operator might set', () => {
    assert.equal(isLoopbackHost('127.0.0.1'), true);
    assert.equal(isLoopbackHost('::1'), true);
    assert.equal(isLoopbackHost('localhost'), true);
    assert.equal(isLoopbackHost('0.0.0.0'), false);
  });
});

describe('H1 — json_each replaces vulnerable LIKE pattern in resolveOwner', () => {
  // Mirrors the post-patch SQL for the transcript_path matcher.
  const createSchema = (db: Database.Database) => {
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        transcript_paths TEXT
      );
    `);
  };

  const matchByTranscript = (db: Database.Database, needle: string): string | null => {
    const row = db.prepare(
      `SELECT s.id FROM sessions s, json_each(s.transcript_paths)
       WHERE s.transcript_paths IS NOT NULL
         AND json_each.value = ?
       LIMIT 1`,
    ).get(needle) as { id: string } | undefined;
    return row?.id ?? null;
  };

  test('exact transcript_path matches the owning session', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare("INSERT INTO sessions (id, transcript_paths) VALUES (?, ?)")
      .run('pm-1', JSON.stringify(['/Users/me/.claude/projects/x/real.jsonl']));
    assert.equal(matchByTranscript(db, '/Users/me/.claude/projects/x/real.jsonl'), 'pm-1');
    db.close();
  });

  test('attacker-supplied `%` wildcard does NOT match arbitrary rows (LIKE-sidestep)', () => {
    const db = new Database(':memory:');
    createSchema(db);
    db.prepare("INSERT INTO sessions (id, transcript_paths) VALUES (?, ?)")
      .run('victim', JSON.stringify(['/Users/victim/.claude/projects/x/transcript.jsonl']));
    // Pre-patch, this would LIKE-match the victim row via substring.
    // Post-patch (json_each exact compare), it matches nothing.
    assert.equal(matchByTranscript(db, '%'), null);
    assert.equal(matchByTranscript(db, '%.jsonl'), null);
    assert.equal(matchByTranscript(db, '_sers_victim_'), null);
    db.close();
  });
});

describe('H1 — transcript_path allowlist (path must live under ~/.claude/projects/)', () => {
  // Mirror of the isAllowedTranscriptPath predicate (resolvePath + dir
  // prefix startsWith). Defined inline so the test is immune to the
  // route module's side-effects at import time.
  const projectsDir = '/Users/me/.claude/projects';
  const check = (p: string): boolean => {
    if (!p || !p.endsWith('.jsonl')) return false;
    const dirPrefix = projectsDir.endsWith('/') ? projectsDir : projectsDir + '/';
    // Resolve relative components (..) so /projects/../etc/hosts.jsonl
    // can't sneak through.
    return resolvePath(p).startsWith(dirPrefix);
  };

  test('legitimate Claude projects path passes', () => {
    assert.equal(check('/Users/me/.claude/projects/my-app/abc.jsonl'), true);
  });

  test('/etc/hosts-style paths are rejected', () => {
    assert.equal(check('/etc/hosts'), false);
    assert.equal(check('/etc/hosts.jsonl'), false);
    assert.equal(check('/Users/victim/.ssh/config.jsonl'), false);
  });

  test('directory traversal attempt is rejected after path.resolve', () => {
    assert.equal(check('/Users/me/.claude/projects/../../../etc/hosts.jsonl'), false);
  });

  test('empty / non-jsonl / wrong extension is rejected', () => {
    assert.equal(check(''), false);
    assert.equal(check('/Users/me/.claude/projects/x/y.txt'), false);
  });
});

describe('H1/M5 — specific-watcher LRU cap', () => {
  // Mirror of the eviction strategy used in
  // fileWatcherService.watchSpecificFile. Close-on-evict is stubbed here
  // because the real path allocates an fs.watch FD.
  const CAP = 100;
  const makeBagWithEviction = () => {
    const bag = new Map<string, { closed: boolean }>();
    const add = (key: string) => {
      if (bag.has(key)) return;
      if (bag.size >= CAP) {
        const oldestKey = bag.keys().next().value;
        if (oldestKey !== undefined) {
          const v = bag.get(oldestKey);
          if (v) v.closed = true;
          bag.delete(oldestKey);
        }
      }
      bag.set(key, { closed: false });
    };
    return { bag, add };
  };

  test('101st unique add evicts the oldest entry and closes its watcher', () => {
    const { bag, add } = makeBagWithEviction();
    const markers: Array<{ closed: boolean }> = [];
    for (let i = 0; i < 100; i++) {
      const key = `/path/${i}.jsonl`;
      add(key);
      const v = bag.get(key);
      if (v) markers.push(v);
    }
    assert.equal(bag.size, 100);
    assert.equal(markers[0]!.closed, false);

    add('/path/100.jsonl');
    assert.equal(bag.size, 100);
    assert.equal(markers[0]!.closed, true); // oldest evicted + closed
    assert.equal(bag.has('/path/0.jsonl'), false);
    assert.equal(bag.has('/path/100.jsonl'), true);
  });

  test('re-adding an existing key is a no-op and does NOT evict', () => {
    const { bag, add } = makeBagWithEviction();
    for (let i = 0; i < 100; i++) add(`/path/${i}.jsonl`);
    add('/path/0.jsonl'); // already present
    assert.equal(bag.size, 100);
    assert.equal(bag.has('/path/0.jsonl'), true);
  });
});

describe('H2 — WebSocket Origin allowlist', () => {
  test('missing Origin (non-browser caller) is allowed — route + PIN guards still apply', () => {
    assert.equal(isAllowedWsOrigin(undefined), true);
    assert.equal(isAllowedWsOrigin(''), true);
    assert.equal(isAllowedWsOrigin(null), true);
  });

  test('known dev-time origins are accepted', () => {
    assert.equal(isAllowedWsOrigin('http://localhost:11573'), true);
    assert.equal(isAllowedWsOrigin('http://127.0.0.1:11573'), true);
    assert.equal(isAllowedWsOrigin('http://localhost:5173'), true);
  });

  test('cross-origin malicious pages are rejected', () => {
    assert.equal(isAllowedWsOrigin('https://evil.com'), false);
    assert.equal(isAllowedWsOrigin('http://attacker.example'), false);
    // Substring-ish attacks on the allowlist — strict equality fences
    // these out.
    assert.equal(isAllowedWsOrigin('http://localhost:11573.evil.com'), false);
    assert.equal(isAllowedWsOrigin('evil.com?http://localhost:11573'), false);
  });
});
