import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  jsonlParserService,
  hasUnmatchedToolUseInLines,
  hasPendingToolUseInTranscript,
} from '../jsonl-parser.service.js';

// Chat-fidelity regression — the attachment-record discriminator.
//
// Context: the JSONL shape written by Claude Code for an attachment
// record carries the discriminator on `record.attachment.type`, NOT on
// `record.subtype`. The original Phase-L implementation read
// `record.subtype`, which is absent on every real attachment record in
// the wild — so the `edited_text_file` branch never fired and every
// attachment silently dropped out of chat while still being visible on
// the pane.
//
// The narrow fix is discriminator-only: read from `record.attachment?.type`.
// We also surface `task_reminder` (the `<system-reminder>` shape Claude
// is fed at runtime) as a system_note so the chat shows the same hint
// the pane shows the model.

describe('jsonlParserService — attachment discriminator (chat/terminal fidelity)', () => {
  test('edited_text_file (top-level filePath, no snippet) falls back to top-level filename', () => {
    // Issue 7.1 — older shape the tests originally pinned: top-level
    // `record.filePath` rather than inner `attachment.filename`. Parser
    // tolerates both. `filename` populates from whichever source is
    // present; snippet absent is fine (expand-on-click just disables).
    const record = {
      type: 'attachment',
      uuid: 'a1',
      parentUuid: null,
      timestamp: '2026-04-17T05:26:17.746Z',
      attachment: { type: 'edited_text_file' },
      filePath: '/Users/x/src/foo.ts',
    };
    const parsed = jsonlParserService.parseRecord(record as never);
    assert.ok(parsed, 'edited_text_file must parse into a ChatMessage');
    assert.equal(parsed!.role, 'system');
    const block = parsed!.content[0]!;
    assert.equal(block.type, 'file_edit_note');
    if (block.type === 'file_edit_note') {
      assert.equal(block.filename, '/Users/x/src/foo.ts');
      assert.equal(block.snippet, undefined);
    }
  });

  test('task_reminder attachment surfaces as an inline_reminder block (Issue 7 P1)', () => {
    // Issue 7 typed renderer: task_reminder now emits `inline_reminder`
    // so the UI can style it as a muted footnote attached to the
    // preceding user turn instead of a separator banner.
    const record = {
      type: 'attachment',
      uuid: 'a2',
      parentUuid: null,
      timestamp: '2026-04-17T05:26:17.746Z',
      attachment: {
        type: 'task_reminder',
        content:
          'Reminder: the TaskCreate tool has not been used. Consider tracking work.',
      },
    };
    const parsed = jsonlParserService.parseRecord(record as never);
    assert.ok(parsed, 'task_reminder must parse into a ChatMessage');
    assert.equal(parsed!.role, 'system');
    const block = parsed!.content[0]!;
    assert.equal(block.type, 'inline_reminder');
    if (block.type === 'inline_reminder') {
      assert.match(block.text, /TaskCreate/);
    }
  });

  test('file attachment surfaces as file_attachment block with preview metadata (Issue 7 P1)', () => {
    const record = {
      type: 'attachment',
      uuid: 'a6',
      parentUuid: null,
      timestamp: '2026-04-17T05:26:17.746Z',
      attachment: {
        type: 'file',
        filename: '/Users/x/project/STATE.md',
        displayPath: 'STATE.md',
        content: {
          type: 'file',
          file: {
            filePath: '/Users/x/project/STATE.md',
            content: '# State\n\nline1\nline2\n',
            numLines: '4',
            startLine: '1',
            totalLines: '120',
          },
        },
      },
    };
    const parsed = jsonlParserService.parseRecord(record as never);
    assert.ok(parsed, 'file must parse into a ChatMessage');
    const block = parsed!.content[0]!;
    assert.equal(block.type, 'file_attachment');
    if (block.type === 'file_attachment') {
      assert.equal(block.displayPath, 'STATE.md');
      assert.equal(block.filename, '/Users/x/project/STATE.md');
      // numLines/totalLines come through as numbers even when JSONL
      // stores them as strings (they're rendered in a counter).
      assert.equal(block.numLines, 4);
      assert.equal(block.totalLines, 120);
      assert.match(block.content ?? '', /# State/);
    }
  });

  test('edited_text_file surfaces as typed file_edit_note (Issue 7.1 upgrade)', () => {
    const record = {
      type: 'attachment',
      uuid: 'a8',
      parentUuid: null,
      timestamp: '2026-04-17T05:26:17.746Z',
      attachment: {
        type: 'edited_text_file',
        filename: '/Users/x/proj/foo.ts',
        snippet: '1\texport const foo = 1;\n2\texport const bar = 2;\n',
      },
    };
    const parsed = jsonlParserService.parseRecord(record as never);
    assert.ok(parsed);
    const block = parsed!.content[0]!;
    assert.equal(block.type, 'file_edit_note');
    if (block.type === 'file_edit_note') {
      assert.equal(block.filename, '/Users/x/proj/foo.ts');
      assert.match(block.snippet ?? '', /export const foo/);
    }
  });

  test('skill_listing surfaces as typed skill_listing block, content parsed (Issue 7.1)', () => {
    const record = {
      type: 'attachment',
      uuid: 'a9',
      parentUuid: null,
      timestamp: '2026-04-17T05:26:17.746Z',
      attachment: {
        type: 'skill_listing',
        isInitial: true,
        skillCount: 3,
        content: '- pm: Project manager skill.\n- db-architect: Schema expert.\n- ui-expert',
      },
    };
    const parsed = jsonlParserService.parseRecord(record as never);
    assert.ok(parsed);
    const block = parsed!.content[0]!;
    assert.equal(block.type, 'skill_listing');
    if (block.type === 'skill_listing') {
      assert.equal(block.isInitial, true);
      assert.equal(block.skills.length, 3);
      assert.equal(block.skills[0]!.name, 'pm');
      assert.match(block.skills[0]!.description ?? '', /Project manager/);
      assert.equal(block.skills[2]!.name, 'ui-expert');
      // name-only line → description absent, not empty
      assert.equal(block.skills[2]!.description, undefined);
    }
  });

  test('invoked_skills surfaces as typed invoked_skills block (Issue 7.1)', () => {
    const record = {
      type: 'attachment',
      uuid: 'a10',
      parentUuid: null,
      timestamp: '2026-04-17T05:26:17.746Z',
      attachment: {
        type: 'invoked_skills',
        skills: [
          { name: 'ui-expert', path: 'userSettings:ui-expert', content: 'long body...' },
          { name: 'qa', path: 'userSettings:qa' },
        ],
      },
    };
    const parsed = jsonlParserService.parseRecord(record as never);
    assert.ok(parsed);
    const block = parsed!.content[0]!;
    assert.equal(block.type, 'invoked_skills');
    if (block.type === 'invoked_skills') {
      assert.equal(block.skills.length, 2);
      assert.equal(block.skills[0]!.name, 'ui-expert');
      assert.equal(block.skills[0]!.path, 'userSettings:ui-expert');
    }
  });

  test('queued_command surfaces as typed queued_command block (Issue 7.1)', () => {
    const record = {
      type: 'attachment',
      uuid: 'a11',
      parentUuid: null,
      timestamp: '2026-04-17T05:26:17.746Z',
      attachment: {
        type: 'queued_command',
        prompt: 'I have a vercel account, do I need to login?',
        commandMode: 'prompt',
      },
    };
    const parsed = jsonlParserService.parseRecord(record as never);
    assert.ok(parsed);
    const block = parsed!.content[0]!;
    assert.equal(block.type, 'queued_command');
    if (block.type === 'queued_command') {
      assert.match(block.prompt, /vercel/);
      assert.equal(block.commandMode, 'prompt');
    }
  });

  test('compact_file_reference surfaces as compact_file_ref block (no content by design, Issue 7 P2)', () => {
    const record = {
      type: 'attachment',
      uuid: 'a7',
      parentUuid: null,
      timestamp: '2026-04-17T05:26:17.746Z',
      attachment: {
        type: 'compact_file_reference',
        filename: '/Users/x/project/pre-compact.tsx',
        displayPath: 'pre-compact.tsx',
      },
    };
    const parsed = jsonlParserService.parseRecord(record as never);
    assert.ok(parsed, 'compact_file_reference must parse into a ChatMessage');
    const block = parsed!.content[0]!;
    assert.equal(block.type, 'compact_file_ref');
    if (block.type === 'compact_file_ref') {
      assert.equal(block.displayPath, 'pre-compact.tsx');
      assert.equal(block.filename, '/Users/x/project/pre-compact.tsx');
    }
  });

  test('hook_success attachment stays dropped (noise, not user-facing)', () => {
    // Hook telemetry is the 80%+ tail of attachment volume; surfacing
    // it in chat would bury every real message. Keep dropping.
    const record = {
      type: 'attachment',
      uuid: 'a3',
      parentUuid: null,
      attachment: {
        type: 'hook_success',
        hookName: 'PostToolUse:Read',
        toolUseID: 'toolu_x',
        exitCode: 0,
      },
    };
    assert.equal(jsonlParserService.parseRecord(record as never), null);
  });

  test('attachment with no inner discriminator is dropped, not thrown', () => {
    const record = {
      type: 'attachment',
      uuid: 'a4',
      parentUuid: null,
    };
    assert.equal(jsonlParserService.parseRecord(record as never), null);
  });

  test('pre-fix-era top-level subtype does NOT trigger the branch (discriminator is inner)', () => {
    // Guard against regression to the old (broken) discriminator. Even
    // if a caller crafts a record with top-level subtype, we still
    // require the real `attachment.type` discriminator.
    const record = {
      type: 'attachment',
      uuid: 'a5',
      parentUuid: null,
      subtype: 'edited_text_file',
      filePath: '/nope.ts',
    };
    // No inner attachment — drop.
    assert.equal(jsonlParserService.parseRecord(record as never), null);
  });
});

// Issue 5 — the chat pane was silently dropping most event types.
// The bug: per-type branches, no default. Every JSONL shape we hadn't
// hand-mapped was returning null, which in turn caused whole multi-
// event turns to collapse into ghost turns (user prompt missing,
// tool_use missing, unknown system notes missing). The remediation is
// "default = surface; explicit drop list for known noise" so a future
// Claude Code record shape we haven't seen yet lands as a visible
// debug placeholder instead of vanishing.
//
// These tests pin the contract: a multi-event turn (user text + assistant
// text + TodoWrite + Bash) survives in full; unknown shapes surface as
// `system_note` placeholders; and the three known noise types
// (hook_success, stop_hook_summary, turn_duration) stay dropped.

describe('jsonlParserService — Issue 5 multi-event turn + silent-drop policy', () => {
  test('multi-event turn survives: user text + assistant text + TodoWrite + Bash all render as distinct blocks', () => {
    // Repro of Jose's test prompt: "Say hello plain text. TodoWrite A/B/C.
    // Bash echo test." Before the fix, the chat pane rendered nothing —
    // not even the user's own prompt. This asserts the baseline the UI
    // depends on: four distinct pieces in parse order.
    const lines = [
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        parentUuid: null,
        timestamp: '2026-04-18T12:00:00.000Z',
        message: {
          role: 'user',
          content: 'Say "hello" as plain text. Use TodoWrite with items A/B/C. Run Bash: echo test.',
        },
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'u1',
        timestamp: '2026-04-18T12:00:01.000Z',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-7',
          content: [
            { type: 'text', text: 'hello' },
            { type: 'tool_use', id: 'tu_td', name: 'TodoWrite', input: { todos: [{ content: 'A' }, { content: 'B' }, { content: 'C' }] } },
            { type: 'tool_use', id: 'tu_bash', name: 'Bash', input: { command: 'echo test' } },
          ],
        },
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'u2',
        parentUuid: 'a1',
        timestamp: '2026-04-18T12:00:02.000Z',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu_bash', content: 'test\n' }],
        },
      }),
    ];

    const parsed = jsonlParserService.parseLines(lines);

    const userPrompt = parsed.find((m) => m.id === 'u1');
    assert.ok(userPrompt, 'user prompt must be parsed');
    assert.equal(userPrompt!.role, 'user');
    assert.equal(userPrompt!.content[0]?.type, 'text');
    if (userPrompt!.content[0]?.type === 'text') {
      assert.match(userPrompt!.content[0].text, /hello/i);
    }

    const assistant = parsed.find((m) => m.id === 'a1');
    assert.ok(assistant, 'assistant turn must be parsed');
    assert.equal(assistant!.role, 'assistant');
    // Must preserve all three blocks in order: text, TodoWrite, Bash.
    assert.equal(assistant!.content.length, 3);
    assert.equal(assistant!.content[0]?.type, 'text');
    assert.equal(assistant!.content[1]?.type, 'tool_use');
    assert.equal(assistant!.content[2]?.type, 'tool_use');
    if (assistant!.content[1]?.type === 'tool_use') {
      assert.equal(assistant!.content[1].name, 'TodoWrite');
    }
    if (assistant!.content[2]?.type === 'tool_use') {
      assert.equal(assistant!.content[2].name, 'Bash');
    }

    const toolResult = parsed.find((m) => m.id === 'u2');
    assert.ok(toolResult, 'tool_result message must be parsed');
    assert.equal(toolResult!.content[0]?.type, 'tool_result');
  });

  test('unknown top-level record type surfaces as a debug_unmapped block (default = render)', () => {
    // Before the fix, parseRecord's tail was `return null` for anything
    // not in the denylist. A future Claude Code record shape would
    // silently vanish. New contract: unknown top-level shapes land as
    // a debug_unmapped block keyed on the type name so the renderer
    // can show a muted collapsible chip the user can file an issue on.
    const record = {
      type: 'novel-claude-code-record',
      uuid: 'unk-1',
      parentUuid: null,
      timestamp: '2026-04-18T12:00:00.000Z',
    };
    const parsed = jsonlParserService.parseRecord(record as never);
    assert.ok(parsed, 'unknown top-level type must surface, not drop');
    assert.equal(parsed!.role, 'system');
    const block = parsed!.content[0]!;
    assert.equal(block.type, 'debug_unmapped');
    if (block.type === 'debug_unmapped') {
      assert.equal(block.kind, 'record_type');
      assert.equal(block.key, 'novel-claude-code-record');
    }
  });

  test('unknown system subtype surfaces as a debug_unmapped block carrying the subtype + raw content', () => {
    // Any system record with a subtype we don't recognize (e.g.
    // `scheduled_task_fire`, `away_summary`) used to return null. Now
    // surfaces with the subtype as `key` and the record's own content
    // as `raw` so the collapsible chip can show what Claude Code said.
    const record = {
      type: 'system',
      uuid: 'sys-1',
      parentUuid: null,
      timestamp: '2026-04-18T12:00:00.000Z',
      subtype: 'scheduled_task_fire',
      content: 'Scheduled task fired: /loop prompt',
    };
    const parsed = jsonlParserService.parseRecord(record as never);
    assert.ok(parsed, 'unknown system subtype must surface');
    assert.equal(parsed!.role, 'system');
    const block = parsed!.content[0]!;
    assert.equal(block.type, 'debug_unmapped');
    if (block.type === 'debug_unmapped') {
      assert.equal(block.kind, 'system_subtype');
      assert.equal(block.key, 'scheduled_task_fire');
      assert.match(block.raw ?? '', /loop prompt/);
    }
  });

  test('stop_hook_summary is in the explicit drop list (known noise, stays dropped)', () => {
    // Stop-hook summaries fire on every pane stop — surfacing them would
    // paper the chat with "stop hook ran" lines after every turn. Keep
    // dropped, but drop via the explicit list, not by falling off the
    // end of the switch.
    const record = {
      type: 'system',
      uuid: 'sys-2',
      parentUuid: null,
      subtype: 'stop_hook_summary',
      content: 'ran 2 hooks',
    };
    assert.equal(jsonlParserService.parseRecord(record as never), null);
  });

  test('turn_duration system record is in the explicit drop list', () => {
    const record = {
      type: 'system',
      uuid: 'sys-3',
      parentUuid: null,
      subtype: 'turn_duration',
      content: '2.4s',
    };
    assert.equal(jsonlParserService.parseRecord(record as never), null);
  });

  test('unknown attachment inner type surfaces as a debug_unmapped block (default = render)', () => {
    // attachment.type = 'date_change' (or any future Claude Code
    // attachment we haven't mapped) used to silently drop. Now
    // surfaces as debug_unmapped with the inner type as `key` and
    // (if present) inner.content as `raw`.
    const record = {
      type: 'attachment',
      uuid: 'att-1',
      parentUuid: null,
      timestamp: '2026-04-18T12:00:00.000Z',
      attachment: { type: 'date_change', content: 'day changed 2026-04-17 → 2026-04-18' },
    };
    const parsed = jsonlParserService.parseRecord(record as never);
    assert.ok(parsed, 'unknown attachment type must surface');
    assert.equal(parsed!.role, 'system');
    const block = parsed!.content[0]!;
    assert.equal(block.type, 'debug_unmapped');
    if (block.type === 'debug_unmapped') {
      assert.equal(block.kind, 'attachment_type');
      assert.equal(block.key, 'date_change');
      assert.match(block.raw ?? '', /day changed/);
    }
  });

  test('unknown assistant content block type surfaces as a debug_unmapped block instead of being stripped', () => {
    // parseAssistantBlocks used to switch over {text, thinking,
    // tool_use} and drop everything else on the floor. A future
    // Anthropic content shape (e.g. `server_tool_use`,
    // `redacted_thinking`) would erase the entire assistant turn if
    // it was the only block. Now: unknown content blocks surface as
    // debug_unmapped so the turn is visible.
    const record = {
      type: 'assistant',
      uuid: 'a2',
      parentUuid: null,
      timestamp: '2026-04-18T12:00:00.000Z',
      message: {
        role: 'assistant',
        model: 'claude-opus-4-7',
        content: [
          { type: 'text', text: 'visible text' },
          { type: 'server_tool_use', id: 'stu_1', name: 'web_search', input: { query: 'foo' } },
        ],
      },
    };
    const parsed = jsonlParserService.parseRecord(record as never);
    assert.ok(parsed, 'assistant message with unknown block type must still parse');
    assert.equal(parsed!.content.length, 2);
    assert.equal(parsed!.content[0]?.type, 'text');
    const debug = parsed!.content[1]!;
    assert.equal(debug.type, 'debug_unmapped');
    if (debug.type === 'debug_unmapped') {
      assert.equal(debug.kind, 'assistant_block');
      assert.equal(debug.key, 'server_tool_use');
    }
  });
});

