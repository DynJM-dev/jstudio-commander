// Model limits as of 2026-04-15. Update when Claude Code changes model naming.

export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

// All prices are per 1M tokens (USD)
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-7':              { input: 15.00, output: 75.00, cacheRead: 1.50, cacheCreation: 18.75 },
  'claude-opus-4-6':              { input: 15.00, output: 75.00, cacheRead: 1.50, cacheCreation: 18.75 },
  'claude-sonnet-4-6':            { input: 3.00,  output: 15.00, cacheRead: 0.30, cacheCreation: 3.75 },
  'claude-haiku-4-5':             { input: 0.80,  output: 4.00,  cacheRead: 0.08, cacheCreation: 1.00 },
  // Legacy models (may appear in older JSONL files)
  'claude-opus-4-5-20251101':     { input: 15.00, output: 75.00, cacheRead: 1.50, cacheCreation: 18.75 },
  'claude-sonnet-4-5-20241022':   { input: 3.00,  output: 15.00, cacheRead: 0.30, cacheCreation: 3.75 },
};

export const DEFAULT_MODEL = 'claude-opus-4-7';

// Default context window per model id (tokens). Models can opt into the
// 1M context window with a `[1m]` suffix on the model field, regardless
// of the base model's default — see `getContextLimit`.
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'claude-opus-4-7': 1_000_000,
  'claude-opus-4-6': 1_000_000,
  'claude-sonnet-4-6': 1_000_000,
  'claude-haiku-4-5': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  'claude-opus-4-5-20251101': 1_000_000,
  'claude-sonnet-4-5-20241022': 200_000,
};

export const DEFAULT_CONTEXT_LIMIT = 200_000;

// Team configs and slash commands often use short model aliases.
export const SHORT_MODEL_MAP: Record<string, string> = {
  opus: 'claude-opus-4-7',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
};

export const normalizeModelId = (model: string): string => {
  const base = model.replace(/\[.*?\]\s*$/, '').trim();
  return SHORT_MODEL_MAP[base] ?? base;
};

export const getContextLimit = (model?: string | null): number => {
  if (!model) return DEFAULT_CONTEXT_LIMIT;
  if (/\[1m\]/i.test(model)) return 1_000_000;
  const normalized = normalizeModelId(model);
  if (!normalized) return DEFAULT_CONTEXT_LIMIT;
  return MODEL_CONTEXT_LIMITS[normalized] ?? DEFAULT_CONTEXT_LIMIT;
};
