// Heartbeat smoke: server responds to ping frames with pong.
// Uses a real WebSocket round-trip through a bound server so the contract is
// exercised end-to-end, not unit-mocked.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDatabase } from '@jstudio-commander/db';
import WebSocket from 'ws';
import { EventBus } from './event-bus.js';
import { UnimplementedOrchestrator } from '../routes/sessions.js';
import { createServer, bindWithPortDiscovery } from '../server.js';

describe('ws heartbeat — ping → pong', () => {
  let tmpDir: string;
  let db: ReturnType<typeof initDatabase>;
  let app: ReturnType<typeof createServer>;
  let port: number;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ping-test-'));
    db = initDatabase({ dbPath: join(tmpDir, 'test.db') });
    app = createServer({ db, bus: new EventBus(), orchestrator: new UnimplementedOrchestrator() });
    port = await bindWithPortDiscovery(app, 12500, 12510);
  });

  afterEach(async () => {
    await app.close();
    db.raw.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('replies with pong within 500ms of receiving a ping', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    const received: unknown[] = [];
    ws.on('message', (data) => {
      try {
        received.push(JSON.parse(String(data)));
      } catch {
        /* ignore */
      }
    });

    ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));

    const started = Date.now();
    while (Date.now() - started < 1000) {
      if (received.some((f) => (f as { type?: string }).type === 'pong')) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const pong = received.find((f) => (f as { type?: string }).type === 'pong') as
      | { type: 'pong'; timestamp: number }
      | undefined;
    expect(pong).toBeTruthy();
    expect(pong!.timestamp).toBeGreaterThan(0);
    expect(Date.now() - started).toBeLessThan(500);

    ws.close();
    await new Promise((r) => setTimeout(r, 30));
  });

  it('ignores malformed frames without crashing the socket', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    ws.send('not-json-at-all');
    // Still responds to a subsequent valid ping.
    const received: unknown[] = [];
    ws.on('message', (data) => {
      try {
        received.push(JSON.parse(String(data)));
      } catch {
        /* ignore */
      }
    });
    ws.send(JSON.stringify({ type: 'ping' }));
    const started = Date.now();
    while (Date.now() - started < 1000) {
      if (received.some((f) => (f as { type?: string }).type === 'pong')) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(received.some((f) => (f as { type?: string }).type === 'pong')).toBe(true);
    ws.close();
    await new Promise((r) => setTimeout(r, 30));
  });
});
