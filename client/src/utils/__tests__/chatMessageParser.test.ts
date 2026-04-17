import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStructuredUserContent,
  parseTaskNotification,
  parseTeammateMessage,
} from '../chatMessageParser.js';

describe('parseTaskNotification', () => {
  test('full payload → all fields extracted', () => {
    const raw = `
<task-notification>
  <task-id>aa78580c9a87b3389</task-id>
  <tool-use-id>toolu_01J2849wQBUtfviVpaueQwCw</tool-use-id>
  <output-file>/tmp/task-output.md</output-file>
  <status>completed</status>
  <summary>Agent "Phase 3: Shell polish" completed</summary>
  <result>Shipped TabBar token compliance + sidebar dividers. 12 files changed.</result>
  <usage><total_tokens>45732</total_tokens><tool_uses>25</tool_uses><duration_ms>98454</duration_ms></usage>
</task-notification>
    `.trim();

    const parsed = parseTaskNotification(raw);
    assert.ok(parsed, 'parsed should be non-null');
    assert.equal(parsed!.taskId, 'aa78580c9a87b3389');
    assert.equal(parsed!.toolUseId, 'toolu_01J2849wQBUtfviVpaueQwCw');
    assert.equal(parsed!.outputFile, '/tmp/task-output.md');
    assert.equal(parsed!.status, 'completed');
    assert.match(parsed!.summary, /Shell polish/);
    assert.match(parsed!.result, /12 files changed/);
    assert.equal(parsed!.usage?.totalTokens, 45732);
    assert.equal(parsed!.usage?.toolUses, 25);
    assert.equal(parsed!.usage?.durationMs, 98454);
  });

  test('minimal payload without usage → usage undefined', () => {
    const raw = `<task-notification><task-id>x</task-id><summary>Quick fix</summary><result>done</result></task-notification>`;
    const parsed = parseTaskNotification(raw);
    assert.ok(parsed);
    assert.equal(parsed!.usage, undefined);
  });

  test('mixed content (tag + extra text) → null (strict mode)', () => {
    const raw = `prefix<task-notification><task-id>x</task-id><summary>s</summary><result>r</result></task-notification>suffix`;
    assert.equal(parseTaskNotification(raw), null);
  });

  test('empty / non-XML input → null', () => {
    assert.equal(parseTaskNotification(''), null);
    assert.equal(parseTaskNotification('plain user text'), null);
  });

  test('entities in body are decoded', () => {
    const raw = `<task-notification><task-id>x</task-id><summary>5 &gt; 3</summary><result>1 &amp; 2</result></task-notification>`;
    const parsed = parseTaskNotification(raw);
    assert.ok(parsed);
    assert.equal(parsed!.summary, '5 > 3');
    assert.equal(parsed!.result, '1 & 2');
  });
});

describe('parseTeammateMessage', () => {
  test('full payload → fields extracted', () => {
    const raw = `<teammate-message teammate_id="coder" color="blue" summary="Ready for first task">
Ready. Coder checking in for OvaGas ERP UI overhaul.

## Phases
- Phase 1 done
- Phase 2 WIP
</teammate-message>`;

    const parsed = parseTeammateMessage(raw);
    assert.ok(parsed);
    assert.equal(parsed!.teammateId, 'coder');
    assert.equal(parsed!.color, 'blue');
    assert.equal(parsed!.summary, 'Ready for first task');
    assert.match(parsed!.body, /OvaGas/);
    assert.match(parsed!.body, /Phase 1 done/);
  });

  test('hyphenated attr form (teammate-id) also accepted', () => {
    const raw = `<teammate-message teammate-id="c" summary="s">body</teammate-message>`;
    const parsed = parseTeammateMessage(raw);
    assert.ok(parsed);
    assert.equal(parsed!.teammateId, 'c');
  });

  test('missing color → empty string (caller falls back to default)', () => {
    const raw = `<teammate-message teammate_id="c" summary="s">hi</teammate-message>`;
    const parsed = parseTeammateMessage(raw);
    assert.ok(parsed);
    assert.equal(parsed!.color, '');
  });

  test('no matching tag → null', () => {
    assert.equal(parseTeammateMessage('just prose'), null);
  });

  test('mixed content → null (strict mode)', () => {
    const raw = `<teammate-message teammate_id="c" summary="s">hi</teammate-message>trailing text`;
    assert.equal(parseTeammateMessage(raw), null);
  });
});

describe('parseStructuredUserContent', () => {
  test('task-notification routes correctly', () => {
    const raw = `<task-notification><task-id>x</task-id><summary>s</summary><result>r</result></task-notification>`;
    const out = parseStructuredUserContent(raw);
    assert.ok(out);
    assert.equal(out!.kind, 'task-notification');
  });

  test('teammate-message routes correctly', () => {
    const raw = `<teammate-message teammate_id="c" summary="s">hi</teammate-message>`;
    const out = parseStructuredUserContent(raw);
    assert.ok(out);
    assert.equal(out!.kind, 'teammate-message');
  });

  test('plain text → null', () => {
    assert.equal(parseStructuredUserContent('hello there'), null);
  });
});
