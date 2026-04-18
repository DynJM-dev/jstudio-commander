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
