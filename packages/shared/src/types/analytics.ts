export interface TokenUsageEntry {
  id: number;
  sessionId: string;
  projectId: string | null;
  messageId: string | null;
  requestId: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  timestamp: string;
}

export interface CostEntry {
  id: number;
  date: string;
  sessionId: string | null;
  projectId: string | null;
  model: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalCostUsd: number;
  messageCount: number;
}

export interface DailyStats {
  date: string;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  messageCount: number;
  byModel: Record<string, {
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
  }>;
}
