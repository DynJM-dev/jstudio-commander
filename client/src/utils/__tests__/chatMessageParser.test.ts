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
  parseIdleNotification,
  parseTeammateTerminated,
  parseShutdownApproved,
  parseChatMessage,
} from '../chatMessageParser.js';
import { collapseConsecutiveIdles } from '../systemEvents.js';

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

// ============================================================================
// Phase K — new protocol detectors + array parser + collapse helper.
// ============================================================================

describe('parseIdleNotification', () => {
  test('full payload → from + idleReason + timestamp', () => {
    const raw = JSON.stringify({
      type: 'idle_notification',
      from: 'coder-15',
      timestamp: '2026-04-17T18:14:00.000Z',
      idleReason: 'available',
    });
    const parsed = parseIdleNotification(raw);
    assert.ok(parsed);
    assert.equal(parsed!.from, 'coder-15');
    assert.equal(parsed!.idleReason, 'available');
    assert.equal(parsed!.timestamp, '2026-04-17T18:14:00.000Z');
  });

  test('missing from → null (required field)', () => {
    const raw = JSON.stringify({ type: 'idle_notification' });
    assert.equal(parseIdleNotification(raw), null);
  });

  test('snake_case idle_reason also recognized', () => {
    const raw = JSON.stringify({ type: 'idle_notification', from: 'c', idle_reason: 'available' });
    const parsed = parseIdleNotification(raw);
    assert.ok(parsed);
    assert.equal(parsed!.idleReason, 'available');
  });

  test('wrong type → null', () => {
    const raw = JSON.stringify({ type: 'teammate_terminated', from: 'x' });
    assert.equal(parseIdleNotification(raw), null);
  });
});

describe('parseTeammateTerminated', () => {
  test('extracts from + message + timestamp', () => {
    const raw = JSON.stringify({
      type: 'teammate_terminated',
      from: 'coder-14',
      message: 'stood down at rotation',
      timestamp: '2026-04-17T18:20:00.000Z',
    });
    const parsed = parseTeammateTerminated(raw);
    assert.ok(parsed);
    assert.equal(parsed!.from, 'coder-14');
    assert.match(parsed!.message ?? '', /stood down/);
  });

  test('wrong type → null', () => {
    assert.equal(parseTeammateTerminated(JSON.stringify({ type: 'idle_notification' })), null);
  });
});

describe('parseShutdownApproved', () => {
  test('extracts requestId + paneId + backendType', () => {
    const raw = JSON.stringify({
      type: 'shutdown_approved',
      requestId: 'req-abc123',
      from: 'coder-14',
      paneId: '%35',
      backendType: 'tmux',
    });
    const parsed = parseShutdownApproved(raw);
    assert.ok(parsed);
    assert.equal(parsed!.requestId, 'req-abc123');
    assert.equal(parsed!.paneId, '%35');
    assert.equal(parsed!.backendType, 'tmux');
  });

  test('snake_case request_id also recognized', () => {
    const raw = JSON.stringify({ type: 'shutdown_approved', request_id: 'r1' });
    const parsed = parseShutdownApproved(raw);
    assert.ok(parsed);
    assert.equal(parsed!.requestId, 'r1');
  });

  test('wrong type → null', () => {
    assert.equal(parseShutdownApproved(JSON.stringify({ type: 'shutdown_response' })), null);
  });
});