// Issue 15 — tool_use / tool_result pairing probe. Drives the Stop-hook
// gate that prevents false-idle during tool execution.
describe('hasUnmatchedToolUseInLines — pure pairing logic', () => {
  const toolUseLine = (id: string, name = 'Bash'): string => JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input: {} }] },
  });
  const toolResultLine = (toolUseId: string): string => JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'ok' }] },
  });
  const textLine = (role: 'user' | 'assistant', text: string): string => JSON.stringify({
    type: role,
    message: { role, content: [{ type: 'text', text }] },
  });

  test('tool_use with matching tool_result → no pending', () => {
    const lines = [
      textLine('user', 'do the thing'),
      toolUseLine('toolu_01'),
      toolResultLine('toolu_01'),
      textLine('assistant', 'done'),
    ];
    assert.equal(hasUnmatchedToolUseInLines(lines), false);
  });

  test('tool_use with NO matching tool_result → pending (canonical Issue 15 case)', () => {
    const lines = [
      textLine('user', 'run sleep 30'),
      toolUseLine('toolu_02'),
      // Stop hook fires here while bash is sleeping. No tool_result yet.
    ];
    assert.equal(hasUnmatchedToolUseInLines(lines), true);
  });

  test('multiple tool_use, one still pending → pending', () => {
    const lines = [
      toolUseLine('toolu_03'),
      toolResultLine('toolu_03'),
      toolUseLine('toolu_04'),
      // second tool_result missing
    ];
    assert.equal(hasUnmatchedToolUseInLines(lines), true);
  });

  test('multiple tool_use, all matched → not pending', () => {
    const lines = [
      toolUseLine('toolu_05'),
      toolResultLine('toolu_05'),
      toolUseLine('toolu_06'),
      toolResultLine('toolu_06'),
    ];
    assert.equal(hasUnmatchedToolUseInLines(lines), false);
  });

  test('no tool blocks at all → not pending', () => {
    const lines = [
      textLine('user', 'hi'),
      textLine('assistant', 'hello'),
    ];
    assert.equal(hasUnmatchedToolUseInLines(lines), false);
  });

  test('tool_result without originating tool_use (bounded-tail edge) → not pending', () => {
    // Bounded tail read may start after the tool_use that precedes
    // a tool_result in the window. Tolerate — do not flip idle.
    const lines = [toolResultLine('toolu_99')];
    assert.equal(hasUnmatchedToolUseInLines(lines), false);
  });

  test('malformed line skipped — valid pairing around it still resolves', () => {
    const lines = [
      toolUseLine('toolu_07'),
      'not-json',
      toolResultLine('toolu_07'),
    ];
    assert.equal(hasUnmatchedToolUseInLines(lines), false);
  });

  test('empty input → not pending', () => {
    assert.equal(hasUnmatchedToolUseInLines([]), false);
  });

  test('tool_use missing id → ignored (malformed record)', () => {
    const badToolUse = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash' }] },
    });
    assert.equal(hasUnmatchedToolUseInLines([badToolUse]), false);
  });
});

