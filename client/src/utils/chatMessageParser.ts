// Structured user-message tags injected by Claude Code.
//
// Claude Code (and its teammate-messaging layer) occasionally routes
// structured payloads through the `user` role of the JSONL transcript,
// wrapped in predictable XML tags. Without a parser they render as if
// the user typed them — ugly "JB" message with raw XML.
//
// We don't import an XML parser: these payloads are predictable,
// machine-authored, and letting a full DOM parser near them would
// expand the XSS surface. A tight regex set is safer and faster.

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

const TASK_NOTIFICATION_RE = /<task-notification\b[^>]*>([\s\S]*?)<\/task-notification>/;
const TEAMMATE_MESSAGE_RE = /<teammate-message\b([^>]*)>([\s\S]*?)<\/teammate-message>/;

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
// as non-matching for now — ChatThread will keep rendering those as a
// normal user message.
const isStrictlyTag = (content: string, match: RegExpExecArray): boolean => {
  const before = content.slice(0, match.index).trim();
  const after = content.slice(match.index + match[0].length).trim();
  return before.length === 0 && after.length === 0;
};

export const parseTaskNotification = (content: string): TaskNotification | null => {
  const match = TASK_NOTIFICATION_RE.exec(content);
  if (!match) return null;
  if (!isStrictlyTag(content, match)) return null;

  const inner = match[1] ?? '';

  const taskId = extractChildText(inner, 'task-id') ?? '';
  const toolUseId = extractChildText(inner, 'tool-use-id') ?? '';
  const outputFile = extractChildText(inner, 'output-file') ?? '';
  const status = extractChildText(inner, 'status') ?? '';
  const summary = extractChildText(inner, 'summary') ?? '';
  const result = extractChildText(inner, 'result') ?? '';

  // Usage block is optional. Scoped extraction keeps stray <total_tokens>
  // tags outside <usage> (there are none today, but be safe) from leaking.
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

  return {
    taskId,
    toolUseId,
    outputFile,
    status,
    summary,
    result,
    usage,
  };
};

export const parseTeammateMessage = (content: string): TeammateMessage | null => {
  const match = TEAMMATE_MESSAGE_RE.exec(content);
  if (!match) return null;
  if (!isStrictlyTag(content, match)) return null;

  const attrs = parseAttrs(match[1] ?? '');
  const body = decodeEntities(match[2] ?? '').trim();

  const teammateId = attrs['teammate_id'] ?? attrs['teammate-id'] ?? '';
  const color = attrs['color'] ?? '';
  const summary = attrs['summary'] ?? '';

  if (!teammateId && !summary && !body) return null;

  return {
    teammateId,
    color,
    summary,
    body,
  };
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

// Single entry point used by ChatThread/UserMessage to classify a user-role
// message. Returns null when the content is plain user text so the normal
// UserMessage render path takes over. Detector order: strongest-signal
// first — XML tags (unambiguous), then JSON protocol messages (also
// unambiguous), then the sender-preamble heuristic (which is conservative
// but can still false-positive on pasted text that happens to start with
// a slug-like word and a newline).
export const parseStructuredUserContent = (content: string): StructuredUserPayload | null => {
  const notification = parseTaskNotification(content);
  if (notification) return { kind: 'task-notification', notification };

  const teammate = parseTeammateMessage(content);
  if (teammate) return { kind: 'teammate-message', teammate };

  const shutdownReq = parseShutdownRequest(content);
  if (shutdownReq) return { kind: 'shutdown-request', request: shutdownReq };

  const shutdownResp = parseShutdownResponse(content);
  if (shutdownResp) return { kind: 'shutdown-response', response: shutdownResp };

  const planReq = parsePlanApprovalRequest(content);
  if (planReq) return { kind: 'plan-approval-request', request: planReq };

  const planResp = parsePlanApprovalResponse(content);
  if (planResp) return { kind: 'plan-approval-response', response: planResp };

  const preamble = parseSenderPreamble(content);
  if (preamble) return { kind: 'teammate-message', teammate: preamble };

  return null;
};