describe('parseChatMessage', () => {
  test('empty content → empty array', () => {
    assert.deepEqual(parseChatMessage(''), []);
    assert.deepEqual(parseChatMessage('   \n  '), []);
  });

  test('plain prose → empty array (caller falls back to UserMessage)', () => {
    assert.deepEqual(parseChatMessage('just a user sentence'), []);
  });

  test('single teammate-message wrapping idle_notification JSON → idle-notification fragment with context', () => {
    const raw = `<teammate-message teammate_id="coder-15" color="orange">\n${JSON.stringify({
      type: 'idle_notification',
      from: 'coder-15',
      timestamp: '2026-04-17T18:14:00.000Z',
      idleReason: 'available',
    })}\n</teammate-message>`;
    const parsed = parseChatMessage(raw);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.kind, 'idle-notification');
    if (parsed[0]?.kind === 'idle-notification') {
      assert.equal(parsed[0].notification.from, 'coder-15');
      assert.equal(parsed[0].context?.teammateId, 'coder-15');
      assert.equal(parsed[0].context?.color, 'orange');
    }
  });

  test('two back-to-back idle-notification wrappers → 2-element array in order', () => {
    const inner = JSON.stringify({ type: 'idle_notification', from: 'coder-15', timestamp: '2026-04-17T18:14:00.000Z' });
    const raw = `<teammate-message teammate_id="coder-15">${inner}</teammate-message>\n<teammate-message teammate_id="coder-15">${inner}</teammate-message>`;
    const parsed = parseChatMessage(raw);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0]?.kind, 'idle-notification');
    assert.equal(parsed[1]?.kind, 'idle-notification');
  });

  test('mixed-kind wrappers → fragments preserve injection order', () => {
    const teammate = '<teammate-message teammate_id="coder-14" summary="report">Phase ready</teammate-message>';
    const shutdown = JSON.stringify({ type: 'shutdown_request', from: 'team-lead', reason: 'rotation' });
    const raw = `${teammate}\n<teammate-message teammate_id="team-lead">${shutdown}</teammate-message>`;
    const parsed = parseChatMessage(raw);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0]?.kind, 'teammate-message');
    assert.equal(parsed[1]?.kind, 'shutdown-request');
  });

  test('prose before + wrapper + prose after → three fragments in order', () => {
    const wrapper = '<teammate-message teammate_id="coder-14" summary="x">Body</teammate-message>';
    const raw = `Heads up team.\n${wrapper}\nThat was the handoff.`;
    const parsed = parseChatMessage(raw);
    assert.equal(parsed.length, 3);
    assert.equal(parsed[0]?.kind, 'prose');
    assert.equal(parsed[1]?.kind, 'teammate-message');
    assert.equal(parsed[2]?.kind, 'prose');
    if (parsed[0]?.kind === 'prose') assert.match(parsed[0].text, /Heads up/);
    if (parsed[2]?.kind === 'prose') assert.match(parsed[2].text, /handoff/);
  });

  test('unparseable JSON body in teammate-message → teammate-message with "(unparseable payload)" marker', () => {
    const raw = `<teammate-message teammate_id="coder-15" color="orange">{"type":"idle_notification","from":broken}</teammate-message>`;
    const parsed = parseChatMessage(raw);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.kind, 'teammate-message');
    if (parsed[0]?.kind === 'teammate-message') {
      assert.match(parsed[0].teammate.body, /unparseable payload/);
    }
  });

  test('unknown JSON type → unrecognized-protocol fragment preserving type + raw', () => {
    const raw = JSON.stringify({ type: 'future_event_kind', foo: 'bar' });
    const parsed = parseChatMessage(raw);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.kind, 'unrecognized-protocol');
    if (parsed[0]?.kind === 'unrecognized-protocol') {
      assert.equal(parsed[0].protocolType, 'future_event_kind');
      assert.match(parsed[0].raw, /future_event_kind/);
    }
  });

  test('unknown JSON type inside wrapper → unrecognized-protocol fragment with context', () => {
    const inner = JSON.stringify({ type: 'future_ping', foo: 'bar' });
    const raw = `<teammate-message teammate_id="coder-15" color="orange">${inner}</teammate-message>`;
    const parsed = parseChatMessage(raw);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.kind, 'unrecognized-protocol');
    if (parsed[0]?.kind === 'unrecognized-protocol') {
      assert.equal(parsed[0].protocolType, 'future_ping');
      assert.equal(parsed[0].context?.teammateId, 'coder-15');
      assert.equal(parsed[0].context?.color, 'orange');
    }
  });

  test('task-notification wrapper survives array return', () => {
    const raw = '<task-notification><task-id>x</task-id><summary>s</summary><result>r</result></task-notification>';
    const parsed = parseChatMessage(raw);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.kind, 'task-notification');
  });

  test('shutdown_approved + teammate-message wrapping idle_notification → 2 fragments', () => {
    const approved = JSON.stringify({ type: 'shutdown_approved', requestId: 'r1', from: 'coder-14' });
    const idleInner = JSON.stringify({ type: 'idle_notification', from: 'coder-15' });
    const raw = `<teammate-message teammate_id="coder-14" color="orange">${approved}</teammate-message>\n<teammate-message teammate_id="coder-15" color="pink">${idleInner}</teammate-message>`;
    const parsed = parseChatMessage(raw);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0]?.kind, 'shutdown-approved');
    assert.equal(parsed[1]?.kind, 'idle-notification');
  });

  // Phase K addendum — `sender{json}` form with zero whitespace between the
  // sender slug and the JSON body. This is the shape the messaging layer
  // uses for every `shutdown_request` / `shutdown_approved` that isn't
  // wrapped in <teammate-message>. All three tests below cover scenarios
  // the team-lead called out.
  test('sender + JSON with zero whitespace → routes to protocol card with sender attribution', () => {
    const raw = 'team-lead' + JSON.stringify({
      type: 'shutdown_request',
      requestId: 'shutdown-1776383084629@coder',
      from: 'team-lead',
      reason: 'Respawning on Opus 4.7 per user request',
      timestamp: '2026-04-16T23:44:44.630Z',
    });
    const parsed = parseChatMessage(raw);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.kind, 'shutdown-request');
    if (parsed[0]?.kind === 'shutdown-request') {
      assert.equal(parsed[0].request.from, 'team-lead');
      assert.equal(parsed[0].request.requestId, 'shutdown-1776383084629@coder');
      assert.match(parsed[0].request.reason ?? '', /Respawning/);
    }
  });

  test('sender preamble + idle_notification JSON (newline separator) → idle-notification', () => {
    const raw = 'coder-15\n' + JSON.stringify({
      type: 'idle_notification',
      from: 'coder-15',
      timestamp: '2026-04-17T18:14:00.000Z',
      idleReason: 'available',
    });
    const parsed = parseChatMessage(raw);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.kind, 'idle-notification');
    if (parsed[0]?.kind === 'idle-notification') {
      assert.equal(parsed[0].notification.from, 'coder-15');
      assert.equal(parsed[0].notification.idleReason, 'available');
    }
  });

  test('sender preamble + plain prose (no JSON) still routes to teammate-message', () => {
    const parsed = parseChatMessage('team-lead\nready for Phase K');
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.kind, 'teammate-message');
    if (parsed[0]?.kind === 'teammate-message') {
      assert.equal(parsed[0].teammate.teammateId, 'team-lead');
      assert.match(parsed[0].teammate.body, /Phase K/);
    }
  });

  test('preamble sender wins over JSON.from when they disagree', () => {
    // Wire-level sender (preamble) must win: the JSON's `from` is
    // author-supplied and could be wrong; the preamble is the transport.
    const raw = 'team-lead' + JSON.stringify({
      type: 'shutdown_approved',
      requestId: 'r1',
      from: 'coder-14', // claims it's from coder-14
    });
    const parsed = parseChatMessage(raw);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.kind, 'shutdown-approved');
    if (parsed[0]?.kind === 'shutdown-approved') {
      assert.equal(parsed[0].notification.from, 'team-lead');
    }
  });

  test('sender + unknown JSON type → unrecognized-protocol with senderOverride', () => {
    const raw = 'team-lead' + JSON.stringify({ type: 'future_event_kind', foo: 'bar' });
    const parsed = parseChatMessage(raw);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.kind, 'unrecognized-protocol');
    if (parsed[0]?.kind === 'unrecognized-protocol') {
      assert.equal(parsed[0].protocolType, 'future_event_kind');
      assert.equal(parsed[0].senderOverride, 'team-lead');
    }
  });
});

