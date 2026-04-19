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
  // Issue 7.1 — post-edit file snapshot emitted by Claude Code as
  // `attachment.type: edited_text_file`. Upgrades the Issue 7 era
  // system_note banner. Shape from pane inventory:
  //   {filename, snippet}
  // `snippet` is the numbered post-edit view (no old/new diff pair);
  // this variant doesn't attempt to synthesize a diff from a single
  // snapshot. Renderer shows filename + click-to-expand snippet.
  | { type: 'file_edit_note'; filename: string; snippet?: string }
  // Issue 7.1 — list of skills available to this session, emitted as
  // `attachment.type: skill_listing` on session start. Content is a
  // newline-separated `- name: description` block the parser splits
  // into structured entries; `isInitial` flags session-start vs.
  // mid-session reload.
  | { type: 'skill_listing'; skills: Array<{ name: string; description?: string }>; isInitial: boolean }
  // Issue 7.1 — skills actually invoked at a specific point in the
  // turn, emitted as `attachment.type: invoked_skills`. Parser keeps
  // just the name + path from the (potentially large) skills list
  // so the chip stays light.
  | { type: 'invoked_skills'; skills: Array<{ name: string; path?: string }> }
  // Issue 7.1 — command queued for dispatch, emitted as
  // `attachment.type: queued_command`. `prompt` is the queued text;
  // `commandMode` distinguishes prompt vs. other modes ('prompt' in
  // all observed records).
  | { type: 'queued_command'; prompt: string; commandMode?: string }
  // Issue 15.1-G — post-compact synthetic summary Claude Code injects
  // after every compaction. Raw JSONL shape: `type: 'user'`,
  // `role: 'user'`, `isCompactSummary: true`, `isVisibleInTranscriptOnly:
  // true`. Pre-fix it rendered with the JB crown icon (as if Jose sent
  // it); this typed variant lets the renderer route it to SystemNote so
  // it's visually distinct from real user turns. `text` is the summary
  // body; the structured-metadata discriminator (isCompactSummary) is
  // the §24 authoritative signal, NOT text-prose matching.
  | { type: 'compact_summary'; text: string }
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
