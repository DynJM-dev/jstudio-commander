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
