import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '@commander/shared';

// Phase Y Rotation 1 — transcript-authoritative state derivation.
// Tests the pure `deriveToolExecutionState` derivation (the hook is a
// trivial useMemo wrapper around it) and the `[codeman-diff]` logger
// dedupe contract, without a React renderer. Matches the existing
// client test-harness posture (node:test + tsx, no jsdom) per dispatch
// §1.5 (rejection trigger (d): no new test harness).

import {
  deriveToolExecutionState,
  type ToolExecutionState,
} from '../../hooks/useToolExecutionState';
import { __codemanDiffTestSupport } from '../../hooks/useCodemanDiffLogger';

// ----- Fixture helpers --------------------------------------------------

let uidCounter = 0;
const uid = (): string => `msg-${++uidCounter}`;

const userMsg = (text: string): ChatMessage => ({
  id: uid(),
  parentId: null,
  role: 'user',
  timestamp: new Date().toISOString(),
  content: [{ type: 'text', text }],
  isSidechain: false,
});

const assistantWith = (...blocks: ChatMessage['content']): ChatMessage => ({
  id: uid(),
  parentId: null,
  role: 'assistant',
  timestamp: new Date().toISOString(),
  content: blocks,
  isSidechain: false,
});

const toolResult = (toolUseId: string): ChatMessage => ({
  id: uid(),
  parentId: null,
  role: 'user',
  timestamp: new Date().toISOString(),
  content: [{ type: 'tool_result', toolUseId, content: 'ok' }],
  isSidechain: false,
});

const systemMsg = (
  block:
    | { type: 'compact_boundary'; trigger: 'manual' | 'auto'; preTokens: number }
    | { type: 'compact_summary'; text: string },
): ChatMessage => ({
  id: uid(),
  parentId: null,
  role: 'system',
  timestamp: new Date().toISOString(),
  content: [block],
  isSidechain: false,
});

// ----- Test 1 — return-shape contract -----------------------------------

describe('Phase Y Rotation 1 — Test 1: return shape', () => {
  test('empty messages → idle state', () => {
    const s = deriveToolExecutionState([]);
    assert.deepEqual(s, {
      isWorking: false,
      currentTool: null,
      label: null,
      subtype: 'idle',
    } satisfies ToolExecutionState);
  });

  test('return object has all four required fields with correct types', () => {
    const s = deriveToolExecutionState([assistantWith({ type: 'text', text: 'hi' })]);
    assert.equal(typeof s.isWorking, 'boolean');
    assert.ok(
      s.currentTool === null
        || typeof s.currentTool === 'string'
        || Array.isArray(s.currentTool),
    );
    assert.ok(s.label === null || typeof s.label === 'string');
    assert.ok(['tool_exec', 'composing', 'compacting', 'idle'].includes(s.subtype));
  });
});

// ----- Test 2 — unmatched tool_use in tail → rich label -----------------

describe('Phase Y Rotation 1 — Test 2: unmatched tool_use → rich label', () => {
  test('Read → "Reading <basename>"', () => {
    const s = deriveToolExecutionState([
      userMsg('read the file'),
      assistantWith({
        type: 'tool_use',
        id: 'tu-1',
        name: 'Read',
        input: { file_path: '/abs/path/to/foo.ts' },
      }),
    ]);
    assert.equal(s.isWorking, true);
    assert.equal(s.currentTool, 'Read');
    assert.equal(s.label, 'Reading foo.ts');
    assert.equal(s.subtype, 'tool_exec');
  });

  test('Bash → "Running command"', () => {
    const s = deriveToolExecutionState([
      userMsg('run ls'),
      assistantWith({ type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'ls' } }),
    ]);
    assert.equal(s.label, 'Running command');
    assert.equal(s.currentTool, 'Bash');
  });

  test('Edit / MultiEdit → "Editing <basename>"', () => {
    const s = deriveToolExecutionState([
      assistantWith({
        type: 'tool_use',
        id: 'tu-1',
        name: 'Edit',
        input: { file_path: '/a/b/hook.ts' },
      }),
    ]);
    assert.equal(s.label, 'Editing hook.ts');
  });

  test('Task → "Spawning agent (<subtype>)" — sub-agent spawn path', () => {
    const s = deriveToolExecutionState([
      assistantWith({
        type: 'tool_use',
        id: 'tu-1',
        name: 'Task',
        input: { subagent_type: 'general-purpose', description: 'do X' },
      }),
    ]);
    assert.equal(s.subtype, 'tool_exec');
    assert.equal(s.currentTool, 'Task');
    assert.equal(s.label, 'Spawning agent (general-purpose)');
  });

  test('unknown tool → "Running <Name>" fallback (Issue 5 default-render)', () => {
    const s = deriveToolExecutionState([
      assistantWith({
        type: 'tool_use',
        id: 'tu-1',
        name: 'SomeFutureTool',
        input: {},
      }),
    ]);
    assert.equal(s.label, 'Running SomeFutureTool');
  });
});

