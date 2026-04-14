export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string; signature?: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
  | { type: 'system_note'; text: string }
  | { type: 'compact_boundary'; trigger: 'manual' | 'auto'; preTokens: number };

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
