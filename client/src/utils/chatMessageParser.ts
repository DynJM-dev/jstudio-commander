// Structured user-message tags injected by Claude Code.
//
// Claude Code (and its teammate-messaging layer) occasionally routes
// structured payloads through the `user` role of the JSONL transcript,
// wrapped in predictable XML tags or raw JSON blobs. Without a parser
// they render as if the user typed them — ugly "JB" message with raw
// tag soup.
//
// We don't import an XML parser: these payloads are predictable,
// machine-authored, and letting a full DOM parser near them would
// expand the XSS surface. A tight regex set is safer and faster.
//
// Phase K extended this from "parse one top-level wrapper per message"
// to "scan for multiple wrappers in order, interleave with prose, and
// route JSON-bodied wrappers into their protocol kinds." A single user
// message from Claude Code's messaging layer can now contain multiple
// back-to-back `<teammate-message>` envelopes that each wrap a protocol
// JSON (idle_notification, shutdown_approved, …), plus free-form prose
// segments between them.

export interface TaskNotification {
  taskId: string;
  toolUseId: string;
  outputFile: string;
  status: 'completed' | 'failed' | 'in_progress' | string;
  summary: string;
  result: string;
  usage?: {
    totalTokens?: number;
    toolUses?: number;
    durationMs?: number;
  };
}

export interface TeammateMessage {
  teammateId: string;
  color: string;
  summary: string;
  body: string;
}

// Non-global versions — used by the strict top-level `parseTaskNotification` /
// `parseTeammateMessage` entry points and by the `isStrictlyTag` check.
const TASK_NOTIFICATION_RE = /<task-notification\b[^>]*>([\s\S]*?)<\/task-notification>/;
const TEAMMATE_MESSAGE_RE = /<teammate-message\b([^>]*)>([\s\S]*?)<\/teammate-message>/;

// Global versions used by the scanner. Each exec advances past the last match
// so we can walk the content left-to-right and carve prose segments between
// wrappers. Kept distinct from the non-global versions above so the strict
// entry points don't accidentally inherit sticky lastIndex state.
const TASK_NOTIFICATION_RE_G = /<task-notification\b[^>]*>([\s\S]*?)<\/task-notification>/g;
const TEAMMATE_MESSAGE_RE_G = /<teammate-message\b([^>]*)>([\s\S]*?)<\/teammate-message>/g;

const ATTR_RE = /(\w[\w-]*)\s*=\s*"([^"]*)"/g;

const parseAttrs = (raw: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m = ATTR_RE.exec(raw);
  while (m) {
    attrs[m[1]!] = decodeEntities(m[2] ?? '');
    m = ATTR_RE.exec(raw);
  }
  return attrs;
};

