import { readFileSync } from 'node:fs';
import type { ChatMessage, ContentBlock, TokenUsage } from '@commander/shared';
import { v4 as uuidv4 } from 'uuid';

// Record types we explicitly skip
const SKIP_TYPES = new Set([
  'permission-mode',
  'file-history-snapshot',
  'queue-operation',
  'ai-title',
  'custom-title',
  'last-prompt',
  'progress',
]);

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

    // Skip known non-message types
    if (SKIP_TYPES.has(type)) return null;

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

    // Unknown type — skip
    return null;
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
    // Only show non-meta system records with meaningful content
    const content = record.content;
    if (!content || record.isMeta) return null;

    // Compact boundaries are interesting to show
    if (record.subtype === 'compact_boundary') {
      return {
        id: record.uuid ?? uuidv4(),
        parentId: record.parentUuid ?? null,
        role: 'system',
        timestamp: record.timestamp ?? new Date().toISOString(),
        content: [{ type: 'system_note', text: `Conversation compacted` }],
        isSidechain: record.isSidechain ?? false,
      };
    }

    return null;
  },

  parseAttachmentRecord(record: RawRecord): ChatMessage | null {
    // Only show edited_text_file attachments as system notes
    const subtype = record.subtype as string | undefined;
    if (subtype === 'edited_text_file') {
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
    return null;
  },
};
