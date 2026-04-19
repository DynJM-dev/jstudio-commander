import { readFileSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import type { ChatMessage, ContentBlock, TokenUsage, UnmappedKind } from '@commander/shared';
import {
  DROP_RECORD_TYPES,
  DROP_SYSTEM_SUBTYPES,
  DROP_ATTACHMENT_TYPES,
} from '@commander/shared';
import { v4 as uuidv4 } from 'uuid';

// Issue 5 — the chat pipeline's drop invariant.
//
//   Default = render. The denylist (sourced from @commander/shared's
//   event-policy module) is the ONLY drop mechanism — an explicit
//   noise-suppression list, not an allowlist. Anything that isn't
//   handled by a dedicated branch AND isn't on the denylist surfaces
//   as a `debug_unmapped` ContentBlock. The renderer maps that block
//   to the UnmappedEventChip, a muted collapsible debug placeholder,
//   so novel Claude Code record shapes show up in the UI immediately
//   rather than vanishing until someone ships a parser patch.
//
// See packages/shared/src/constants/event-policy.ts for the policy
// statement + rationale per drop entry.

const unmapped = (kind: UnmappedKind, key: string, raw?: string): ContentBlock => ({
  type: 'debug_unmapped',
  kind,
  key,
  ...(raw !== undefined ? { raw } : {}),
});

interface RawRecord {
  type: string;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  timestamp?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  requestId?: string;
  message?: {
    id?: string;
    role?: string;
    content?: string | RawContentBlock[];
    model?: string;
    usage?: RawUsage;
  };
  // system records
  subtype?: string;
  content?: string;
  slug?: string;
  compactMetadata?: {
    trigger?: 'manual' | 'auto';
    preTokens?: number;
  };
  [key: string]: unknown;
}

interface RawContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  signature?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | Array<{ type: string; text: string }>;
  is_error?: boolean;
  source?: { media_type?: string; type?: string; data?: string };
  title?: string;
}

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

const normalizeToolResultContent = (content: string | Array<{ type: string; text: string }> | undefined): string => {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('\n');
  }
  return String(content);
};

const extractUsage = (usage: RawUsage | undefined): TokenUsage | undefined => {
  if (!usage) return undefined;
  const { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens } = usage;
  if (input_tokens === undefined && output_tokens === undefined) return undefined;
  return {
    inputTokens: input_tokens ?? 0,
    outputTokens: output_tokens ?? 0,
    cacheReadTokens: cache_read_input_tokens ?? 0,
    cacheCreationTokens: cache_creation_input_tokens ?? 0,
  };
};

const parseAssistantBlocks = (content: RawContentBlock[]): ContentBlock[] => {
  const blocks: ContentBlock[] = [];
  for (const block of content) {
    switch (block.type) {
      case 'text':
        if (block.text) {
          blocks.push({ type: 'text', text: block.text });
        }
        break;
      case 'thinking':
        blocks.push({
          type: 'thinking',
          text: block.thinking ?? block.text ?? '',
          ...(block.signature ? { signature: block.signature } : {}),
        });
        break;
      case 'tool_use':
        if (block.id && block.name) {
          blocks.push({
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input ?? {},
          });
        }
        break;
      default: {
        // Default = surface, not drop. A future Anthropic content-block
        // shape (server_tool_use, redacted_thinking, document, etc.)
        // would otherwise strip from the turn entirely and — if it was
        // the only block — collapse the whole assistant message to
        // nothing. debug_unmapped carries the shape identifier + a
        // short raw preview so the UnmappedEventChip renderer can show
        // what was dropped from Claude Code's point of view.
        const preview = block.text ?? block.thinking ?? (block.name ? `tool: ${block.name}` : undefined);
        blocks.push(unmapped('assistant_block', block.type, preview));
        break;
      }
    }
  }
  return blocks;
};

const parseUserContent = (content: string | RawContentBlock[]): ContentBlock[] => {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }

  if (!Array.isArray(content)) {
    return [{ type: 'text', text: String(content) }];
  }

  const blocks: ContentBlock[] = [];
  for (const block of content) {
    switch (block.type) {
      case 'tool_result':
        blocks.push({
          type: 'tool_result',
          toolUseId: block.tool_use_id ?? '',
          content: normalizeToolResultContent(block.content),
          ...(block.is_error ? { isError: true } : {}),
        });
        break;
      case 'text':
        if (block.text) {
          blocks.push({ type: 'text', text: block.text });
        }
        break;
      case 'document':
        // Skip document/attachment blocks in user messages (system context injection)
        break;
      default:
        if (block.text) {
          blocks.push({ type: 'text', text: block.text });
        }
        break;
    }
  }
  return blocks;
};

