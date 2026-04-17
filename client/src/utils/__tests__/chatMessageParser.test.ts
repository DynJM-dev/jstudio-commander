import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStructuredUserContent,
  parseTaskNotification,
  parseTeammateMessage,
  parseShutdownRequest,
  parseShutdownResponse,
  parsePlanApprovalRequest,
  parsePlanApprovalResponse,
  parseSenderPreamble,
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

  test('shutdown_request JSON routes correctly', () => {
    const raw = JSON.stringify({ type: 'shutdown_request', from: 'team-lead', reason: 'rotation' });
    const out = parseStructuredUserContent(raw);
    assert.ok(out);
    assert.equal(out!.kind, 'shutdown-request');
  });

  test('plan_approval_response JSON routes correctly', () => {
    const raw = JSON.stringify({ type: 'plan_approval_response', request_id: 'r-1', approve: true });
    const out = parseStructuredUserContent(raw);
    assert.ok(out);
    assert.equal(out!.kind, 'plan-approval-response');
  });

  test('sender preamble routes to teammate-message', () => {
    const raw = 'team-lead\n\nPlease start Phase K.';
    const out = parseStructuredUserContent(raw);
    assert.ok(out);
    assert.equal(out!.kind, 'teammate-message');
    if (out!.kind === 'teammate-message') {
      assert.equal(out!.teammate.teammateId, 'team-lead');
      assert.match(out!.teammate.body, /Phase K/);
    }
  });

  test('XML tag wins over JSON detector when content is an XML tag', () => {
    // Guard: task-notification detector runs before JSON detectors. A nested
    // <status> inside task-notification (status="shutdown_request") must not
    // get re-classified as a shutdown-request via the JSON path.
    const raw = '<task-notification><task-id>x</task-id><status>completed</status><summary>s</summary><result>r</result></task-notification>';
    const out = parseStructuredUserContent(raw);
    assert.equal(out!.kind, 'task-notification');
  });
});

describe('parseShutdownRequest', () => {
  test('type + fields → extracted', () => {
    const raw = JSON.stringify({ type: 'shutdown_request', from: 'team-lead', reason: 'rotation', requestId: 'abc123' });
    const parsed = parseShutdownRequest(raw);
    assert.ok(parsed);
    assert.equal(parsed!.from, 'team-lead');
    assert.equal(parsed!.reason, 'rotation');
    assert.equal(parsed!.requestId, 'abc123');
  });

  test('wrong type → null', () => {
    const raw = JSON.stringify({ type: 'plan_approval_request', from: 'x' });
    assert.equal(parseShutdownRequest(raw), null);
  });

  test('non-JSON → null', () => {
    assert.equal(parseShutdownRequest('hello {not json}'), null);
  });
});

describe('parseShutdownResponse', () => {
  test('approve:true → approve=true, request_id snake or camel', () => {
    const raw = JSON.stringify({ type: 'shutdown_response', request_id: 'abc', approve: true });
    const parsed = parseShutdownResponse(raw);
    assert.ok(parsed);
    assert.equal(parsed!.approve, true);
    assert.equal(parsed!.requestId, 'abc');
  });

  test('missing approve boolean → null', () => {
    const raw = JSON.stringify({ type: 'shutdown_response', request_id: 'abc' });
    assert.equal(parseShutdownResponse(raw), null);
  });
});

describe('parsePlanApprovalRequest', () => {
  test('includes plan text', () => {
    const raw = JSON.stringify({ type: 'plan_approval_request', from: 'coder-15', plan: '1. Do X\n2. Do Y' });
    const parsed = parsePlanApprovalRequest(raw);
    assert.ok(parsed);
    assert.equal(parsed!.from, 'coder-15');
    assert.match(parsed!.plan ?? '', /Do X/);
  });
});

describe('parsePlanApprovalResponse', () => {
  test('feedback passes through', () => {
    const raw = JSON.stringify({ type: 'plan_approval_response', requestId: 'r1', approve: false, feedback: 'add error handling' });
    const parsed = parsePlanApprovalResponse(raw);
    assert.ok(parsed);
    assert.equal(parsed!.approve, false);
    assert.match(parsed!.feedback ?? '', /error handling/);
  });
});

describe('parseSenderPreamble', () => {
  test('known sender + body', () => {
    const parsed = parseSenderPreamble('coder-14\n\nhere is the report');
    assert.ok(parsed);
    assert.equal(parsed!.teammateId, 'coder-14');
    assert.match(parsed!.body, /here is the report/);
  });

  test('missing body → null', () => {
    assert.equal(parseSenderPreamble('coder-14\n   \n'), null);
  });

  test('single line without newline → null', () => {
    assert.equal(parseSenderPreamble('team-lead please wait'), null);
  });

  test('plain prose → null', () => {
    assert.equal(parseSenderPreamble('hello world how are you'), null);
  });
});
