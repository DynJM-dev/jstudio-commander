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

export interface StructuredUserContent {
  kind: 'task-notification';
  notification: TaskNotification;
}

export interface StructuredTeammateContent {
  kind: 'teammate-message';
  teammate: TeammateMessage;
}

export type StructuredUserPayload = StructuredUserContent | StructuredTeammateContent;

// Single entry point used by ChatThread/UserMessage to classify a user-role
// message. Returns null when the content is plain user text so the normal
// UserMessage render path takes over.
export const parseStructuredUserContent = (content: string): StructuredUserPayload | null => {
  const notification = parseTaskNotification(content);
  if (notification) return { kind: 'task-notification', notification };
  const teammate = parseTeammateMessage(content);
  if (teammate) return { kind: 'teammate-message', teammate };
  return null;
};
