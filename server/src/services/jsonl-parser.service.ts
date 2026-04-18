import { readFileSync } from 'node:fs';
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

    if (innerType === 'edited_text_file') {
      const filename = (record as Record<string, unknown>).filePath ?? 'unknown file';
      return {
        id: record.uuid ?? uuidv4(),
        parentId: record.parentUuid ?? null,
        role: 'system',
        timestamp: record.timestamp ?? new Date().toISOString(),
        content: [{ type: 'system_note', text: `Edited: ${filename}` }],
        isSidechain: false,
      };
    }

    // The <system-reminder> block the pane shows Claude. Surface the
    // raw reminder text as a system note so the chat transcript holds
    // the same cue Claude saw when reasoning about the turn.
    if (innerType === 'task_reminder' && typeof inner?.content === 'string' && inner.content.trim().length > 0) {
      return {
        id: record.uuid ?? uuidv4(),
        parentId: record.parentUuid ?? null,
        role: 'system',
        timestamp: record.timestamp ?? new Date().toISOString(),
        content: [{ type: 'system_note', text: inner.content.trim() }],
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