// The payloads we parse are under user control at source (Claude Code writes
// them), so a minimal set of standard XML entities is enough. We do NOT pass
// the decoded output to any HTML sink — it flows back into our existing
// markdown renderer, which escapes on its own.
const decodeEntities = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const extractChildText = (inner: string, tag: string): string | null => {
  // Non-greedy. We match a direct child of the parent container; the payloads
  // don't nest tags of the same name, so a simple search is safe.
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`);
  const match = re.exec(inner);
  if (!match) return null;
  return decodeEntities(match[1] ?? '').trim();
};

const parseIntOrUndef = (s: string | null): number | undefined => {
  if (!s) return undefined;
  const n = Number.parseInt(s.replace(/[_,]/g, ''), 10);
  return Number.isFinite(n) ? n : undefined;
};

// True iff `content` is a single structured tag at the top, optionally
// surrounded by whitespace. We treat mixed content (tag plus other prose)
// as non-matching for the strict entry points — ChatThread's new array
// path handles mixed content via `parseChatMessage`.
const isStrictlyTag = (content: string, match: RegExpExecArray): boolean => {
  const before = content.slice(0, match.index).trim();
  const after = content.slice(match.index + match[0].length).trim();
  return before.length === 0 && after.length === 0;
};

// Shared task-notification extractor — given the inner body of a
// <task-notification> element, pull the known child fields. Used by both
// the strict entry point and the multi-wrapper scanner.
const extractTaskNotification = (inner: string): TaskNotification | null => {
  const taskId = extractChildText(inner, 'task-id') ?? '';
  const toolUseId = extractChildText(inner, 'tool-use-id') ?? '';
  const outputFile = extractChildText(inner, 'output-file') ?? '';
  const status = extractChildText(inner, 'status') ?? '';
  const summary = extractChildText(inner, 'summary') ?? '';
  const result = extractChildText(inner, 'result') ?? '';

  let usage: TaskNotification['usage'];
  const usageMatch = /<usage\b[^>]*>([\s\S]*?)<\/usage>/.exec(inner);
  if (usageMatch) {
    const usageInner = usageMatch[1] ?? '';
    const totalTokens = parseIntOrUndef(extractChildText(usageInner, 'total_tokens'));
    const toolUses = parseIntOrUndef(extractChildText(usageInner, 'tool_uses'));
    const durationMs = parseIntOrUndef(extractChildText(usageInner, 'duration_ms'));
    if (totalTokens !== undefined || toolUses !== undefined || durationMs !== undefined) {
      usage = { totalTokens, toolUses, durationMs };
    }
  }

  if (!taskId && !summary && !result) return null;

  return { taskId, toolUseId, outputFile, status, summary, result, usage };
};

export const parseTaskNotification = (content: string): TaskNotification | null => {
  const match = TASK_NOTIFICATION_RE.exec(content);
  if (!match) return null;
  if (!isStrictlyTag(content, match)) return null;
  return extractTaskNotification(match[1] ?? '');
};

// Shared teammate-message extractor — given attrs + body, build the
// TeammateMessage record. Used by the strict entry point and the scanner.
const extractTeammateMessage = (attrsRaw: string, bodyRaw: string): TeammateMessage | null => {
  const attrs = parseAttrs(attrsRaw);
  const body = decodeEntities(bodyRaw).trim();

  const teammateId = attrs['teammate_id'] ?? attrs['teammate-id'] ?? '';
  const color = attrs['color'] ?? '';
  const summary = attrs['summary'] ?? '';

  if (!teammateId && !summary && !body) return null;

  return { teammateId, color, summary, body };
};

export const parseTeammateMessage = (content: string): TeammateMessage | null => {
  const match = TEAMMATE_MESSAGE_RE.exec(content);
  if (!match) return null;
  if (!isStrictlyTag(content, match)) return null;
  return extractTeammateMessage(match[1] ?? '', match[2] ?? '');
};

// Inter-session protocol messages — JSON bodies the SendMessage layer uses
// when teammates coordinate lifecycle (shutdown requests + approvals) or
// plan-approval handoffs. Both ends are Claude Code processes; the JSON is
// delivered as a user-role message in the transcript and otherwise renders
// as raw curly-brace soup in the JB bubble.

export interface ShutdownRequest {
  from?: string;
  reason?: string;
  requestId?: string;
  timestamp?: string;
}

export interface ShutdownResponse {
  requestId?: string;
  approve: boolean;
  reason?: string;
  from?: string;
}

export interface PlanApprovalRequest {
  from?: string;
  plan?: string;
  requestId?: string;
  timestamp?: string;
}

export interface PlanApprovalResponse {
  requestId?: string;
  approve: boolean;
  feedback?: string;
  from?: string;
}

// Phase K — system-noise protocol payloads. These fire frequently (idle
// flips) or as informational receipts (terminated, shutdown_approved) and
// render as subtle chips by default instead of full cards.
export interface IdleNotification {
  from: string;
  timestamp?: string;
  idleReason?: string;
}

export interface TeammateTerminated {
  from?: string;
  message?: string;
  timestamp?: string;
}

export interface ShutdownApproved {
  requestId?: string;
  from?: string;
  timestamp?: string;
  paneId?: string;
  backendType?: string;
}

// Conservative sender-name detector: only fires on a literal known pattern.
// Today: `team-lead`, `coder-N`, `pm`, `pm-N`, plus anything matching
// `<slug>-\d+`. Too-broad would false-positive on ordinary user text that
// starts with a word and a newline.
const SENDER_PREAMBLE_RE = /^(team-lead|coder-\d+|pm(?:-[a-z0-9]+)?|[a-z][a-z0-9-]{1,40}-\d+)\s*\n+([\s\S]+)$/;

const tryParseJson = (content: string): unknown | null => {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
};

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export const parseShutdownRequest = (content: string): ShutdownRequest | null => {
  const obj = asRecord(tryParseJson(content));
  if (!obj || obj.type !== 'shutdown_request') return null;
  return {
    from: str(obj.from),
    reason: str(obj.reason),
    requestId: str(obj.requestId ?? obj.request_id),
    timestamp: str(obj.timestamp),
  };
};

export const parseShutdownResponse = (content: string): ShutdownResponse | null => {
  const obj = asRecord(tryParseJson(content));
  if (!obj || obj.type !== 'shutdown_response') return null;
  if (typeof obj.approve !== 'boolean') return null;
  return {
    requestId: str(obj.request_id ?? obj.requestId),
    approve: obj.approve,
    reason: str(obj.reason),
    from: str(obj.from),
  };
};

export const parsePlanApprovalRequest = (content: string): PlanApprovalRequest | null => {
  const obj = asRecord(tryParseJson(content));
  if (!obj || obj.type !== 'plan_approval_request') return null;
  return {
    from: str(obj.from),
    plan: str(obj.plan),
    requestId: str(obj.requestId ?? obj.request_id),
    timestamp: str(obj.timestamp),
  };
};

export const parsePlanApprovalResponse = (content: string): PlanApprovalResponse | null => {
  const obj = asRecord(tryParseJson(content));
  if (!obj || obj.type !== 'plan_approval_response') return null;
  if (typeof obj.approve !== 'boolean') return null;
  return {
    requestId: str(obj.request_id ?? obj.requestId),
    approve: obj.approve,
    feedback: str(obj.feedback),
    from: str(obj.from),
  };
};

export const parseIdleNotification = (content: string): IdleNotification | null => {
  const obj = asRecord(tryParseJson(content));
  if (!obj || obj.type !== 'idle_notification') return null;
  const from = str(obj.from);
  if (!from) return null;
  return {
    from,
    timestamp: str(obj.timestamp),
    idleReason: str(obj.idleReason ?? obj.idle_reason),
  };
};

export const parseTeammateTerminated = (content: string): TeammateTerminated | null => {
  const obj = asRecord(tryParseJson(content));
  if (!obj || obj.type !== 'teammate_terminated') return null;
  return {
    from: str(obj.from),
    message: str(obj.message),
    timestamp: str(obj.timestamp),
  };
};

export const parseShutdownApproved = (content: string): ShutdownApproved | null => {
  const obj = asRecord(tryParseJson(content));
  if (!obj || obj.type !== 'shutdown_approved') return null;
  return {
    requestId: str(obj.requestId ?? obj.request_id),
    from: str(obj.from),
    timestamp: str(obj.timestamp),
    paneId: str(obj.paneId ?? obj.pane_id),
    backendType: str(obj.backendType ?? obj.backend_type),
  };
};

// Detects the "sender\n<body>" preamble form that arrives when the messaging
// layer delivers a plain-text SendMessage that wasn't wrapped in the
// teammate-message XML tag. Maps onto the same TeammateMessageCard so the
// rendering stays consistent.
export const parseSenderPreamble = (content: string): TeammateMessage | null => {
  const match = SENDER_PREAMBLE_RE.exec(content);
  if (!match) return null;
  const teammateId = match[1] ?? '';
  const body = (match[2] ?? '').trim();
  if (!teammateId || !body) return null;
  return {
    teammateId,
    color: '', // Let the card fall back to its default teal
    summary: '',
    body,
  };
};

// Legacy single-result kinds — the shape ChatThread consumed before Phase K.
// Retained for the deprecated `parseStructuredUserContent` compat shim and
// for the variants in the discriminated union `ParsedChatMessage`.
export interface StructuredUserContent {
  kind: 'task-notification';
  notification: TaskNotification;
}

export interface StructuredTeammateContent {
  kind: 'teammate-message';
  teammate: TeammateMessage;
}

export interface StructuredShutdownRequest {
  kind: 'shutdown-request';
  request: ShutdownRequest;
}

export interface StructuredShutdownResponse {
  kind: 'shutdown-response';
  response: ShutdownResponse;
}

export interface StructuredPlanApprovalRequest {
  kind: 'plan-approval-request';
  request: PlanApprovalRequest;
}

export interface StructuredPlanApprovalResponse {
  kind: 'plan-approval-response';
  response: PlanApprovalResponse;
}

export type StructuredUserPayload =
  | StructuredUserContent
  | StructuredTeammateContent
  | StructuredShutdownRequest
  | StructuredShutdownResponse
  | StructuredPlanApprovalRequest
  | StructuredPlanApprovalResponse;

// Phase K — discriminated union returned by `parseChatMessage`. Includes the
// noise-protocol kinds (idle-notification / teammate-terminated /
// shutdown-approved), an unrecognized-protocol fallback for future Claude
// Code payloads we don't model yet, and a `'prose'` kind that carries the
// free-text segments between wrappers in a multi-wrapper message.
export interface TeammateContext {
  teammateId: string;
  color: string;
}

export interface ProseFragment {
  kind: 'prose';
  text: string;
}

export interface IdleNotificationFragment {
  kind: 'idle-notification';
  notification: IdleNotification;
  context?: TeammateContext;
}

export interface TeammateTerminatedFragment {
  kind: 'teammate-terminated';
  notification: TeammateTerminated;
  context?: TeammateContext;
}

export interface ShutdownApprovedFragment {
  kind: 'shutdown-approved';
  notification: ShutdownApproved;
  context?: TeammateContext;
}

export interface UnrecognizedProtocolFragment {
  kind: 'unrecognized-protocol';
  protocolType: string;
  raw: string;
  context?: TeammateContext;
}

export type ParsedChatMessage =
  | ProseFragment
  | StructuredUserContent
  | StructuredTeammateContent
  | StructuredShutdownRequest
  | StructuredShutdownResponse
  | StructuredPlanApprovalRequest
  | StructuredPlanApprovalResponse
  | IdleNotificationFragment
  | TeammateTerminatedFragment
  | ShutdownApprovedFragment
  | UnrecognizedProtocolFragment;

// Turn a parsed JSON object carrying a recognized `type` field into the
// matching fragment. Returns null if the object shape isn't one we handle
// (caller decides whether to emit an `unrecognized-protocol` fragment).
const routeJsonByType = (
  obj: Record<string, unknown>,
  raw: string,
  context?: TeammateContext,
): ParsedChatMessage | null => {
  switch (obj.type) {
    case 'shutdown_request': {
      const parsed = parseShutdownRequest(raw);
      return parsed ? { kind: 'shutdown-request', request: parsed } : null;
    }
    case 'shutdown_response': {
      const parsed = parseShutdownResponse(raw);
      return parsed ? { kind: 'shutdown-response', response: parsed } : null;
    }
    case 'plan_approval_request': {
      const parsed = parsePlanApprovalRequest(raw);
      return parsed ? { kind: 'plan-approval-request', request: parsed } : null;
    }
    case 'plan_approval_response': {
      const parsed = parsePlanApprovalResponse(raw);
      return parsed ? { kind: 'plan-approval-response', response: parsed } : null;
    }
    case 'idle_notification': {
      const parsed = parseIdleNotification(raw);
      return parsed ? { kind: 'idle-notification', notification: parsed, context } : null;
    }
    case 'teammate_terminated': {
      const parsed = parseTeammateTerminated(raw);
      return parsed ? { kind: 'teammate-terminated', notification: parsed, context } : null;
    }
    case 'shutdown_approved': {
      const parsed = parseShutdownApproved(raw);
      return parsed ? { kind: 'shutdown-approved', notification: parsed, context } : null;
    }
    default:
      return null;
  }
};

// Detect a top-level JSON protocol or sender-preamble on a segment of content
// that does NOT live inside a wrapper. Returns null when the segment is plain
// prose (caller emits a ProseFragment if it's non-empty).
const detectTopLevelStructured = (segment: string): ParsedChatMessage | null => {
  const json = tryParseJson(segment);
  const obj = asRecord(json);
  if (obj && typeof obj.type === 'string') {
    const routed = routeJsonByType(obj, segment.trim());
    if (routed) return routed;
    // JSON with a known shape (`type`) but we don't model it — emit the
    // placeholder card so callers never render raw curly braces.
    return {
      kind: 'unrecognized-protocol',
      protocolType: obj.type,
      raw: segment.trim(),
    };
  }

  const preamble = parseSenderPreamble(segment);
  if (preamble) return { kind: 'teammate-message', teammate: preamble };

  return null;
};

// Classify the body of a parsed <teammate-message>. If the body is JSON with
// a recognized `type`, we forward to that fragment and attach the wrapper's
// teammate context (so the chip/card can tint with the teammate's color). If
// the body is unparseable JSON (starts with `{` but fails to parse), we keep
// it as a teammate-message and append an "(unparseable payload)" marker.
// Plain-prose bodies stay as ordinary TeammateMessageCard fragments.
const classifyTeammateBody = (teammate: TeammateMessage): ParsedChatMessage => {
  const context: TeammateContext = { teammateId: teammate.teammateId, color: teammate.color };
  const body = teammate.body;

  if (body.startsWith('{')) {
    const parsed = tryParseJson(body);
    const obj = asRecord(parsed);
    if (obj && typeof obj.type === 'string') {
      const routed = routeJsonByType(obj, body, context);
      if (routed) return routed;
      return {
        kind: 'unrecognized-protocol',
        protocolType: obj.type,
        raw: body,
        context,
      };
    }
    if (parsed === null && body.endsWith('}')) {
      // Looked like JSON but failed to parse — keep as teammate-message and
      // mark so the card shows "(unparseable payload)" instead of garble.
      return {
        kind: 'teammate-message',
        teammate: {
          ...teammate,
          body: `${body}\n\n(unparseable payload)`,
        },
      };
    }
  }

  return { kind: 'teammate-message', teammate };
};

interface WrapperHit {
  kind: 'task' | 'teammate';
  start: number;
  end: number;
  match: RegExpExecArray;
}

// Scan content for all top-level task-notification + teammate-message
// wrappers, in order. We don't attempt to nest — these tags never contain
// each other today, and if they ever did the inner one would get claimed
// by the outer match and that's acceptable (no crash, just one fewer card).
const scanWrappers = (content: string): WrapperHit[] => {
  const hits: WrapperHit[] = [];

  TASK_NOTIFICATION_RE_G.lastIndex = 0;
  let m = TASK_NOTIFICATION_RE_G.exec(content);
  while (m) {
    hits.push({ kind: 'task', start: m.index, end: m.index + m[0].length, match: m });
    m = TASK_NOTIFICATION_RE_G.exec(content);
  }

  TEAMMATE_MESSAGE_RE_G.lastIndex = 0;
  m = TEAMMATE_MESSAGE_RE_G.exec(content);
  while (m) {
    hits.push({ kind: 'teammate', start: m.index, end: m.index + m[0].length, match: m });
    m = TEAMMATE_MESSAGE_RE_G.exec(content);
  }

  hits.sort((a, b) => a.start - b.start);

  // Drop any hits that overlap an earlier hit — keeps the cursor logic
  // monotonic and avoids double-counting if a teammate-message ever wraps
  // a task-notification body (which we'd still render as one card).
  const nonOverlapping: WrapperHit[] = [];
  let lastEnd = -1;
  for (const hit of hits) {
    if (hit.start >= lastEnd) {
      nonOverlapping.push(hit);
      lastEnd = hit.end;
    }
  }
  return nonOverlapping;
};

// Primary entry point. Returns an ordered list of fragments; empty array
// means "no structured content was found" and the caller should fall back
// to rendering the message as ordinary user text.
export const parseChatMessage = (content: string): ParsedChatMessage[] => {
  if (!content || !content.trim()) return [];

  const wrappers = scanWrappers(content);
  if (wrappers.length === 0) {
    const top = detectTopLevelStructured(content);
    return top ? [top] : [];
  }

  const out: ParsedChatMessage[] = [];
  let cursor = 0;

  const emitProse = (segment: string) => {
    if (!segment.trim()) return;
    const top = detectTopLevelStructured(segment);
    if (top) {
      out.push(top);
    } else {
      out.push({ kind: 'prose', text: segment.trim() });
    }
  };

  for (const hit of wrappers) {
    if (hit.start > cursor) {
      emitProse(content.slice(cursor, hit.start));
    }

    if (hit.kind === 'task') {
      const parsed = extractTaskNotification(hit.match[1] ?? '');
      if (parsed) out.push({ kind: 'task-notification', notification: parsed });
    } else {
      const parsed = extractTeammateMessage(hit.match[1] ?? '', hit.match[2] ?? '');
      if (parsed) out.push(classifyTeammateBody(parsed));
    }

    cursor = hit.end;
  }

  if (cursor < content.length) {
    emitProse(content.slice(cursor));
  }

  return out;
};

// Deprecated — Phase F/J single-result API. New callers should use
// `parseChatMessage` so they iterate the full array. Kept as a thin shim
// so test suites and belt-and-suspenders call sites migrate gradually.
// Returns the first non-prose fragment (mapped onto the pre-Phase-K
// `StructuredUserPayload` union) or null.
export const parseStructuredUserContent = (content: string): StructuredUserPayload | null => {
  const fragments = parseChatMessage(content);
  for (const frag of fragments) {
    switch (frag.kind) {
      case 'task-notification':
      case 'teammate-message':
      case 'shutdown-request':
      case 'shutdown-response':
      case 'plan-approval-request':
      case 'plan-approval-response':
        return frag;
      default:
        continue;
    }
  }
  return null;
};