describe('collapseConsecutiveIdles', () => {
  test('same teammate within window collapses to count=N', () => {
    const mkIdle = (from: string, iso: string) =>
      ({
        kind: 'idle-notification',
        notification: { from, timestamp: iso },
        context: { teammateId: from, color: 'orange' },
      }) as const;

    const fragments = [
      mkIdle('coder-15', '2026-04-17T18:14:00.000Z'),
      mkIdle('coder-15', '2026-04-17T18:14:05.000Z'),
      mkIdle('coder-15', '2026-04-17T18:14:12.000Z'),
    ];
    const collapsed = collapseConsecutiveIdles(fragments);
    assert.equal(collapsed.length, 1);
    assert.equal(collapsed[0]?.kind, 'idle-notification');
    if (collapsed[0]?.kind === 'idle-notification') {
      assert.equal(collapsed[0].count, 3);
      // The newest timestamp wins so the hover-title reflects burst end.
      assert.equal(collapsed[0].notification.timestamp, '2026-04-17T18:14:12.000Z');
    }
  });

  test('different teammates stay separate even adjacent', () => {
    const fragments = [
      { kind: 'idle-notification', notification: { from: 'coder-15' } },
      { kind: 'idle-notification', notification: { from: 'coder-14' } },
    ] as const;
    const collapsed = collapseConsecutiveIdles([...fragments]);
    assert.equal(collapsed.length, 2);
  });

  test('idles separated by non-idle fragment do not collapse across the gap', () => {
    const fragments = [
      { kind: 'idle-notification', notification: { from: 'coder-15' } },
      { kind: 'prose', text: 'something else' },
      { kind: 'idle-notification', notification: { from: 'coder-15' } },
    ] as const;
    const collapsed = collapseConsecutiveIdles([...fragments]);
    assert.equal(collapsed.length, 3);
  });

  test('non-idle fragments pass through untouched', () => {
    const fragments = [
      { kind: 'teammate-message', teammate: { teammateId: 'x', color: 'blue', summary: '', body: 'hi' } },
      { kind: 'shutdown-approved', notification: { from: 'coder-14' } },
    ] as const;
    const collapsed = collapseConsecutiveIdles([...fragments]);
    assert.equal(collapsed.length, 2);
    assert.equal(collapsed[0]?.kind, 'teammate-message');
    assert.equal(collapsed[1]?.kind, 'shutdown-approved');
  });
});