export const jsonlParserService = {
  parseFile(filePath: string): ChatMessage[] {
    const raw = readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    return this.parseLines(lines);
  },

  parseLines(lines: string[]): ChatMessage[] {
    const messages: ChatMessage[] = [];
    for (const line of lines) {
      try {
        const record = JSON.parse(line) as RawRecord;
        const msg = this.parseRecord(record);
        if (msg) messages.push(msg);
      } catch {
        // Malformed JSON line — skip silently
      }
    }
    return messages;
  },

  parseRecord(record: RawRecord): ChatMessage | null {
    // Skip meta records
    if (record.isMeta) return null;

    const type = record.type;

    // Denylist — explicit noise suppression per the Issue 5 policy.
    // Known-renderer types continue below; anything else falls through
    // to the debug_unmapped chip.
    if (DROP_RECORD_TYPES.has(type)) return null;

    if (type === 'user') {
      return this.parseUserRecord(record);
    }

    if (type === 'assistant') {
      return this.parseAssistantRecord(record);
    }

    if (type === 'system') {
      return this.parseSystemRecord(record);
    }

    if (type === 'attachment') {
      return this.parseAttachmentRecord(record);
    }

    // Unknown top-level record type — surface as the debug placeholder
    // block rather than silently dropping. Future Claude Code record
    // shapes land here until we wire a dedicated renderer, so "empty
    // chat" is never the failure mode of an unrecognized record.
    return {
      id: record.uuid ?? uuidv4(),
      parentId: record.parentUuid ?? null,
      role: 'system',
      timestamp: record.timestamp ?? new Date().toISOString(),
      content: [unmapped('record_type', type)],
      isSidechain: record.isSidechain ?? false,
    };
  },

  parseUserRecord(record: RawRecord): ChatMessage | null {
    const content = record.message?.content;
    if (content === undefined || content === null) return null;

    const blocks = parseUserContent(content);
    if (blocks.length === 0) return null;

    return {
      id: record.uuid ?? uuidv4(),
      parentId: record.parentUuid ?? null,
      role: 'user',
      timestamp: record.timestamp ?? new Date().toISOString(),
      content: blocks,
      isSidechain: record.isSidechain ?? false,
      sessionSlug: record.slug as string | undefined,
    };
  },

  parseAssistantRecord(record: RawRecord): ChatMessage | null {
    const msgContent = record.message?.content;
    if (!Array.isArray(msgContent) || msgContent.length === 0) return null;

    const blocks = parseAssistantBlocks(msgContent);
    if (blocks.length === 0) return null;

    const usage = extractUsage(record.message?.usage);

    return {
      id: record.uuid ?? record.message?.id ?? uuidv4(),
      parentId: record.parentUuid ?? null,
      role: 'assistant',
      timestamp: record.timestamp ?? new Date().toISOString(),
      content: blocks,
      model: record.message?.model,
      usage,
      isSidechain: record.isSidechain ?? false,
      sessionSlug: record.slug as string | undefined,
    };
  },

  parseSystemRecord(record: RawRecord): ChatMessage | null {
    // Compact boundaries: emit a dedicated block so the client can render a
    // separator AND reset the running context-token counter past this point.
    if (record.subtype === 'compact_boundary') {
      const trigger = record.compactMetadata?.trigger === 'auto' ? 'auto' : 'manual';
      const preTokens = record.compactMetadata?.preTokens ?? 0;
      return {
        id: record.uuid ?? uuidv4(),
        parentId: record.parentUuid ?? null,
        role: 'system',
        timestamp: record.timestamp ?? new Date().toISOString(),
        content: [{ type: 'compact_boundary', trigger, preTokens }],
        isSidechain: record.isSidechain ?? false,
      };
    }

    // Denylist — explicit noise suppression. The set is the SSOT in
    // @commander/shared; see event-policy.ts for rationale per entry.
    if (record.subtype && DROP_SYSTEM_SUBTYPES.has(record.subtype)) return null;

    // Issue 9 Part 3 — slash-command local output (`/status`,
    // `/compact`, etc.). Claude Code wraps the stream in
    // `<local-command-stdout>` / `<local-command-stderr>` tags; we
    // surface as a typed `local_command` block so the renderer can
    // show an expandable chip with the correct chrome (stderr →
    // error-red, stdout → muted). The content body is extracted
    // from inside the tag; when the shape drifts, we fall through
    // to the debug chip via the default branch below.
    if (record.subtype === 'local_command' && typeof record.content === 'string') {
      const raw = record.content;
      const stdoutMatch = /^<local-command-stdout>([\s\S]*?)<\/local-command-stdout>$/.exec(raw);
      const stderrMatch = /^<local-command-stderr>([\s\S]*?)<\/local-command-stderr>$/.exec(raw);
      if (stdoutMatch) {
        return {
          id: record.uuid ?? uuidv4(),
          parentId: record.parentUuid ?? null,
          role: 'system',
          timestamp: record.timestamp ?? new Date().toISOString(),
          content: [{ type: 'local_command', stream: 'stdout', text: stdoutMatch[1]!.trim() }],
          isSidechain: record.isSidechain ?? false,
        };
      }
      if (stderrMatch) {
        return {
          id: record.uuid ?? uuidv4(),
          parentId: record.parentUuid ?? null,
          role: 'system',
          timestamp: record.timestamp ?? new Date().toISOString(),
          content: [{ type: 'local_command', stream: 'stderr', text: stderrMatch[1]!.trim() }],
          isSidechain: record.isSidechain ?? false,
        };
      }
      // Shape drift → fall through to debug chip so the novel form
      // surfaces instead of silently dropping.
    }

    // Anything else: surface as the debug placeholder block. The
    // UnmappedEventChip renderer uses `key` to label the chip and
    // (when present) `raw` for the collapsed payload preview.
    const raw =
      typeof record.content === 'string' && record.content.trim().length > 0
        ? record.content.trim()
        : undefined;

    return {
      id: record.uuid ?? uuidv4(),
      parentId: record.parentUuid ?? null,
      role: 'system',
      timestamp: record.timestamp ?? new Date().toISOString(),
      content: [unmapped('system_subtype', record.subtype ?? 'unknown', raw)],
      isSidechain: record.isSidechain ?? false,
    };
  },

  parseAttachmentRecord(record: RawRecord): ChatMessage | null {
    // The discriminator lives on `record.attachment.type`, not
    // `record.subtype` (which is always absent on attachment records
    // written by Claude Code). Reading the wrong field was a silent
    // drop of every attachment — the fresh-session surface and any
    // task_reminder the pane showed Claude never reached the chat.
    const inner = (record as { attachment?: { type?: string; content?: string } }).attachment;
    const innerType = inner?.type;
    if (!innerType) return null;

    // Issue 7.1 — upgrade from system_note banner to file_edit_note
    // block. Shape inventory: attachment.{filename, snippet}. snippet
    // is a numbered post-edit view (no old/new diff pair present in
    // the JSONL record; a synthesized diff would require the preceding
    // file state which we don't have). Renderer shows filename +
    // click-to-expand snippet.
    if (innerType === 'edited_text_file') {
      const att = (record as Record<string, unknown>).attachment as
        | { filename?: string; snippet?: string }
        | undefined;
      const topLevelPath = (record as Record<string, unknown>).filePath;
      const filename =
        (typeof att?.filename === 'string' && att.filename) ||
        (typeof topLevelPath === 'string' && topLevelPath) ||
        'unknown file';
      const snippet = typeof att?.snippet === 'string' ? att.snippet : undefined;
      return {
        id: record.uuid ?? uuidv4(),
        parentId: record.parentUuid ?? null,
        role: 'system',
        timestamp: record.timestamp ?? new Date().toISOString(),
        content: [{
          type: 'file_edit_note',
          filename,
          ...(snippet !== undefined ? { snippet } : {}),
        }],
        isSidechain: false,
      };
    }

    // Issue 7.1 — skill_listing / invoked_skills / queued_command.
    // Each parses attachment.* fields into the typed ContentBlock so
    // the renderer has structured data; shape drift falls through to
    // the debug chip via the tail branch of this function.
    if (innerType === 'skill_listing') {
      const att = (record as Record<string, unknown>).attachment as
        | { content?: string; isInitial?: boolean }
        | undefined;
      const raw = typeof att?.content === 'string' ? att.content : '';
      // Each line: `- skill-name: description`. Tolerate description
      // absent; skip lines that don't start with `- `.
      const skills: Array<{ name: string; description?: string }> = [];
      for (const line of raw.split('\n')) {
        const m = /^-\s+([\w./:-]+)\s*:\s*(.*)$/.exec(line.trim());
        if (!m) {
          const nameOnly = /^-\s+([\w./:-]+)\s*$/.exec(line.trim());
          if (nameOnly) skills.push({ name: nameOnly[1]! });
          continue;
        }
        const description = m[2]!.trim();
        skills.push(description ? { name: m[1]!, description } : { name: m[1]! });
      }
      return {
        id: record.uuid ?? uuidv4(),
        parentId: record.parentUuid ?? null,
        role: 'system',
        timestamp: record.timestamp ?? new Date().toISOString(),
        content: [{
          type: 'skill_listing',
          skills,
          isInitial: att?.isInitial === true,
        }],
        isSidechain: false,
      };
    }

    if (innerType === 'invoked_skills') {
      const att = (record as Record<string, unknown>).attachment as
        | { skills?: Array<{ name?: string; path?: string }> }
        | undefined;
      const skills = (att?.skills ?? [])
        .filter((s): s is { name: string; path?: string } => typeof s?.name === 'string')
        .map((s) => (s.path ? { name: s.name, path: s.path } : { name: s.name }));
      return {
        id: record.uuid ?? uuidv4(),
        parentId: record.parentUuid ?? null,
        role: 'system',
        timestamp: record.timestamp ?? new Date().toISOString(),
        content: [{ type: 'invoked_skills', skills }],
        isSidechain: false,
      };
    }

    if (innerType === 'queued_command') {
      const att = (record as Record<string, unknown>).attachment as
        | { prompt?: string; commandMode?: string }
        | undefined;
      const prompt = typeof att?.prompt === 'string' ? att.prompt : '';
      return {
        id: record.uuid ?? uuidv4(),
        parentId: record.parentUuid ?? null,
        role: 'system',
        timestamp: record.timestamp ?? new Date().toISOString(),
        content: [{
          type: 'queued_command',
          prompt,
          ...(typeof att?.commandMode === 'string' ? { commandMode: att.commandMode } : {}),
        }],
        isSidechain: false,
      };
    }

    // Issue 7 P1 — <system-reminder> becomes a typed inline_reminder
    // block. UI styles it as a muted footnote attached to the preceding
    // user turn rather than a standalone banner.
    if (innerType === 'task_reminder' && typeof inner?.content === 'string' && inner.content.trim().length > 0) {
      return {
        id: record.uuid ?? uuidv4(),
        parentId: record.parentUuid ?? null,
        role: 'system',
        timestamp: record.timestamp ?? new Date().toISOString(),
        content: [{ type: 'inline_reminder', text: inner.content.trim() }],
        isSidechain: false,
      };
    }

    // Issue 7 P1 — user-attached file. The shape is nested:
    // attachment.content.file.{filePath, content, numLines, totalLines}.
    // Treat any missing field as absent (UI degrades gracefully) so a
    // minor shape drift doesn't crash into the debug chip for a
    // high-frequency attachment.
    if (innerType === 'file') {
      const ext = record as Record<string, unknown> & {
        attachment?: {
          filename?: string;
          displayPath?: string;
          content?: { file?: { filePath?: string; content?: string; numLines?: string | number; totalLines?: string | number } };
        };
      };
      const att = ext.attachment;
      const file = att?.content?.file;
      const toNum = (v: string | number | undefined): number | undefined => {
        if (v === undefined) return undefined;
        const n = typeof v === 'number' ? v : parseInt(v, 10);
        return Number.isFinite(n) ? n : undefined;
      };
      const filename = att?.filename ?? file?.filePath ?? 'unknown';
      const displayPath = att?.displayPath ?? filename;
      return {
        id: record.uuid ?? uuidv4(),
        parentId: record.parentUuid ?? null,
        role: 'system',
        timestamp: record.timestamp ?? new Date().toISOString(),
        content: [{
          type: 'file_attachment',
          filename,
          displayPath,
          ...(toNum(file?.numLines) !== undefined ? { numLines: toNum(file?.numLines) } : {}),
          ...(toNum(file?.totalLines) !== undefined ? { totalLines: toNum(file?.totalLines) } : {}),
          ...(typeof file?.content === 'string' && file.content.length > 0 ? { content: file.content } : {}),
        }],
        isSidechain: false,
      };
    }

    // Issue 7 P2 — post-compaction file reference. No content by
    // design (compaction drops it); UI treats as historical.
    if (innerType === 'compact_file_reference') {
      const ext = record as Record<string, unknown> & {
        attachment?: { filename?: string; displayPath?: string };
      };
      const att = ext.attachment;
      const filename = att?.filename ?? 'unknown';
      const displayPath = att?.displayPath ?? filename;
      return {
        id: record.uuid ?? uuidv4(),
        parentId: record.parentUuid ?? null,
        role: 'system',
        timestamp: record.timestamp ?? new Date().toISOString(),
        content: [{ type: 'compact_file_ref', filename, displayPath }],
        isSidechain: false,
      };
    }

    // Denylist — high-volume / low-signal attachments. Rationale per
    // entry lives in @commander/shared's event-policy.ts.
    if (DROP_ATTACHMENT_TYPES.has(innerType)) return null;

    // Unknown attachment — surface as the debug placeholder block so
    // the user sees Claude Code injected something we haven't modeled.
    // The inner `content` (when present) ships as the raw preview for
    // the collapsible chip.
    const raw =
      typeof inner?.content === 'string' && inner.content.trim().length > 0
        ? inner.content.trim()
        : undefined;

    return {
      id: record.uuid ?? uuidv4(),
      parentId: record.parentUuid ?? null,
      role: 'system',
      timestamp: record.timestamp ?? new Date().toISOString(),
      content: [unmapped('attachment_type', innerType, raw)],
      isSidechain: false,
    };
  },
};

