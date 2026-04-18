import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { jsonlParserService } from '../jsonl-parser.service.js';

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
  test('edited_text_file attachment surfaces as a system_note', () => {
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
    assert.equal(block.type, 'system_note');
    if (block.type === 'system_note') {
      assert.match(block.text, /Edited:/);
      assert.match(block.text, /foo\.ts/);
    }
  });

  test('task_reminder attachment surfaces as a system_note carrying the reminder text', () => {
    // Shape observed in real JSONLs: the reminder sits on
    // attachment.content. Terminal shows this inline to Claude as a
    // `<system-reminder>` block; chat previously dropped it entirely.
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
    assert.equal(block.type, 'system_note');
    if (block.type === 'system_note') {
      assert.match(block.text, /TaskCreate/);
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
