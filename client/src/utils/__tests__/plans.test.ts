import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatMessage } from '@commander/shared';
import {
  buildPlanFromMessages,
  buildToolResultMap,
  getActivePlan,
} from '../plans.js';
import { parseFixture } from './parseFixture.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(__dirname, 'fixtures', name);

const build = (path: string) => {
  const messages = parseFixture(path);
  const toolResults = buildToolResultMap(messages);
  return { messages, ...buildPlanFromMessages(messages, toolResults) };
};

describe('buildPlanFromMessages', () => {
  test('empty message array → no plan', () => {
    const plan = buildPlanFromMessages([], new Map());
    assert.equal(plan.plan.length, 0);
    assert.equal(plan.firstCreateMessageId, null);
    assert.equal(plan.allDone, false);
  });

  test('simple plan → tasks extracted with correct final statuses', () => {
    const result = build(fixture('plan-simple.jsonl'));
    assert.ok(result.plan.length > 0, 'expected at least one task');
    for (const t of result.plan) {
      assert.ok(['pending', 'in_progress', 'completed', 'need_help', 'failed'].includes(t.status), `unknown status ${t.status}`);
      assert.ok(t.id.length > 0, 'task missing id');
      assert.ok(t.title.length > 0, 'task missing title');
    }
    assert.ok(result.firstCreateMessageId, 'plan should anchor to a message id');
  });

  test('cross-group plan — TaskCreates + TaskUpdates across assistant groups resolve', () => {
    // The GrandGaming counting session splits the plan across groups via user
    // "Proceed" messages. If the walker regressed to per-group logic the
    // TaskUpdate branches would have nothing to update and every task would
    // stay 'pending'.
    const result = build(fixture('plan-cross-group.jsonl'));
    const byStatus = new Map<string, number>();
    for (const t of result.plan) byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);
    const completed = byStatus.get('completed') ?? 0;
    const pending = byStatus.get('pending') ?? 0;
    assert.ok(
      completed > 0,
      `expected at least one completed task after cross-group walk, got statuses=${JSON.stringify([...byStatus])}`,
    );
    // The old per-group behavior produced only-pending plans — assert we
    // don't regress to that signature.
    assert.ok(
      completed + (byStatus.get('in_progress') ?? 0) + (byStatus.get('failed') ?? 0) > 0,
      'all tasks are pending — cross-group walker regressed',
    );
    assert.equal(pending + completed + (byStatus.get('in_progress') ?? 0), result.plan.length);
  });

  test("'deleted' TaskUpdate status removes task without crashing", () => {
    // Fixture contains at least one TaskUpdate with status='deleted' (found
    // in real elementti-ERP session). The pipeline must treat it as a
    // removal rather than a status change — and must not crash on the
    // unknown enum value (pre-fix this hit STATUS_CONFIG[x].color undefined).
    const result = build(fixture('plan-with-deleted.jsonl'));
    for (const t of result.plan) {
      assert.notEqual(t.status, 'deleted', `task ${t.id} leaked a 'deleted' status`);
    }
    // Run the full extraction pipeline to ensure defensive STATUS_CONFIG
    // lookups in the renderers would have survived too.
    assert.doesNotThrow(() => getActivePlan(parseFixture(fixture('plan-with-deleted.jsonl'))));
  });

  test('new plan in a later group supersedes the earlier one', () => {
    // Synthetic — two TaskCreates + their completions in assistant group A,
    // then a user message, then a NEW TaskCreate in assistant group B. The
    // later group defines the current plan (Phase H recency rule).
    const tr = new Map<string, { content: string; isError?: boolean }>();
    tr.set('u1', { content: 'Task #1 created successfully: alpha' });
    tr.set('u2', { content: 'Task #2 created successfully: beta' });
    tr.set('u3', { content: 'Task #3 created successfully: gamma' });

    const msgs: ChatMessage[] = [
      {
        id: 'm1', role: 'assistant', parentId: null, timestamp: '', isSidechain: false,
        content: [
          { type: 'tool_use', id: 'u1', name: 'TaskCreate', input: { subject: 'alpha' } },
          { type: 'tool_use', id: 'u2', name: 'TaskCreate', input: { subject: 'beta' } },
          { type: 'tool_use', id: 'x1', name: 'TaskUpdate', input: { taskId: '1', status: 'completed' } },
          { type: 'tool_use', id: 'x2', name: 'TaskUpdate', input: { taskId: '2', status: 'completed' } },
        ],
      },
      {
        id: 'u-proceed', role: 'user', parentId: null, timestamp: '', isSidechain: false,
        content: [{ type: 'text', text: 'next phase' }],
      },
      {
        id: 'm2', role: 'assistant', parentId: null, timestamp: '', isSidechain: false,
        content: [
          { type: 'tool_use', id: 'u3', name: 'TaskCreate', input: { subject: 'gamma' } },
        ],
      },
    ];

    const result = buildPlanFromMessages(msgs, tr);
    assert.equal(result.plan.length, 1, 'should have reset to the new single-task plan');
    assert.equal(result.plan[0]!.id, '3');
    assert.equal(result.plan[0]!.title, 'gamma');
    assert.equal(result.firstCreateMessageId, 'm2');
    assert.equal(result.allDone, false);
  });

  test('multiple TaskCreates in the same group merge into one plan', () => {
    // Per Phase H spec: "Multiple TaskCreate bundles in the SAME assistant
    // group → treat as one plan (build from all of them)".
    const tr = new Map<string, { content: string; isError?: boolean }>();
    tr.set('u1', { content: 'Task #1 created successfully: alpha' });
    tr.set('u2', { content: 'Task #2 created successfully: beta' });

    const msgs: ChatMessage[] = [
      {
        id: 'm1', role: 'assistant', parentId: null, timestamp: '', isSidechain: false,
        content: [{ type: 'tool_use', id: 'u1', name: 'TaskCreate', input: { subject: 'alpha' } }],
      },
      {
        id: 'm2', role: 'assistant', parentId: null, timestamp: '', isSidechain: false,
        content: [{ type: 'tool_use', id: 'u2', name: 'TaskCreate', input: { subject: 'beta' } }],
      },
    ];

    const result = buildPlanFromMessages(msgs, tr);
    assert.equal(result.plan.length, 2, 'consecutive assistant msgs = same group = merged plan');
    assert.deepEqual(result.plan.map((t) => t.title).sort(), ['alpha', 'beta']);
    assert.equal(result.firstCreateMessageId, 'm1');
  });

  test('latest plan with all tasks completed still returns (widget can fade)', () => {
    // Per Phase H spec: "Latest plan has all tasks completed → still returns
    // it (so widget can show+fade correctly)".
    const tr = new Map<string, { content: string; isError?: boolean }>();
    tr.set('u1', { content: 'Task #1 created successfully: alpha' });

    const msgs: ChatMessage[] = [
      {
        id: 'm1', role: 'assistant', parentId: null, timestamp: '', isSidechain: false,
        content: [
          { type: 'tool_use', id: 'u1', name: 'TaskCreate', input: { subject: 'alpha' } },
          { type: 'tool_use', id: 'x1', name: 'TaskUpdate', input: { taskId: '1', status: 'completed' } },
        ],
      },
    ];

    const result = buildPlanFromMessages(msgs, tr);
    assert.equal(result.plan.length, 1);
    assert.equal(result.plan[0]!.status, 'completed');
    assert.equal(result.allDone, true);
    assert.equal(result.firstCreateMessageId, 'm1');
  });

  test('TaskUpdates in groups AFTER the latest-create group still apply', () => {
    // Recency is set by the TaskCreate group; later groups' TaskUpdates on
    // those ids continue to resolve. Mirrors the real cross-group flow where
    // Claude completes tasks over several "Proceed" cycles.
    const tr = new Map<string, { content: string; isError?: boolean }>();
    tr.set('u1', { content: 'Task #1 created successfully: alpha' });

    const msgs: ChatMessage[] = [
      {
        id: 'm1', role: 'assistant', parentId: null, timestamp: '', isSidechain: false,
        content: [{ type: 'tool_use', id: 'u1', name: 'TaskCreate', input: { subject: 'alpha' } }],
      },
      {
        id: 'u-proceed', role: 'user', parentId: null, timestamp: '', isSidechain: false,
        content: [{ type: 'text', text: 'continue' }],
      },
      {
        id: 'm2', role: 'assistant', parentId: null, timestamp: '', isSidechain: false,
        content: [
          { type: 'tool_use', id: 'x1', name: 'TaskUpdate', input: { taskId: '1', status: 'completed' } },
        ],
      },
    ];

    const result = buildPlanFromMessages(msgs, tr);
    assert.equal(result.plan.length, 1);
    assert.equal(result.plan[0]!.status, 'completed');
    assert.equal(result.firstCreateMessageId, 'm1', 'anchor stays at the TaskCreate group');
  });

  test('TaskCreate without tool_result is skipped (unresolved id)', () => {
    const msgs: ChatMessage[] = [
      {
        id: 'm1', role: 'assistant', parentId: null, timestamp: '', isSidechain: false,
        content: [
          { type: 'tool_use', id: 'u-missing', name: 'TaskCreate', input: { subject: 'orphan' } },
        ],
      },
    ];
    const result = buildPlanFromMessages(msgs, new Map());
    assert.equal(result.plan.length, 0);
    assert.equal(result.firstCreateMessageId, null);
  });
});