describe('hasPendingToolUseInTranscript — bounded file tail', () => {
  let dir: string;
  const write = (name: string, content: string): string => {
    const p = join(dir, name);
    writeFileSync(p, content);
    return p;
  };

  test.before(() => { dir = mkdtempSync(join(tmpdir(), 'issue15-')); });
  test.after(() => { rmSync(dir, { recursive: true, force: true }); });

  test('pending tool_use at tail → true', () => {
    const content = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'go' }] } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_a', name: 'Bash', input: {} }] } }),
    ].join('\n') + '\n';
    const p = write('pending.jsonl', content);
    assert.equal(hasPendingToolUseInTranscript(p), true);
  });

  test('matched pair at tail → false', () => {
    const content = [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_b', name: 'Bash', input: {} }] } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_b', content: 'ok' }] } }),
    ].join('\n') + '\n';
    const p = write('matched.jsonl', content);
    assert.equal(hasPendingToolUseInTranscript(p), false);
  });

  test('missing file → false (fall-through to legacy Stop behavior)', () => {
    const p = join(dir, 'does-not-exist.jsonl');
    assert.equal(hasPendingToolUseInTranscript(p), false);
  });

  test('empty file → false', () => {
    const p = write('empty.jsonl', '');
    assert.equal(hasPendingToolUseInTranscript(p), false);
  });
});