// Issue 15 — tool-use / tool-result pairing probe for the Stop-hook gate.
//
// Claude Code fires the Stop hook every time the LLM yields, which
// includes the gap between an `assistant tool_use` record and the
// matching `user tool_result`. The LLM IS idle during tool execution,
// but the session is still doing work. Commander's Stop handler was
// slamming status='idle' in that gap, activating the 60s hook-yield
// gate in the poller and locking in the false-idle for the duration
// of the tool call.
//
// The JSONL is the authoritative structured signal: every tool_use
// block carries a unique `id`; the matching tool_result block carries
// the same id in its `tool_use_id`. An unmatched tool_use means the
// tool call is still in flight.
//
// PATTERN-MATCHING CONSTRAINT (agent-status.service.ts §24): this
// probe is explicit-semantic — it pairs on the Claude Code JSONL
// contract (tool_use.id ↔ tool_result.tool_use_id). Not a character
// match, not a pane-text scan.
//
// Performance: we read a bounded tail of the file (last TAIL_BYTES),
// not the full transcript. Claude Code's tool_use/tool_result records
// are typically < 1 KB each, so 64 KB covers the last few dozen
// records — more than enough for the "last turn" resolution needed.
// Infrequent caller (Stop hook fires at turn boundaries, not per-token),
// so even a few-ms disk read per call is negligible.
const PENDING_TOOL_TAIL_BYTES = 64 * 1024;

