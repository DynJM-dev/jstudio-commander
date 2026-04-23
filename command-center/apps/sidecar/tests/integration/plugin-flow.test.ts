import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { rm } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { FastifyInstance } from 'fastify';
import type { SidecarConfig } from '../../src/config';
import { runMigrations } from '../../src/db/client';
import * as schema from '../../src/db/schema';
import { createServer } from '../../src/server';

const TEST_TOKEN = 'n2-integration-test-token-abcdef';

describe('plugin-flow integration', () => {
  let raw: Database;
  let server: FastifyInstance;
  let baseUrl: string;
  let wsUrl: string;
  const config: SidecarConfig = {
    bearerToken: TEST_TOKEN,
    port: 0,
    version: '0.1.0-n2-test',
    updatedAt: new Date().toISOString(),
  };

  beforeAll(async () => {
    // State isolation §3.4.2 — our fabricated SessionStart payload uses
    // `/tmp/test-project` as a synthetic cwd. Nuke any stale real dir left
    // by prior runs so `ensureProjectByCwd` takes the non-existent-cwd
    // fallback path (raw-cwd DB insert, no disk write) consistently.
    await rm('/tmp/test-project', { recursive: true, force: true });

    raw = new Database(':memory:');
    raw.exec('PRAGMA foreign_keys = ON;');
    runMigrations(raw);
    const db = drizzle(raw, { schema });
    server = createServer({ config, raw, db, logLevel: 'silent' });
    await server.listen({ port: 0, host: '127.0.0.1' });
    const addr = server.server.address();
    if (!addr || typeof addr === 'string') throw new Error('server.address() returned no port');
    baseUrl = `http://127.0.0.1:${addr.port}`;
    wsUrl = `ws://127.0.0.1:${addr.port}/ws`;
  });

  afterAll(async () => {
    await server.close();
    raw.close();
    // Clean up anything createWorktree may have materialized under the
    // synthetic cwd during spawn_agent_run tests.
    await rm('/tmp/test-project', { recursive: true, force: true });
  });

  // ---- Fabricated payloads ----
  // Claude Code 2.x hook payloads carry session_id, transcript_path, cwd,
  // hook_event_name, plus event-specific fields. We don't know the exact
  // wire shape for every event (and KB-P1.1's "store raw + de-dupe by uuid"
  // is specifically designed to survive shape drift), so we test the
  // pipeline's raw-passthrough behavior with a minimal realistic payload.

  const SESSION_ID = '11111111-2222-3333-4444-555555555555';
  const EVENT_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  const sessionStartPayload = {
    session_id: SESSION_ID,
    hook_event_name: 'SessionStart',
    transcript_path: '/tmp/fake.jsonl',
    cwd: '/tmp/test-project',
    uuid: EVENT_UUID,
    source: 'startup',
  };

  const preToolUsePayload = {
    session_id: SESSION_ID,
    hook_event_name: 'PreToolUse',
    cwd: '/tmp/test-project',
    uuid: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
    tool_name: 'Read',
    tool_input: { file_path: '/tmp/test-project/README.md' },
  };

  it('rejects unauthed POST to /hooks/session-start with 401', async () => {
    const res = await fetch(`${baseUrl}/hooks/session-start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sessionStartPayload),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; error?: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });

  it('accepts authed POST + persists raw payload exactly', async () => {
    const res = await fetch(`${baseUrl}/hooks/session-start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify(sessionStartPayload),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { continue: boolean };
    expect(body.continue).toBe(true);

    // DB assertion: exactly one row, raw payload byte-identical after JSON
    // round-trip.
    const rowId = `${SESSION_ID}:${EVENT_UUID}`;
    const row = raw
      .query<{ id: string; event_name: string; payload_json: string }, [string]>(
        'SELECT id, event_name, payload_json FROM hook_events WHERE id = ?',
      )
      .get(rowId);
    expect(row).not.toBeNull();
    expect(row?.event_name).toBe('SessionStart');
    // Drizzle json-mode stores as JSON.stringify; parse to compare.
    const persisted =
      typeof row?.payload_json === 'string' ? JSON.parse(row.payload_json) : row?.payload_json;
    expect(persisted).toEqual(sessionStartPayload);
  });

  it('de-dupes identical (session_id, event_uuid) tuple — second POST adds no row', async () => {
    // First insert already happened in the previous test. POST again.
    await fetch(`${baseUrl}/hooks/session-start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify(sessionStartPayload),
    });
    const rows = raw
      .query<{ n: number }, [string, string]>(
        'SELECT COUNT(*) as n FROM hook_events WHERE session_id = ? AND event_name = ?',
      )
      .get(SESSION_ID, 'SessionStart');
    expect(rows?.n).toBe(1);
  });

  it('auto-creates project + session on SessionStart', async () => {
    // Dual-form lookup (N4a.1): row may be at raw-cwd OR <cwd>/.commander.json
    // form depending on whether the synthetic cwd existed when ensureProjectByCwd
    // ran.
    const project = raw
      .query<{ id: string; name: string; identity_file_path: string }, [string, string]>(
        'SELECT id, name, identity_file_path FROM projects WHERE identity_file_path = ? OR identity_file_path = ?',
      )
      .get('/tmp/test-project', '/tmp/test-project/.commander.json');
    expect(project).not.toBeNull();
    expect(project?.name).toBe('test-project');

    const session = raw
      .query<{ id: string; status: string }, [string]>(
        'SELECT id, status FROM sessions WHERE id = ?',
      )
      .get(SESSION_ID);
    expect(session).not.toBeNull();
    // After SessionStart the pipeline updates status to 'initializing'.
    expect(session?.status).toBe('initializing');
  });

  it('PreToolUse returns allow envelope (N2 auto-allow per dispatch §2 T4)', async () => {
    const res = await fetch(`${baseUrl}/hooks/pre-tool-use`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify(preToolUsePayload),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      hookSpecificOutput?: {
        hookEventName?: string;
        permissionDecision?: string;
        permissionDecisionReason?: string;
      };
    };
    expect(body.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
    expect(body.hookSpecificOutput?.permissionDecision).toBe('allow');
    expect(body.hookSpecificOutput?.permissionDecisionReason).toContain('N2 pre-approval-UI');
  });

  it('WS subscriber receives typed event on hook:<session_id> topic', async () => {
    // Open WS, subscribe to hook:SESSION_ID, then POST a new hook event and
    // await the event on the socket.
    const NEW_EVENT_UUID = 'cccccccc-dddd-eeee-ffff-000000000000';
    const payload = {
      session_id: SESSION_ID,
      hook_event_name: 'UserPromptSubmit',
      cwd: '/tmp/test-project',
      uuid: NEW_EVENT_UUID,
      prompt: 'what files are here?',
    };

    // Bun's WebSocket follows WHATWG spec — no custom headers. Auth
    // middleware accepts ?access_token=<token> as a standard WS fallback.
    const ws = new WebSocket(`${wsUrl}?access_token=${TEST_TOKEN}`);

    const received: unknown[] = [];
    const opened = new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', (ev) => reject(new Error(`ws error: ${String(ev)}`)));
    });
    ws.addEventListener('message', (ev: MessageEvent) => {
      try {
        received.push(JSON.parse(String(ev.data)));
      } catch {
        // ignore
      }
    });
    await opened;

    ws.send(JSON.stringify({ kind: 'subscribe', topic: `hook:${SESSION_ID}` }));
    // Wait for subscribed ack
    await new Promise<void>((resolve) => {
      const check = () => {
        if (received.some((m) => (m as { kind?: string }).kind === 'subscribed')) resolve();
        else setTimeout(check, 5);
      };
      check();
    });

    // POST the event
    const postRes = await fetch(`${baseUrl}/hooks/user-prompt-submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });
    expect(postRes.status).toBe(200);

    // Wait for the event to reach the WS subscriber
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('ws event timeout')), 2_000);
      const check = () => {
        const hit = received.find(
          (m) =>
            (m as { kind?: string }).kind === 'event' &&
            (m as { topic?: string }).topic === `hook:${SESSION_ID}`,
        );
        if (hit) {
          clearTimeout(timeout);
          resolve();
        } else setTimeout(check, 10);
      };
      check();
    });

    const evt = received.find(
      (m) =>
        (m as { kind?: string }).kind === 'event' &&
        (m as { topic?: string }).topic === `hook:${SESSION_ID}`,
    ) as { data: { event_name: string; session_id: string; event_uuid: string } } | undefined;

    expect(evt).toBeDefined();
    expect(evt?.data.event_name).toBe('UserPromptSubmit');
    expect(evt?.data.session_id).toBe(SESSION_ID);
    expect(evt?.data.event_uuid).toBe(NEW_EVENT_UUID);

    ws.close();
  });

  it('MCP /mcp tools/list returns 10 CRUD tools', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      jsonrpc: string;
      result?: { tools?: Array<{ name: string }> };
    };
    expect(body.jsonrpc).toBe('2.0');
    expect(body.result?.tools).toHaveLength(10);
    const names = (body.result?.tools ?? []).map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'add_knowledge_entry',
        'cancel_agent_run',
        'create_task',
        'get_project',
        'get_session',
        'list_projects',
        'list_sessions',
        'list_tasks',
        'spawn_agent_run',
        'update_task',
      ].sort(),
    );
  });

  it('MCP tools/call list_projects returns the auto-created project', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'list_projects', arguments: {} },
        id: 2,
      }),
    });
    const body = (await res.json()) as {
      result?: { content?: Array<{ type: string; text: string }> };
    };
    const text = body.result?.content?.[0]?.text;
    expect(typeof text).toBe('string');
    const parsed = JSON.parse(text ?? '[]') as Array<{ name: string }>;
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    expect(parsed.some((p) => p.name === 'test-project')).toBe(true);
  });

  it('MCP unauthed GET /mcp/tools/list returns 401 (acceptance 2.5)', async () => {
    const res = await fetch(`${baseUrl}/mcp/tools/list`);
    expect(res.status).toBe(401);
  });

  it('MCP spawn_agent_run now really spawns (status=running) and completes', async () => {
    // N2 stub asserted status=queued. N3 replaces the stub with a real PTY
    // spawn (agent-run/lifecycle.ts). Return-value row shows status=running
    // with a real pty_pid; a short poll confirms transition to completed.
    const project = raw
      .query<{ id: string }, [string, string]>(
        'SELECT id FROM projects WHERE identity_file_path = ? OR identity_file_path = ?',
      )
      .get('/tmp/test-project', '/tmp/test-project/.commander.json');
    expect(project).not.toBeNull();

    const createTaskRes = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'create_task',
          arguments: {
            project_id: project?.id,
            title: 'N3 integration test task',
            instructions_md: 'no-op — exists for spawn test',
          },
        },
        id: 3,
      }),
    });
    const createTaskBody = (await createTaskRes.json()) as {
      result?: { content?: Array<{ text: string }> };
    };
    const task = JSON.parse(createTaskBody.result?.content?.[0]?.text ?? '{}') as { id: string };
    expect(typeof task.id).toBe('string');

    const spawnRes = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'spawn_agent_run',
          arguments: { task_id: task.id, command: 'echo integration-plugin-flow' },
        },
        id: 4,
      }),
    });
    const spawnBody = (await spawnRes.json()) as {
      result?: { content?: Array<{ text: string }> };
    };
    const run = JSON.parse(spawnBody.result?.content?.[0]?.text ?? '{}') as {
      id: string;
      status: string;
    };
    expect(run.status).toBe('running');

    // Wait for natural exit (echo is instant; give the FSM a few ticks).
    await new Promise((r) => setTimeout(r, 400));
    const finalRow = raw
      .query<{ status: string; exit_reason: string | null }, [string]>(
        'SELECT status, exit_reason FROM agent_runs WHERE id = ?',
      )
      .get(run.id);
    expect(finalRow?.status).toBe('completed');
    expect(finalRow?.exit_reason).toBe('exit-code-0');
  });
});