// ----- Test 3 — matched tool_use + tool_result → idle -------------------

describe('Phase Y Rotation 1 — Test 3: matched tool pair → not working', () => {
  test('tool_use paired by id with tool_result → falls through to idle tail', () => {
    const s = deriveToolExecutionState([
      userMsg('read'),
      assistantWith({ type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/a.ts' } }),
      toolResult('tu-1'),
    ]);
    // Last message is a user tool_result — no text tail, no unmatched.
    assert.equal(s.isWorking, false);
    assert.equal(s.subtype, 'idle');
    assert.equal(s.label, null);
  });

  test('mixed — one matched, one unmatched → tool_exec on the unmatched', () => {
    const s = deriveToolExecutionState([
      assistantWith(
        { type: 'tool_use', id: 'tu-A', name: 'Read', input: { file_path: '/a.ts' } },
        { type: 'tool_use', id: 'tu-B', name: 'Bash', input: { command: 'ls' } },
      ),
      toolResult('tu-A'),
    ]);
    // Only tu-B unmatched → single-tool rich label.
    assert.equal(s.subtype, 'tool_exec');
    assert.equal(s.currentTool, 'Bash');
    assert.equal(s.label, 'Running command');
  });
});

// ----- Test 4 — composing subtype (Rotation 1.5 Fix C — stability-gated)

describe('Phase Y Rotation 1.5 — Test 4: composing gated on streamingAssistantId', () => {
  test('text tail + streamingAssistantId matches → composing (real streaming case)', () => {
    const userM = userMsg('hello');
    const assistantM = assistantWith({ type: 'text', text: 'Working on it...' });
    const s = deriveToolExecutionState([userM, assistantM], 8, assistantM.id);
    assert.equal(s.isWorking, true);
    assert.equal(s.subtype, 'composing');
    assert.equal(s.label, 'Composing response...');
    assert.equal(s.currentTool, null);
  });

  test('text tail + streamingAssistantId=null (settled) → idle (Class 1 closure)', () => {
    const s = deriveToolExecutionState(
      [userMsg('hello'), assistantWith({ type: 'text', text: 'Working on it...' })],
      8,
      null,
    );
    assert.equal(s.isWorking, false);
    assert.equal(s.subtype, 'idle');
    assert.equal(s.label, null);
  });

  test('text tail + streamingAssistantId points to OLDER message → idle (stale id guard)', () => {
    const older = assistantWith({ type: 'text', text: 'prior turn' });
    const current = assistantWith({ type: 'text', text: 'this turn' });
    const s = deriveToolExecutionState(
      [userMsg('msg-1'), older, userMsg('msg-2'), current],
      8,
      older.id, // stale — user already moved past `older`
    );
    assert.equal(s.subtype, 'idle');
  });

  test('default streamingAssistantId (omitted) → idle on text tail (non-regression on pre-1.5 callers)', () => {
    const s = deriveToolExecutionState([
      userMsg('hello'),
      assistantWith({ type: 'text', text: 'done.' }),
    ]);
    // No streamingAssistantId → settled by default. Ensures tests or
    // callers that don't pass the signal get the safe, non-sticky path.
    assert.equal(s.subtype, 'idle');
  });

  test('assistant with unmatched tool + text tail → tool_exec wins over composing (derivation order)', () => {
    const s = deriveToolExecutionState([
      assistantWith(
        { type: 'text', text: 'reading a file...' },
        { type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/x.ts' } },
      ),
    ]);
    // Last block is tool_use, not text → composing not eligible anyway;
    // unmatched tool_use catches it first.
    assert.equal(s.subtype, 'tool_exec');
  });
});

// ----- Test 5 — /compact detection --------------------------------------

describe('Phase Y Rotation 1 — Test 5: compacting subtype', () => {
  test('compact_boundary without subsequent compact_summary → compacting', () => {
    const s = deriveToolExecutionState([
      userMsg('/compact'),
      systemMsg({ type: 'compact_boundary', trigger: 'manual', preTokens: 12345 }),
    ]);
    assert.equal(s.isWorking, true);
    assert.equal(s.subtype, 'compacting');
    assert.equal(s.label, 'Compacting context...');
  });

  test('compact_boundary followed by compact_summary → no longer compacting', () => {
    const s = deriveToolExecutionState([
      userMsg('/compact'),
      systemMsg({ type: 'compact_boundary', trigger: 'manual', preTokens: 12345 }),
      systemMsg({ type: 'compact_summary', text: 'Summary...' }),
    ]);
    assert.notEqual(s.subtype, 'compacting');
  });

  test('compact overrides tool_exec — derivation order (1) compact > (2) tool_exec', () => {
    const s = deriveToolExecutionState([
      assistantWith({ type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'ls' } }),
      systemMsg({ type: 'compact_boundary', trigger: 'auto', preTokens: 99999 }),
    ]);
    assert.equal(s.subtype, 'compacting');
  });
});

// ----- Test 6 — parallel tool_use (Candidate b — ratified) --------------

describe('Phase Y Rotation 1 — Test 6: parallel tool_use synthetic label', () => {
  test('5 parallel TaskCreate → "Running 5 tools (TaskCreate×5)"', () => {
    const s = deriveToolExecutionState([
      assistantWith(
        { type: 'tool_use', id: 't1', name: 'TaskCreate', input: { subject: 'A' } },
        { type: 'tool_use', id: 't2', name: 'TaskCreate', input: { subject: 'B' } },
        { type: 'tool_use', id: 't3', name: 'TaskCreate', input: { subject: 'C' } },
        { type: 'tool_use', id: 't4', name: 'TaskCreate', input: { subject: 'D' } },
        { type: 'tool_use', id: 't5', name: 'TaskCreate', input: { subject: 'E' } },
      ),
    ]);
    assert.equal(s.subtype, 'tool_exec');
    assert.ok(Array.isArray(s.currentTool));
    assert.equal((s.currentTool as string[]).length, 5);
    assert.equal(s.label, 'Running 5 tools (TaskCreate×5)');
  });

  test('mixed Read + Grep + Bash parallel → caps at 2 distinct names + "…" suffix', () => {
    const s = deriveToolExecutionState([
      assistantWith(
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a' } },
        { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/b' } },
        { type: 'tool_use', id: 't3', name: 'Grep', input: { pattern: 'x' } },
        { type: 'tool_use', id: 't4', name: 'Bash', input: { command: 'ls' } },
      ),
    ]);
    assert.equal(s.subtype, 'tool_exec');
    assert.equal(s.label, 'Running 4 tools (Read×2, Grep, …)');
  });

  test('2 parallel Tasks → "Running 2 tools (Task×2)" (sub-agent fan-out)', () => {
    const s = deriveToolExecutionState([
      assistantWith(
        { type: 'tool_use', id: 't1', name: 'Task', input: { subagent_type: 'general-purpose' } },
        { type: 'tool_use', id: 't2', name: 'Task', input: { subagent_type: 'Explore' } },
      ),
    ]);
    assert.equal(s.label, 'Running 2 tools (Task×2)');
    assert.deepEqual(s.currentTool, ['Task', 'Task']);
  });
});

// ----- Test 7 — [codeman-diff] logger dedupe + emit contract ------------

describe('Phase Y Rotation 1 — Test 7: [codeman-diff] logger shape + dedupe', () => {
  beforeEach(() => __codemanDiffTestSupport.reset());

  test('first emission for a session → fires', () => {
    const fired = __codemanDiffTestSupport.tryEmitForTest({
      sessionId: 'sess-A',
      codemanIsWorking: true,
      codemanLabel: 'Running command',
      codemanSubtype: 'tool_exec',
      legacyIsWorking: false,
      legacyLabel: null,
      sessionStatus: 'idle',
      sessionStateKind: 'Idle',
    });
    assert.equal(fired, true);
  });

  test('identical signature on second call → dedupe suppresses', () => {
    const payload = {
      sessionId: 'sess-A',
      codemanIsWorking: true,
      codemanLabel: 'Reading foo.ts',
      codemanSubtype: 'tool_exec' as const,
      legacyIsWorking: true,
      legacyLabel: 'Reading foo.ts',
      sessionStatus: 'working',
      sessionStateKind: 'Working' as const,
    };
    assert.equal(__codemanDiffTestSupport.tryEmitForTest(payload), true);
    assert.equal(__codemanDiffTestSupport.tryEmitForTest(payload), false);
  });

  test('label change → fires again', () => {
    const base = {
      sessionId: 'sess-A',
      codemanIsWorking: true,
      codemanSubtype: 'tool_exec' as const,
      legacyIsWorking: true,
      sessionStatus: 'working',
      sessionStateKind: 'Working' as const,
    };
    __codemanDiffTestSupport.tryEmitForTest({
      ...base,
      codemanLabel: 'Reading a.ts',
      legacyLabel: 'Reading a.ts',
    });
    const fired = __codemanDiffTestSupport.tryEmitForTest({
      ...base,
      codemanLabel: 'Editing b.ts',
      legacyLabel: 'Editing b.ts',
    });
    assert.equal(fired, true);
  });

  test('different sessions dedupe independently', () => {
    const make = (sessionId: string) => ({
      sessionId,
      codemanIsWorking: true,
      codemanLabel: 'X',
      codemanSubtype: 'tool_exec' as const,
      legacyIsWorking: false,
      legacyLabel: null,
      sessionStatus: 'idle',
      sessionStateKind: 'Idle' as const,
    });
    assert.equal(__codemanDiffTestSupport.tryEmitForTest(make('sess-A')), true);
    assert.equal(__codemanDiffTestSupport.tryEmitForTest(make('sess-B')), true);
    assert.equal(__codemanDiffTestSupport.tryEmitForTest(make('sess-A')), false);
  });
});

// ----- Test 8 — per-session isolation (function-level) ------------------

describe('Phase Y Rotation 1 — Test 8: per-session isolation (function-level)', () => {
  test('two sessions with different messages derive independently', () => {
    const msgsA: ChatMessage[] = [
      assistantWith({ type: 'tool_use', id: 'a1', name: 'Bash', input: { command: 'ls' } }),
    ];
    const msgsB: ChatMessage[] = [
      assistantWith({ type: 'text', text: 'idle reply' }),
      userMsg('next'),
    ];
    const sA = deriveToolExecutionState(msgsA);
    const sB = deriveToolExecutionState(msgsB);
    assert.equal(sA.isWorking, true);
    assert.equal(sA.subtype, 'tool_exec');
    assert.equal(sB.isWorking, false);
    assert.equal(sB.subtype, 'idle');
  });

  test('order-invariance: deriving A then B vs B then A yields identical outputs', () => {
    const msgsA: ChatMessage[] = [
      assistantWith({ type: 'tool_use', id: 'a1', name: 'Read', input: { file_path: '/a' } }),
    ];
    const msgsB: ChatMessage[] = [
      assistantWith({ type: 'tool_use', id: 'b1', name: 'Grep', input: { pattern: 'x' } }),
    ];
    const forwardA = deriveToolExecutionState(msgsA);
    const forwardB = deriveToolExecutionState(msgsB);
    const reverseB = deriveToolExecutionState(msgsB);
    const reverseA = deriveToolExecutionState(msgsA);
    assert.deepEqual(forwardA, reverseA);
    assert.deepEqual(forwardB, reverseB);
  });
});

// ----- Test 8b — per-session isolation (React-tree substitute) ----------
//
// Dispatch §1.6 Test 8b (CTO Amendment 3) asks for React-tree rendering
// with different sessionIds. The existing client harness has no jsdom /
// RTL (dispatch §1.5 rejection trigger (d): no new test harness in a
// hotfix-adjacent rotation). Structural substitute per dispatch:
// "verify the hook uses no module-level state per-key."
//
// Verified STRUCTURALLY by construction:
//   - `deriveToolExecutionState` closes over no module-scope
//     Maps/Sets/vars — it reads `messages` and returns. This test
//     asserts pure function-ness via three contract checks.
//   - `useToolExecutionState` is a thin `useMemo` over the pure
//     derivation; no useRef carrying cross-session caches.

describe('Phase Y Rotation 1 — Test 8b: per-session isolation (structural)', () => {
  test('derivation is pure — same input → same output, no memo state across calls', () => {
    const msgs: ChatMessage[] = [
      assistantWith({ type: 'tool_use', id: 'x', name: 'Bash', input: { command: 'ls' } }),
    ];
    const s1 = deriveToolExecutionState(msgs);
    // Interleave with a different session's derivation.
    deriveToolExecutionState([
      assistantWith({ type: 'text', text: 'B composing' }),
      userMsg('latest'),
    ]);
    const s2 = deriveToolExecutionState(msgs);
    assert.deepEqual(s1, s2, 'session A derivation is not contaminated by session B call');
  });

  test('returns a fresh object for non-idle paths — no shared-identity leakage', () => {
    // Use a tool_exec fixture so the derivation constructs a fresh
    // object per call. Idle paths deliberately return the shared
    // IDLE_STATE module constant (zero-alloc hot path), so the
    // "distinct references" invariant only applies to non-idle.
    const msgs: ChatMessage[] = [
      assistantWith({ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }),
    ];
    const s1 = deriveToolExecutionState(msgs);
    const s2 = deriveToolExecutionState(msgs);
    assert.deepEqual(s1, s2);
    assert.notStrictEqual(s1, s2, 'distinct object references per non-idle call');
  });

  test('different sessionIds with different messages: zero cross-talk', () => {
    // Simulate two hook instances by calling the pure derivation with
    // two different inputs in interleaved order — exactly what two
    // React-tree hooks with different sessionIds would do.
    const msgsA: ChatMessage[] = [
      assistantWith({ type: 'tool_use', id: 'a1', name: 'Read', input: { file_path: '/A' } }),
    ];
    const msgsB: ChatMessage[] = [
      assistantWith({ type: 'tool_use', id: 'b1', name: 'Write', input: { file_path: '/B' } }),
    ];
    const snapshots: Array<{ who: string; s: ToolExecutionState }> = [];
    for (let i = 0; i < 5; i++) {
      snapshots.push({ who: 'A', s: deriveToolExecutionState(msgsA) });
      snapshots.push({ who: 'B', s: deriveToolExecutionState(msgsB) });
    }
    for (const { who, s } of snapshots) {
      if (who === 'A') assert.equal(s.label, 'Reading A');
      else assert.equal(s.label, 'Writing B');
    }
  });
});

// ----- Test 9 — non-regression: hook does not touch usePromptDetection --

describe('Phase Y Rotation 1 — Test 9: Item 3 approval path non-regression (structural)', () => {
  test('useToolExecutionState source file has no reference to usePromptDetection', async () => {
    const fs = await import('node:fs/promises');
    const url = await import('node:url');
    // Resolve the hook file path from this test's location via URL tricks
    // (works under node:test + tsx without __dirname).
    const here = url.fileURLToPath(import.meta.url);
    const path = here.replace(
      /client\/src\/utils\/__tests__\/phase-y-tool-execution-state\.test\.ts$/,
      'client/src/hooks/useToolExecutionState.ts',
    );
    const src = await fs.readFile(path, 'utf8');
    assert.ok(
      !src.includes('usePromptDetection'),
      'Phase Y hook must not couple to Item 3 approval path',
    );
    assert.ok(
      !src.includes('ProjectStateDrawer'),
      'Phase Y hook must not couple to M7 drawer',
    );
    assert.ok(
      !src.includes('SessionCard'),
      'Phase Y hook must not couple to M8 effort UI',
    );
    assert.ok(
      !src.includes('TmuxMirror') && !src.includes('usePreference') && !src.includes('status-poller'),
      'Phase Y hook must not couple to Phase T mirror or its deps',
    );
  });
});