// Issue 15.1-G — post-compact synthetic summary routing.
// Claude Code emits the summary with `type: 'user'` + `isCompactSummary:
// true`. The parser must route via the structured discriminator (NOT
// text-prose matching) to a system-role `compact_summary` block so the
// renderer can distinguish it from real user turns.
describe('jsonlParserService — Issue 15.1-G compact_summary routing', () => {
  test('isCompactSummary=true user record → system role + compact_summary block', () => {
    const line = JSON.stringify({
      type: 'user',
      uuid: 'summary-uuid-1',
      parentUuid: 'prev-1',
      timestamp: '2026-04-19T10:00:00Z',
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
      message: {
        role: 'user',
        content: [{
          type: 'text',
          text: 'This session is being continued from a previous conversation...',
        }],
      },
    });
    const messages = jsonlParserService.parseLines([line]);
    assert.equal(messages.length, 1);
    const m = messages[0]!;
    assert.equal(m.role, 'system');
    assert.equal(m.content.length, 1);
    const block = m.content[0]!;
    assert.equal(block.type, 'compact_summary');
    if (block.type === 'compact_summary') {
      assert.match(block.text, /This session is being continued/);
    }
  });

  test('isCompactSummary=true with multiple text blocks → concatenates', () => {
    const line = JSON.stringify({
      type: 'user',
      uuid: 'summary-uuid-2',
      isCompactSummary: true,
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'Part A' },
          { type: 'text', text: 'Part B' },
        ],
      },
    });
    const messages = jsonlParserService.parseLines([line]);
    const block = messages[0]!.content[0]!;
    if (block.type === 'compact_summary') {
      assert.match(block.text, /Part A/);
      assert.match(block.text, /Part B/);
    } else {
      assert.fail(`expected compact_summary block, got ${block.type}`);
    }
  });

  test('regular user record (no isCompactSummary) → stays user role', () => {
    // Regression guard — the discriminator must not false-fire on
    // ordinary user turns. Absence of the flag means "real user".
    const line = JSON.stringify({
      type: 'user',
      uuid: 'real-user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'hi Claude' }],
      },
    });
    const messages = jsonlParserService.parseLines([line]);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]!.role, 'user');
    assert.equal(messages[0]!.content[0]!.type, 'text');
  });

  test('isCompactSummary=false → treated as ordinary user turn', () => {
    const line = JSON.stringify({
      type: 'user',
      uuid: 'explicit-false',
      isCompactSummary: false,
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'hey' }],
      },
    });
    const messages = jsonlParserService.parseLines([line]);
    assert.equal(messages[0]!.role, 'user');
  });

  test('string-content isCompactSummary → flattens to compact_summary text', () => {
    // Defensive against Claude Code emitting the summary as a bare
    // string rather than a content-block array.
    const line = JSON.stringify({
      type: 'user',
      uuid: 'string-content',
      isCompactSummary: true,
      message: { role: 'user', content: 'summary as a string' },
    });
    const messages = jsonlParserService.parseLines([line]);
    const block = messages[0]!.content[0]!;
    if (block.type === 'compact_summary') {
      assert.equal(block.text, 'summary as a string');
    } else {
      assert.fail(`expected compact_summary block, got ${block.type}`);
    }
  });
});
