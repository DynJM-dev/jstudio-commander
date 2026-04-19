// `debug_unmapped` is emitted by the JSONL parser whenever it encounters
// a record shape that has no typed renderer branch yet: an unknown
// top-level record.type, an unknown system.subtype, an unknown
// attachment.type, or an unknown assistant content-block type. The
// renderer maps it to <UnmappedEventChip/>, a muted collapsible debug
// placeholder. This is how the Issue 5 "default = render, never
// vanish" policy surfaces novel Claude Code shapes without requiring
// a parser patch first. The `kind` field tells the reader which
// discriminator missed; `key` carries the specific type name we saw;
// `raw` is an optional payload preview (string) for the collapsed view.
export type UnmappedKind =
  | 'record_type'
  | 'system_subtype'
  | 'attachment_type'
  | 'assistant_block';

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string; signature?: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
  | { type: 'system_note'; text: string }
  | { type: 'compact_boundary'; trigger: 'manual' | 'auto'; preTokens: number }
  // Issue 7 P1 — <system-reminder> attachment rendered as a muted inline
  // footnote visually attached to the preceding user turn. Was
  // `system_note` pre-7; the typed variant lets the renderer style it
  // as a footnote rather than a separator banner.
  | { type: 'inline_reminder'; text: string }
  // Issue 7 P1 — user-attached file (drag/drop/paste). Carries the
  // displayed filename + absolute path + lightweight preview metadata
  // (numLines/totalLines) + optional content preview for expand.
  | {
      type: 'file_attachment';
      filename: string;
      displayPath: string;
      numLines?: number;
      totalLines?: number;
      content?: string;
    }
  // Issue 7 P2 — post-compaction reference to a file that was in the
  // pre-compact context. No content (by design — compaction drops it);
  // UI treats these as historical references with muted styling.
  | { type: 'compact_file_ref'; filename: string; displayPath: string }
  // Issue 9 Part 3 — output from Claude Code slash commands
  // (`/status`, `/compact`, `/login`, etc.) that Claude Code emits
  // as `system.subtype: local_command`. Payload is stdout or stderr
  // wrapped in `<local-command-stdout>` / `<local-command-stderr>`
  // tags. The tag kind drives chrome (error-red for stderr, muted
  // for stdout); the body is click-to-expand.
  | { type: 'local_command'; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'debug_unmapped'; kind: UnmappedKind; key: string; raw?: string };

export interface ChatMessage {
  id: string;
  parentId: string | null;
  role: 'user' | 'assistant' | 'system';
  timestamp: string;
  content: ContentBlock[];
  model?: string;
  usage?: TokenUsage;
  sessionSlug?: string;
  isSidechain: boolean;
  agentId?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}
