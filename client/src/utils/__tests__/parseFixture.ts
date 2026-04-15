import { readFileSync } from 'node:fs';
import type { ChatMessage, ContentBlock } from '@commander/shared';

// Minimal JSONL → ChatMessage projection — captures only the fields that
// buildPlanFromMessages actually reads (role, id, content blocks of type
// tool_use / tool_result). Mirrors server/src/services/jsonl-parser.service
// for the subset relevant to plan extraction; keeping this tiny lets the
// tests run via `node --import tsx` without pulling in the full server tree.

interface RawBlock {
  type?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | Array<{ type?: string; text?: string }>;
  is_error?: boolean;
  text?: string;
}

interface RawRecord {
  type?: string;
  uuid?: string;
  isMeta?: boolean;
  message?: {
    role?: string;
    content?: string | RawBlock[];
  };
}

const normalizeToolResultContent = (
  content: string | Array<{ type?: string; text?: string }> | undefined,
): string => {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content.map((b) => b.text ?? '').filter(Boolean).join('\n');
};

const parseBlocks = (raw: RawBlock[], role: 'user' | 'assistant'): ContentBlock[] => {
  const out: ContentBlock[] = [];
  for (const b of raw) {
    if (b.type === 'tool_use' && b.id && b.name) {
      out.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input ?? {} });
    } else if (b.type === 'tool_result' && role === 'user') {
      out.push({
        type: 'tool_result',
        toolUseId: b.tool_use_id ?? '',
        content: normalizeToolResultContent(b.content),
        ...(b.is_error ? { isError: true } : {}),
      });
    } else if (b.type === 'text' && b.text) {
      out.push({ type: 'text', text: b.text });
    }
  }
  return out;
};

export const parseFixture = (path: string): ChatMessage[] => {
  const lines = readFileSync(path, 'utf-8').split('\n').filter((l) => l.trim());
  const messages: ChatMessage[] = [];
  for (const line of lines) {
    let r: RawRecord;
    try { r = JSON.parse(line) as RawRecord; } catch { continue; }
    if (r.isMeta) continue;
    const role = r.message?.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const rawContent = r.message?.content;
    const blocks = typeof rawContent === 'string'
      ? [{ type: 'text', text: rawContent } as ContentBlock]
      : Array.isArray(rawContent)
        ? parseBlocks(rawContent, role)
        : [];
    if (blocks.length === 0) continue;
    messages.push({
      id: r.uuid ?? `synthetic-${messages.length}`,
      parentId: null,
      role,
      timestamp: '',
      content: blocks,
      isSidechain: false,
    });
  }
  return messages;
};