// Exposed for unit testing — pure function over lines, no I/O.
export const hasUnmatchedToolUseInLines = (lines: string[]): boolean => {
  const toolUseIds = new Set<string>();
  const toolResultIds = new Set<string>();
  for (const line of lines) {
    if (!line || line[0] !== '{') continue;
    let rec: RawRecord;
    try {
      rec = JSON.parse(line) as RawRecord;
    } catch {
      continue;
    }
    const content = rec.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === 'tool_use' && typeof block.id === 'string' && block.id.length > 0) {
        toolUseIds.add(block.id);
      } else if (block.type === 'tool_result' && typeof block.tool_use_id === 'string' && block.tool_use_id.length > 0) {
        toolResultIds.add(block.tool_use_id);
      }
    }
  }
  // Any tool_use id without a matching tool_result means the tool call
  // has not yet returned. Within a bounded tail read the reverse case
  // (tool_result without a tool_use in the window) is tolerated — the
  // originating tool_use likely lives earlier in the transcript.
  for (const id of toolUseIds) {
    if (!toolResultIds.has(id)) return true;
  }
  return false;
};

// Read the last PENDING_TOOL_TAIL_BYTES of a JSONL and return true iff
// its records contain an unmatched tool_use. Missing / unreadable files
// return false (the Stop handler should behave as before — flip idle).
// Malformed JSONL lines are skipped per `hasUnmatchedToolUseInLines`.
export const hasPendingToolUseInTranscript = (transcriptPath: string): boolean => {
  let fd: number;
  try {
    fd = openSync(transcriptPath, 'r');
  } catch {
    return false;
  }
  try {
    let size: number;
    try {
      size = statSync(transcriptPath).size;
    } catch {
      return false;
    }
    if (size === 0) return false;
    const toRead = Math.min(size, PENDING_TOOL_TAIL_BYTES);
    const start = size - toRead;
    const buf = Buffer.alloc(toRead);
    const bytesRead = readSync(fd, buf, 0, toRead, start);
    const tail = buf.toString('utf-8', 0, bytesRead);
    // Drop the first (possibly partial) line when we didn't start at
    // file head — splitting a JSON record mid-way yields garbage that
    // would false-positive as an unparseable line. When start === 0
    // the first line is guaranteed whole.
    const rawLines = tail.split('\n').filter((l) => l.length > 0);
    const lines = start === 0 ? rawLines : rawLines.slice(1);
    return hasUnmatchedToolUseInLines(lines);
  } catch {
    return false;
  } finally {
    try { closeSync(fd); } catch { /* already closed */ }
  }
};
